import {Reader,WireError} from '../protocol/reader.mjs';

// Research-only readers inferred from a marked capture, except 0x561b whose
// schema/reason enum also appears in the static protocol reference. Names below
// describe candidate interpretations, not official packet names. These readers
// do not participate in FrameStream synchronization or the live DPS decoder.
export const WORLD_EVIDENCE_OPCODES=new Set([0x3634,0x3635,0x3637,0x3638,0x363a,0x363b,0x561e,0x561b]);
export function readWorldEvidence(opcode,payload){
  const r=new Reader(payload);
  if(opcode===0x3634){
    const entity=r.vi32(),headerWord=r.u16(),template=r.i32();
    const position=r.vec();
    if(entity<=0||template<=0||!Object.values(position).every(Number.isFinite))throw new WireError('Invalid object prefix');
    // The two-byte header and remaining fields are not yet explained. Do not
    // export positions or mistake a prefix read for full schema validation.
    return [{kind:'object-appear-prefix',entity,template,headerWord,validation:'empirical-prefix',unparsedBytes:payload.length-r.pos}];
  }
  if(opcode===0x3635){
    const entity=r.vi32(),tail=[r.u8(),r.u8(),r.u8()];r.done();
    return [{kind:'object-disappear',entity,tail,validation:'empirical-layout'}];
  }
  if(opcode===0x3637){
    const result=r.u16(),flags=r.u8(),entity=r.vi32(),timeField=String(r.i64());r.done();
    return [{kind:'object-interaction-response',entity,result,flags,timeField,validation:'empirical-layout'}];
  }
  if(opcode===0x3638){
    const entity=r.vi32(),actor=r.vi32(),state=r.u8();r.done();
    return [{kind:'object-interaction-start',entity,actor,state,validation:'empirical-layout'}];
  }
  if(opcode===0x363a){
    const entity=r.vi32(),actor=r.vi32(),counter=r.i32(),item=r.i32();r.done();
    return [{kind:'object-interaction-result',entity,actor,counter,item,validation:'empirical-layout'}];
  }
  if(opcode===0x363b){
    const entity=r.vi32();r.done();return [{kind:'object-interaction-end',entity,validation:'empirical-layout'}];
  }
  if(opcode===0x561e){
    const flags=r.u8(),entity=r.i32();
    return [{kind:'drop-source-prefix',entity,flags,validation:'empirical-prefix',unparsedBytes:payload.length-r.pos}];
  }
  if(opcode===0x561b){
    const changes=r.list(t=>{
      const type=t.u8(),flags=t.u8();t.i64();const item=t.i32();t.i64();t.u8();t.i32();t.bool();t.str();t.i64();t.bool();
      // Equipment suffixes are intentionally unsupported in this narrow reader.
      if(flags)throw new WireError('Unsupported equipment item detail');
      const increaseReason=t.u8(),decreaseReason=t.u8(),updateReason=t.u8();
      return {kind:'inventory-change',item,type,increaseReason,decreaseReason,updateReason,validation:'static-schema'};
    });r.done();return changes;
  }
  return [];
}

export function objectChains(observations){
  const sorted=[...observations].sort((a,b)=>a.at-b.at),chains=[];
  for(const result of sorted.filter(o=>o.kind==='object-interaction-result'&&o.item>0)){
    const same=o=>o.stream===result.stream&&o.entity===result.entity;
    const before=sorted.filter(o=>same(o)&&o.at<=result.at);
    const appear=before.findLast(o=>o.kind==='object-appear-prefix');
    const start=before.findLast(o=>o.kind==='object-interaction-start');
    const response=before.findLast(o=>o.kind==='object-interaction-response'&&o.at>=(start?.at??result.at-10000));
    // A brief temporal join is supporting evidence, not a universal classifier.
    const after=sorted.filter(o=>same(o)&&o.at>=result.at&&o.at<=result.at+3000);
    const drops=after.filter(o=>o.kind==='drop-source-prefix');
    const disappear=after.find(o=>o.kind==='object-disappear');
    const consume=sorted.find(o=>o.kind==='inventory-change'&&o.stream===result.stream&&o.item===result.item&&o.decreaseReason===54&&Math.abs(o.at-result.at)<1000);
    chains.push({entity:result.entity,stream:result.stream,template:appear?.template??null,
      appearanceAt:appear?.at??null,interactionAt:start?.at??null,responseAt:response?.at??null,
      responseResult:response?.result??null,resultAt:result.at,item:result.item,
      interactionRequirementConsumed:!!consume,consumedAt:consume?.at??null,
      dropMessages:drops.length,firstDropAt:drops[0]?.at??null,disappearAt:disappear?.at??null,
      disappearTail:disappear?.tail??null,interpretation:'Aday nesne zinciri; tek kayıt diğer cube türlerini veya mesafe eşiğini doğrulamaz.'});
  }
  return chains;
}
