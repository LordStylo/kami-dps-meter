import { listDevices, openDevice, tcpConnections, gamePids } from '../src/capture/npcap.mjs';
const devices = listDevices(), pids = await gamePids();
const loopback = devices.find(d => d.loopback);
if (!loopback) throw Error('Npcap loopback adapter not found');
const capture = openDevice(loopback.name, 'tcp and port 65534'); capture.next(); capture.close();
console.log(JSON.stringify({ npcap: 'loaded', adapterOpen: 'passed', devices: devices.length, gameProcesses: pids.size, gameConnections: tcpConnections(pids).length }, null, 2));
