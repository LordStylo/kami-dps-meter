import { parentPort } from 'node:worker_threads';
import { listDevices, openDevice, gamePids, tcpConnections } from './npcap.mjs';
import { parseTcpFrame, TcpStream } from './tcp.mjs';
import { FrameStream } from '../protocol/framing.mjs';

const handles = new Map(), streams = new Map(), issues = new Map(), opcodes = new Map();
let stopped = false, refreshing = false, events = [], packetCount = 0, decoded = 0, unknown = 0;
let status = { state: 'starting', connections: 0, adapters: 0, error: null };
const issue = key => { if (issues.size < 100 || issues.has(key)) issues.set(key, (issues.get(key) || 0) + 1); };
const sendStatus = () => parentPort.postMessage({ type: 'status', ...status, packetCount, decoded, unknown, issues: Object.fromEntries(issues), opcodes: Object.fromEntries(opcodes), duplicates: [...streams.values()].reduce((n,s)=>n+s.tcp.duplicates,0) });
function newStream() {
  const frame = new FrameStream(packet => {
    const code = `0x${packet.opcode.toString(16)}`;
    if (opcodes.size < 256 || opcodes.has(code)) opcodes.set(code, (opcodes.get(code) || 0) + 1);
    if (packet.known) { decoded++; events.push(...packet.events); } else unknown++;
  }, issue);
  const tcp = new TcpStream((bytes, at) => frame.push(bytes, at), at => { frame.gap(); events.push({ type: 'capture-gap', at }); });
  return { frame, tcp };
}
async function refresh() {
  if (stopped || refreshing) return;
  refreshing = true;
  try {
    const pids = await gamePids(); if (stopped) return;
    const connections = tcpConnections(pids), devices = listDevices(), active = new Set(connections.map(c => c.key));
    for (const key of streams.keys()) if (!active.has(key)) streams.delete(key);
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
  } catch (error) { status = { ...status, state: 'error', error: error.message }; }
  finally { refreshing = false; if (!stopped) sendStatus(); }
}
const poll = setInterval(() => {
  for (const [name, handle] of handles) {
    try {
      for (let n = 0; n < 1500; n++) {
        const packet = handle.device.next(); if (!packet) break;
        packetCount++; const tcp = parseTcpFrame(packet.bytes, handle.device.linkType); if (!tcp) continue;
        const stream = streams.get(`${tcp.source}>${tcp.destination}`);
        stream?.tcp.push(tcp.sequence, tcp.payload, tcp.syn, packet.at);
      }
    } catch (error) { issue(`capture:${error.message}`); handle.device.close(); handles.delete(name); }
  }
  for (const stream of streams.values()) stream.tcp.tick(Date.now());
  if (events.length) { parentPort.postMessage({ type: 'events', events }); events = []; }
}, 20);
const discovery = setInterval(refresh, 2000), reports = setInterval(sendStatus, 1000);
parentPort.on('message', message => {
  if (message === 'stop') {
    stopped = true; clearInterval(poll); clearInterval(discovery); clearInterval(reports);
    for (const { device } of handles.values()) device.close();
    handles.clear(); parentPort.postMessage({ type: 'stopped' }); parentPort.close();
  }
});
refresh();
