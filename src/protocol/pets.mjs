import {Reader,WireError} from './reader.mjs';

// Independently implemented from the observed Questlog 0.1.36 wire schemas.
// Unused panel/appearance fields are consumed, never stored as raw data.
export const PET_OPCODES=new Set([0x9000,0x9009,0x900d,0x900e]);
export const MAX_PET_RECORDS=10000;
const genusKeys={2:'intellect',3:'feral',4:'nature',5:'trans',6:'special'};
const positive=(value,label)=>{if(!Number.isInteger(value)||value<=0)throw new WireError('Invalid '+label);return value;};
const nonnegative=(value,label)=>{if(!Number.isInteger(value)||value<0)throw new WireError('Invalid '+label);return value;};
const level=value=>{if(!Number.isInteger(value)||value<0||value>3)throw new WireError('Invalid pet level');return value;};

export function readPetObservation(opcode,payload){
  if(!PET_OPCODES.has(opcode))return null;
  if(!payload||payload.length>65536)throw new WireError('Pet payload size limit');
  const r=new Reader(payload);let records=0;
  const list=read=>{
    const count=r.v32();records+=count;
    if(count>MAX_PET_RECORDS||records>MAX_PET_RECORDS||count>r.bytes.length-r.pos)throw new WireError('Pet list size limit');
    return Array.from({length:count},()=>read());
  };
  const map=(key,read)=>{
    const seen=new Set();
    return list(()=>{const id=key();if(seen.has(id))throw new WireError('Duplicate pet map key');seen.add(id);return [id,read()];});
  };
  const pet=()=>positive(r.i32(),'pet identifier');
  const points=()=>nonnegative(r.i32(),'pet points');
  const experience=()=>{if(r.i64()<0n)throw new WireError('Invalid genus experience');};
  let event;
  if(opcode===0x9000){
    nonnegative(r.i32(),'default pet identifier');
    const ids=new Set(),levels={};
    map(pet,()=>{
      const petId=pet(),value=level(r.i32());
      if(ids.has(petId))throw new WireError('Duplicate acquired pet');ids.add(petId);levels[petId]=value;
    });
    const souls=Object.fromEntries(map(pet,points));
    map(()=>r.u8(),points); // Soul crystals by creature type.
    const collections=new Set();list(()=>{const id=pet();if(collections.has(id))throw new WireError('Duplicate pet collection reward');collections.add(id);});
    const genera={};
    for(const [type,board]of map(()=>r.u8(),()=>{
      const type=r.u8(),value=nonnegative(r.i32(),'genus level');experience();
      map(()=>r.u8(),()=>{
        const slots=new Set();
        list(()=>{
          const slot=r.u8();if(slots.has(slot))throw new WireError('Duplicate genus slot');slots.add(slot);
          r.u8();r.u16();r.i64();r.bool();r.bool();
        });
      });
      return {type,level:value};
    })){
      const key=genusKeys[type];
      // The map key identifies the genus; the board's inner type is not used
      // as an extra constraint by the observed normalizer.
      if(key)genera[key]={level:board.level};
    }
    r.u8(); // Selected genus panel.
    event={kind:'init',levels,souls,genera};
  }else if(opcode===0x9009){
    const entity=positive(r.vi32(),'pet owner entity'),petId=pet(),value=level(r.i32());
    const key=genusKeys[r.u8()],genusLevel=nonnegative(r.i32(),'genus level');experience();
    event={kind:'acquired',entity,petId,level:value,...key?{genus:{key,level:genusLevel}}:{}};
  }else{
    const ids=new Set(),items=list(()=>{
      const petId=pet(),value=points();if(ids.has(petId))throw new WireError('Duplicate pet soul entry');ids.add(petId);
      return {petId,points:value};
    });
    event={kind:opcode===0x900d?'souls-increase':'souls-decrease',items};
  }
  r.done();return event;
}
