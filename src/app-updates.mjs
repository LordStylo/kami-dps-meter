import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

export const UPDATE_REPOSITORY='LordStylo/kami-dps-meter';
export const UPDATE_API='https://api.github.com/repos/'+UPDATE_REPOSITORY+'/releases?per_page=30';
const REPO_PATH='/'+UPDATE_REPOSITORY,MAX_JSON=1024*1024,MAX_INSTALLER=512*1024*1024;
const CDN_HOSTS=new Set(['release-assets.githubusercontent.com','objects.githubusercontent.com']);
const busy=message=>Object.assign(Error(message),{statusCode:409});
const safeError=error=>error?.name==='AbortError'||error?.name==='TimeoutError'?'Güncelleme sunucusu zamanında yanıt vermedi.':String(error?.message||'Güncelleme denetlenemedi.').slice(0,250);

export function stableVersion(value){
 if(typeof value!=='string'||!/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value))return null;
 const numbers=value.replace(/^v/,'').split('.').map(Number);
 return numbers.every(Number.isSafeInteger)?numbers.join('.'):null;
}
export function compareVersions(a,b){
 const aa=stableVersion(a),bb=stableVersion(b);if(!aa||!bb)throw Error('Geçersiz uygulama sürümü.');
 const left=aa.split('.').map(Number),right=bb.split('.').map(Number);
 for(let i=0;i<3;i++)if(left[i]!==right[i])return left[i]>right[i]?1:-1;return 0;
}
function httpsURL(value){
 let url;try{url=new URL(value);}catch{throw Error('Güncelleme adresi geçersiz.');}
 if(url.protocol!=='https:'||url.username||url.password||url.port||url.hash)throw Error('Güncelleme adresine izin verilmiyor.');return url;
}
function assetURL(value,tag,name,{redirect=false}={}){
 const url=httpsURL(value);
 if(url.hostname==='github.com'){
  if(url.pathname!==REPO_PATH+'/releases/download/'+encodeURIComponent(tag)+'/'+encodeURIComponent(name)||url.search)throw Error('Kurulum dosyasının deposu veya adı uyuşmuyor.');
 }else if(!redirect||!CDN_HOSTS.has(url.hostname))throw Error('Kurulum indirme sunucusuna izin verilmiyor.');
 return url.href;
}
function releaseURL(value,tag){
 const url=httpsURL(value);if(url.hostname!=='github.com'||url.pathname!==REPO_PATH+'/releases/tag/'+encodeURIComponent(tag)||url.search)throw Error('Sürüm sayfası bu depoya ait değil.');return url.href;
}
function installerAsset(release,version){
 const name=`Kami-DPS-Meter-Setup-${version}.exe`,assets=Array.isArray(release.assets)?release.assets.filter(a=>a?.name===name):[];
 if(assets.length!==1)return null;const asset=assets[0];
 if(asset.state!=='uploaded'||!Number.isSafeInteger(asset.size)||asset.size<64||asset.size>MAX_INSTALLER||!Number.isSafeInteger(asset.id)||asset.id<=0||!/^sha256:[a-f0-9]{64}$/i.test(asset.digest||''))return null;
 return {version,tag:release.tag_name,name,size:asset.size,sha256:asset.digest.slice(7).toLowerCase(),url:assetURL(asset.browser_download_url,release.tag_name,name),releaseUrl:releaseURL(release.html_url,release.tag_name)};
}
async function bytes(response,limit,onChunk){
 const advertised=response.headers.get('content-length');if(advertised!==null&&(!/^\d+$/.test(advertised)||Number(advertised)>limit))throw Error('Güncelleme yanıtı boyut sınırını aşıyor.');
 if(!response.body)throw Error('Güncelleme yanıtı boş.');let size=0;
 for await(const part of response.body){const chunk=Buffer.from(part);size+=chunk.length;if(size>limit)throw Error('Güncelleme yanıtı boyut sınırını aşıyor.');await onChunk(chunk,size);}
 return size;
}
function executable(prefix){
 if(prefix.length<64||prefix[0]!==0x4d||prefix[1]!==0x5a)return false;const offset=prefix.readUInt32LE(0x3c);
 return offset>=64&&offset+4<=prefix.length&&prefix.subarray(offset,offset+4).equals(Buffer.from([0x50,0x45,0,0]));
}

export function createAppUpdates({version,dataDir,fetch:fetchImpl=globalThis.fetch,platform=process.platform,onInstall=null,clock=Date.now,checkTimeoutMs=8000,downloadTimeoutMs=120000,startupDelayMs=2500}={}){
 const currentVersion=stableVersion(version);if(!currentVersion||!dataDir||!path.isAbsolute(dataDir)||typeof fetchImpl!=='function')throw Error('Güncelleme yapılandırması geçersiz.');
 const directory=path.join(dataDir,'updates');
 let candidate=null,operation=null,checkPromise=null,startupTimer=null,started=false,checked=false,controller=null;
 let state={currentVersion,status:'idle',latestVersion:null,checkedAt:null,releaseUrl:null,downloadBytes:0,downloadTotal:null,error:null,retryAt:null};
 const snapshot=()=>({...state,canInstall:platform==='win32'&&typeof onInstall==='function'&&state.status==='available'&&!!candidate});
 function reset(values){state={...state,downloadBytes:0,downloadTotal:null,error:null,retryAt:null,...values};}
 async function request(url,{timeout,accept='application/vnd.github+json',download=null}={}){
  controller=new AbortController();const active=controller,timer=setTimeout(()=>active.abort(),timeout);timer.unref?.();
  try{
   let target=url;
   for(let count=0;count<=4;count++){
    const response=await fetchImpl(target,{method:'GET',redirect:'manual',signal:active.signal,headers:{Accept:accept,'User-Agent':'Kami-DPS-Meter/'+currentVersion,'X-GitHub-Api-Version':'2022-11-28'}});
    if([301,302,303,307,308].includes(response.status)){
     await response.body?.cancel();if(!download||count===4)throw Error('Güncelleme yönlendirmesine izin verilmiyor.');
     const location=response.headers.get('location');if(!location)throw Error('İndirme yönlendirmesi geçersiz.');target=assetURL(new URL(location,target).href,download.tag,download.name,{redirect:true});continue;
    }
    if(!response.ok){
     if(response.status===404)return {missing:true};
     if(response.status===403||response.status===429){const delay=Number(response.headers.get('retry-after')),resetAt=Number(response.headers.get('x-ratelimit-reset'));state.retryAt=Number.isFinite(delay)&&delay>0?clock()+Math.min(delay,86400)*1000:Number.isFinite(resetAt)&&resetAt*1000>clock()?resetAt*1000:null;throw Error('GitHub istek sınırına ulaşıldı. Daha sonra yeniden dene.');}
     throw Error('Güncelleme sunucusu yanıt vermedi ('+response.status+').');
    }
    if(download)return await download.read(response);
    const chunks=[];await bytes(response,MAX_JSON,chunk=>chunks.push(chunk));return JSON.parse(Buffer.concat(chunks).toString('utf8'));
   }
   throw Error('İndirme yönlendirme sınırını aştı.');
  }finally{clearTimeout(timer);if(controller===active)controller=null;}
 }
 async function inspect(){
  checked=true;candidate=null;reset({status:'checking',checkedAt:clock(),latestVersion:null,releaseUrl:null});
  const releases=await request(UPDATE_API,{timeout:checkTimeoutMs});
  if(releases?.missing){reset({status:'unavailable'});return;}
  if(!Array.isArray(releases)||releases.length>100)throw Error('GitHub sürüm listesi geçersiz.');
  const stable=releases.filter(r=>r&&r.draft===false&&r.prerelease===false&&stableVersion(r.tag_name)).sort((a,b)=>compareVersions(b.tag_name,a.tag_name));
  if(!stable.length){reset({status:'unavailable'});return;}
  const latest=stable[0],latestVersion=stableVersion(latest.tag_name);state.latestVersion=latestVersion;
  if(compareVersions(latestVersion,currentVersion)<=0){reset({status:'up-to-date'});return;}
  candidate=installerAsset(latest,latestVersion);
  if(!candidate){reset({status:'unavailable'});return;}
  reset({status:'available',latestVersion,releaseUrl:candidate.releaseUrl});
 }
 async function check(){
  if(checkPromise)return checkPromise;if(operation)return snapshot();operation='check';
  checkPromise=(async()=>{try{await inspect();}catch(error){state={...state,status:'error',error:safeError(error)};}finally{operation=null;checkPromise=null;}return snapshot();})();
  return checkPromise;
 }
 async function ensureCache(target){
  await fs.mkdir(directory,{recursive:true});if((await fs.lstat(directory)).isSymbolicLink())throw Error('Güncelleme klasörü bağlantı olamaz.');
  await fs.mkdir(target,{recursive:true});if((await fs.lstat(target)).isSymbolicLink())throw Error('Güncelleme klasörü bağlantı olamaz.');
 }
 async function cached(filename,asset){
  let stat;try{stat=await fs.lstat(filename);}catch(error){if(error.code==='ENOENT')return false;throw error;}
  if(stat.isSymbolicLink()||!stat.isFile())throw Error('Kurulum önbelleği geçersiz.');if(stat.size!==asset.size){await fs.unlink(filename);return false;}
  const file=await fs.open(filename,'r'),hash=createHash('sha256'),prefix=Buffer.alloc(Math.min(65536,stat.size));
  try{await file.read(prefix,0,prefix.length,0);for await(const chunk of file.createReadStream({autoClose:false}))hash.update(chunk);}finally{await file.close();}
  if(hash.digest('hex')===asset.sha256&&executable(prefix))return true;await fs.unlink(filename);return false;
 }
 async function stage(asset){
  const target=path.join(directory,asset.version),filename=path.join(target,asset.name);await ensureCache(target);
  reset({status:'downloading',downloadTotal:asset.size});
  if(await cached(filename,asset)){state.downloadBytes=asset.size;return filename;}
  const temporary=filename+'.'+randomUUID()+'.tmp',hash=createHash('sha256');let file,prefix=Buffer.alloc(0);
  try{
   file=await fs.open(temporary,'wx',0o600);
   const result=await request(asset.url,{timeout:downloadTimeoutMs,accept:'application/octet-stream',download:{...asset,async read(response){
    const size=await bytes(response,Math.min(MAX_INSTALLER,asset.size),async(chunk,total)=>{hash.update(chunk);if(prefix.length<65536)prefix=Buffer.concat([prefix,chunk.subarray(0,65536-prefix.length)]);let offset=0;while(offset<chunk.length){const {bytesWritten}=await file.write(chunk,offset,chunk.length-offset,null);if(bytesWritten<=0)throw Error('Kurulum dosyası yazılamadı.');offset+=bytesWritten;}state.downloadBytes=total;});
    if(size!==asset.size)throw Error('İndirilen kurulum boyutu sürüm bilgisiyle uyuşmuyor.');return {ok:true};
   }}});
   if(result?.missing)throw Error('Kurulum dosyası artık yayımlanmıyor.');
   if(hash.digest('hex')!==asset.sha256)throw Error('Kurulum dosyasının SHA-256 doğrulaması başarısız.');
   if(!executable(prefix))throw Error('İndirilen dosya geçerli bir Windows kurulum dosyası değil.');
   await file.sync();await file.close();file=null;await fs.rename(temporary,filename);return filename;
  }finally{if(file)await file.close();try{await fs.unlink(temporary);}catch(error){if(error.code!=='ENOENT')throw error;}}
 }
 async function install(){
  if(operation||state.status==='installing')throw busy('Bir güncelleme işlemi zaten sürüyor.');
  if(platform!=='win32'||typeof onInstall!=='function')throw Object.assign(Error('Bu çalıştırmada kurulum güncellemesi kullanılamıyor.'),{statusCode:409});
  operation='install';
  try{
   await inspect();if(!candidate||state.status!=='available')throw Error(state.status==='up-to-date'?'Uygulama zaten güncel.':'İndirilebilir kurulum paketi henüz bulunamadı.');
   const asset={...candidate},installerPath=await stage(asset);state.status='installing';await onInstall({installerPath,version:asset.version,sha256:asset.sha256});return snapshot();
  }catch(error){state={...state,status:'error',error:safeError(error)};throw error;}finally{operation=null;}
 }
 function start(){if(started)return;started=true;startupTimer=setTimeout(()=>{startupTimer=null;if(!checked&&!operation)void check();},startupDelayMs);startupTimer.unref?.();}
 function dispose(){clearTimeout(startupTimer);startupTimer=null;controller?.abort();}
 function handoffFailed(message){if(state.status==='installing')state={...state,status:'error',error:safeError({message})};return snapshot();}
 return {snapshot,check,install,start,dispose,handoffFailed};
}
