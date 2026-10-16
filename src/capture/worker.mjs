import { parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { CubeRecorder } from '../research/cube-recorder.mjs';
import { createCubeHotkeys } from './hotkeys.mjs';
import { listDevices, openDevice, gamePids, tcpConnections } from './npcap.mjs';
import { parseTcpFrame, TcpStream } from './tcp.mjs';
import { FrameStream } from '../protocol/framing.mjs';
import { CubeDetector } from '../cube-detector.mjs';

const handles = new Map(), streams = new Map(), issues = new Map(), opcodes = new Map();
const recorder = new CubeRecorder(workerData?.researchDirectory || fileURLToPath(new URL('../../captures/cube-research/', import.meta.url)));
const detector = new CubeDetector({onChange:event=>recorder.annotation(event),onPosition:event=>recorder.annotation(event)});
let cubeRevision = -1;
let streamNumber = 0, researchError = null;
let stopped = false, refreshing = false, events = [], packetCount = 0, decoded = 0, unknown = 0;
let status = { state: 'starting', connections: 0, adapters: 0, error: null };
let lastMessageAt = null, processingLagMs = 0;
const hotkeys = createCubeHotkeys(action => {
  try { researchError = null; if (action === 'found') recorder.found(status); else recorder.opened(status); }
  catch (error) { researchError = error.message; issue(`research:${error.message}`); }
  sendStatus();
});
const issue = (key, stream = null) => {
  if (issues.size < 100 || issues.has(key)) issues.set(key, (issues.get(key) || 0) + 1);
  recorder.issue(key, stream);
  if(['stream-gap','bad-frame','sync-discard','unrecognized-stream'].includes(key)||key.includes(':0xffff:'))detector.invalidate(stream,key);
};
const researchStatus = () => ({ ...recorder.status(), commandError: researchError, hotkeys: hotkeys.status() });
const sendStatus = () => parentPort.postMessage({ type: 'status', ...status, lastMessageAt, processingLagMs, packetCount, decoded, unknown, issues: Object.fromEntries(issues), opcodes: Object.fromEntries(opcodes), duplicates: [...streams.values()].reduce((n,s)=>n+s.tcp.duplicates,0), research: researchStatus(), cubes:detector.snapshot() });
function newStream() {
  const id = `flow-${++streamNumber}`;
  const frame = new FrameStream(packet => {
    const code = `0x${packet.opcode.toString(16)}`;
    if (opcodes.size < 256 || opcodes.has(code)) opcodes.set(code, (opcodes.get(code) || 0) + 1);
    if (packet.known) { decoded++; events.push(...packet.events); } else unknown++;
  }, code => issue(code, id), packet => { lastMessageAt=packet.at;processingLagMs=Math.max(0,Date.now()-packet.at);recorder.message(packet, id); detector.message(packet, id); });
  const tcp = new TcpStream((bytes, at) => frame.push(bytes, at), at => { frame.gap(); events.push({ type: 'capture-gap', at }); });
  return { frame, tcp, id };
}
async function refresh() {
  if (stopped || refreshing) return;
  refreshing = true;
  try {
    const pids = await gamePids(); if (stopped) return;
    const connections = tcpConnections(pids), devices = listDevices(), active = new Set(connections.map(c => c.key));
    for (const key of streams.keys()) if (!active.has(key)) { const id=streams.get(key).id;recorder.issue('connection-closed', id);detector.invalidate(id,'connection-closed');streams.delete(key); }
    for (const key of active) if (!streams.has(key)) streams.set(key, newStream());
    const plans = new Map();
    for (const c of connections) {
      const candidates = devices.filter(d => c.localAddress.startsWith('127.') ? d.loopback : d.addresses.includes(c.localAddress));
      if (!candidates.length) { issue('adapter-not-found'); continue; }
      for (const d of candidates) {
        const clauses = plans.get(d.name) || new Set();
        clauses.add(`(src host ${c.remoteAddress} and src port ${c.remotePort} and dst host ${c.localAddress} and dst port ${c.localPort})`);
        plans.set(d.name, clauses);
      }
    }
    for (const [name, handle] of handles) if (!plans.has(name)) { handle.device.close(); handles.delete(name); }
    const errors = [];
    for (const [name, clauses] of plans) {
      const filter = `ip and tcp and (${[...clauses].sort().join(' or ')})`;
      if (handles.get(name)?.filter === filter) continue;
      try {
        const device = openDevice(name, filter); handles.get(name)?.device.close(); handles.set(name, { device, filter });
      } catch (error) { errors.push(error.message); }
    }
    status = { state: !pids.size ? 'waiting-for-game' : !connections.length ? 'waiting-for-connection' : handles.size ? 'capturing' : 'error', processes: pids.size, connections: connections.length, adapters: handles.size,
      error: errors.join('; ') || (connections.length && !handles.size ? 'Oyun bağlantısına ait IPv4 adaptörü bulunamadı.' : null), deviceCount: devices.length };
  } catch (error) { status = { ...status, state: 'error', error: error.message };detector.invalidate(null,'capture-error'); }
  finally { refreshing = false; if (!stopped) sendStatus(); }
}
const poll = setInterval(() => {
  recorder.tick();detector.tick();
  hotkeys.setEnabled(recorder.active || recorder.armed); hotkeys.poll();
  for (const [name, handle] of handles) {
    try {
      const deadline=performance.now()+8;
      for (let n = 0; n < 1500; n++) {
        const packet = handle.device.next(); if (!packet) break;
        packetCount++; const tcp = parseTcpFrame(packet.bytes, handle.device.linkType); if (!tcp) continue;
        const stream = streams.get(`${tcp.source}>${tcp.destination}`);
        stream?.tcp.push(tcp.sequence, tcp.payload, tcp.syn, packet.at);
        if(performance.now()>=deadline)break; // let commands/status run between busy batches
      }
    } catch (error) { issue(`capture:${error.message}`);detector.invalidate(null,'capture-error'); handle.device.close(); handles.delete(name); }
  }
  for (const stream of streams.values()) stream.tcp.tick(Date.now());
  if (events.length) { parentPort.postMessage({ type: 'events', events }); events = []; }
  if(cubeRevision!==detector.revision){cubeRevision=detector.revision;sendStatus();parentPort.postMessage({type:'cube-status',cubes:detector.snapshot()});}
}, 20);
const discovery = setInterval(refresh, 2000), reports = setInterval(sendStatus, 1000);
parentPort.on('message', message => {
  if (message?.type === 'research-command') {
    try {
      researchError = null;
      if(message.expiresAt && Date.now()>=message.expiresAt)throw Error('İşlem beklerken süresi doldu; yeniden deneyin.');
      if (message.action === 'arm') recorder.arm();
      else if (message.action === 'found') recorder.found(status);
      else if (message.action === 'opened') recorder.opened(status);
      else if (message.action === 'start') recorder.start(status);
      else if (message.action === 'mark') recorder.mark(message.phase);
      else if (message.action === 'stop') recorder.stop(message.reason || 'manual');
      else throw Error('Geçersiz inceleme işlemi.');
      hotkeys.setEnabled(recorder.active || recorder.armed);
      parentPort.postMessage({ type: 'research-result', requestId: message.requestId, research: researchStatus() });
    } catch (error) { researchError = error.message; parentPort.postMessage({ type: 'research-result', requestId: message.requestId, error: error.message, research: researchStatus() }); }
    sendStatus(); return;
  }
  if (message === 'stop') {
    detector.invalidate(null,'capture-stopped');
    recorder.stop('capture-stopped');
    hotkeys.close();
    stopped = true; clearInterval(poll); clearInterval(discovery); clearInterval(reports);
    for (const { device } of handles.values()) device.close();
    handles.clear(); parentPort.postMessage({ type: 'stopped', research: researchStatus(), cubes:detector.snapshot() }); parentPort.close();
  }
});
refresh();
