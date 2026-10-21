import {Reader, WireError} from './reader.mjs';
import {readSelfPosition, readNpcPosition, readBuffPositionAnchors} from './packets.mjs';

export const POSITION_OPCODES = new Set([0x3621,0x3623,0x3633,0x3641,0x3642,0x371a,0x371b,0x371c,0x373c,0x382a,0x382b]);
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
  } else if (opcode === 0x373c) {
    // Questlog 0.1.35 CharWarpLeave_NT: complete known schema, including both
    // optional IDs. A teleport is a discontinuity, never evidence of approach.
    const entity = r.vi32(), flags = r.u8();
    if (flags & ~3) throw new WireError('Unknown warp position flags');
    const position = r.vec(), direction = r.f32(), moveState = r.u8(), moveSubstate = r.u8(), reason = r.u8();
    const skill = flags & 1 ? r.i32() : undefined, effect = flags & 2 ? r.i32() : undefined, durationMs = r.vi32();
    r.done();
    if (!Number.isFinite(direction)) throw new WireError('Invalid warp direction');
    observation = {kind:'warp',entity,position,reason,moveState,moveSubstate,skill,effect,durationMs};
  } else if (opcode === 0x382a || opcode === 0x382b) {
    const {entity, anchors} = readBuffPositionAnchors(opcode, payload);
    // Quest-compatible map coordinates accept this own-cast/own-target origin
    // as estimated. Conservative near/far keeps it as corroboration only:
    // an effect's area origin can outlive movement away from it.
    const anchor = anchors.findLast(anchor => anchor.caster === entity && (anchor.position.x !== 0 || anchor.position.y !== 0));
    if (!anchor) return null;
    observation = {kind:'buff-anchor',entity,...anchor};
  } else if ([0x371a,0x371b,0x371c].includes(opcode)) {
    // Complete server movement layouts verified against Questlog 0.1.36.
    // Direction and local vessel coordinates are consumed for validation;
    // only the packet's global XYZ can update a player's world position.
    const entity = r.vi32(), flags = r.u8();
    let position;
    if (opcode === 0x371a) {
      if (flags & ~15) throw new WireError('Unknown movement stop flags');
      r.u8(); // move state
      if (flags & 1) r.u8(); // move substate
      position = r.vec(); r.u16(); // global rotation
      if (flags & 2) {
        r.i32(); const local = r.vec(); r.v32();
        if (!valid(local)) throw new WireError('Invalid local movement position');
      }
      if (flags & 4) r.bool();
      if (flags & 8) r.i64();
    } else {
      if (flags & ~7) throw new WireError('Unknown movement start flags');
      if (flags & 1) r.bool(); // running
      position = r.vec(); r.u16(); r.u16(); // movement and rotation directions
      if (flags & 2) {
        r.i32(); const local = r.vec(); r.v32(); r.v32();
        if (!valid(local)) throw new WireError('Invalid local movement position');
      }
      if (flags & 4) r.bool(); // server dead-reckoning flag; not a new coordinate
    }
    r.done();
    observation = {kind:'move',entity,position};
  } else return null;
  if (observation.position && !valid(observation.position)) throw new WireError('Invalid spatial observation');
  if (observation.entity !== undefined && (observation.entity<=0 || observation.entity>=10000000)) throw new WireError('Invalid spatial entity');
  return observation;
}
