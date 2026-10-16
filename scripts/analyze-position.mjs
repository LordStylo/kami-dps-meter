import fs from 'node:fs';
import readline from 'node:readline';
import {FrameStream} from '../src/protocol/framing.mjs';
import {PlayerPositionTracker} from '../src/player-position.mjs';

const filename=process.argv[2];
if(!filename?.endsWith('.ndjson'))throw Error('Usage: node scripts/analyze-position.mjs <capture.ndjson>');
if(fs.statSync(filename).size>65*1024*1024)throw Error('Capture exceeds 65 MiB');
const tracker=new PlayerPositionTracker(),frames=new Map(),updates=[],recorded=[],issues=[];
let messages=0,invalidLines=0,truncatedUpdates=false;
function keep(list,row){if(list.length<10000)list.push(row);else truncatedUpdates=true;}
function packet(p,stream){
 messages++;const before=tracker.status(stream,p.at);tracker.message(p,stream);const after=tracker.status(stream,p.at),s=tracker.streams.get(stream);
 if(after.at!==null&&before.at!==after.at)keep(updates,{stream,at:after.at,quality:after.quality,source:after.source,
  position:{...s.position},fit:s.quality==='estimated'?{...s.fit}:null});
}
const input=fs.createReadStream(filename),lines=readline.createInterface({input,crlfDelay:Infinity});
try{for await(const line of lines){
 let row;try{row=JSON.parse(line);}catch{invalidLines++;continue;}
 const stream=row.pair??row.stream;
 if(row.kind==='player-position'){keep(recorded,row);continue;}
 if(row.kind==='issue'){
  keep(issues,{stream,at:row.at,code:row.code});
  if(!row.direction||row.direction==='in'){frames.get(stream)?.gap();tracker.invalidate(stream);}continue;
 }
 if(!Number.isFinite(row.at)||typeof row.payload!=='string'||row.payload.length>1024*1024||!/^(?:[0-9a-f]{2})*$/i.test(row.payload))continue;
 if(row.kind==='message'){packet({...row,payload:Buffer.from(row.payload,'hex')},stream);continue;}
 if(row.kind!=='chunk'||row.direction!=='in')continue;
 if(!frames.has(stream)){
  if(frames.size>=128)throw Error('Too many streams');
  frames.set(stream,new FrameStream(()=>{},()=>tracker.invalidate(stream),p=>packet(p,stream)));
 }
 frames.get(stream).push(Buffer.from(row.payload,'hex'),row.at);
}}finally{lines.close();input.destroy();}
const report={format:'kami-position-analysis/1',messages,updates,recorded,issues,invalidLines,parseErrors:tracker.errors,truncatedUpdates,
 continuousWalkingVerified:false,metreScaleCalibrated:false,
 conclusion:'Visibility estimates are sparse and experimental. Fit residual measures internal consistency, not real position accuracy. Recorded annotations are not independent ground truth.'};
const output=filename.replace(/\.ndjson$/,'.position-analysis.json');fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({messages,observed:updates.filter(x=>x.quality==='observed').length,
 estimated:updates.filter(x=>x.quality==='estimated').length,recorded:recorded.length,parseErrors:tracker.errors,issues:issues.length,output},null,2));
