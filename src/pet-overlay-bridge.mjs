import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {setTimeout as delay} from 'node:timers/promises';

const MAX_FILE_BYTES=4096,MAX_REQUEST_AGE=10000;
const positive=value=>Number.isSafeInteger(value)&&value>0;
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);

export class PetOverlayError extends Error {
  constructor(message,status=400){super(message);this.status=status;}
}

async function readJson(filename,limit=MAX_FILE_BYTES){
  let handle;
  try{
    handle=await fs.open(filename,'r');
    const bytes=Buffer.alloc(limit+1),{bytesRead}=await handle.read(bytes,0,bytes.length,0);
    if(bytesRead>limit)return null;
    return JSON.parse(bytes.subarray(0,bytesRead).toString('utf8'));
  }catch(error){if(error.code==='ENOENT'||error instanceof SyntaxError)return null;throw error;}
  finally{await handle?.close();}
}

// Each endpoint instance serializes requests. Never remove a file left for a
// different request, including an unrelated response received during timeout.
async function removeOwn(filename,requestId){
  try{if((await readJson(filename))?.requestId===requestId)await fs.unlink(filename);}
  catch(error){if(error.code!=='ENOENT')throw error;}
}

export class PetOverlayBridge {
  constructor({directory,pets,maps,timeoutMs=2500,pollMs=40,clock=Date.now}={}){
    if(typeof directory!=='string'||!directory||!Array.isArray(pets)||!Array.isArray(maps)||!Number.isFinite(timeoutMs)||timeoutMs<=0||timeoutMs>2500||!Number.isFinite(pollMs)||pollMs<=0)throw new TypeError('Invalid pet overlay bridge');
    this.directory=path.resolve(directory);this.requestFile=path.join(this.directory,'pet-map.request');this.responseFile=path.join(this.directory,'pet-map.response');this.hostFile=path.join(this.directory,'host.json');
    this.pets=new Map(pets.map(p=>[p.id,p]));this.maps=new Set(maps.map(m=>m.id));this.timeoutMs=timeoutMs;this.pollMs=pollMs;this.clock=clock;this.pending=false;
  }
  validMap(petId,mapId){return positive(mapId)&&(this.maps.has(mapId)||(this.pets.get(petId)?.mapIds||[]).includes(mapId));}
  validate(value){
    if(!object(value)||Object.keys(value).some(key=>!['petId','mapId'].includes(key))||!positive(value.petId)||!this.pets.has(value.petId))throw new PetOverlayError('Geçerli bir pet seçmelisin.');
    if(value.mapId!==undefined&&!this.validMap(value.petId,value.mapId))throw new PetOverlayError('Pet haritası geçerli değil.');
    return {petId:value.petId,...value.mapId===undefined?{}:{mapId:value.mapId}};
  }
  async requireHost(){
    const host=await readJson(this.hostFile,16384);
    if(!object(host)||!positive(host.pid))throw new PetOverlayError('Kami overlay’i açık değil. Overlay’i açıp tekrar dene.',503);
    if(!Array.isArray(host.features)||!host.features.includes('pet-map-overlay'))throw new PetOverlayError('Pet haritası için Kami overlay’i güncellenmeli. Overlay’i yeniden açıp tekrar dene.',503);
  }
  async select(value){
    const selected=this.validate(value);
    if(this.pending)throw new PetOverlayError('Başka bir pet haritası isteği işleniyor.',409);
    this.pending=true;
    const requestId=randomUUID(),request={...selected,requestId,at:this.clock()},temporary=this.requestFile+'.tmp-'+requestId;
    let written=false;
    try{
      await this.requireHost();
      const previous=await readJson(this.requestFile);
      const age=request.at-previous?.at;
      if(previous?.requestId&&Number.isFinite(previous.at)&&age>=-2000&&age<=MAX_REQUEST_AGE)throw new PetOverlayError('Başka bir pet haritası isteği bekliyor.',409);
      await fs.writeFile(temporary,JSON.stringify(request),{flag:'wx'});
      await fs.rename(temporary,this.requestFile);written=true;
      const deadline=performance.now()+this.timeoutMs;
      while(performance.now()<deadline){
        const response=await readJson(this.responseFile);
        if(response?.requestId===requestId){
          if(response.ok===false)throw new PetOverlayError(typeof response.error==='string'&&response.error.length<=300?response.error:'Pet haritası açılamadı.',502);
          if(response.ok!==true||response.petId!==selected.petId||response.mapId!==undefined&&response.mapId!==null&&!this.validMap(selected.petId,response.mapId)||selected.mapId!==undefined&&response.mapId!==selected.mapId)throw new PetOverlayError('Overlay’den geçersiz pet haritası yanıtı alındı.',502);
          return {requestId,ok:true,petId:response.petId,...response.mapId===undefined?{}:{mapId:response.mapId}};
        }
        await this.requireHost();
        await delay(Math.min(this.pollMs,Math.max(1,deadline-performance.now())));
      }
      throw new PetOverlayError('Pet haritası overlay’inden yanıt alınamadı. Kami overlay’ini açıp tekrar dene.',504);
    }catch(error){
      if(error instanceof PetOverlayError)throw error;
      throw new PetOverlayError('Pet haritası overlay’ine istek iletilemedi.',503);
    }finally{
      try{await fs.unlink(temporary);}catch{}
      if(written){await removeOwn(this.requestFile,requestId).catch(()=>{});await removeOwn(this.responseFile,requestId).catch(()=>{});}
      this.pending=false;
    }
  }
}
