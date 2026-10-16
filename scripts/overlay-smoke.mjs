import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {_electron}=require(process.env.PLAYWRIGHT_PATH||path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const root=path.resolve(process.env.AION_OVERLAY_TEST_ROOT||'.'),profile=path.resolve('tmp','overlay-smoke-'+Date.now());
const runtime=path.join(root,'runtime/electron/electron.exe'),entry=path.join(root,'overlay/main.cjs');
const state={app:'aion-dps-lab',mode:'live',capture:{state:'capturing'},scope:'party',cubes:{epoch:'test',total:0,active:[]},current:{id:1,damage:600000,dps:120000,seconds:5,players:[{entity:1,name:'Kamielle',self:true,dps:90000,damage:450000,share:75,skills:[{id:18290000,name:'Spinning Strike',icon:'/icons/skills/ICON_CH_SKILL_029.webp',dps:90000,share:100}]},{entity:2,name:'Nyra',dps:30000,damage:150000,share:25,skills:[]}]}};
const server=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(state));});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
let app;const errors=[];
async function launch(){
 app=await _electron.launch({executablePath:runtime,args:[entry,`--port=${port}`,`--profile=${profile}`,'--test-overlay'],env,timeout:30000});
 await app.firstWindow();
 await app.evaluate((_e,filename)=>{globalThis.overlayForTest=process.mainModule.require(filename);if(globalThis.overlayForTest.windows.size!==2)throw Error('Missing native windows');globalThis.overlayForTest.pauseKeys();},entry);
 console.log('Native overlay windows loaded');
 for(let attempt=0;app.windows().length<2&&attempt<100;attempt++)await new Promise(r=>setTimeout(r,50));
 const pages=app.windows();for(const p of pages){p.on('pageerror',e=>errors.push(e.message));await p.waitForURL(/panel=(dps|cube)/);}
 const dps=pages.find(p=>p.url().includes('panel=dps')),cube=pages.find(p=>p.url().includes('panel=cube'));
 if(!dps||!cube)throw Error('Both panels must load');
 await dps.waitForFunction(()=>!!window.kamiOverlay);await cube.waitForFunction(()=>!!window.kamiOverlay);
 return {dps,cube};
}
async function flags(){return app.evaluate((_e,koffiPath)=>{
 const k=process.mainModule.require(koffiPath),u=k.load('user32.dll'),get=u.func('intptr __stdcall GetWindowLongPtrW(uintptr hwnd, int index)');
 return [...globalThis.overlayForTest.windows].map(([panel,w])=>{const style=Number(get(w.getNativeWindowHandle().readBigUInt64LE(),-20));return {panel,transparent:!!(style&0x20),noActivate:!!(style&0x8000000),topmost:w.isAlwaysOnTop(),focusable:w.isFocusable(),bounds:w.getBounds()};});
},path.join(root,'node_modules/koffi'));}
try{
 let {dps,cube}=await launch();
 await dps.waitForFunction(()=>document.querySelectorAll('[data-player]').length===2);
 assert.equal(await dps.locator('#total-dps').textContent(),'120 K');
 assert.match(await cube.locator('#cube-status').textContent(),/Aktif/);
 const before=await flags();assert.ok(before.every(w=>w.transparent&&w.noActivate&&w.topmost&&!w.focusable));
 await app.evaluate(()=>globalThis.overlayForTest.setInteraction(true));
 const after=await flags();assert.ok(after.every(w=>!w.transparent&&!w.noActivate&&w.focusable));
 await dps.locator('[data-player="1"]').click({force:true});assert.match(await dps.locator('#rows').textContent(),/Spinning Strike/);
 await dps.locator('.icon').evaluate(img=>img.decode());
 await dps.screenshot({path:'tmp/overlay-dps.png'});await cube.screenshot({path:'tmp/overlay-cube.png'});
 await dps.getByRole('button',{name:'Küçült',exact:true}).click({force:true});
 await dps.waitForFunction(()=>document.getElementById('dps-body').hidden);
 const collapsed=await flags(),collapsedHeight=collapsed.find(w=>w.panel==='dps').bounds.height;
 // Windows at fractional display scaling can round native bounds by a few DIP.
 assert.ok(collapsedHeight>=36&&collapsedHeight<=40,`Unexpected collapsed height: ${collapsedHeight}`);
 assert.equal(await dps.locator('#total-dps').isVisible(),false);
 await dps.screenshot({path:'tmp/overlay-collapsed.png'});
 // Exercise the actual pointer-down IPC and native positioning without moving
 // the system mouse or sending any keys to the game.
 const old=await app.evaluate(()=>globalThis.overlayForTest.windows.get('cube').getBounds());
 const cursor=await app.evaluate(({screen})=>screen.getCursorScreenPoint());
 await cube.locator('#bar').dispatchEvent('pointerdown',{button:0});
 await app.evaluate(async()=>new Promise(r=>setTimeout(r,100)));
 await app.evaluate((_e,point)=>{globalThis.overlayForTest.stepDrag(point,true);globalThis.overlayForTest.stepDrag(point,false);},{x:cursor.x+30,y:cursor.y+25});
 const moved=await app.evaluate(()=>globalThis.overlayForTest.windows.get('cube').getBounds());
 assert.notDeepEqual({x:moved.x,y:moved.y},{x:old.x,y:old.y});
 await cube.locator('#bar').dispatchEvent('pointerdown',{button:0});
 await app.evaluate(async()=>new Promise(r=>setTimeout(r,100)));
 await app.evaluate((_e,point)=>{for(let i=0;i<100;i++)globalThis.overlayForTest.stepDrag(point,true);globalThis.overlayForTest.stepDrag(point,false);},cursor);
 const afterDrag=await app.evaluate(()=>globalThis.overlayForTest.windows.get('cube').getBounds());
 assert.ok(Math.abs(afterDrag.width-320)<=8&&Math.abs(afterDrag.height-148)<=8,JSON.stringify(afterDrag));
 // Audio uses a real AudioContext; a synthetic cube never goes to the backend.
 await cube.evaluate(()=>{window.__sounds=[];const Native=window.AudioContext;window.AudioContext=class extends Native{
  constructor(...args){super(...args);this.silentOutput=super.createGain();this.silentOutput.gain.value=0;this.silentOutput.connect(super.destination);}
  get destination(){return this.silentOutput||super.destination;}
  createOscillator(){const o=super.createOscillator(),start=o.start.bind(o);o.start=(...a)=>{if(o.frequency.value===659.25)window.__sounds.push(Date.now());return start(...a);};return o;}
 };});
 await cube.locator('#sound').click({force:true});
 state.cubes.total=1;state.cubes.active=[{id:'test-cube',sequence:1,status:'present',detectedAt:Date.now()-30000}];
 await cube.waitForFunction(()=>document.getElementById('cube-count').textContent==='1');
 await cube.waitForFunction(()=>window.__sounds.length>=2,{},{timeout:6000});
 const sounds=await cube.evaluate(()=>window.__sounds);assert.ok(sounds[1]-sounds[0]>=3000);
 state.cubes.active=[];await cube.waitForFunction(()=>document.getElementById('cube-count').textContent==='0');
 const count=await cube.evaluate(()=>window.__sounds.length);await cube.waitForTimeout(3300);assert.equal(await cube.evaluate(()=>window.__sounds.length),count);
 await app.evaluate(()=>globalThis.overlayForTest.setInteraction(false));assert.ok((await flags()).every(w=>w.transparent&&w.noActivate));
 await dps.waitForTimeout(300);
 const exitRequested=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Quit-file request did not close the overlay')),5000);app.process().once('exit',()=>{clearTimeout(timer);resolve();});});
 fs.writeFileSync(path.join(profile,'quit.request'),'quit');await exitRequested;app=null;
 ({dps,cube}=await launch());await dps.waitForFunction(()=>document.getElementById('dps-body').hidden);
 const restored=await flags();assert.ok(restored.find(w=>w.panel==='dps').bounds.height>=36&&restored.find(w=>w.panel==='dps').bounds.height<=40);
 const restoredCube=restored.find(w=>w.panel==='cube').bounds;
 assert.deepEqual({x:restoredCube.x,y:restoredCube.y},{x:afterDrag.x,y:afterDrag.y});
 assert.ok(Math.abs(restoredCube.width-320)<=8&&Math.abs(restoredCube.height-148)<=8,JSON.stringify(restoredCube));
 await app.evaluate(()=>globalThis.overlayForTest.setInteraction(true));
 await dps.getByRole('button',{name:'Genişlet',exact:true}).click({force:true});await dps.waitForFunction(()=>!document.getElementById('dps-body').hidden);
 assert.equal((await flags()).find(w=>w.panel==='dps').bounds.height,360);
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({twoWindows:'passed',nativeClickThrough:'passed',altInteraction:'focusable only during interaction',drag:'passed',collapsedHeight,dpsHiddenWhenCollapsed:true,persistedLayout:'passed',skillIcons:'passed',threeSecondAudio:'passed with muted output',removal:'silent',quitRequest:'passed',errors},null,2));
}finally{if(app)await app.close();server.close();}
