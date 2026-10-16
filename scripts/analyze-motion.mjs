import fs from 'node:fs';
import readline from 'node:readline';
import {FrameStream,frameHeader} from '../src/protocol/framing.mjs';
import {readSelfPosition} from '../src/protocol/packets.mjs';
import {Reader} from '../src/protocol/reader.mjs';

// Offline only. This never promotes spawn-only observations to live proximity.
const filename=process.argv[2];
if(!filename)throw Error('Usage: node scripts/analyze-motion.mjs captures/motion-session-<time>.ndjson');
if(fs.statSync(filename).size>17*1024*1024)throw Error('Motion research file exceeds 17 MiB');
const streams=new Map(),positions=[],issues=[],outgoingLengths={},outgoingOpcodes=new Set();
let messages=0,ownMovement=0,outgoingFrames=0,incompleteOutgoing=0,invalidLines=0;
function pair(id){
 if(streams.has(id))return streams.get(id);
 if(streams.size>=128)throw Error('Too many streams');
 const p={self:null,out:Buffer.alloc(0),ownOpcodes:{},movementEntities:{},at:null};
 p.frame=new FrameStream(()=>{},code=>issues.push({pair:id,direction:'in',at:p.at,code}),packet=>{
  messages++;
  if(packet.opcode===0x3621)p.self=null;
  if(packet.opcode===0x3633){try{p.self=readSelfPosition(packet.payload);positions.push({pair:id,at:packet.at,...p.self});}catch{issues.push({pair:id,code:'invalid-self-position'});}}
  if(!p.self||!packet.payload.length)return;
  // For movement-family packets this is a candidate entity prefix. Other
  // opcodes' first integers must not be treated as proven character identities.
  if(packet.opcode<0x3710||packet.opcode>0x3746)return;
  try{const entity=new Reader(packet.payload).vi32(),code='0x'+packet.opcode.toString(16);
   if(entity===p.self.entity)p.ownOpcodes[code]=(p.ownOpcodes[code]||0)+1;
   if([0x371a,0x371b,0x371c,0x371d].includes(packet.opcode)){
    p.movementEntities[entity]=(p.movementEntities[entity]||0)+1;if(entity===p.self.entity)ownMovement++;
   }
  }catch{}
 });streams.set(id,p);return p;
}
const input=fs.createReadStream(filename),lines=readline.createInterface({input,crlfDelay:Infinity});
try{for await(const line of lines){if(!line.trim())continue;let row;try{row=JSON.parse(line);}catch{invalidLines++;continue;}
 const p=pair(row.pair);p.at=row.at;
 if(row.kind==='issue'){issues.push({pair:row.pair,direction:row.direction,at:row.at,code:row.code});if(row.direction==='in')p.frame.gap();else p.out=Buffer.alloc(0);continue;}
 if(row.kind!=='chunk'||typeof row.payload!=='string'||!/^(?:[0-9a-f]{2})*$/i.test(row.payload))continue;
 const bytes=Buffer.from(row.payload,'hex');if(row.direction==='in'){p.frame.push(bytes,row.at);continue;}
 p.out=Buffer.concat([p.out,bytes]);let consumed=0;
 while(consumed<p.out.length){let h;try{h=frameHeader(p.out,consumed);}catch{p.out=Buffer.alloc(0);consumed=0;issues.push({pair:row.pair,code:'unrecognized-outgoing-framing'});break;}
  if(!h||consumed+h.size>p.out.length)break;
  outgoingFrames++;outgoingLengths[h.size]=(outgoingLengths[h.size]||0)+1;outgoingOpcodes.add(h.opcode);consumed+=h.size;
 }p.out=p.out.subarray(consumed);if(p.out.length>131072){p.out=Buffer.alloc(0);issues.push({pair:row.pair,code:'outgoing-buffer-limit'});}
}}finally{lines.close();input.destroy();}
for(const p of streams.values())if(p.out.length)incompleteOutgoing++;
const report={format:'kami-motion-research/1',messages,positionSnapshots:positions,
 ownMovementPrefixMatches:ownMovement,streams:[...streams].map(([id,p])=>({id,ownMovementFamilyOpcodes:p.ownOpcodes,movementEntities:p.movementEntities})),
 outgoing:{frames:outgoingFrames,frameSizes:outgoingLengths,distinctWireOpcodes:outgoingOpcodes.size,incompleteStreams:incompleteOutgoing},
 issues,invalidLines,currentWalkingPositionVerified:false,
 conclusion:'Self appearance provides a spawn snapshot. It does not establish ongoing player position. Outgoing payloads are not decrypted; no proximity cadence is enabled.'};
const output=filename.replace(/\.ndjson$/,'.analysis.json');if(output===filename)throw Error('Input must end with .ndjson');
fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({messages,spawnSnapshots:positions.length,ownMovementPrefixMatches:ownMovement,outgoingFrames,distinctWireOpcodes:outgoingOpcodes.size,issues:issues.length,output,currentWalkingPositionVerified:false},null,2));
