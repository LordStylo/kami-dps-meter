export function parseTcpFrame(input, linkType) {
  const bytes = Buffer.from(input); let ip = 0;
  if (linkType === 1) {
    if (bytes.length < 14) return null;
    let type = bytes.readUInt16BE(12); ip = 14;
    for (let count = 0; [0x8100, 0x88a8].includes(type) && count < 2; count++) {
      if (bytes.length < ip + 4) return null;
      type = bytes.readUInt16BE(ip + 2); ip += 4;
    }
    if (type !== 0x0800) return null;
  } else if (linkType === 0 || linkType === 108) ip = 4;
  else if (linkType !== 12 && linkType !== 101) return null;
  if (bytes.length < ip + 20 || bytes[ip] >>> 4 !== 4 || bytes[ip + 9] !== 6) return null;
  const ipLength = (bytes[ip] & 15) * 4, total = bytes.readUInt16BE(ip + 2);
  if (ipLength < 20 || total < ipLength + 20 || bytes.length < ip + total || (bytes.readUInt16BE(ip + 6) & 0x3fff)) return null;
  const tcp = ip + ipLength;
  if (tcp + 20 > ip + total) return null;
  const tcpLength = (bytes[tcp + 12] >>> 4) * 4;
  if (tcpLength < 20 || tcp + tcpLength > ip + total) return null;
  const flags = bytes[tcp + 13];
  return {
    source: `${bytes.subarray(ip + 12, ip + 16).join('.')}:${bytes.readUInt16BE(tcp)}`,
    destination: `${bytes.subarray(ip + 16, ip + 20).join('.')}:${bytes.readUInt16BE(tcp + 2)}`,
    sequence: bytes.readUInt32BE(tcp + 4), syn: !!(flags & 2), fin: !!(flags & 1), rst: !!(flags & 4),
    payload: bytes.subarray(tcp + tcpLength, ip + total),
  };
}

const diff = (a, b) => (a - b) | 0;
export class TcpStream {
  constructor(onData, onGap, { timeout = 1000, maxPending = 1024 * 1024 } = {}) {
    this.onData = onData; this.onGap = onGap; this.timeout = timeout; this.maxPending = maxPending;
    this.expected = null; this.pending = []; this.pendingBytes = 0; this.waitingSince = null;
    this.duplicates = 0;
  }
  push(sequence, payload, syn, at) {
    sequence >>>= 0;
    if (syn) { this.expected = (sequence + 1) >>> 0; this.pending = []; this.pendingBytes = 0; this.waitingSince = null; sequence = this.expected; }
    if (!payload.length) { this.tick(at); return; }
    if (this.expected === null) this.expected = sequence;
    const delta = diff(sequence, this.expected);
    if (delta > 0) {
      if (!this.pending.some(p => p.sequence === sequence && p.bytes.length >= payload.length)) {
        this.pending.push({ sequence, bytes: Buffer.from(payload), at }); this.pendingBytes += payload.length; this.waitingSince ??= at;
      }
      this.tick(at); return;
    }
    this.deliver(sequence, payload, at); this.drain(at);
  }
  deliver(sequence, bytes, at) {
    const skip = Math.max(0, -diff(sequence, this.expected));
    if (skip >= bytes.length) { this.duplicates++; return; }
    this.onData(bytes.subarray(skip), at); this.expected = (sequence + bytes.length) >>> 0;
  }
  drain(at) {
    let found;
    do {
      found = this.pending.findIndex(p => diff(p.sequence, this.expected) <= 0);
      if (found >= 0) {
        const [packet] = this.pending.splice(found, 1); this.pendingBytes -= packet.bytes.length;
        this.deliver(packet.sequence, packet.bytes, Math.max(at, packet.at));
      }
    } while (found >= 0);
    if (!this.pending.length) this.waitingSince = null;
  }
  tick(at) {
    if (!this.pending.length || (this.pendingBytes <= this.maxPending && at - this.waitingSince <= this.timeout)) return;
    this.pending.sort((a,b) => diff(a.sequence, this.expected) - diff(b.sequence, this.expected));
    this.expected = this.pending[0].sequence; this.onGap(at); this.drain(at);
    if (this.pending.length) this.waitingSince = at;
  }
}
