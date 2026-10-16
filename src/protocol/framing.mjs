import { decodePacket, isKnown } from './packets.mjs';
import { WireError } from './reader.mjs';

export function frameHeader(bytes, offset = 0, strict = true) {
  let length = 0, width = 0;
  for (; width < 4; width++) {
    if (offset + width >= bytes.length) return null;
    const byte = bytes[offset + width]; length += (byte & 127) * 2 ** (7 * width);
    if (!(byte & 128)) { width++; break; }
    if (width === 3) { if (strict) throw new WireError('Frame varint too long'); return null; }
  }
  const size = length - 4 + width;
  if (size < width + 2 || size > 65536) { if (strict) throw new WireError('Invalid frame size'); return null; }
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

function decodeFrame(frame, header, at, depth = 0, budget = { frames: 0, bytes: 0 }, includePayload = false) {
  if (depth > 4 || ++budget.frames > 4096) throw new WireError('Bundle nesting/count limit');
  const payload = frame.subarray(header.width + 2);
  const wire = includePayload ? { payload } : {};
  if (header.opcode !== 0xffff) {
    try { return [{ ...decodePacket(header.opcode, payload, at), ...wire }]; }
    catch (error) {
      if (!(error instanceof WireError)) throw error;
      return [{ opcode: header.opcode, known: true, complete: false, events: [], error: `${error.constructor.name}:${error.message}`, ...wire }];
    }
  }
  if (payload.length < 5) throw new WireError('Truncated bundle');
  const length = payload.readUInt32LE(0); budget.bytes += length;
  if (budget.bytes > 8 * 1024 * 1024) throw new WireError('Bundle expansion limit');
  const expanded = decompressLz4(payload.subarray(4), length), result = [];
  for (let p = 0; p < expanded.length;) {
    const h = frameHeader(expanded, p);
    if (!h || p + h.size > expanded.length) throw new WireError('Incomplete bundled message');
    result.push(...decodeFrame(expanded.subarray(p, p + h.size), h, at, depth + 1, budget, includePayload)); p += h.size;
  }
  return result;
}

export class FrameStream {
  constructor(onPacket, onIssue = () => {}, onMessage = null) { this.onPacket = onPacket; this.onIssue = onIssue; this.onMessage = onMessage; this.buffer = Buffer.alloc(0); this.locked = false; this.probed = 0; this.ignored = false; this.resetScan(); }
  resetScan() { this.scanOffset = 0; this.scanPending = []; }
  gap() { this.buffer = Buffer.alloc(0); this.locked = false; this.probed = 0; this.ignored = false; this.resetScan(); this.onIssue('stream-gap'); }
  anchor(bytes, offset, at) {
    try {
      // Scanning non-game/TLS bytes is normal. Throwing an Error for every
      // invalid offset stalls the shared capture worker for tens of seconds.
      const h = frameHeader(bytes, offset, false);
      if (!h || offset + h.size > bytes.length || (!isKnown(h.opcode) && h.opcode !== 0xffff)) return null;
      const decoded = decodeFrame(bytes.subarray(offset, offset + h.size), h, at);
      return decoded.some(p => p.known && p.complete) && decoded.every(p => !p.known || p.complete) ? h : null;
    } catch { return null; }
  }
  probe(candidate, at) {
    // Only incomplete candidates are revisited, once the bytes they need arrive.
    // A fully rejected offset can never become valid by appending more data.
    for (let part = candidate.firstSize ? 1 : 0; part < 2; part++) {
      const offset = candidate.offset + (part ? candidate.firstSize : 0);
      const h = frameHeader(this.buffer, offset, false);
      if (!h) {
        if (this.buffer.length - offset < 6) { candidate.needed = this.buffer.length + 1; return 'wait'; }
        return 'reject';
      }
      if (!isKnown(h.opcode) && h.opcode !== 0xffff) return 'reject';
      if (offset + h.size > this.buffer.length) { candidate.needed = offset + h.size; return 'wait'; }
      if (!this.anchor(this.buffer, offset, at)) return 'reject';
      if (!part) candidate.firstSize = h.size;
    }
    return 'found';
  }
  scan(at) {
    const pending = [];
    for (const candidate of this.scanPending) {
      const result = candidate.needed > this.buffer.length ? 'wait' : this.probe(candidate, at);
      if (result === 'found') return candidate.offset;
      if (result === 'wait') pending.push(candidate);
    }
    this.scanPending = pending;
    for (; this.scanOffset < this.buffer.length; this.scanOffset++) {
      const candidate = { offset: this.scanOffset, firstSize: 0, needed: 0 };
      const result = this.probe(candidate, at);
      if (result === 'found') return candidate.offset;
      if (result === 'wait') this.scanPending.push(candidate);
    }
    return -1;
  }
  push(chunk, at) {
    if (this.ignored) return;
    if (!this.locked && (this.probed += chunk.length) > 512 * 1024) { this.ignored = true; this.buffer = Buffer.alloc(0); this.resetScan(); this.onIssue('unrecognized-stream'); return; }
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
      const anchor = this.scan(at);
      if (anchor >= 0) start = prefixStarts.get(anchor) ?? anchor;
      if (start < 0) {
        if (this.buffer.length > 131072) {
          const discard = this.buffer.length - 65536;
          this.buffer = this.buffer.subarray(discard);
          this.scanOffset -= discard;
          this.scanPending = this.scanPending.filter(c=>c.offset>=discard).map(c=>({...c,offset:c.offset-discard,needed:c.needed-discard}));
          this.onIssue('sync-discard');
        }
        return;
      }
      if (start) this.onIssue('sync-discard');
      pos = start; this.locked = true; this.resetScan();
    }
    while (pos < this.buffer.length) {
      let h;
      try { h = frameHeader(this.buffer, pos); }
      catch { this.buffer = this.buffer.subarray(pos + 1); this.locked = false; this.resetScan(); this.onIssue('bad-frame'); return; }
      if (!h || pos + h.size > this.buffer.length) break;
      try {
        for (const packet of decodeFrame(this.buffer.subarray(pos, pos + h.size), h, at, 0, undefined, !!this.onMessage)) {
          // Only observe committed frames, never speculative synchronization probes.
          // Whole bundles are structurally validated before any child is observed.
          if (this.onMessage) this.onMessage({ ...packet, at });
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
