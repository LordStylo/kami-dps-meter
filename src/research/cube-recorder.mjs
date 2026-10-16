import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const CUBE_PHASES = Object.freeze({
  baseline: 'İşaret öncesi / referans', approach: 'Yaklaşıyorum', near: 'Cube yanındayım',
  leave: 'Uzaklaşıyorum', far: 'Uzaklaştım', opening: 'Açmaya başlıyorum', opened: 'Açıldı',
});
// Keep opcode/length/timing, but omit known account and player identity payloads.
const IDENTITY_OPCODES = new Set([0x3615, 0x3633, 0x3645, 0x8d04, 0x9200, 0x920d, 0x9222, 0x931f, 0x9602, 0x960a, 0x961b, 0x9622, 0x962e]);
const DEFAULT_LIMITS = { maxBytes: 64 * 1024 * 1024, maxDurationMs: 20 * 60 * 1000, maxMarkers: 1000,
  prebufferMs: 60000, maxBufferBytes: 8 * 1024 * 1024, postOpenMs: 30000 };

export class CubeRecorder {
  constructor(directory, { clock = Date.now, ...limits } = {}) {
    this.directory = directory; this.clock = clock; this.limits = { ...DEFAULT_LIMITS, ...limits };
    this.fd = null; this.session = null; this.sequence = 0;
    this.armed = false; this.autoStopAt = null; this.clearBuffer();
  }
  get active() { return this.fd !== null; }
  clearBuffer() { this.pending = []; this.head = 0; this.bufferBytes = 0; this.bufferMessages = 0; this.bufferClipped = false; }
  prune() {
    const cutoff = this.clock() - this.limits.prebufferMs;
    while (this.head < this.pending.length && (this.pending[this.head].row.at < cutoff || this.bufferBytes > this.limits.maxBufferBytes)) {
      const entry = this.pending[this.head]; this.pending[this.head++] = null;
      if (entry.row.at >= cutoff) this.bufferClipped = true;
      this.bufferBytes -= entry.bytes; if (entry.row.kind === 'message') this.bufferMessages--;
    }
    if (this.head > 1024) { this.pending = this.pending.slice(this.head); this.head = 0; }
  }
  buffer(row) {
    // Adapters are drained separately, so a delayed packet can arrive after a
    // newer one. Reject already expired messages before they enter the queue.
    if (row.at < this.clock() - this.limits.prebufferMs) return;
    const bytes = Buffer.byteLength(JSON.stringify(row)) + 64;
    this.pending.push({ row, bytes }); this.bufferBytes += bytes;
    if (row.kind === 'message') this.bufferMessages++;
    this.prune();
  }
  arm() {
    if (this.active) throw Error('Önce açık test kaydını bitir.');
    if (!this.armed) { this.clearBuffer(); this.session = null; this.autoStopAt = null; this.armed = true; }
    return this.status();
  }
  status() {
    const s = this.session;
    return { active: this.active, armed: this.armed, autoStopAt: this.autoStopAt, id: s?.id ?? null, startedAt: s?.startedAt ?? null,
      endedAt: s?.endedAt ?? null, reason: s?.reason ?? null, error: s?.error ?? null,
      bytes: s?.bytes ?? 0, messages: s?.messages ?? 0, omittedPayloads: s?.omittedPayloads ?? 0,
      phase: s?.markers.at(-1)?.phase ?? null, markers: s?.markers.slice(-30) ?? [],
      elapsedMs: s ? Math.max(0, (s.endedAt ?? this.clock()) - s.startedAt) : 0,
      bufferMessages: this.bufferMessages, bufferBytes: this.bufferBytes, bufferClipped: this.bufferClipped,
      bufferMs: this.armed && this.pending[this.head] ? Math.min(this.limits.prebufferMs, Math.max(0, this.clock() - this.pending[this.head].row.at)) : 0, ...this.limits };
  }
  start(context = {}) {
    if (this.active) throw Error('Cube test kaydı zaten açık.');
    this.prune();
    const prelude = this.armed ? this.pending.slice(this.head).map(x => x.row).filter(row => row.at >= this.clock() - this.limits.prebufferMs) : [];
    const prebuffer = { requestedMs: this.limits.prebufferMs, messages: prelude.filter(row=>row.kind==='message').length, clipped: this.bufferClipped };
    fs.mkdirSync(this.directory, { recursive: true });
    const now = this.clock(), startedAt = prelude.reduce((at,row)=>Math.min(at,row.at),now), id = randomUUID();
    const filename = path.join(this.directory, id + '.ndjson');
    this.fd = fs.openSync(filename, 'wx');
    this.armed = false; this.autoStopAt = null; this.clearBuffer();
    this.sequence = 0;
    this.session = { id, startedAt, endedAt: null, reason: null, error: null, bytes: 0, messages: 0, omittedPayloads: 0, markers: [] };
    this.append({ kind: 'header', format: 'kami-cube-research/1', id, at: startedAt,
      source: 'live-game-inbound', recordingStartedAt: now, prebuffer, limits: this.limits,
      scope: 'Synchronized Aion frames only; LZ4 children expanded; incoming only; no IP addresses; known identity payloads omitted.',
      capture: { state: context.state ?? 'starting', connections: context.connections ?? 0, adapters: context.adapters ?? 0 } });
    if (this.active) this.addMarker('baseline', startedAt);
    for (const row of prelude) this.record(row);
    if (!this.active) throw Error(this.session.error || 'Test kaydı açılamadı.');
    return this.status();
  }
  append(record, footer = false) {
    if (!this.active) return false;
    const line = JSON.stringify({ ...record, seq: ++this.sequence }) + '\n';
    const bytes = Buffer.from(line);
    // Reserve space for a terminal record even when a busy scene reaches the cap.
    if (!footer && this.session.bytes + bytes.length > this.limits.maxBytes - 4096) { this.stop('size-limit'); return false; }
    try {
      let written = 0;
      while (written < bytes.length) {
        const count = fs.writeSync(this.fd, bytes, written, bytes.length - written);
        if (!count) throw Error('Disk yazma ilerlemedi.');
        written += count;
      }
      this.session.bytes += written; return true;
    } catch (error) {
      this.session.error = `Kayıt yazılamadı: ${error.message}`;
      this.session.endedAt = this.clock(); this.session.reason = 'write-error';
      try { fs.closeSync(this.fd); } catch { /* original error is retained */ }
      this.fd = null; this.saveSummary(); return false;
    }
  }
  tick() {
    if (this.armed) this.prune();
    if (this.active && this.autoStopAt !== null && this.clock() >= this.autoStopAt) this.stop('post-open-complete');
    if (this.active && this.clock() - this.session.startedAt >= this.limits.maxDurationMs) this.stop('time-limit');
  }
  message(packet, stream) {
    this.tick(); if (!this.active && !this.armed) return;
    const omit = IDENTITY_OPCODES.has(packet.opcode);
    const row = { kind: 'message', at: packet.at, observedAt: this.clock(), stream,
      opcode: packet.opcode, size: packet.payload.length, known: !!packet.known, complete: !!packet.complete,
      ...(packet.error ? { error: packet.error } : {}),
      ...(omit ? { payloadOmitted: 'identity' } : { payload: packet.payload.toString('hex') }) };
    if (this.active) this.record(row); else this.buffer(row);
  }
  record(row) {
    if (this.append(row) && row.kind === 'message') { this.session.messages++; if (row.payloadOmitted) this.session.omittedPayloads++; }
  }
  mark(phase) {
    if (!Object.hasOwn(CUBE_PHASES, phase)) throw Error('Geçersiz test aşaması.');
    this.tick(); if (!this.active) throw Error('Önce test kaydını başlat.');
    if (this.session.markers.length >= this.limits.maxMarkers) throw Error('İşaret sınırına ulaşıldı; yeni bir test başlat.');
    return this.addMarker(phase, this.clock());
  }
  addMarker(phase, at) {
    const marker = { index: this.session.markers.length, phase, label: CUBE_PHASES[phase], at };
    if (!this.append({ kind: 'marker', ...marker })) throw Error(this.session.error || 'Kayıt sınırına ulaşıldı.');
    this.session.markers.push(marker); return this.status();
  }
  found(context = {}) {
    if (!this.active) {
      if (!this.armed) throw Error('Önce cube arama modunu aç.');
      this.start(context);
    }
    return this.mark('near');
  }
  opened(context = {}) {
    // A rushed opening still preserves the prebuffer if the Found key was missed.
    if (!this.active) {
      if (!this.armed) throw Error('Önce cube arama modunu aç.');
      this.start(context);
    }
    this.mark('opened'); this.autoStopAt = this.clock() + this.limits.postOpenMs;
    return this.status();
  }
  issue(code, stream = null) {
    this.tick(); const row = { kind: 'issue', at: this.clock(), code, stream };
    if (this.active) this.append(row); else if (this.armed) this.buffer(row);
  }
  annotation(row) {
    this.tick();
    if (this.active) this.append(row); else if (this.armed) this.buffer(row);
  }
  stop(reason = 'manual') {
    this.armed = false; this.autoStopAt = null; this.clearBuffer();
    if (!this.active) return this.status();
    this.session.endedAt = this.clock(); this.session.reason = reason;
    this.append({ kind: 'end', at: this.session.endedAt, reason, messages: this.session.messages,
      omittedPayloads: this.session.omittedPayloads }, true);
    if (this.active) {
      try { fs.closeSync(this.fd); } catch (error) { this.session.error = error.message; }
      this.fd = null;
    }
    this.saveSummary(); return this.status();
  }
  saveSummary() {
    try { fs.writeFileSync(path.join(this.directory, this.session.id + '.summary.json'), JSON.stringify({ ...this.status(), markers: this.session.markers }, null, 2) + '\n'); }
    catch (error) { this.session.error ||= `Özet yazılamadı: ${error.message}`; }
  }
}
