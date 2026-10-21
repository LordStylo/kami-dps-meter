import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {createRequire} from 'node:module';
import {checkFocusTransitions} from './overlay-focus-regression.mjs';
const require=createRequire(import.meta.url);
const {_electron}=require(process.env.PLAYWRIGHT_PATH||path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const root=path.resolve(process.env.AION_OVERLAY_TEST_ROOT||'.'),profile=path.resolve('tmp','overlay-smoke-'+Date.now());
const runtime=process.env.AION_OVERLAY_TEST_RUNTIME||path.join(root,'runtime/electron/electron.exe'),entry=path.join(root,'overlay/main.cjs');
const panels=['dps','cube','cube-map','pet-map','controls'];
const panelPage=(pages,panel)=>pages.find(page=>new URL(page.url()).searchParams.get('panel')===panel);
const state={app:'aion-dps-lab',mode:'live',capture:{state:'capturing'},scope:'party',cubes:{epoch:'test',total:0,active:[]},current:{id:1,damage:600000,dps:120000,seconds:5,players:[{entity:1,name:'Kamielle',self:true,dps:90000,damage:450000,share:75,skills:[{id:18290000,name:'Spinning Strike',icon:'/icons/skills/ICON_CH_SKILL_029.webp',dps:90000,damage:450000,share:100}]},{entity:2,name:'Nyra',dps:30000,damage:150000,share:25,skills:[]}]}};
let shutdownRequests=0;
const server=http.createServer(async(req,res)=>{
 res.setHeader('Content-Type','application/json');
 if(req.method==='POST'&&req.url==='/api/control'){
  let body='';for await(const chunk of req)body+=chunk;
  assert.deepEqual(JSON.parse(body),{action:'shutdown'});shutdownRequests++;
  res.end(JSON.stringify(state));setTimeout(()=>server.close(),150);return;
 }
 res.end(JSON.stringify(state));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
let app;const errors=[];
async function capture(panel,filename){
 const png=await app.evaluate(async(_e,name)=>{const image=await globalThis.overlayForTest.windows.get(name).webContents.capturePage(undefined,{stayHidden:true,stayAwake:true});if(image.isEmpty())throw Error('Empty overlay capture');return image.toPNG().toString('base64');},panel);
 fs.writeFileSync(filename,Buffer.from(png,'base64'));
}
async function launch(){
 app=await _electron.launch({executablePath:runtime,args:[entry,`--port=${port}`,`--profile=${profile}`,'--test-overlay'],env,timeout:30000});
 await app.firstWindow();
 await app.evaluate((_e,{filename,panels})=>{globalThis.overlayForTest=process.mainModule.require(filename);if(globalThis.overlayForTest.windows.size!==panels.length||panels.some(panel=>!globalThis.overlayForTest.windows.has(panel)))throw Error('Missing native windows');globalThis.overlayForTest.pauseKeys();},{filename:entry,panels});
 console.log('Native overlay windows loaded');
 for(let attempt=0;app.windows().length<panels.length&&attempt<100;attempt++)await new Promise(r=>setTimeout(r,50));
 const pages=app.windows();assert.equal(pages.length,panels.length);
 for(const p of pages){p.on('pageerror',e=>errors.push(e.message));await p.waitForURL(url=>panels.includes(url.searchParams.get('panel')));}
 const dps=panelPage(pages,'dps'),cube=panelPage(pages,'cube'),cubeMap=panelPage(pages,'cube-map'),controls=panelPage(pages,'controls');
 if(!dps||!cube||!cubeMap||!controls)throw Error('All panels must load');
 await dps.waitForFunction(()=>!!window.kamiOverlay);await cube.waitForFunction(()=>!!window.kamiOverlay);
 await cubeMap.waitForFunction(()=>!!window.kamiOverlay);await controls.waitForFunction(()=>!!window.kamiOverlay);
 const host=JSON.parse(fs.readFileSync(path.join(profile,'host.json'),'utf8'));
 assert.ok(['cube-map-overlay','pet-map-overlay'].every(feature=>host.features.includes(feature)));assert.equal(host.version,JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version);
 return {dps,cube,cubeMap,controls};
}
async function flags(){return app.evaluate((_e,koffiPath)=>{
 const k=process.mainModule.require(koffiPath),u=k.load('user32.dll'),get=u.func('intptr __stdcall GetWindowLongPtrW(uintptr hwnd, int index)');
 return [...globalThis.overlayForTest.windows].map(([panel,w])=>{const style=Number(get(w.getNativeWindowHandle().readBigUInt64LE(),-20));return {panel,transparent:!!(style&0x20),noActivate:!!(style&0x8000000),topmost:w.isAlwaysOnTop(),focusable:w.isFocusable(),bounds:w.getBounds()};});
},path.join(root,'node_modules/koffi'));}
try{
 let {dps,cube,cubeMap,controls}=await launch();
 await dps.waitForFunction(()=>document.querySelectorAll('[data-player]').length===2);
 assert.equal(await dps.locator('#total-dps').textContent(),'120 K');
 assert.match(await cube.locator('#cube-status').textContent(),/Kapalı/);
 assert.equal(await cube.locator('#cube-start').textContent(),'Başlat');
 assert.equal(await cube.locator('#sound').textContent(),'Sesi dene');
 const cubeFit=await cube.locator('#cube-body').evaluate(el=>({horizontal:el.scrollWidth>el.clientWidth,vertical:el.scrollHeight>el.clientHeight}));
 assert.deepEqual(cubeFit,{horizontal:false,vertical:false});
 const before=await flags();assert.equal(before.length,panels.length);assert.ok(before.every(w=>w.transparent&&w.noActivate&&w.topmost&&!w.focusable));
 const mapBounds=before.find(w=>w.panel==='cube-map').bounds;
 assert.ok(Math.abs(mapBounds.width-360)<=4&&Math.abs(mapBounds.height-360)<=4,JSON.stringify(mapBounds));
 await app.evaluate(()=>globalThis.overlayForTest.setDesktopEdit(true));
 const after=await flags();assert.ok(after.every(w=>!w.transparent&&w.noActivate&&!w.focusable));
 // Ask the actual HWND how it handles a mouse activation request. This is a
 // window message to our hidden test windows only, not physical mouse input.
 const mouseActivation=await app.evaluate((_e,koffiPath)=>{
  const k=process.mainModule.require(koffiPath),u=k.load('user32.dll');
  const send=u.func('intptr __stdcall SendMessageW(uintptr hwnd, uint32 message, uintptr wParam, intptr lParam)');
  return [...globalThis.overlayForTest.windows].map(([panel,w])=>({panel,result:Number(send(w.getNativeWindowHandle().readBigUInt64LE(),0x21,0,(0x201<<16)|1))}));
 },path.join(root,'node_modules/koffi'));
 assert.ok(mouseActivation.every(w=>w.result===3),JSON.stringify(mouseActivation)); // MA_NOACTIVATE, not MA_NOACTIVATEANDEAT
 await capture('controls','tmp/overlay-launcher.png');
 const controlsOld=await app.evaluate(()=>globalThis.overlayForTest.windows.get('controls').getBounds());
 await controls.locator('#launcher').dispatchEvent('pointerdown',{button:0});
 await app.evaluate(async()=>new Promise(r=>setTimeout(r,100)));
 await app.evaluate(({screen})=>{const cursor=screen.getCursorScreenPoint(),point={x:cursor.x+50,y:cursor.y+30};globalThis.overlayForTest.stepDrag(point,true);globalThis.overlayForTest.stepDrag(point,false);});
 const controlsMoved=await app.evaluate(()=>globalThis.overlayForTest.windows.get('controls').getBounds());
 assert.notDeepEqual({x:controlsMoved.x,y:controlsMoved.y},{x:controlsOld.x,y:controlsOld.y});
 assert.ok(controlsMoved.width>=44&&controlsMoved.width<=48&&controlsMoved.height>=44&&controlsMoved.height<=48);
 await controls.locator('#launcher').dispatchEvent('click');
 assert.equal((await controls.evaluate(()=>window.kamiOverlay.init())).controlsOpen,false);
 await controls.waitForTimeout(350);
 await controls.locator('#launcher').click({force:true});await controls.waitForFunction(()=>!document.getElementById('controls-body').hidden);
 const expandedControls=(await flags()).find(w=>w.panel==='controls').bounds;
 assert.ok(Math.abs(expandedControls.width-224)<=4&&Math.abs(expandedControls.height-292)<=4,JSON.stringify(expandedControls));
 // Combat auto-hide status must not alter user visibility preferences or the
 // persistent non-activating window policy. Windows stay hidden in this test.
 await app.evaluate(()=>globalThis.overlayForTest.setDesktopEdit(false));
 state.combat={active:false};
 await controls.waitForFunction(()=>document.querySelector('#toggle-dps .switch-state').textContent==='Savaş bekliyor');
 assert.equal(await controls.locator('#controls-body').evaluate(el=>el.scrollWidth>el.clientWidth),false);
 assert.equal((await controls.evaluate(()=>window.kamiOverlay.init())).panels.dps,true);
 await app.evaluate(()=>globalThis.overlayForTest.setDesktopEdit(true));
 await controls.locator('#show-dps').click({force:true});
 await controls.waitForFunction(async()=>(await window.kamiOverlay.init()).manualDpsReveal);
 assert.equal((await controls.evaluate(()=>window.kamiOverlay.init())).autoHide,true);
 assert.equal((await dps.evaluate(()=>window.kamiOverlay.init())).collapsed,false);
 assert.equal(await controls.locator('#show-dps').textContent(),'Otomatik gizlemeye dön');
 await controls.locator('#show-dps').click({force:true});await controls.waitForFunction(async()=>!(await window.kamiOverlay.init()).manualDpsReveal);
 await controls.locator('#toggle-dps').click({force:true});await controls.waitForFunction(async()=>!(await window.kamiOverlay.init()).panels.dps);
 await controls.locator('#show-dps').click({force:true});
 await controls.waitForFunction(async()=>{const v=await window.kamiOverlay.init();return v.manualDpsReveal&&v.panels.dps;});
 state.combat={active:true};
 await controls.waitForFunction(async()=>!(await window.kamiOverlay.init()).manualDpsReveal);
 await controls.waitForFunction(()=>document.querySelector('#toggle-dps .switch-state').textContent==='Açık');
 await app.evaluate(()=>globalThis.overlayForTest.setDesktopEdit(true));
 assert.equal(await controls.locator('#controls-body').evaluate(el=>el.scrollHeight>el.clientHeight),false);
 state.current.healing=10000;state.current.hps=2000;state.current.healingSeconds=5;
 state.current.healers=[{entity:1,name:'Kamielle',self:true,healing:4000,hps:800,share:40,skills:[{id:18290000,name:'Test heal',healing:4000,hps:800,share:100}]},{entity:3,name:'Healer',healing:6000,hps:1200,share:60,skills:[]}];
 await dps.locator('#metric-healing').click({force:true});
 await dps.waitForFunction(()=>document.getElementById('fight-label').textContent==='PARTİ HPS'&&document.getElementById('damage').textContent==='10 K iyileştirme');
 assert.equal(await dps.locator('#total-dps').textContent(),'2 K');
 assert.match(await dps.locator('#rows').textContent(),/Healer/);
 await dps.locator('#mode-individual').click({force:true});await dps.waitForFunction(()=>document.getElementById('total-dps').textContent==='800');
 assert.match(await dps.locator('#rows').textContent(),/Test heal/);
 assert.equal(await dps.locator('.skill-damage').textContent(),'4 K');
 await dps.locator('#metric-damage').click({force:true});await dps.locator('#mode-party').click({force:true});
 await dps.waitForFunction(()=>document.getElementById('fight-label').textContent==='PARTİ DPS');
 await capture('controls','tmp/overlay-controls.png');
 await controls.locator('#toggle-dps').click({force:true});await controls.waitForFunction(async()=>!(await window.kamiOverlay.init()).panels.dps);
 await controls.locator('#toggle-dps').click({force:true});await controls.waitForFunction(async()=>(await window.kamiOverlay.init()).panels.dps);
 // A meter renderer cannot toggle other windows, and unknown modes are ignored.
 await dps.evaluate(()=>{window.kamiOverlay.togglePanel('cube');window.kamiOverlay.mode('invalid');});
 assert.equal((await controls.evaluate(()=>window.kamiOverlay.init())).panels.cube,true);
 await dps.locator('#mode-individual').click({force:true});await dps.waitForFunction(()=>document.getElementById('fight-label').textContent==='BENİM DPS');
 assert.equal(await dps.locator('#total-dps').textContent(),'90 K');assert.equal(await dps.locator('#damage').textContent(),'450 K hasar');
 assert.equal(await dps.locator('[data-player]').count(),0);assert.equal(await dps.locator('.skill-damage').textContent(),'450 K');
 assert.equal(await dps.locator('#back').isVisible(),false);await dps.screenshot({path:'tmp/overlay-individual.png'});
 const compactBounds=(await flags()).find(w=>w.panel==='dps').bounds;
 assert.ok(Math.abs(compactBounds.width-232)<=4&&Math.abs(compactBounds.height-210)<=4,JSON.stringify(compactBounds));
 await app.evaluate(()=>globalThis.overlayForTest.windows.get('dps').setPosition(100,100));
 async function cornerResize(dx,dy,releaseAlt=false){
  // Freeze only the test app's cursor reader, never move the system cursor.
  await app.evaluate(({screen})=>{globalThis.realTestCursor=screen.getCursorScreenPoint;screen.getCursorScreenPoint=()=>({x:500,y:400});});
  try{
   await dps.locator('#resize-grip').dispatchEvent('pointerdown',{button:0});
   await app.evaluate(async()=>new Promise(r=>setTimeout(r,60)));
   return await app.evaluate((_e,{dx,dy,releaseAlt})=>{const point={x:500+dx,y:400+dy};for(let i=0;i<100;i++)globalThis.overlayForTest.stepDrag(point,true);if(releaseAlt)globalThis.overlayForTest.setInteraction(false);else globalThis.overlayForTest.stepDrag(point,false);return {bounds:globalThis.overlayForTest.windows.get('dps').getBounds(),saved:globalThis.overlayForTest.getLayout().dps};},{dx,dy,releaseAlt});
  }finally{await app.evaluate(({screen})=>{screen.getCursorScreenPoint=globalThis.realTestCursor;});}
 }
 const enlarged=await cornerResize(140,100);
 assert.equal(enlarged.saved.width,372);assert.equal(enlarged.saved.height,310);
 assert.ok(Math.abs(enlarged.bounds.width-372)<=4&&Math.abs(enlarged.bounds.height-310)<=4,JSON.stringify(enlarged));
 const minimum=await cornerResize(-9999,-9999);
 assert.equal(minimum.saved.width,220);assert.equal(minimum.saved.height,150);
 const originalSkills=state.current.players[0].skills;
 state.current.players[0].skills=Array.from({length:8},(_,i)=>({...originalSkills[0],id:i+1,name:'Spinning Strike '+(i+1)}));
 await dps.waitForFunction(()=>document.querySelectorAll('#rows .row').length===8);
 const fit=await dps.evaluate(()=>{const rows=document.getElementById('rows');return {horizontal:rows.scrollWidth>rows.clientWidth,vertical:rows.scrollHeight>rows.clientHeight,readable:rows.clientHeight>=24,toolbarFits:document.querySelector('.meter-toolbar').scrollWidth<=document.querySelector('.meter-toolbar').clientWidth,grip:document.getElementById('resize-grip').hidden};});
 assert.deepEqual(fit,{horizontal:false,vertical:true,readable:true,toolbarFits:true,grip:false});await capture('dps','tmp/overlay-minimum.png');
 state.current.players[0].skills=originalSkills;await dps.waitForFunction(()=>document.querySelectorAll('#rows .row').length===1);
 const resized=await cornerResize(100,100,true);
 assert.equal(resized.saved.width,320);assert.equal(resized.saved.height,250);
 assert.ok((await flags()).every(w=>w.transparent&&w.noActivate));
 await app.evaluate(()=>globalThis.overlayForTest.setDesktopEdit(true));
 const own=state.current.players[0];state.current.players=state.current.players.slice(1);
 await dps.waitForFunction(()=>document.getElementById('rows').textContent.includes('Kendi karakterinin'));
 assert.equal(await dps.locator('#total-dps').textContent(),'—');assert.doesNotMatch(await dps.locator('#rows').textContent(),/Nyra/);
 state.current.players.unshift(own);await dps.waitForFunction(()=>document.getElementById('total-dps').textContent==='90 K');
 await dps.locator('#mode-party').click({force:true});await dps.waitForFunction(()=>document.querySelectorAll('[data-player]').length===2);
 assert.equal(await dps.locator('#total-dps').textContent(),'120 K');
 await dps.locator('[data-player="1"]').click({force:true});assert.match(await dps.locator('#rows').textContent(),/Spinning Strike/);
 await dps.locator('.icon').evaluate(img=>img.decode());
 await dps.screenshot({path:'tmp/overlay-dps.png'});await cube.screenshot({path:'tmp/overlay-cube.png'});
 const changeTransparency=async value=>{await dps.locator('#transparency').evaluate((input,n)=>{input.value=n;input.dispatchEvent(new Event('input',{bubbles:true}));},value);await dps.waitForFunction(async n=>(await window.kamiOverlay.init()).transparency===n,value);};
 await dps.getByRole('button',{name:'Ayarlar',exact:true}).click({force:true});
 await dps.waitForFunction(()=>!document.getElementById('settings-body').hidden);
 assert.equal(await dps.locator('#dps-body').isVisible(),false);
 assert.equal(await dps.locator('#transparency').inputValue(),'8');
 assert.equal(await dps.locator('#auto-hide').isChecked(),true);
 await dps.locator('#auto-hide').uncheck({force:true});
 await dps.waitForFunction(async()=>!(await window.kamiOverlay.init()).autoHide);
 await changeTransparency(65);
 assert.equal(await app.evaluate(()=>globalThis.overlayForTest.getLayout().dps.transparency),65);
 const appearance=await dps.evaluate(()=>({background:getComputedStyle(document.getElementById('panel')).backgroundColor,textOpacity:getComputedStyle(document.getElementById('title')).opacity,overflow:document.getElementById('settings-body').scrollHeight>document.getElementById('settings-body').clientHeight}));
 assert.equal(appearance.background,'rgba(13, 19, 25, 0.35)');assert.equal(appearance.textOpacity,'1');assert.equal(appearance.overflow,false);
 assert.equal(await cube.locator('#panel').evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(13, 19, 25, 0.92)');
 await dps.screenshot({path:'tmp/overlay-settings.png'});
 await dps.locator('#appearance-reset').click({force:true});await dps.waitForFunction(()=>document.getElementById('transparency').value==='8');
 await changeTransparency(0);assert.equal(await dps.locator('#panel').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(13, 19, 25)');
 await changeTransparency(100);assert.equal(await dps.locator('#panel').evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(13, 19, 25, 0)');
 await changeTransparency(65);
 await dps.getByRole('button',{name:'Ayarları kapat',exact:true}).click({force:true});await dps.waitForFunction(()=>!document.getElementById('dps-body').hidden);
 await dps.locator('#mode-individual').click({force:true});await dps.waitForFunction(()=>document.getElementById('total-dps').textContent==='90 K');
 await dps.getByRole('button',{name:'Küçült',exact:true}).click({force:true});
 await dps.waitForFunction(()=>document.getElementById('dps-body').hidden);
 const collapsed=await flags(),collapsedHeight=collapsed.find(w=>w.panel==='dps').bounds.height;
 // Windows at fractional display scaling can round native bounds by a few DIP.
 assert.ok(collapsedHeight>=36&&collapsedHeight<=40,`Unexpected collapsed height: ${collapsedHeight}`);
 assert.equal(await dps.locator('#total-dps').isVisible(),false);
 assert.equal(await dps.locator('#resize-grip').isVisible(),false);
 assert.equal(await app.evaluate(()=>globalThis.overlayForTest.getLayout().dps.height),250);
 await dps.screenshot({path:'tmp/overlay-collapsed.png'});
 await dps.locator('#settings').click({force:true});await dps.waitForFunction(()=>!document.getElementById('settings-body').hidden);
 assert.equal(await dps.locator('#total-dps').isVisible(),false);
 await dps.locator('#settings-close').click({force:true});await dps.waitForFunction(()=>document.body.classList.contains('collapsed'));
 assert.equal(await dps.locator('#total-dps').isVisible(),false);
 await dps.locator('#settings').click({force:true});await dps.waitForFunction(()=>!document.getElementById('settings-body').hidden);
 await dps.getByRole('button',{name:'Küçült',exact:true}).click({force:true});await dps.waitForFunction(()=>document.body.classList.contains('collapsed'));
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
 assert.ok(Math.abs(afterDrag.width-206)<=4&&Math.abs(afterDrag.height-206)<=4,JSON.stringify(afterDrag));
 // Audio uses a real AudioContext; a synthetic cube never goes to the backend.
 await cube.evaluate(()=>{window.__sounds=[];const Native=window.AudioContext;window.AudioContext=class extends Native{
  constructor(...args){super(...args);this.silentOutput=super.createGain();this.silentOutput.gain.value=0;this.silentOutput.connect(super.destination);}
  get destination(){return this.silentOutput||super.destination;}
  createOscillator(){const o=super.createOscillator(),start=o.start.bind(o);o.start=(...a)=>{if(o.frequency.value===659.25)window.__sounds.push(Date.now());return start(...a);};return o;}
 };});
 await cube.locator('#sound').click({force:true});
 assert.equal((await cube.evaluate(()=>window.kamiOverlay.init())).cubeAlarm.running,false,'Test sound cannot start monitoring');
 await cube.locator('#cube-start').click({force:true});await cube.waitForFunction(async()=>(await window.kamiOverlay.init()).cubeAlarm.running);
 await controls.locator('#toggle-cube').click({force:true});await controls.waitForFunction(async()=>!(await window.kamiOverlay.init()).panels.cube);
 await controls.locator('#toggle-dps').click({force:true});await controls.waitForFunction(async()=>!(await window.kamiOverlay.init()).panels.dps);
 state.cubes.total=1;state.cubes.active=[{id:'test-cube',sequence:1,status:'present',detectedAt:Date.now()-30000}];
 await cube.waitForFunction(()=>document.getElementById('cube-count').textContent==='1');
 await controls.waitForFunction(async()=>(await window.kamiOverlay.init()).panels.cube);
 await cube.locator('#cube-hide').click({force:true});
 await controls.waitForFunction(async()=>!(await window.kamiOverlay.init()).panels.cube);
 await cube.waitForFunction(()=>window.__sounds.length>=2,{},{timeout:6000});
 const sounds=await cube.evaluate(()=>window.__sounds);assert.ok(sounds[1]-sounds[0]>=3000);
 await cube.locator('#mute').click({force:true});await cube.waitForFunction(()=>document.getElementById('mute').getAttribute('aria-pressed')==='true');
 const mutedCount=await cube.evaluate(()=>window.__sounds.length);
 state.cubes.total=2;state.cubes.active=[{id:'cube-muted',sequence:2,status:'present',detectedAt:Date.now()}];
 await cube.waitForFunction(()=>document.getElementById('cube-detail').textContent.includes('#2'));
 await controls.waitForFunction(async()=>(await window.kamiOverlay.init()).panels.cube);
 await cube.waitForTimeout(3300);assert.equal(await cube.evaluate(()=>window.__sounds.length),mutedCount,'Muted detections open the panel without sound');
 await cube.locator('#sound').click({force:true});await cube.waitForFunction(n=>window.__sounds.length>n,mutedCount);
 await cube.locator('#cube-stop').click({force:true});await cube.waitForFunction(async()=>!(await window.kamiOverlay.init()).cubeAlarm.running);
 await cube.locator('#cube-hide').click({force:true});await controls.waitForFunction(async()=>!(await window.kamiOverlay.init()).panels.cube);
 state.cubes.total=3;state.cubes.active=[{id:'cube-stopped',sequence:3,status:'present',detectedAt:Date.now()}];
 await cube.waitForTimeout(800);assert.equal((await controls.evaluate(()=>window.kamiOverlay.init())).panels.cube,false,'Stopped alerts never reopen a hidden window');
 await controls.waitForFunction(async()=>(await window.kamiOverlay.init()).panels['cube-map']);
 assert.equal((await cubeMap.evaluate(()=>window.kamiOverlay.init())).cubeAlarm.running,false,'Map auto-open must not start audio monitoring');
 await cubeMap.locator('#cube-map-hide').click({force:true});
 await controls.waitForFunction(async()=>!(await window.kamiOverlay.init()).panels['cube-map']);
 await cubeMap.waitForTimeout(800);
 assert.equal((await controls.evaluate(()=>window.kamiOverlay.init())).panels['cube-map'],false,'Repeated snapshots of the same cube cannot reopen a manually hidden map');
 state.cubes.active=[];await cube.waitForFunction(()=>document.getElementById('cube-count').textContent==='0');
 const count=await cube.evaluate(()=>window.__sounds.length);await cube.waitForTimeout(3300);assert.equal(await cube.evaluate(()=>window.__sounds.length),count);
 await app.evaluate(()=>globalThis.overlayForTest.setInteraction(false));assert.ok((await flags()).every(w=>w.transparent&&w.noActivate));
 await dps.waitForTimeout(300);
 const exitRequested=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Quit-file request did not close the overlay')),5000);app.process().once('exit',()=>{clearTimeout(timer);resolve();});});
 fs.writeFileSync(path.join(profile,'quit.request'),'quit');await exitRequested;app=null;
 ({dps,cube,cubeMap,controls}=await launch());await dps.waitForFunction(()=>document.getElementById('dps-body').hidden);
 const savedControlState=await controls.evaluate(()=>window.kamiOverlay.init());assert.deepEqual(savedControlState.panels,{dps:false,cube:false,'cube-map':false,'pet-map':false});assert.equal(savedControlState.controlsOpen,false);assert.equal(savedControlState.dpsMode,'individual');
 const restoredControls=await app.evaluate(()=>globalThis.overlayForTest.windows.get('controls').getBounds());assert.equal(restoredControls.x,controlsMoved.x);assert.equal(restoredControls.y,controlsMoved.y);assert.ok(restoredControls.width<=48,JSON.stringify(restoredControls));
 assert.equal(await dps.locator('#transparency').inputValue(),'65');assert.equal(await dps.locator('#settings-body').isVisible(),false);
 assert.equal((await dps.evaluate(()=>window.kamiOverlay.init())).autoHide,false,'Auto-hide preference must survive restart');
 const restored=await flags();assert.ok(restored.find(w=>w.panel==='dps').bounds.height>=36&&restored.find(w=>w.panel==='dps').bounds.height<=40);
 assert.equal(await app.evaluate(()=>globalThis.overlayForTest.getLayout().dps.height),250);
 const restoredCube=restored.find(w=>w.panel==='cube').bounds;
 assert.deepEqual({x:restoredCube.x,y:restoredCube.y},{x:afterDrag.x,y:afterDrag.y});
 assert.ok(Math.abs(restoredCube.width-206)<=4&&Math.abs(restoredCube.height-206)<=4,JSON.stringify(restoredCube));
 await app.evaluate(()=>globalThis.overlayForTest.setDesktopEdit(true));
 await controls.locator('#launcher').click({force:true});await controls.waitForFunction(()=>!document.getElementById('controls-body').hidden);
 await controls.locator('#toggle-dps').click({force:true});await controls.waitForFunction(async()=>(await window.kamiOverlay.init()).panels.dps);
 await controls.locator('#toggle-cube').click({force:true});await controls.waitForFunction(async()=>(await window.kamiOverlay.init()).panels.cube);
 await controls.locator('#controls-close').click({force:true});await controls.waitForFunction(()=>document.getElementById('controls-body').hidden);
 await dps.getByRole('button',{name:'Genişlet',exact:true}).click({force:true});await dps.waitForFunction(()=>!document.getElementById('dps-body').hidden);
 await dps.locator('#settings').click({force:true});await dps.waitForFunction(()=>!document.getElementById('settings-body').hidden);
 await dps.locator('#auto-hide').check({force:true});await dps.waitForFunction(async()=>(await window.kamiOverlay.init()).autoHide);
 await dps.locator('#settings-close').click({force:true});
 const reopened=(await flags()).find(w=>w.panel==='dps').bounds;
 assert.ok(Math.abs(reopened.width-320)<=4&&Math.abs(reopened.height-250)<=4,JSON.stringify(reopened));
 assert.equal(await dps.locator('#total-dps').textContent(),'90 K');assert.equal(await dps.locator('.skill-damage').textContent(),'450 K');
 assert.deepEqual(errors,[]);
 const focusTransitions=await checkFocusTransitions(app,path.join(root,'overlay/windows.cjs'));
 console.log(JSON.stringify({focusTransitions}));
 assert.equal(shutdownRequests,0,'Overlay-only exit must leave the backend running');
 const fullExit=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Full shutdown did not close the overlay')),10000);app.process().once('exit',()=>{clearTimeout(timer);resolve();});});
 await app.evaluate(()=>{const item=globalThis.overlayForTest.getTrayMenu().getMenuItemById('quit-all');if(item.label!=='Tamamen kapat')throw Error('Missing full shutdown menu item');item.click(item);});
 await fullExit;app=null;
 assert.equal(shutdownRequests,1);assert.equal(server.listening,false);
 assert.equal(fs.existsSync(path.join(profile,'host.json')),false);
 assert.equal(JSON.parse(fs.readFileSync(path.join(profile,'layout.json'),'utf8')).dps.mode,'individual');
 console.log(JSON.stringify({fiveWindows:'passed',nativeClickThrough:'passed',altInteraction:'always nonactivating; native mouse activation returns MA_NOACTIVATE',miniMap:'360px bounds, auto-opens with audio stopped, manual hide suppresses same-cube reopening, hidden preference survives restart',drag:'passed including launcher click suppression',cornerResize:'compact default, enlarge/shrink, 100-tick stability, minimum scrolling, Alt-release save, collapse/settings/restart persistence',controls:'292px menu, hide/show both meters, restart persistence, compact recovery',dpsModes:'party totals, self skills and damage, missing-self guard, persistence',collapsedHeight,dpsHiddenWhenCollapsed:true,persistedLayout:'passed',appearanceSettings:'0–100%, reset, restart persistence, collapsed access; text stays opaque',skillIcons:'passed',threeSecondAudio:'passed while cube hidden, with muted output',removal:'silent',quitRequest:'passed',fullShutdown:'tray action stops backend, exits overlay and saves layout',errors},null,2));
}finally{if(app)await app.close();server.close();}
