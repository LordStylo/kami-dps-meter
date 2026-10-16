import {Reader, WireError} from './reader.mjs';
import {readSelfPosition, readNpcPosition} from './packets.mjs';

export const POSITION_OPCODES = new Set([0x3621,0x3623,0x3633,0x3641,0x3642,0x371a,0x371b,0x371c]);
const valid = p => Object.values(p).every(v => Number.isFinite(v) && Math.abs(v) < 1e7);
export function readPositionObservation(opcode, payload) {
  const r = new Reader(payload); let observation;
  if (opcode === 0x3621) return {kind:'reset'};
  if (opcode === 0x3633) observation = {kind:'self', ...readSelfPosition(payload)};
  else if (opcode === 0x3641) observation = {kind:'npc', ...readNpcPosition(payload)};
  else if (opcode === 0x3623) {
    // Empirical arrival layout: six zero result/header bytes, XYZ and tail.
    if (payload.length !== 24 || !payload.subarray(0,6).every(v=>v===0)) return null;
    r.skip(6); observation = {kind:'arrival',position:r.vec()};
  } else if (opcode === 0x3642) {
    const entity = r.vi32(), flags = r.u8(), reason = r.u8();
    if (flags & ~1) return null;
    if (flags & 1) r.i32(); r.done();
    observation = {kind:'remove',entity,reason};
  } else if ([0x371a,0x371b,0x371c].includes(opcode)) {
    const entity = r.vi32(), prefix = r.pos, flags = r.u8();
    if (opcode === 0x371a) {
      if (![0,12].includes(flags) || payload.length !== prefix+16+(flags===12?9:0)) return null;
      r.u8();
    } else {
      if (![1,4,5].includes(flags) || payload.length !== prefix+17+([1,5].includes(flags)?1:0)+(flags===4?1:0)) return null;
      if ([1,5].includes(flags)) r.u8();
    }
    observation = {kind:'move',entity,position:r.vec()};
  } else return null;
  if (observation.position && !valid(observation.position)) throw new WireError('Invalid spatial observation');
  if (observation.entity !== undefined && (observation.entity<=0 || observation.entity>=10000000)) throw new WireError('Invalid spatial entity');
  return observation;
}
