import { decodePacket, isKnown } from './packets.mjs';
import { WireError } from './reader.mjs';

export function frameHeader(bytes, offset = 0) {
  let length = 0, width = 0;
  for (; width < 4; width++) {
    if (offset + width >= bytes.length) return null;
    const byte = bytes[offset + width]; length += (byte & 127) * 2 ** (7 * width);
    if (!(byte & 128)) { width++; break; }
    if (width === 3) throw new WireError('Frame varint too long');
  }
  const size = length - 4 + width;
  if (size < width + 2 || size > 65536) throw new WireError('Invalid frame size');
  if (offset + width + 2 > bytes.length) return null;
  return { size, width, opcode: bytes.readUInt16LE(offset + width), payloadOffset: offset + width + 2 };
}

export function decompressLz4(bytes, length) {
  if (!Number.isSafeInteger(length) || length < 0 || length > 4 * 1024 * 1024 || length > bytes.length * 255) throw new WireError('LZ4 size limit');
  const output = Buffer.alloc(length); let pos = 0, written = 0;
  const byte = () => { if (pos >= bytes.length) throw new WireError('Truncated LZ4'); return bytes[pos++]; };
  const count = initial => { let result = initial; if (initial === 15) { let more; do { more = byte(); result += more; } while (more === 255); } return result; };
  while (pos < bytes.length) {
    const token = byte(), literals = count(token >>> 4);
    if (pos + literals > bytes.length || written + literals > length) throw new WireError('LZ4 literals overflow');
    bytes.copy(output, written, pos, pos + literals); pos += literals; written += literals;
    if (pos === bytes.length) break;
    const distance = byte() | (byte() << 8), matches = count(token & 15) + 4;
    if (!distance || distance > written || written + matches > length) throw new WireError('LZ4 invalid match');
    for (let i = 0; i < matches; i++) { output[written] = output[written - distance]; written++; }
  }
  if (written !== length) throw new WireError('LZ4 output size mismatch');
  return output;
}

function decodeFrame(frame, header, at, depth = 0, budget = { frames: 0, bytes: 0 }) {
  if (depth > 4 || ++budget.frames > 4096) throw new WireError('Bundle nesting/count limit');
  const payload = frame.subarray(header.width + 2);
  if (header.opcode !== 0xffff) {
    try { return [decodePacket(header.opcode, payload, at)]; }
    catch (error) {
      if (!(error instanceof WireError)) throw error;
      return [{ opcode: header.opcode, known: true, complete: false, events: [], error: `${error.constructor.name}:${error.message}` }];
    }
  }
  if (payload.length < 5) throw new WireError('Truncated bundle');
  const length = payload.readUInt32LE(0); budget.bytes += length;
  if (budget.bytes > 8 * 1024 * 1024) throw new WireError('Bundle expansion limit');
  const expanded = decompressLz4(payload.subarray(4), length), result = [];
  for (let p = 0; p < expanded.length;) {
    const h = frameHeader(expanded, p);
    if (!h || p + h.size > expanded.length) throw new WireError('Incomplete bundled message');
    result.push(...decodeFrame(expanded.subarray(p, p + h.size), h, at, depth + 1, budget)); p += h.size;
  }
  return result;
}

export class FrameStream {
  constructor(onPacket, onIssue = () => {}) { this.onPacket = onPacket; this.onIssue = onIssue; this.buffer = Buffer.alloc(0); this.locked = false; this.probed = 0; this.ignored = false; }
  gap() { this.buffer = Buffer.alloc(0); this.locked = false; this.probed = 0; this.ignored = false; this.onIssue('stream-gap'); }
  anchor(bytes, offset, at) {
    try {
      const h = frameHeader(bytes, offset);
      if (!h || offset + h.size > bytes.length || (!isKnown(h.opcode) && h.opcode !== 0xffff)) return null;
      const decoded = decodeFrame(bytes.subarray(offset, offset + h.size), h, at);
      return decoded.some(p => p.known && p.complete) && decoded.every(p => !p.known || p.complete) ? h : null;
    } catch { return null; }
  }
  push(chunk, at) {
    if (this.ignored) return;
    if (!this.locked && (this.probed += chunk.length) > 512 * 1024) { this.ignored = true; this.buffer = Buffer.alloc(0); this.onIssue('unrecognized-stream'); return; }
    if (chunk.length > 4 * 1024 * 1024) { this.gap(); return; }
    this.buffer = Buffer.concat([this.buffer, chunk]);
    let pos = 0;
    if (!this.locked) {
      let start = -1;
      // Preserve a chain of parseable identity prefixes before the strict anchors.
      const prefixStarts = new Map();
      let prefix = 0;
      try {
        for (let n = 0; n < 128 && prefix < this.buffer.length; n++) {
          const h = frameHeader(this.buffer, prefix);
          if (!h || prefix + h.size > this.buffer.length || (!isKnown(h.opcode) && h.opcode !== 0xffff)) break;
          if (decodeFrame(this.buffer.subarray(prefix, prefix + h.size), h, at).some(p=>p.error)) break;
          prefix += h.size; prefixStarts.set(prefix, 0);
        }
      } catch { /* an unverified leading fragment is discarded at synchronization */ }
      for (let i = 0; i < this.buffer.length - 5; i++) {
        const one = this.anchor(this.buffer, i, at);
        if (one && this.anchor(this.buffer, i + one.size, at)) { start = prefixStarts.get(i) ?? i; break; }
      }
      if (start < 0) { if (this.buffer.length > 131072) { this.buffer = this.buffer.subarray(-65536); this.onIssue('sync-discard'); } return; }
      if (start) this.onIssue('sync-discard');
      pos = start; this.locked = true;
    }
    while (pos < this.buffer.length) {
      let h;
      try { h = frameHeader(this.buffer, pos); }
      catch { this.buffer = this.buffer.subarray(pos + 1); this.locked = false; this.onIssue('bad-frame'); return; }
      if (!h || pos + h.size > this.buffer.length) break;
      try {
        for (const packet of decodeFrame(this.buffer.subarray(pos, pos + h.size), h, at)) {
          if (packet.error) this.onIssue(`0x${packet.opcode.toString(16)}:${packet.error}`);
          else this.onPacket(packet);
        }
      }
      catch (error) { this.onIssue(`${error.constructor.name}:0x${h.opcode.toString(16)}:${error.message}`); }
      pos += h.size;
    }
    this.buffer = this.buffer.subarray(pos);
  }
}
