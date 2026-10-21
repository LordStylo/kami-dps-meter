// Hidden native windows and an isolated synthetic backend only. No real input,
// game messages, audio, live capture controls or production profile writes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {petForId} from '../src/pet-catalog.mjs';
const require=createRequire(import.meta.url);
const {_electron}=require(process.env.PLAYWRIGHT_PATH||path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const root=path.resolve('.'),entry=path.join(root,'overlay/main.cjs'),profile=path.join(root,'tmp','pet-map-overlay-smoke-'+Date.now());
const runtime=process.env.AION_OVERLAY_TEST_RUNTIME||process.env.AION_ELECTRON_PATH||path.resolve('../Kami-DPS-Meter/runtime/electron/electron.exe');
const panels=['dps','cube','cube-map','pet-map','controls'],petA=petForId(1016),petB=petForId(1004);
assert.ok(petA&&petB);
const npcA=petA.monsters.find(n=>!petB.monsters.some(b=>b.id===n.id)).id,npcB=petB.monsters.find(n=>!petA.monsters.some(a=>a.id===n.id)).id;
const context=(revision=1,mapId=1110,extra={})=>({id:'pet-context-'+mapId,stream:'pet-stream',mapId,mapState:'confirmed',enteredAt:Date.now(),observedAt:Date.now(),player:{x:0,y:0,z:0,at:Date.now(),ageMs:0,fresh:true,quality:'observed',source:'move',generation:1,revision},...extra});
const marker=(id,npcId,mapId=1110,extra={})=>({id,entity:id,npcId,stream:'pet-stream',contextId:'pet-context-'+mapId,mapId,x:5100,y:0,z:null,at:Date.now(),status:'present',...extra});
let mapContext=context(),markers=[];
let state={app:'aion-dps-lab',mode:'live',capture:{state:'capturing'},scope:'party',combat:{active:false},cubes:{epoch:'pet-ui',total:0,active:[],recent:[],map:{contexts:[],markers:[]}},pets:{collection:{status:'live',complete:false,levels:{1016:2,1004:1},souls:{1016:74,1004:14},revision:1},map:{contexts:[mapContext],markers}},current:{id:1,damage:0,healing:0,dps:0,seconds:0,players:[],healers:[]}};
const requests=[],errors=[],network=[];
const server=http.createServer((req,res)=>{requests.push({method:req.method,path:req.url});res.setHeader('Content-Type','application/json');res.end(JSON.stringify(state));});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
let app,mini;
const body=()=>mini.locator('#pet-map-body');
async function waitRevision(revision){await mini.waitForFunction(value=>document.querySelector('#pet-map-body').dataset.testRevision===String(value),revision);}
async function ready(petId,mapId){await mini.waitForFunction(({petId,mapId})=>{const b=document.querySelector('#pet-map-body');return b.dataset.pet===String(petId)&&b.dataset.map===String(mapId)&&b.dataset.state==='ready';},{petId,mapId});}
async function fresh(value){await mini.waitForFunction(value=>document.querySelector('[data-pet-map-position]').dataset.fresh===String(value),value);}
async function color(){return mini.locator('[data-pet-map-canvas]').evaluate(canvas=>[...canvas.getContext('2d').getImageData(Math.floor(canvas.width/2),Math.floor(canvas.height/2),1,1).data].slice(0,3));}
async function bitmap(){return mini.locator('[data-pet-map-canvas]').evaluate(canvas=>canvas.toDataURL());}
function push(next,items=[]){mapContext=next;markers=items;state={...state,pets:{...state.pets,map:{contexts:[next],markers:items}}};}
function progress(levels={},souls={}){const previous=state.pets.collection;state={...state,pets:{...state.pets,collection:{...previous,levels:{...previous.levels,...levels},souls:{...previous.souls,...souls},revision:previous.revision+1}}};}
async function header(expectedState,text){await mini.waitForFunction(({expectedState,text})=>{const chip=document.getElementById('pet-map-progress');return chip.dataset.state===expectedState&&chip.textContent.includes(text);},{expectedState,text});}
async function headerFits(){
 const metrics=await mini.evaluate(()=>{const rect=id=>{const element=document.getElementById(id),r=element.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height,hidden:element.hidden};};return {bar:rect('bar'),title:rect('title'),progress:rect('pet-map-progress'),alt:rect('interaction'),hide:rect('pet-map-hide'),inHeader:document.getElementById('pet-map-progress').closest('#bar')!==null};});
 assert.equal(metrics.inHeader,true,'Progress must sit next to the title in the header');
 for(const key of ['title','progress','alt','hide']){const r=metrics[key];assert.equal(r.hidden,false,key);assert.ok(r.width>0&&r.height>0&&r.x>=metrics.bar.x&&r.right<=metrics.bar.right+1&&r.y>=metrics.bar.y&&r.bottom<=metrics.bar.bottom+1,JSON.stringify(metrics));}
 assert.ok(metrics.title.right<=metrics.progress.x+1&&metrics.progress.right<=metrics.alt.x+1&&metrics.alt.right<=metrics.hide.x+1,JSON.stringify(metrics));
}
async function show(petId,mapId){await app.evaluate((_electron,{petId,mapId})=>{globalThis.overlayForTest.showPetMap(petId,mapId);},{petId,mapId});}
async function openRequest(petId,mapId){
 const requestId=randomUUID(),request=path.join(profile,'pet-map.request'),response=path.join(profile,'pet-map.response');
 fs.writeFileSync(request,JSON.stringify({petId,mapId,requestId,at:Date.now()}));
 for(let i=0;i<100;i++){if(fs.existsSync(response)){const ack=JSON.parse(fs.readFileSync(response,'utf8'));if(ack.requestId===requestId){assert.equal(ack.ok,true,JSON.stringify(ack));assert.equal(ack.petId,petId);assert.equal(fs.existsSync(request),false);return;}}await new Promise(resolve=>setTimeout(resolve,30));}
 throw Error('The isolated pet-map request was not acknowledged');
}
async function nativeFlags(){return app.evaluate((_electron,koffiPath)=>{
 const k=process.mainModule.require(koffiPath),u=k.load('user32.dll'),get=u.func('intptr __stdcall GetWindowLongPtrW(uintptr hwnd, int index)'),send=u.func('intptr __stdcall SendMessageW(uintptr hwnd, uint32 message, uintptr wParam, intptr lParam)');
 return [...globalThis.overlayForTest.windows].map(([panel,w])=>{const handle=w.getNativeWindowHandle().readBigUInt64LE(),style=Number(get(handle,-20));return {panel,id:w.id,visible:w.isVisible(),focusable:w.isFocusable(),noActivate:!!(style&0x8000000),transparent:!!(style&0x20),topmost:w.isAlwaysOnTop(),mouseActivation:Number(send(handle,0x21,0,(0x201<<16)|1)),bounds:w.getBounds()};});
 },path.join(root,'node_modules/koffi'));}
try{
 app=await _electron.launch({executablePath:runtime,args:[entry,`--port=${server.address().port}`,`--profile=${profile}`,'--test-overlay'],env,timeout:30000});await app.firstWindow();
 await app.evaluate((_electron,filename)=>{globalThis.overlayForTest=process.mainModule.require(filename);globalThis.overlayForTest.pauseKeys();globalThis.overlayForTest.setDesktopEdit(false);globalThis.overlayForTest.setInteraction(false);},entry);
 for(let i=0;app.windows().length<panels.length&&i<100;i++)await new Promise(resolve=>setTimeout(resolve,30));assert.equal(app.windows().length,panels.length);
 const pages=app.windows();for(const p of pages){p.on('pageerror',e=>errors.push(e.message));p.on('request',request=>{if(/^https?:/.test(request.url()))network.push(request.url());});await p.waitForFunction(()=>!!window.kamiOverlay);await p.evaluate(()=>{window.__audio=0;window.__petImages=[];window.AudioContext=class{constructor(){window.__audio++;throw Error('Audio excluded from pet-map QA');}};const source=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src');Object.defineProperty(HTMLImageElement.prototype,'src',{...source,set(value){window.__petImages.push(new URL(value,document.baseURI).href);source.set.call(this,value);}});});}
 assert.deepEqual(pages.map(p=>new URL(p.url()).searchParams.get('panel')).sort(),[...panels].sort());
 mini=pages.find(p=>new URL(p.url()).searchParams.get('panel')==='pet-map');assert.ok(mini);
 await mini.evaluate(()=>window.kamiOverlay.onUpdate(value=>{document.getElementById('pet-map-body').dataset.testRevision=String(value.state?.pets?.map?.contexts?.[0]?.player?.revision??0);}));
 assert.equal((await mini.evaluate(()=>window.kamiOverlay.init())).panels['pet-map'],false);
 const initial=await nativeFlags();assert.equal(initial.length,5);assert.ok(initial.every(w=>!w.visible&&!w.focusable&&w.noActivate&&w.topmost&&w.transparent&&w.mouseActivation===3));
 const petWindow=initial.find(w=>w.panel==='pet-map');assert.ok(Math.abs(petWindow.bounds.width-420)<=4&&Math.abs(petWindow.bounds.height-420)<=4);assert.equal(await mini.evaluate(()=>window.__petImages.length),0,'A hidden unselected pet map must not load maps');
 const host=JSON.parse(fs.readFileSync(path.join(profile,'host.json'),'utf8'));assert.ok(host.features.includes('pet-map-overlay'));
 await app.evaluate(()=>globalThis.overlayForTest.setDesktopEdit(true));assert.ok((await nativeFlags()).every(w=>!w.transparent&&w.noActivate&&!w.focusable&&w.mouseActivation===3));
 push(context(2),[marker('selected-a',npcA),marker('other-pet',npcB),marker('old-context',npcA,1110,{contextId:'old-context'}),marker('other-stream',npcA,1110,{stream:'other-stream'}),marker('other-map',npcA,22),marker('dead',npcA,1110,{status:'ended'})]);
 await show(petA.id,1110);await ready(petA.id,1110);await header('progress','74/75 ruh · 1 kaldı');await headerFits();await waitRevision(2);await fresh(true);assert.deepEqual(await color(),[155,241,228]);assert.ok(Number(await body().getAttribute('data-static'))>0);assert.equal(await body().getAttribute('data-live'),'1');assert.equal(await body().getAttribute('data-own'),'visible');
 assert.equal(app.windows().length,5);assert.equal((await nativeFlags()).find(w=>w.panel==='pet-map').id,petWindow.id);
 const moved=context(3);moved.player.x=10000;moved.player.y=20000;push(moved,[marker('selected-a',npcA,1110,{x:15100,y:20000})]);await waitRevision(3);await fresh(true);assert.deepEqual(await color(),[155,241,228]);
 await mini.locator('[data-pet-map-zoom-in]').dispatchEvent('click');await mini.evaluate(()=>new Promise(requestAnimationFrame));assert.deepEqual(await color(),[155,241,228]);await mini.locator('[data-pet-map-zoom-out]').dispatchEvent('click');await mini.evaluate(()=>new Promise(requestAnimationFrame));
 const fixed=await bitmap();for(const [type,event]of [['pointerdown',{button:0,pointerId:1,clientX:100,clientY:100}],['pointermove',{pointerId:1,clientX:150,clientY:130}],['pointerup',{pointerId:1}],['keydown',{key:'ArrowRight'}]])await mini.locator('[data-pet-map-canvas]').dispatchEvent(type,event);await mini.waitForTimeout(600);assert.equal(await bitmap(),fixed,'Pan, arrow keys and repeated snapshots cannot invent movement or unlock follow');await mini.locator('[data-pet-map-canvas]').dispatchEvent('wheel',{deltaY:100,clientX:120,clientY:120});await mini.evaluate(()=>new Promise(requestAnimationFrame));assert.deepEqual(await color(),[155,241,228],'Wheel zoom must keep the measured own position centered');
 // Header-only soul changes must not reseed the selected map or reset zoom.
 const headerBitmap=await bitmap();progress({}, {1016:73});await header('progress','73/75 ruh · 2 kaldı');assert.equal(await bitmap(),headerBitmap);assert.deepEqual(await color(),[155,241,228]);progress({}, {1016:75});await header('progress','75/75 ruh · 0 kaldı');assert.equal(await bitmap(),headerBitmap);assert.equal((await mini.evaluate(()=>window.kamiOverlay.init())).petOverlay.pet.id,1016);
 const estimated=context(4);estimated.player={...moved.player,revision:4,quality:'estimated',source:'self-buff-range',at:Date.now()-55000,ageMs:55000};push(estimated);await waitRevision(4);await fresh(true);assert.match(await mini.locator('[data-pet-map-position]').textContent(),/Tahmini/);assert.deepEqual(await color(),[155,241,228]);
 const stale=context(5);stale.player={...moved.player,revision:5,at:Date.now()-60100,ageMs:60100,fresh:false};push(stale);await waitRevision(5);await fresh(false);assert.equal(await body().getAttribute('data-own'),'visible');assert.match(await mini.locator('[data-pet-map-position]').textContent(),/Son bilinen/);assert.deepEqual(await color(),[138,153,165]);const staleBitmap=await bitmap();await mini.waitForTimeout(600);assert.equal(await bitmap(),staleBitmap);
 // Map choice follows the actual own region, and no old-context NPC moves with it.
 push(context(6,22),[marker('middle',npcA,22),marker('old-altgard',npcA),marker('wrong-middle-context',npcA,22,{contextId:'old-context'})]);await waitRevision(6);await ready(petA.id,22);await fresh(true);assert.equal(await body().getAttribute('data-live'),'1');assert.ok(Number(await body().getAttribute('data-static'))>0);assert.deepEqual(await color(),[155,241,228]);
 const images=await mini.evaluate(()=>window.__petImages);assert.ok(images.some(url=>url.endsWith('/public/maps/World_D_A.webp')));for(const suffix of ['00_00','01_00','00_01','01_01'])assert.ok(images.some(url=>url.endsWith('/public/pet-maps/Abyss_Reshanta_C_'+suffix+'.webp')));assert.ok(images.every(url=>url.startsWith('file:')));
 // A second pet replaces the content of the same permanent native window.
 push(context(7),[marker('old-pet',npcA),marker('selected-b',npcB)]);await show(petB.id,1110);await ready(petB.id,1110);await header('progress','14/25 ruh · 11 kaldı');await waitRevision(7);assert.equal(await body().getAttribute('data-live'),'1');assert.ok(Number(await body().getAttribute('data-static'))>0);assert.equal((await nativeFlags()).find(w=>w.panel==='pet-map').id,petWindow.id);assert.equal(app.windows().length,5);
 const bBitmap=await bitmap();progress({}, {1004:24});await header('progress','24/25 ruh · 1 kaldı');assert.equal(await bitmap(),bBitmap,'Soul updates must preserve the second pet map view');
 const missing=context(8,1011);push(missing,[marker('old-pet',npcB)]);await waitRevision(8);await mini.waitForFunction(()=>document.querySelector('#pet-map-body').dataset.own==='missing');assert.equal(await body().getAttribute('data-live'),'0','NPCs must not leak from a previous own-region context');
 await mini.locator('#pet-map-hide').dispatchEvent('click');await mini.waitForFunction(async()=>!(await window.kamiOverlay.init()).panels['pet-map']);push(context(9),[marker('selected-b',npcB)]);await waitRevision(9);await mini.waitForTimeout(600);const hiddenBitmap=await bitmap();progress({}, {1004:25});await header('progress','25/25 ruh · 0 kaldı');assert.equal(await bitmap(),hiddenBitmap,'A hidden map must preserve center and zoom when only its header changes');assert.equal((await mini.evaluate(()=>window.kamiOverlay.init())).panels['pet-map'],false,'SSE cannot undo an explicit hide');
 await openRequest(petA.id,1110);await ready(petA.id,1110);await mini.waitForFunction(async()=>(await window.kamiOverlay.init()).panels['pet-map']);await openRequest(petB.id,1110);await ready(petB.id,1110);assert.equal((await nativeFlags()).find(w=>w.panel==='pet-map').id,petWindow.id);assert.equal(app.windows().length,5);
 progress({1004:1}, {1004:14});await header('progress','14/25 ruh · 11 kaldı');
 const fit=await body().evaluate(el=>({horizontal:el.scrollWidth>el.clientWidth,vertical:el.scrollHeight>el.clientHeight}));assert.deepEqual(fit,{horizontal:false,vertical:false});
 for(const p of pages.filter(p=>p!==mini)){assert.equal(await p.evaluate(()=>window.__petImages.length),0,'Only the pet-map renderer instantiates pet map assets');assert.equal(await p.locator('#pet-map-progress').isHidden(),true,'Other panels cannot display a selected-pet progress chip');}
 await app.evaluate(()=>globalThis.overlayForTest.setInteraction(false));const finalFlags=await nativeFlags();assert.ok(finalFlags.every(w=>!w.visible&&!w.focusable&&w.noActivate&&w.transparent&&w.mouseActivation===3));
 for(const p of pages)assert.equal(await p.evaluate(()=>window.__audio),0);assert.deepEqual(errors,[]);assert.deepEqual(network,[]);assert.ok(requests.every(r=>r.method==='GET'&&r.path==='/api/state'));
 fs.mkdirSync('tmp',{recursive:true});await mini.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await mini.waitForTimeout(150);const png=await app.evaluate(async()=>{const w=globalThis.overlayForTest.windows.get('pet-map');return (await w.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG().toString('base64');});fs.writeFileSync('tmp/pet-map-overlay-native.png',Buffer.from(png,'base64'));
 // Stress the fixed 420px header with a real long name and the largest valid balance.
 await app.evaluate(()=>{globalThis.overlayForTest.setDesktopEdit(false);globalThis.overlayForTest.setInteraction(false);});progress({1030:1},{1030:14});await show(1030,22);await ready(1030,22);await header('progress','14/25 ruh · 11 kaldı');await headerFits();assert.match(await mini.locator('#title').getAttribute('title'),/Nagarant Guardian Warrior/);assert.equal(await mini.locator('#interaction').textContent(),'ALT');assert.equal(await mini.locator('#pet-map-hide').textContent(),'Gizle');
 const headerPng=async filename=>{await mini.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await mini.waitForTimeout(150);const encoded=await app.evaluate(async()=>{const w=globalThis.overlayForTest.windows.get('pet-map');return (await w.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG().toString('base64');});fs.writeFileSync(filename,Buffer.from(encoded,'base64'));};await headerPng('tmp/pet-map-header-long-name.png');progress({}, {1030:2147483647});await header('progress','0 kaldı');await headerFits();assert.match(await mini.locator('#pet-map-progress').getAttribute('title'),/2[.,]147[.,]483[.,]647|2147483647/);await headerPng('tmp/pet-map-header-large-count.png');
 console.log(JSON.stringify({headerNextLevelAndSelectedPet:'passed',headerSsePreservesCenterAndZoom:'passed',headerSsePreservesHiddenPreference:'passed',headerOnlyOnPetPanel:'passed',headerLongNameAndLargeCount420:'passed',fiveHiddenWindows:'passed',defaultHidden420:'passed',singleWindowReuse:'passed',bundledStaticSpawns:'passed',liveNpcAndContextIsolation:'passed',ownCenterMovementAndZoom:'passed',lockedFollowNoExtrapolation:'passed',estimated55Seconds:'passed',stale60SecondsGhost:'passed',altgardAndMiddleFourTiles:'passed',ownRegionTransition:'passed',hideSurvivesSSE:'passed',explicitRequestReshows:'passed',requestAckAndReuse:'passed',allFiveNoActivateAndAltClickthrough:'passed',noRendererNetwork:'passed',noAudioOrCaptureWrites:'passed',browserErrors:errors},null,2));
}finally{if(app)await app.close();await new Promise(resolve=>server.close(resolve));}
