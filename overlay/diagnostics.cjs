const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');

// Keep only lifecycle metadata. Combat state, packet bodies and renderer URLs
// never belong in this log.
const allowed=new Set(['panel','reason','code','exitCode','signal','type','origin','source','message','stack','name','normal','previousPid','previousSession','previousStartedAt','version','electron','node','koffi']);
function sanitize(value,limit=2048){
 return String(value)
  .replace(/[A-Z]:[\\/]Users[\\/][^\\/\s:)]+/gi,'<user>')
  .replace(/\/(?:home|Users)\/[^/\s:)]+/g,'<user>')
  .replace(/(?:https?|wss?):\/\/[^\s)]+/gi,value=>{try{const url=new URL(value);url.username='';url.password='';url.search='';url.hash='';return url.toString();}catch{return '<url>';}})
  .replace(/data:[^\s)]+/gi,'<data>')
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'')
  .slice(0,limit);
}
function errorFields(error){
 try{
  if(error instanceof Error)return {name:sanitize(error.name,80),message:sanitize(error.message),stack:sanitize(error.stack||'',8192)};
  return {name:'NonError',message:typeof error==='string'?sanitize(error):`Rejected ${error===null?'null':typeof error} value`};
 }catch{return {name:'Error',message:'Error details unavailable'};}
}

function createDiagnostics({directory,maxBytes=256*1024,fsModule=fs,processObject=process,now=Date.now}={}){
 if(typeof directory!=='string'||!directory)throw new TypeError('Diagnostics directory is required');
 const limit=Number.isFinite(maxBytes)?Math.max(1024,Math.floor(maxBytes)):256*1024;
 const logPath=path.join(directory,'diagnostics.ndjson'),previousPath=path.join(directory,'diagnostics.previous.ndjson'),markerPath=path.join(directory,'diagnostics-session.json');
 const session=randomUUID(),pid=processObject.pid??process.pid,startedAt=new Date(now()).toISOString();
 let quitRequested=false,fatal=false,attached=false,disposed=false;
 const removeListeners=[];
 function record(event,fields={}){
  if(disposed)return false;
  const base={at:new Date(now()).toISOString(),session,pid,event:sanitize(event,80)},entry={...base};
  for(const [key,value]of Object.entries(fields))if(allowed.has(key)){
   if(typeof value==='string')entry[key]=sanitize(value,key==='stack'?8192:2048);
   else if(typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))entry[key]=value;
  }
  let line=JSON.stringify(entry)+'\n';
  if(Buffer.byteLength(line)>limit)line=JSON.stringify({...base,truncated:true,message:entry.message?.slice(0,80)})+'\n';
  try{
   fsModule.mkdirSync(directory,{recursive:true});
   let size=0;try{size=fsModule.statSync(logPath).size;}catch(error){if(error.code!=='ENOENT')throw error;}
   if(size+Buffer.byteLength(line)>limit){
    try{fsModule.unlinkSync(previousPath);}catch(error){if(error.code!=='ENOENT')throw error;}
    fsModule.renameSync(logPath,previousPath);
   }
   fsModule.appendFileSync(logPath,line,'utf8');
   return true;
  }catch{return false;}
 }
 function listen(emitter,name,handler){emitter.on(name,handler);removeListeners.push(()=>emitter.removeListener(name,handler));}
 function attachProcess(){
  if(attached||disposed)return;attached=true;
  // An unhandledRejection listener would suppress Node's default fatal action.
  // The monitor observes that same failure without changing its handling.
  listen(processObject,'uncaughtExceptionMonitor',(error,origin)=>{
   fatal=true;record(origin==='unhandledRejection'?'unhandled-rejection':'uncaught-exception',{...errorFields(error),origin});
  });
  listen(processObject,'exit',code=>{
   const normal=quitRequested&&!fatal&&code===0;
   record('process-exit',{code,normal});
   if(normal)try{if(JSON.parse(fsModule.readFileSync(markerPath,'utf8')).session===session)fsModule.unlinkSync(markerPath);}catch{}
  });
 }
 function watchWindow(window,panel){
  if(disposed)return;
  record('window-created',{panel});
  listen(window,'closed',()=>record('window-closed',{panel}));
  listen(window,'unresponsive',()=>record('window-unresponsive',{panel}));
  listen(window,'responsive',()=>record('window-responsive',{panel}));
  if(window.webContents)listen(window.webContents,'render-process-gone',(_event,details)=>record('renderer-gone',{panel,reason:details?.reason,exitCode:details?.exitCode}));
 }
 let previous;
 try{const raw=fsModule.readFileSync(markerPath,'utf8');if(raw.length<4096)previous=JSON.parse(raw);}catch{}
 record('startup',{version:1});
 if(previous?.session&&previous?.startedAt)record('previous-session-incomplete',{previousPid:previous.pid,previousSession:previous.session,previousStartedAt:previous.startedAt});
 try{fsModule.mkdirSync(directory,{recursive:true});fsModule.writeFileSync(markerPath,JSON.stringify({session,pid,startedAt}),'utf8');}catch{}
 return {path:logPath,record,attachProcess,watchWindow,
  beforeQuit(reason='app-before-quit'){quitRequested=true;record('before-quit',{reason});},
  error(event,error,fields={}){return record(event,{...fields,...errorFields(error)});},
  dispose(){for(const remove of removeListeners.splice(0))remove();disposed=true;}
 };
}
module.exports={createDiagnostics};
