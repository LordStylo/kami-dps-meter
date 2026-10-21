// Real hidden native windows + synthetic backend. No physical input/audio/live ports.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {_electron}=require(process.env.PLAYWRIGHT_PATH||path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const root=path.resolve('.'),entry=path.join(root,'overlay/main.cjs'),profile=path.join(root,'tmp','cube-map-overlay-smoke-'+Date.now());
const runtime=process.env.AION_ELECTRON_PATH||path.resolve('../Kami-DPS-Meter/runtime/electron/electron.exe');
let mapContext={id:'mini-1',stream:'mini-test',mapId:1010,mapState:'confirmed',enteredAt:Date.now(),observedAt:Date.now(),player:{x:0,y:0,z:0,at:Date.now(),ageMs:0,fresh:true,quality:'observed',source:'self',generation:1,revision:1}};
let markers=[{id:'mini-cube',sequence:1,contextId:'mini-1',mapId:1010,x:5100,y:0,z:0,status:'present',detectedAt:Date.now()}];
let state={app:'aion-dps-lab',mode:'live',capture:{state:'capturing'},scope:'party',combat:{active:false},cubes:{epoch:'mini-ui',total:0,active:[],map:{contexts:[mapContext],markers}},current:{id:1,damage:0,healing:0,dps:0,seconds:0,players:[],healers:[]}};
const requests=[];
const server=http.createServer((req,res)=>{requests.push({method:req.method,path:req.url});res.setHeader('Content-Type','application/json');res.end(JSON.stringify(state));});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
let app;const errors=[],network=[];
async function centerColor(page){return page.locator('[data-map-canvas]').evaluate(c=>{const p=c.getContext('2d').getImageData(Math.floor(c.width/2),Math.floor(c.height/2),1,1).data;return [...p].slice(0,3);});}
async function waitFresh(page,value){await page.waitForFunction(value=>document.querySelector('#cube-map-body [data-map-position]').dataset.fresh===String(value),value);}
async function waitRevision(page,revision){await page.waitForFunction(revision=>document.querySelector('#cube-map-body').dataset.testRevision===String(revision),revision);}
// The production host polls this isolated fake server; the preload listener verifies forwarding.
async function push(nextContext,nextMarkers=markers){mapContext=nextContext;markers=nextMarkers;state={...state,cubes:{...state.cubes,map:{contexts:[mapContext],markers}}};}
try{
 app=await _electron.launch({executablePath:runtime,args:[entry,`--port=${port}`,`--profile=${profile}`,'--test-overlay'],env,timeout:30000});await app.firstWindow();
 await app.evaluate((_electron,filename)=>{globalThis.overlayForTest=process.mainModule.require(filename);globalThis.overlayForTest.pauseKeys();globalThis.overlayForTest.setDesktopEdit(true);},entry);
 for(let i=0;app.windows().length<5&&i<100;i++)await new Promise(r=>setTimeout(r,30));assert.equal(app.windows().length,5);
 const pages=app.windows();for(const p of pages){p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(/^https?:/.test(r.url()))network.push(r.url());});await p.waitForFunction(()=>!!window.kamiOverlay);await p.evaluate(()=>{window.__audioConstructions=0;window.__mapImageSources=[];window.AudioContext=class{constructor(){window.__audioConstructions++;throw Error('Audio excluded from mini-map QA.');}};const source=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src');Object.defineProperty(HTMLImageElement.prototype,'src',{...source,set(value){window.__mapImageSources.push(new URL(value,document.baseURI).href);source.set.call(this,value);}});});}
 const mini=pages.find(p=>new URL(p.url()).searchParams.get('panel')==='cube-map'),controls=pages.find(p=>new URL(p.url()).searchParams.get('panel')==='controls');assert.ok(mini&&controls);
 // Track forwarded revisions through the existing public preload, without production test hooks.
 await mini.evaluate(()=>window.kamiOverlay.onUpdate(value=>{document.getElementById('cube-map-body').dataset.testRevision=String(value.state?.cubes?.map?.contexts?.[0]?.player?.revision??0);}));
 await mini.waitForFunction(()=>document.querySelector('#cube-map-body').dataset.state==='ready');await waitFresh(mini,true);
 assert.deepEqual(await centerColor(mini),[155,241,228]);assert.equal(await mini.locator('#cube-map-body').getAttribute('data-marker-count'),'1');
 const resources=await mini.evaluate(()=>performance.getEntriesByType('resource').map(r=>r.name));assert.ok(resources.every(url=>url.startsWith('file:')));
 for(const p of pages.filter(p=>p!==mini)){assert.equal(await p.locator('#cube-map-body').getAttribute('data-state'),null);assert.equal(await p.evaluate(()=>performance.getEntriesByType('resource').some(r=>r.name.includes('/maps/'))),false);}
 // Every measured move keeps the own-position dot at the same screen center.
 const moved={...mapContext,player:{...mapContext.player,x:10000,y:20000,at:Date.now(),ageMs:0,revision:2}};
 await push(moved,[{...markers[0],x:15100,y:20000}]);await waitRevision(mini,2);await mini.evaluate(()=>new Promise(requestAnimationFrame));assert.deepEqual(await centerColor(mini),[155,241,228]);
 await mini.locator('[data-map-zoom-in]').dispatchEvent('click');await mini.evaluate(()=>new Promise(requestAnimationFrame));assert.deepEqual(await centerColor(mini),[155,241,228]);await mini.locator('[data-map-zoom-out]').dispatchEvent('click');await mini.evaluate(()=>new Promise(requestAnimationFrame));
 // Pan and arrow keys cannot disable fixed following.
 const bitmap=await mini.locator('[data-map-canvas]').evaluate(c=>c.toDataURL());await mini.locator('[data-map-canvas]').dispatchEvent('pointerdown',{button:0,pointerId:1,clientX:100,clientY:100});await mini.locator('[data-map-canvas]').dispatchEvent('pointermove',{pointerId:1,clientX:150,clientY:130});await mini.locator('[data-map-canvas]').dispatchEvent('pointerup',{pointerId:1});await mini.locator('[data-map-canvas]').dispatchEvent('keydown',{key:'ArrowRight'});await mini.evaluate(()=>new Promise(requestAnimationFrame));assert.equal(await mini.locator('[data-map-follow]').getAttribute('aria-pressed'),'true');assert.equal(await mini.locator('[data-map-canvas]').evaluate(c=>c.toDataURL()),bitmap);
 // Map freshness uses the Quest-compatible 60-second boundary and retains stale coordinates.
 await push({...moved,player:{...moved.player,source:'self-buff-range',quality:'estimated',at:Date.now()-55000,ageMs:55000,revision:3}});await waitRevision(mini,3);await waitFresh(mini,true);assert.match(await mini.locator('[data-map-position]').textContent(),/Tahmini/);
 await push({...moved,player:{...moved.player,at:Date.now()-60100,ageMs:60100,fresh:false,revision:4}});await waitRevision(mini,4);await waitFresh(mini,false);assert.equal(await mini.locator('#cube-map-body').getAttribute('data-player'),'visible');assert.match(await mini.locator('[data-map-position]').textContent(),/Son bilinen konum/);
 // New context: no old/mismatched cube pin can leak onto the next map.
 const next={...moved,id:'mini-2',mapId:1110,enteredAt:Date.now(),observedAt:Date.now(),player:{...moved.player,x:0,y:0,at:Date.now(),fresh:true,ageMs:0,revision:5}};await push(next,[...markers,{...markers[0],id:'wrong-map',contextId:'mini-2',mapId:1010}]);await waitRevision(mini,5);await mini.waitForFunction(()=>{const r=document.querySelector('#cube-map-body');return r.dataset.state==='ready'&&r.dataset.map==='1110';});assert.equal(await mini.locator('#cube-map-body').getAttribute('data-marker-count'),'0');assert.deepEqual(await centerColor(mini),[155,241,228]);
 const imageSources=await mini.evaluate(()=>window.__mapImageSources);assert.ok(imageSources.some(url=>url.startsWith('file:')&&url.endsWith('/public/maps/World_D_A.webp')),'The actual bundled image must load as file://.');assert.ok(imageSources.every(url=>url.startsWith('file:')));for(const p of pages.filter(p=>p!==mini))assert.equal(await p.evaluate(()=>window.__mapImageSources.length),0);
 await push({...next,id:'mini-unknown',mapId:null,player:null},[]);await mini.waitForFunction(()=>document.querySelector('#cube-map-body').dataset.map==='');assert.equal(await mini.locator('#cube-map-body').getAttribute('data-player'),'missing');assert.match(await mini.locator('[data-map-message]').textContent(),/Bölge henüz bilinmiyor/);
 await push(next,[{id:'final',sequence:2,status:'present',contextId:'mini-2',mapId:1110,x:5100,y:0,z:0,detectedAt:Date.now()}]);await mini.waitForFunction(()=>{const r=document.querySelector('#cube-map-body');return r.dataset.state==='ready'&&r.dataset.markerCount==='1';});
 const fit=await mini.locator('#cube-map-body').evaluate(el=>({horizontal:el.scrollWidth>el.clientWidth,vertical:el.scrollHeight>el.clientHeight}));assert.deepEqual(fit,{horizontal:false,vertical:false});
 const native=await app.evaluate(()=>[...globalThis.overlayForTest.windows].map(([panel,w])=>({panel,visible:w.isVisible(),focusable:w.isFocusable(),size:w.getBounds()})));assert.ok(native.every(w=>!w.visible&&!w.focusable));assert.equal(native.find(w=>w.panel==='cube-map').size.width,360);assert.equal(native.find(w=>w.panel==='cube-map').size.height,360);
 // Exercise actual bridge actions from both entry points, while all HWNDs stay hidden.
 await app.evaluate(()=>globalThis.overlayForTest.setDesktopEdit(true));await controls.locator('#launcher').dispatchEvent('click');await controls.waitForFunction(()=>!document.getElementById('controls-body').hidden);await controls.locator('#toggle-cube-map').dispatchEvent('click');await mini.waitForFunction(async()=>{const e=await window.kamiOverlay.init();return e.panels['cube-map']===true;});await mini.locator('#cube-map-hide').dispatchEvent('click');await mini.waitForFunction(async()=>{const e=await window.kamiOverlay.init();return e.panels['cube-map']===false;});
 fs.mkdirSync('tmp',{recursive:true});const png=await app.evaluate(async()=>{const w=globalThis.overlayForTest.windows.get('cube-map');return (await w.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG().toString('base64');});fs.writeFileSync('tmp/cube-map-mini-native.png',Buffer.from(png,'base64'));
 for(const p of pages)assert.equal(await p.evaluate(()=>window.__audioConstructions),0);assert.deepEqual(errors,[]);assert.deepEqual(network,[]);assert.ok(requests.every(r=>r.method==='GET'&&r.path==='/api/state'));
 console.log(JSON.stringify({realHiddenNative:'passed',bundledFileMap:'passed',noRendererNetwork:'passed',mapOnlyInstantiation:'passed',centeredMovement:'passed',centeredZoom:'passed',lockedFollow:'passed',fresh60Seconds:'passed',estimatedLabel:'passed',staleGhost:'passed',contextIsolation:'passed',unknownMap:'passed',compact360:'passed',controlsSwitch:'passed',hideBridge:'passed',noAudioOrCaptureWrites:'passed',noFocus:'passed',browserErrors:errors},null,2));
}finally{if(app)await app.close();await new Promise(resolve=>server.close(resolve));}
