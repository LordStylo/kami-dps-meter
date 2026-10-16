import fs from 'node:fs';
import readline from 'node:readline';
import { createHash } from 'node:crypto';
import { Reader } from '../protocol/reader.mjs';
import { decodePacket } from '../protocol/packets.mjs';
import { WORLD_EVIDENCE_OPCODES, readWorldEvidence, objectChains } from './world-evidence.mjs';

// Static schema from the installed protocol reference. Map membership alone is
// not a proximity or live-spawn signal. Positions are deliberately not exported.
export function worldObjects(bytes) {
  const r = new Reader(bytes), result = r.u16(), mapId = r.i32();
  r.list(t => { const flags=t.u8(); t.vi32(); if(flags&1)t.vec(); t.bool(); t.i64(); });
  r.list(t => { t.vi32(); t.i32(); t.vec(); });
  r.list(t => { t.vi32(); t.i32(); t.i32(); t.vec(); t.vi32(); t.i64(); });
  const objects=r.list(t => { const entity=t.vi32(), template=t.i32(); t.vec(); return {entity,template}; });
  r.done(); return {result,mapId,objects};
}

async function* rows(filename) {
  const input=fs.createReadStream(filename), lines=readline.createInterface({input,crlfDelay:Infinity});
  let line=0;
  try { for await(const text of lines) { line++; if(!text.trim())continue;
    try { yield {row:JSON.parse(text),line}; } catch { yield {invalid:true,line}; }
  } } finally { lines.close(); input.destroy(); }
}
const hex = code=>'0x'+code.toString(16).padStart(4,'0');
export async function analyzeCubeFile(filename) {
  if(fs.statSync(filename).size>65*1024*1024)throw Error('İnceleme dosyası 65 MiB sınırını aşıyor.');
  let header,end,lastAt=0,invalidLines=0,messageCount=0;
  const markers=[],automaticAlerts=[],warnings=new Set(),issues=new Map();
  for await(const {row,invalid} of rows(filename)) {
    if(invalid){invalidLines++;continue;}
    if(!row||typeof row!=='object'){invalidLines++;continue;}
    if(Number.isFinite(row.at))lastAt=Math.max(lastAt,row.at);
    if(row.kind==='header')header=row;
    if(row.kind==='end')end=row;
    if(row.kind==='marker'&&Number.isFinite(row.at)&&markers.length<1000)markers.push(row);
    if(row.kind==='message')messageCount++;
    if(row.kind==='cube-alert'&&automaticAlerts.length<20000)automaticAlerts.push(row);
    if(row.kind==='issue'&&issues.size<200)issues.set(row.code,(issues.get(row.code)||0)+1);
  }
  if(header?.format!=='kami-cube-research/1')throw Error('Desteklenmeyen test kaydı.');
  if(!end)warnings.add('Kayıt tamamlanmamış; son bölüm eksik olabilir.');
  if(invalidLines)warnings.add(`${invalidLines} bozuk satır atlandı.`);
  if(!messageCount)warnings.add('Hiç oyun mesajı yok; bağlantı veya senkronizasyon doğrulanmalı.');
  if(header.prebuffer?.clipped)warnings.add('Bellek sınırı nedeniyle işaret öncesi kayıt kısaldı.');
  if(issues.size)warnings.add('Akış veya çözümleme sorunları var; issues alanını kontrol et.');
  if(end&&end.messages!==messageCount)warnings.add('Dosya mesaj sayısı kapanış özetiyle uyuşmuyor.');
  if(!markers.some(m=>m.phase==='near'))warnings.add('Buldum işareti yok; yaklaşma ve açılma anı ayrı ayrı doğrulanamaz.');
  if(!markers.some(m=>m.phase==='opened'))warnings.add('Açıldı işareti yok.');
  if(['size-limit','time-limit'].includes(end?.reason))warnings.add('Kayıt süre/boyut sınırında kesildi.');
  const finish=end?.at??lastAt;
  markers.sort((a,b)=>a.at-b.at||a.index-b.index);
  const phases=markers.map((m,i)=>({index:i,phase:m.phase,label:m.label,at:m.at,
    until:markers[i+1]?.at??finish,seconds:Math.max(0,((markers[i+1]?.at??finish)-m.at)/1000),messages:0}));
  const opcodes=new Map(),observations=[]; let observationsClipped=false,omitted=0;
  const observe=value=>{if(observations.length<20000)observations.push(value);else observationsClipped=true;};
  for await(const {row,invalid} of rows(filename)) {
    if(invalid||row?.kind!=='message')continue;
    if(!Number.isFinite(row.at)||!Number.isInteger(row.opcode)||row.opcode<0||row.opcode>65535){warnings.add('Geçersiz mesaj başlığı atlandı.');continue;}
    // Packet time, not disk order: buffered packets may straddle a marker.
    let pi=-1;for(let i=0;i<phases.length&&phases[i].at<=row.at;i++)pi=i;
    if(pi>=0)phases[pi].messages++;
    else warnings.add('İlk işaretten önce zaman damgası taşıyan mesaj var.');
    let stat=opcodes.get(row.opcode);
    if(!stat){stat={opcode:hex(row.opcode),known:!!row.known,total:0,decodeErrors:0,omitted:0,minSize:Infinity,maxSize:0,byPhase:{},signatures:new Map()};opcodes.set(row.opcode,stat);}
    stat.total++;stat.decodeErrors+=row.error?1:0;stat.byPhase[pi]=(stat.byPhase[pi]||0)+1;
    if(Number.isFinite(row.size)){stat.minSize=Math.min(stat.minSize,row.size);stat.maxSize=Math.max(stat.maxSize,row.size);}
    if(row.payloadOmitted){stat.omitted++;omitted++;continue;}
    if(typeof row.payload!=='string'||row.payload.length>131072||row.payload.length!==row.size*2||!/^(?:[a-f0-9]{2})*$/i.test(row.payload)){
      warnings.add('Geçersiz mesaj içeriği atlandı.');continue;
    }
    const bytes=Buffer.from(row.payload,'hex');
    if(!row.known){
      const signature=createHash('sha256').update(bytes).digest('hex').slice(0,16);
      if(stat.signatures.has(signature)||stat.signatures.size<16)stat.signatures.set(signature,(stat.signatures.get(signature)||0)+1);
    }
    const context={at:row.at,phaseIndex:pi,stream:row.stream,opcode:hex(row.opcode)};
    try {
      if(WORLD_EVIDENCE_OPCODES.has(row.opcode)){
        for(const event of readWorldEvidence(row.opcode,bytes))observe({...context,...event});
      }else if(row.opcode===0x3641||row.opcode===0x3642){
        const packet=decodePacket(row.opcode,bytes,row.at);
        for(const e of packet.events)if(e.type==='spawn'||e.type==='removed')observe({...context,kind:e.type,entity:e.entity,template:e.npc,owner:e.owner});
      }else if(row.opcode===0x9101){
        const map=worldObjects(bytes);
        if(map.result!==0){observe({...context,kind:'map-error',result:map.result});continue;}
        observe({...context,kind:'map-snapshot',mapId:map.mapId,count:map.objects.length});
        for(const obj of map.objects)observe({...context,kind:'map-object',mapId:map.mapId,...obj});
      }
    }catch(error){observe({...context,kind:'schema-error',error:error.message});}
  }
  const stats=[...opcodes.values()].sort((a,b)=>b.total-a.total).map(s=>({...s,minSize:Number.isFinite(s.minSize)?s.minSize:null,
    signatures:[...s.signatures].map(([hash,count])=>({hash,count})),
    rates:phases.map(p=>({phaseIndex:p.index,count:s.byPhase[p.index]||0,perSecond:p.seconds>0?(s.byPhase[p.index]||0)/p.seconds:null}))}));
  if(observationsClipped)warnings.add('Nesne gözlem listesi 20.000 satırda sınırlandı; ham yerel kayıt korunuyor.');
  return {format:'kami-cube-analysis/1',id:header.id,startedAt:header.at,endedAt:end?.at??null,
    conclusion:'Hidden cube kimliği ve yakınlık sinyali doğrulanmadı. Bu rapor yalnızca işaretlerle ilişkili gözlemleri listeler.',
    interpretation:['İşaret öncesi bölüm uzakta olduğunun kanıtı değildir.','WorldMapContentsInfo nesne listesi yakında veya aktif cube bulunduğunu kanıtlamaz.',
      'Tek kayıttaki opcode artışı ilişki gösterir; çevredeki oyuncular veya başka olaylar da neden olabilir.','İlk 16 farklı bilinmeyen içerik özeti örnektir; bilinmeyen içerik rapora açık metin yazılmaz.'],
    messages:messageCount,omittedPayloads:omitted,phases,opcodes:stats,observations,automaticAlerts,objectChains:objectChains(observations),issues:Object.fromEntries(issues),warnings:[...warnings]};
}
