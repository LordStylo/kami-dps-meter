// Synthetic network fixtures. No user capture or proprietary application code.
export const u8 = n => Buffer.from([n]);
export const u16 = n => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
export const i32 = n => { const b = Buffer.alloc(4); b.writeInt32LE(n); return b; };
export const i64 = n => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b; };
export function vu(n) { n = BigInt(n); const out = []; do { let b = Number(n & 127n); n >>= 7n; out.push(b | (n ? 128 : 0)); } while (n); return Buffer.from(out); }
export const str = s => Buffer.concat([vu(Buffer.byteLength(s)), Buffer.from(s)]);
export const cat = (...pieces) => Buffer.concat(pieces);
export const frame = (opcode, payload) => cat(vu(payload.length + 6), u16(opcode), payload);
export const heartbeat = () => frame(0x3600, i64(123456));
export function direct({ damage = 10000, effect = 12345, actor = 7, target = 50, extra = [], critical = true, plotter = false } = {}) {
  const flags = 4 | (extra.length ? 32 : 0) | (plotter ? 2 | 16 | 4096 : 0);
  return frame(0x3804, cat(vu(target), u16(flags), vu(actor), i32(11010130), u8(1), u8(critical ? 3 : 2),
    ...(plotter ? [u8(0b11000101), vu(0), u8(1)] : []), i32(effect), i32(0), vu(1000), vu(damage),
    ...(extra.length ? [vu(extra.length), ...extra.map(vu)] : []), u16(1), ...(plotter ? [u8(1)] : [])));
}
export function dot({ damage = 3000, effect = 12345 } = {}) { return frame(0x3805, cat(vu(50), u8(10), vu(7), vu(1), i32(effect), vu(damage), i32(11010130))); }
export function bundle(...frames) {
  const raw = cat(...frames); let remaining = raw.length - 15; const sizes = [];
  if (remaining >= 0) { while (remaining >= 255) { sizes.push(255); remaining -= 255; } sizes.push(remaining); }
  return frame(0xffff, cat(i32(raw.length), u8(Math.min(15, raw.length) << 4), Buffer.from(sizes), raw));
}
export function state(position = {x:0,y:0,z:0}) {
  const spatial=Buffer.alloc(18);['x','y','z'].forEach((key,i)=>spatial.writeFloatLE(position[key],i*4));
  return cat(u16(0), spatial, u8(1), vu(100000), vu(100000), Buffer.alloc(52));
}
export function player(entity = 7, name = 'Test') {
  return frame(0x3645, cat(vu(entity), i32(0), u8(1), str(name), i32(5), state(), Buffer.from([0,0,0])));
}
export function npc(entity = 70, owner = 7) {
  return frame(0x3641, cat(vu(entity), u16(16), u8(0), i32(10001), state(), vu(0), i32(owner), Buffer.from([0,0,0])));
}
export function partyMember() {
  return fMember();
}
function fMember() {
  return cat(u8(0),u8(1),i32(7),u16(1),u16(1),str('discard-me'),i64(123),str('Test'),i32(5),vu(10000),vu(20000),Buffer.alloc(24),i64(1),i32(1),Buffer.alloc(12),u8(7),i32(45),i32(0),i32(100),i64(1000),u8(0));
}
export function party() { return frame(0x9200,cat(u8(0),i64(1),i64(123),i32(5),Buffer.alloc(4),vu(1),partyMember(),u8(0))); }
export function self(position) {
  const detail=cat(u8(1),str('Ben'),u16(1),i32(5),Buffer.alloc(16),i64(0),i32(0),i64(0),vu(0),vu(0),Buffer.alloc(8),i64(0),u8(0));
  return frame(0x3633,cat(vu(7),i32(0),detail,state(position),Buffer.from([0,0,0])));
}
export function tcpPacket(payload, sequence = 100) {
  const packet = Buffer.alloc(14 + 20 + 20 + payload.length);
  packet.writeUInt16BE(0x0800, 12); packet[14] = 0x45; packet.writeUInt16BE(packet.length - 14, 16); packet[23] = 6;
  packet.set([10,0,0,1,10,0,0,2], 26); packet.writeUInt16BE(2000,34); packet.writeUInt16BE(5000,36);
  packet.writeUInt32BE(sequence >>> 0, 38); packet[46] = 0x50; packet[47] = 0x18; payload.copy(packet,54); return packet;
}
