import koffi from 'koffi';
import path from 'node:path';
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);
let api;

function native() {
  if (api) return api;
  if (process.platform !== 'win32') throw Error('Canlı yakalama Windows gerektirir.');
  const dll = path.join(process.env.SystemRoot || 'C:/Windows', 'System32/Npcap/wpcap.dll');
  if (!fs.existsSync(dll)) throw Error('Npcap bulunamadı. Npcap sürücüsünü yükleyin.');
  const pcap = koffi.load(dll), ip = koffi.load('iphlpapi.dll');
  const Device = koffi.struct('LabPcapDevice', { next: 'void *', name: 'str', description: 'str', addresses: 'void *', flags: 'uint32' });
  const Address = koffi.struct('LabPcapAddress', { next: 'void *', addr: 'void *', netmask: 'void *', broadaddr: 'void *', dstaddr: 'void *' });
  const Header = koffi.struct('LabPcapHeader', { seconds: 'int32', micros: 'int32', captured: 'uint32', original: 'uint32' });
  koffi.struct('LabBpf', { length: 'uint32', instructions: 'void *' });
  api = { Device, Address, Header,
    devices: pcap.func('int pcap_findalldevs(_Out_ void **devices, void *error)'),
    freeDevices: pcap.func('void pcap_freealldevs(void *devices)'),
    open: pcap.func('void *pcap_open_live(str device, int snaplen, int promisc, int timeout, void *error)'),
    nonblock: pcap.func('int pcap_setnonblock(void *handle, int enabled, void *error)'),
    link: pcap.func('int pcap_datalink(void *handle)'),
    compile: pcap.func('int pcap_compile(void *handle, _Out_ LabBpf *filter, str text, int optimize, uint32 netmask)'),
    filter: pcap.func('int pcap_setfilter(void *handle, LabBpf *filter)'),
    freeFilter: pcap.func('void pcap_freecode(LabBpf *filter)'),
    next: pcap.func('int pcap_next_ex(void *handle, _Out_ void **header, _Out_ void **data)'),
    error: pcap.func('str pcap_geterr(void *handle)'),
    close: pcap.func('void pcap_close(void *handle)'),
    tcp: ip.func('uint32 __stdcall GetExtendedTcpTable(void *table, _Inout_ uint32 *size, bool order, uint32 family, int tableClass, uint32 reserved)'),
  };
  return api;
}
const errorText = b => b.toString('utf8').split('\0')[0];

export function listDevices() {
  const a = native(), pointer = [null], error = Buffer.alloc(256), result = [];
  if (a.devices(pointer, error) !== 0) throw Error(errorText(error));
  try {
    for (let p = pointer[0]; p;) {
      const device = koffi.decode(p, a.Device), addresses = [];
      for (let q = device.addresses; q;) {
        const address = koffi.decode(q, a.Address);
        if (address.addr && koffi.decode(address.addr, 'uint16') === 2) addresses.push([...koffi.decode(address.addr, 'uint8', 8).subarray(4)].join('.'));
        q = address.next;
      }
      result.push({ name: device.name, description: device.description || '', addresses, loopback: /loopback/i.test(device.name) }); p = device.next;
    }
  } finally { if (pointer[0]) a.freeDevices(pointer[0]); }
  return result;
}

export function openDevice(name, filter) {
  const a = native(), error = Buffer.alloc(256), handle = a.open(name, 65535, 0, 1, error);
  if (!handle) throw Error(errorText(error) || 'Npcap adaptörü açılamadı. Sürücünün erişim ayarlarını kontrol edin.');
  let closed = false;
  try {
    if (a.nonblock(handle, 1, error) !== 0) throw Error(errorText(error));
    const program = {};
    if (a.compile(handle, program, filter, 1, 0xffffffff) !== 0) throw Error(a.error(handle));
    try { if (a.filter(handle, program) !== 0) throw Error(a.error(handle)); } finally { a.freeFilter(program); }
  } catch (error) { a.close(handle); throw error; }
  const hp = [null], data = [null];
  return {
    linkType: a.link(handle),
    next() {
      if (closed) return null;
      const result = a.next(handle, hp, data);
      if (result === 0) return null;
      if (result < 0) throw Error(a.error(handle) || `Npcap read: ${result}`);
      const header = koffi.decode(hp[0], a.Header);
      if (header.captured > 65535) throw Error('Invalid capture length');
      // Npcap owns this pointer; copy before the next pcap_next_ex call.
      return { bytes: Buffer.from(koffi.decode(data[0], 'uint8', header.captured)), at: header.seconds * 1000 + header.micros / 1000 };
    },
    close() { if (!closed) { closed = true; a.close(handle); } },
  };
}

export function tcpConnections(pids) {
  const a = native(), size = [0];
  a.tcp(null, size, false, 2, 5, 0);
  let bytes;
  for (let retry = 0; retry < 3; retry++) {
    if (size[0] > 16 * 1024 * 1024) throw Error('TCP table too large');
    bytes = Buffer.alloc(size[0] + 1024); size[0] = bytes.length;
    const code = a.tcp(bytes, size, false, 2, 5, 0);
    if (code === 0) break;
    if (code !== 122 || retry === 2) throw Error(`GetExtendedTcpTable: ${code}`);
  }
  const connections = [], count = bytes.readUInt32LE(0);
  if (4 + count * 24 > bytes.length) throw Error('Malformed TCP table');
  for (let i = 0; i < count; i++) {
    const offset = 4 + i * 24, pid = bytes.readUInt32LE(offset + 20);
    if (bytes.readUInt32LE(offset) !== 5 || !pids.has(pid)) continue;
    const localAddress = [...bytes.subarray(offset + 4, offset + 8)].join('.'), remoteAddress = [...bytes.subarray(offset + 12, offset + 16)].join('.');
    const localPort = bytes.readUInt16BE(offset + 8), remotePort = bytes.readUInt16BE(offset + 16);
    connections.push({ pid, localAddress, localPort, remoteAddress, remotePort, key: `${remoteAddress}:${remotePort}>${localAddress}:${localPort}` });
  }
  return connections;
}

export async function gamePids() {
  // Get-Process -Name returns no matches for this game's running processes on
  // some Windows sessions. CIM exposes their image names without opening them.
  const { stdout } = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    "$ErrorActionPreference = 'Stop'; @(Get-CimInstance Win32_Process -Filter \"Name='AION2.exe'\" | Select-Object -ExpandProperty ProcessId) | ConvertTo-Json -Compress"], { windowsHide: true, timeout: 5000 });
  const parsed = stdout.trim() ? JSON.parse(stdout) : [];
  return new Set((Array.isArray(parsed) ? parsed : [parsed]).filter(pid => Number.isInteger(pid) && pid > 0));
}
