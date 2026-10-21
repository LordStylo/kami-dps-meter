// Isolated synthetic SSE and local image fixtures; no capture/settings/audio writes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {projectWorld} from '../public/cube-map.js';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_PATH||path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const base=process.env.AION_UI_TEST_URL;
if(!base||new URL(base).hostname!=='127.0.0.1'||new URL(base).port==='4317')throw Error('Use an isolated loopback AION_UI_TEST_URL; live port 4317 is excluded.');
const mainMap={id:1010,name:'Verteron',key:'qa-main',image:'/maps/qa-main.webp',width:1024,height:1024,originX:0,originY:0,rows:1,columns:1,cellUnits:102000,tileSize:1024};
const secondMap={...mainMap,id:1110,name:'Altgard',key:'qa-second',image:'/maps/qa-second.webp'};
const failedMap={...mainMap,id:1000,name:'Poeta',key:'qa-failed',image:'/maps/qa-failed.webp'};
const wrongSizeMap={...mainMap,id:1100,name:'Ishalgen',key:'qa-wrong-size',image:'/maps/qa-wrong-size.webp'};
assert.deepEqual(projectWorld(mainMap,{x:0,y:0}),{x:0,y:0});
assert.deepEqual(projectWorld(mainMap,{x:0,y:102000}),{x:0,y:1024});
assert.deepEqual(projectWorld(mainMap,{x:51000,y:51000}),{x:512,y:512});
// Independent Questlog-derived raw-coordinate oracles catch an accidental Y mirror.
const verteron={...mainMap,originX:-408000,originY:-408000,rows:8};
assert.deepEqual(projectWorld(verteron,{x:0,y:-204000}),{x:4096,y:2048});
const ishalgen={...mainMap,originX:-329748,originY:-257999.78,rows:5};
assert.deepEqual(projectWorld(ishalgen,{x:-329748,y:-257999.78}),{x:0,y:0});
assert.deepEqual(projectWorld(ishalgen,{x:-329748,y:252000.22}),{x:0,y:5120});
assert.equal(projectWorld(mainMap,{x:NaN,y:0}),null);assert.equal(projectWorld({...mainMap,cellUnits:0},{x:0,y:0}),null);
const browser=await chromium.launch({headless:true,channel:'msedge'}),page=await browser.newPage({viewport:{width:1280,height:1000}});
const errors=[],mutations=[],external=[],images=[];
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()!=='GET')mutations.push(r.url());if(new URL(r.url()).origin!==new URL(base).origin)external.push(r.url());if(new URL(r.url()).pathname.startsWith('/maps/'))images.push(new URL(r.url()).pathname);});
await page.addInitScript(()=>{window.__audioConstructions=0;window.AudioContext=class{constructor(){window.__audioConstructions++;throw Error('Audio excluded from map QA.');}};window.EventSource=class{constructor(){window.__source=this;}close(){}};});
await page.route(base+'/api/maps',route=>route.fulfill({json:{version:1,maps:[mainMap,secondMap,failedMap,wrongSizeMap],attribution:{game:'NCSOFT',map:'Questlog'}}}));
await page.route(base+'/maps/qa-*.webp',route=>{
  const filename=new URL(route.request().url()).pathname;
  if(filename.includes('failed'))return route.fulfill({status:404,body:'not found'});
  const size=filename.includes('wrong-size')?512:1024;
  return route.fulfill({contentType:'image/svg+xml',body:`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="100%" height="100%" fill="#263b3d"/><path d="M0 512H1024M512 0V1024" stroke="#47645c" stroke-width="2"/><path d="M50 900Q300 20 900 400" fill="none" stroke="#647967" stroke-width="60"/></svg>`});
});
const context=(id='ctx-1',mapId=1010,extra={})=>({id,stream:'qa-stream',mapId,mapState:'confirmed',enteredAt:Date.now()-10000,observedAt:Date.now(),player:{x:51000,y:51000,z:null,at:Date.now(),ageMs:0,fresh:true,quality:'observed',source:'move',generation:1,revision:1},...extra});
const marker=(id='cube-1',contextId='ctx-1',mapId=1010,extra={})=>({id,sequence:1,contextId,mapId,x:76500,y:51000,z:0,detectedAt:Date.now(),status:'present',...extra});
const state=(contexts,markers)=>({app:'aion-dps-lab',mode:'live',scope:'party',target:null,capture:{state:'capturing',issues:{}},coverage:{full:29,prefix:4},current:{id:1,damage:0,dps:0,seconds:0,players:[],healers:[],targets:[],chart:[],issues:{}},research:{active:false},cubes:{epoch:'map-ui',total:0,active:[],recent:[],map:{contexts,markers}},history:[],archive:{ready:true,errors:[]}});
async function push(contexts,markers=[],options={}){const s=state(contexts,markers);s.mode=options.mode||'live';s.capture.state=options.capture||'capturing';await page.evaluate(({s,disconnected})=>{window.__source.onmessage({data:JSON.stringify(s)});if(disconnected)window.__source.onerror();},{s,disconnected:options.disconnected});await page.evaluate(()=>new Promise(requestAnimationFrame));}
const root=page.locator('#cube-map');
async function ready(id='1010'){await page.waitForFunction(id=>{const r=document.getElementById('cube-map');return r.dataset.state==='ready'&&r.dataset.map===id;},id);}
const bitmap=()=>page.locator('[data-map-canvas]').evaluate(c=>c.toDataURL());
const markerSeparation=()=>page.locator('[data-map-canvas]').evaluate(c=>{const {data}=c.getContext('2d').getImageData(0,0,c.width,c.height);let min=Infinity,max=-Infinity;for(let i=0;i<data.length;i+=4)if(data[i]===241&&data[i+1]===186&&data[i+2]===114){const x=(i/4)%c.width;min=Math.min(min,x);max=Math.max(max,x);}return (min+max)/2-c.width/2;});
try{
 await page.goto(base);await page.waitForFunction(()=>typeof window.__source?.onmessage==='function');
 // Hidden map view must not decode a world image in advance.
 await push([context()],[marker()]);assert.equal(images.length,0);
 await page.locator('[data-view="cube"]').click();await ready();assert.equal(await root.getAttribute('data-marker-count'),'1');assert.match(await page.locator('[data-map-position]').textContent(),/Gözlenen konum · güncel/);
 assert.deepEqual(images,['/maps/qa-main.webp']);
 // Quest-compatible map freshness is 60 seconds; near/far proximity remains independent.
 const recent=context();recent.player.at=Date.now()-55000;recent.player.ageMs=55000;recent.player.source='self-buff-range';recent.player.quality='estimated';await push([recent],[marker()]);assert.equal(await page.locator('[data-map-position]').getAttribute('data-fresh'),'true');assert.match(await page.locator('[data-map-position]').textContent(),/Tahmini konum/);
 const recentBitmap=await bitmap();await page.waitForTimeout(300);assert.equal(await bitmap(),recentBitmap,'An older fresh coordinate is held without extrapolation.');
 const expired=context();expired.player.at=Date.now()-60100;expired.player.ageMs=60100;await push([expired],[marker()]);assert.equal(await page.locator('[data-map-position]').getAttribute('data-fresh'),'false');assert.equal(await root.getAttribute('data-player'),'visible');
 const untrusted=context();untrusted.player.fresh=false;await push([untrusted],[marker()]);assert.equal(await page.locator('[data-map-position]').getAttribute('data-fresh'),'false');
 if(process.argv.includes('--freshness-only')){assert.equal(await page.evaluate(()=>window.__audioConstructions),0);assert.deepEqual(errors,[]);assert.deepEqual(mutations,[]);assert.deepEqual(external,[]);console.log(JSON.stringify({mapFresh55Seconds:'passed',mapStale60Seconds:'passed',backendStalenessRespected:'passed',noExtrapolation:'passed',noAudioOrWrites:'passed',browserErrors:errors},null,2));process.exitCode=0;}
 else{
 await push([context()],[marker('nearby','ctx-1',1010,{x:56100})]);const localSeparation=await markerSeparation();assert.ok(localSeparation>40,'A cube 50 m away must be visibly separated from the player in the initial follow view.');
 await page.locator('[data-map-zoom-out]').click();await page.evaluate(()=>new Promise(requestAnimationFrame));const zoomedSeparation=await markerSeparation();assert.ok(zoomedSeparation<localSeparation-5);
 const translated=context();translated.player.x+=10200;translated.player.revision++;await push([translated],[marker('nearby','ctx-1',1010,{x:66300})]);assert.ok(Math.abs(await markerSeparation()-zoomedSeparation)<2,'Manual zoom survives new own-position updates.');
 await page.locator('[data-view="live"]').click();await page.locator('[data-view="cube"]').click();await page.waitForFunction(expected=>{const c=document.querySelector('[data-map-canvas]'),{data}=c.getContext('2d').getImageData(0,0,c.width,c.height);let min=Infinity,max=-Infinity;for(let i=0;i<data.length;i+=4)if(data[i]===241&&data[i+1]===186&&data[i+2]===114){const x=(i/4)%c.width;min=Math.min(min,x);max=Math.max(max,x);}return Math.abs((min+max)/2-c.width/2-expected)<2;},zoomedSeparation,{timeout:1500});
 // Markers from another stream/map, unknown maps, nonfinite or out-of-map coordinates never plot.
 await push([context()],[marker(),marker('wrong-stream','ctx-2'),marker('wrong-map','ctx-1',1110),marker('unknown-map','ctx-1',null),marker('outside','ctx-1',1010,{x:204000}),marker('ended','ctx-1',1010,{status:'ended'})]);assert.equal(await root.getAttribute('data-marker-count'),'1');
 await page.locator('[data-map-reset]').click();assert.equal(await page.locator('[data-map-follow]').getAttribute('aria-pressed'),'false');
 const upper=context();upper.player.y=25500;await push([upper],[marker()]);assert.equal(await page.locator('[data-map-canvas]').evaluate(c=>{const {data}=c.getContext('2d').getImageData(0,0,c.width,c.height);let min=Infinity,max=-Infinity;for(let i=0;i<data.length;i+=4)if(data[i]===155&&data[i+1]===241&&data[i+2]===228){const y=Math.floor(i/4/c.width);min=Math.min(min,y);max=Math.max(max,y);}return (min+max)/2<c.height/2;}),true,'Rendered image Y must follow the independent Quest raw-Y direction.');await push([context()],[marker()]);
 const original=await bitmap();await page.locator('[data-map-own]').uncheck();assert.notEqual(await bitmap(),original);await page.locator('[data-map-own]').check();
 const beforeMove=await bitmap();const moved=context();moved.player.x=61200;moved.player.revision=2;await push([moved],[marker()]);await page.waitForTimeout(50);assert.notEqual(await bitmap(),beforeMove,'Actual packet coordinates move the marker.');
 // The fresh marker does not animate or extrapolate between measurements.
 const fixed=await bitmap();await page.waitForTimeout(350);assert.equal(await bitmap(),fixed,'No coordinate extrapolation.');
 await page.locator('[data-map-follow]').click();assert.equal(await page.locator('[data-map-follow]').getAttribute('aria-pressed'),'true');
 const canvas=page.locator('[data-map-canvas]'),box=await canvas.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+50,box.y+box.height/2+30);await page.mouse.up();assert.equal(await page.locator('[data-map-follow]').getAttribute('aria-pressed'),'false');
 const pan=await bitmap();await page.locator('[data-map-zoom-in]').click();await page.waitForTimeout(50);assert.notEqual(await bitmap(),pan);await page.locator('[data-map-zoom-out]').click();await canvas.focus();await page.keyboard.press('ArrowRight');await page.keyboard.press('Home');
 await push([context('ctx-1',1010,{mapState:'retained'})],[marker()]);assert.equal(await page.locator('[data-map-region-note]').isVisible(),true);
 // Local age invalidates freshness, but retains a visible gray last-known position.
 const old=context();old.player.at=Date.now()-59800;old.player.ageMs=59800;await push([old],[marker()]);await page.waitForFunction(()=>document.querySelector('[data-map-position]').dataset.fresh==='false',{},{timeout:1500});assert.equal(await root.getAttribute('data-player'),'visible');assert.match(await page.locator('[data-map-position]').textContent(),/Son bilinen konum/);
 await push([context()],[marker()],{disconnected:true});await page.waitForFunction(()=>document.querySelector('[data-map-position]').dataset.fresh==='false');assert.match(await page.locator('[data-map-position]').textContent(),/bağlantı kesildi/);
 await push([context()],[marker()],{capture:'delayed'});assert.match(await page.locator('[data-map-position]').textContent(),/canlı veri bekleniyor/);
 await push([context()],[marker()],{mode:'replay'});assert.equal(await page.locator('[data-map-position]').getAttribute('data-fresh'),'false');
 await push([context('ctx-unknown',null)],[marker('unknown','ctx-unknown',null)]);await page.waitForFunction(()=>document.getElementById('cube-map').dataset.map==='');assert.match(await page.locator('[data-map-message]').textContent(),/Bölge henüz bilinmiyor/);assert.equal(await root.getAttribute('data-marker-count'),'0');assert.equal(await root.getAttribute('data-player'),'missing');
 await push([context('ctx-noasset',9999)]);assert.match(await page.locator('[data-map-message]').textContent(),/yerel harita bulunmuyor/);
 await push([context('ctx-failed',1000)]);await page.waitForFunction(()=>document.getElementById('cube-map').dataset.state==='error');assert.equal(await page.locator('[data-map-retry]').isVisible(),true);assert.match(await page.locator('[data-map-message]').textContent(),/açılamadı/);
 await push([context('ctx-wrongsize',1100)]);await page.waitForFunction(()=>document.getElementById('cube-map').dataset.state==='error');assert.equal(await root.getAttribute('data-marker-count'),'0');
 // Context choice remains stable while multiple connections exchange updates; explicit selection switches safely.
 const first=context(),second=context('ctx-2',1110,{enteredAt:Date.now()-20000,observedAt:Date.now()-500});await push([first,second],[marker(),marker('second','ctx-2',1110,{sequence:2})]);await ready();second.observedAt=Date.now()+100;await push([first,second],[marker()]);assert.equal(await root.getAttribute('data-context'),'ctx-1');
 await page.locator('[data-map-context]').selectOption('ctx-2');await ready('1110');assert.equal(await root.getAttribute('data-marker-count'),'0');
 await push([first,second],[marker(),marker('second','ctx-2',1110,{sequence:2})]);assert.equal(await root.getAttribute('data-context'),'ctx-2');assert.equal(await root.getAttribute('data-marker-count'),'1');
 await page.locator('[data-map-context]').selectOption('ctx-1');await ready();await page.locator('[data-map-reset]').click();
 await push([context()],[marker()]);fs.mkdirSync('tmp',{recursive:true});await page.screenshot({path:'tmp/cube-map-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(150);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);const size=await canvas.evaluate(c=>({width:c.width,height:c.height}));assert.ok(size.width<=4096&&size.height<=4096);await page.screenshot({path:'tmp/cube-map-mobile.png',fullPage:true});
 // No further SSE feed: local receive deadline also marks own position stale.
 await push([context()],[marker()]);await page.waitForFunction(()=>document.querySelector('[data-map-position]').dataset.fresh==='false',{},{timeout:4000});
 // Also decode the real packaged 8192×8192 local asset in the browser, independently of fixtures.
 await page.unroute(base+'/api/maps');await page.unroute(base+'/maps/qa-*.webp');await page.setViewportSize({width:1280,height:1000});await page.reload();await page.waitForFunction(()=>typeof window.__source?.onmessage==='function');await page.locator('[data-view="cube"]').click();
 const actual=context();actual.player.x=0;actual.player.y=0;await push([actual],[marker('actual-qa','ctx-1',1010,{x:5100,y:0})]);await ready();assert.ok(await markerSeparation()>40,'Real 8192px map also starts at useful local zoom.');
 await page.screenshot({path:'tmp/cube-map-real-asset-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:'tmp/cube-map-real-asset-mobile.png',fullPage:true});
 assert.equal(await page.evaluate(()=>window.__audioConstructions),0);assert.deepEqual(errors,[]);assert.deepEqual(mutations,[]);assert.deepEqual(external,[]);
 console.log(JSON.stringify({projection:'passed',rawYDirectionPixels:'passed',mapFresh55Seconds:'passed',mapStale60Seconds:'passed',estimatedSourceLabel:'passed',backendStalenessRespected:'passed',lazyLocalImage:'passed',imageDimensions:'passed',realPackagedMap:'passed',nearbyCubeSeparation:'passed',manualZoomRetained:'passed',viewReopen:'passed',wrongContextExcluded:'passed',unknownMapExcluded:'passed',actualMovement:'passed',noExtrapolation:'passed',staleGhost:'passed',connectionAndCaptureState:'passed',retainedRegion:'passed',stableContext:'passed',explicitContextSwitch:'passed',followAndManualPan:'passed',zoomFitKeyboard:'passed',layers:'passed',imageFailure:'passed',responsive:'passed',boundedHiDpi:'passed',noAudio:'passed',noMutations:'passed',noExternalRequests:'passed',browserErrors:errors},null,2));
 }
}finally{await browser.close();}
