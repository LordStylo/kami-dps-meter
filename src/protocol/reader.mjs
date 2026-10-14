export class WireError extends Error {}
export class UnsupportedPacket extends WireError {}

export class Reader {
  constructor(bytes) { this.bytes = Buffer.from(bytes); this.pos = 0; this.boolByte = null; this.boolBit = 8; }
  take(size) {
    if (!Number.isSafeInteger(size) || size < 0 || this.pos + size > this.bytes.length) throw new WireError('Truncated field');
    const offset = this.pos; this.pos += size; return offset;
  }
  u8() { return this.bytes[this.take(1)]; }
  u16() { return this.bytes.readUInt16LE(this.take(2)); }
  u32() { return this.bytes.readUInt32LE(this.take(4)); }
  i32() { return this.bytes.readInt32LE(this.take(4)); }
  f32() { return this.bytes.readFloatLE(this.take(4)); }
  i64() { return this.bytes.readBigInt64LE(this.take(8)); }
  varuint(bits = 32) {
    let value = 0n;
    for (let shift = 0; shift < bits; shift += 7) {
      const byte = this.u8(); value |= BigInt(byte & 127) << BigInt(shift);
      if (!(byte & 128)) {
        if (value >= 1n << BigInt(bits)) throw new WireError('Varint overflow');
        return value;
      }
    }
    throw new WireError('Unterminated varint');
  }
  v32() { return Number(this.varuint(32)); }
  vi32() { return Number(BigInt.asIntN(32, this.varuint(32))); }
  vi64() { return BigInt.asIntN(64, this.varuint(64)); }
  str() {
    const length = this.v32(); const offset = this.take(length);
    return this.bytes.subarray(offset, offset + length).toString('utf8').replace(/\0$/, '');
  }
  bool() {
    if (this.boolBit === 8) { this.boolByte = this.u8(); this.boolBit = 0; }
    return !!(this.boolByte & (1 << this.boolBit++));
  }
  list(read) {
    const length = this.v32();
    if (length > 10000 || length > (this.bytes.length - this.pos) * 8 + 64) throw new WireError('Excessive list');
    return Array.from({ length }, () => read(this));
  }
  vec() { return { x: this.f32(), y: this.f32(), z: this.f32() }; }
  skip(size) { this.take(size); }
  done() { if (this.pos !== this.bytes.length) throw new WireError(`Trailing bytes: ${this.bytes.length - this.pos}`); }
}

export function safeNumber(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new WireError('Unsafe numeric value');
  return number;
}
