// Exercise the real subclass callback on hidden windows owned by this test.
// No keyboard/mouse injection, game-window messages or foreground changes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const {_electron}=require(process.env.PLAYWRIGHT_PATH||path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const root=path.resolve(process.env.AION_OVERLAY_TEST_ROOT||'.');
const entry=path.join(root,'overlay/main.cjs');
const profile=path.resolve('tmp',`overlay-native-stress-${Date.now()}`);
const state={app:'aion-dps-lab',mode:'live',capture:{state:'capturing'},combat:{active:false},scope:'party',cubes:{epoch:'native-stress',total:0,active:[]},current:{id:1,damage:0,dps:0,seconds:0,players:[]}};
const server=http.createServer((_request,response)=>{
 response.setHeader('Content-Type','application/json');response.end(JSON.stringify(state));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const port=server.address().port;
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
let app,exitPromise,processOutput='';
const errors=[];
const started=Date.now();
try{
 app=await _electron.launch({executablePath:path.join(root,'runtime/electron/electron.exe'),args:['--js-flags=--expose-gc',entry,`--port=${port}`,`--profile=${profile}`,'--test-overlay'],env,timeout:30000});
 const child=app.process();
 exitPromise=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
 for(const stream of [child.stdout,child.stderr])stream?.on('data',chunk=>{processOutput=(processOutput+chunk).slice(-16000);});
 await app.firstWindow();
 const versions=await app.evaluate((_electron,paths)=>{
  const overlay=process.mainModule.require(paths.entry);
  overlay.pauseKeys();
  if(overlay.windows.size!==3)throw Error('Three overlay windows are required');
  if(typeof global.gc!=='function')throw Error('GC stress requires --js-flags=--expose-gc');
  const koffi=process.mainModule.require(paths.koffi);
  const user=koffi.load('user32.dll');
  globalThis.nativeStress={overlay,koffi,paths,
   send:user.func('intptr __stdcall SendMessageW(uintptr window, uint32 message, uintptr wParam, intptr lParam)'),
   post:user.func('int __stdcall PostMessageW(uintptr window, uint32 message, uintptr wParam, intptr lParam)'),
   style:user.func('intptr __stdcall GetWindowLongPtrW(uintptr window, int index)'),
   foreground:user.func('uintptr __stdcall GetForegroundWindow()'),
   owner:user.func('uint32 __stdcall GetWindowThreadProcessId(uintptr window, _Out_ uint32 *pid)'),
   rect:user.func('int __stdcall GetWindowRect(uintptr window, void *rectangle)'),
   sent:0,posted:0,moves:0,destroyed:0,collections:0};
  return {koffi:koffi.version,node:process.versions.node,electron:process.versions.electron};
 },{entry,koffi:path.join(root,'node_modules/koffi'),policy:path.join(root,'overlay/mouse-window.cjs')});
 for(const page of app.windows())page.on('pageerror',error=>errors.push(error.message));
 const edgeChecks=await app.evaluate(()=>{
  const s=globalThis.nativeStress,hits=[];
  for(const window of s.overlay.windows.values()){
   const handle=window.getNativeWindowHandle().readBigUInt64LE(),rect=Buffer.alloc(16);
   if(!s.rect(handle,rect))throw Error('GetWindowRect failed');
   const [left,top,right,bottom]=[0,4,8,12].map(offset=>rect.readInt32LE(offset)),mx=Math.round((left+right)/2),my=Math.round((top+bottom)/2);
   for(const [x,y]of [[left,top],[right-1,top],[left,bottom-1],[right-1,bottom-1],[mx,top],[mx,bottom-1],[left,my],[right-1,my]]){
    const hit=Number(s.send(handle,0x84,0,((y&65535)<<16)|(x&65535)));
    if(hit>=10&&hit<=17)throw Error(`Native resize edge escaped policy: ${hit}`);hits.push(hit);
   }
   if(Number(s.send(handle,0x112,0xf008,0))!==0)throw Error('Native SC_SIZE was not blocked');
  }
  return hits.length;
 });
 for(let chunk=0;chunk<20;chunk++){
  await app.evaluate(async(_electron,index)=>{
   const s=globalThis.nativeStress,windows=[...s.overlay.windows.values()];
   for(let message=0;message<1000;message++){
    const window=windows[message%windows.length],handle=window.getNativeWindowHandle().readBigUInt64LE();
    // Synchronous calls re-enter JS from inside an FFI call. Posted messages
    // below instead enter the callback later from Chromium's native loop.
    const activation=message%2===0;
    const result=Number(s.send(handle,activation?0x21:0,0,activation?(0x201<<16)|1:0));
    if(activation&&result!==3)throw Error(`WM_MOUSEACTIVATE returned ${result}`);
    s.sent++;
    if(message<200){if(!s.post(handle,0,0,0))throw Error('PostMessageW failed');s.posted++;}
    if(message%20===0){
     const bounds=window.getBounds();
     window.setBounds({...bounds,x:30+(message%200),y:30+(index%10)},false);
     window.setIgnoreMouseEvents(message%40===0,{forward:true});s.moves++;
    }
   }
   // Keep the callback reachable while GC runs and while queued native
   // messages execute without any synchronous FFI call on the JS stack.
   let garbage=Array.from({length:500},(_,item)=>({item,bytes:Buffer.alloc(1024)}));
   garbage=null;global.gc();s.collections++;
   await new Promise(resolve=>setTimeout(resolve,250));
   for(const window of windows){
    const extended=Number(s.style(window.getNativeWindowHandle().readBigUInt64LE(),-20));
    if(window.isVisible()||window.isFocused()||window.isFocusable()||!(extended&0x8000000))throw Error('Hidden non-activating window policy changed');
   }
   const pid=[0];s.owner(s.foreground(),pid);
   if(pid[0]===process.pid)throw Error('A test window took foreground ownership');
  },chunk);
 }
 await app.evaluate(async({BrowserWindow})=>{
  const s=globalThis.nativeStress;
  const {allowMouseWithoutActivation}=process.mainModule.require(s.paths.policy);
  for(let iteration=0;iteration<50;iteration++){
   const window=new BrowserWindow({width:80,height:80,show:false,frame:false,focusable:false,skipTaskbar:true,webPreferences:{sandbox:true}});
   const release=allowMouseWithoutActivation(window.getNativeWindowHandle().readBigUInt64LE());
   window.once('closed',release);
   const handle=window.getNativeWindowHandle().readBigUInt64LE();
   if(Number(s.send(handle,0x21,0,(0x201<<16)|1))!==3)throw Error('New window rejected its mouse policy');
   s.sent++;
   window.setBounds({x:40,y:40,width:81,height:81},false);s.moves++;
   // Cover both explicit detachment and WM_NCDESTROY cleanup, including
   // redundant releases and GC after native callback registration ends.
   if(iteration%2===0){release();release();}
   window.destroy();s.destroyed++;
   await new Promise(resolve=>setImmediate(resolve));
   if(iteration%5===0){global.gc();s.collections++;}
  }
 });
 const counts=await app.evaluate(()=>{
  const s=globalThis.nativeStress;
  return {sent:s.sent,posted:s.posted,moves:s.moves,destroyed:s.destroyed,collections:s.collections};
 });
 assert.deepEqual(counts,{sent:20050,posted:4000,moves:1050,destroyed:50,collections:30});
 assert.deepEqual(errors,[]);
 await app.close();app=null;
 const exit=await exitPromise;
 assert.equal(exit.code,0,JSON.stringify(exit));assert.equal(exit.signal,null);
 const report={ok:true,...versions,...counts,edgeChecks,nativeResize:'blocked',exit,elapsedMs:Date.now()-started};
 fs.mkdirSync(profile,{recursive:true});fs.writeFileSync(path.join(profile,'result.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));
}catch(error){
 if(processOutput)console.error(processOutput);
 throw error;
}finally{
 if(app)await app.close().catch(()=>{});
 await new Promise(resolve=>server.close(resolve));
}
