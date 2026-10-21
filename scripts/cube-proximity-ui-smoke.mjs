// Synthetic UI feed only: no live capture, settings, application restart or audio.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_PATH||path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const base=process.env.AION_UI_TEST_URL;
if(!base||new URL(base).hostname!=='127.0.0.1'||new URL(base).port==='4317')throw Error('Use an isolated loopback AION_UI_TEST_URL; live port 4317 is excluded.');
const browser=await chromium.launch({headless:true,channel:'msedge'});
const web=await browser.newPage({viewport:{width:1200,height:850}}),native=await browser.newPage({viewport:{width:206,height:206}});
const errors=[],mutations=[];for(const p of [web,native]){p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(r.method()!=='GET')mutations.push(r.url());});}
const noAudio=()=>{window.__audioConstructions=0;window.AudioContext=class{constructor(){window.__audioConstructions++;throw Error('Audio is excluded from proximity UI QA.');}};};
await web.addInitScript(noAudio);await native.addInitScript(noAudio);
await web.addInitScript(()=>{window.EventSource=class{constructor(){window.__source=this;}close(){}};});
await native.addInitScript(()=>{
 window.__envelope=null;
 window.kamiOverlay={init:async()=>window.__envelope,onUpdate:callback=>{window.__overlayUpdate=callback;},collapse(){},dashboard(){},settings(){},controls(){},drag(){},resize(){},togglePanel(){},showDps(){},autoHide(){},mode(){},metric(){},transparency(){},cubeAction(){}};
});
const localFiles=new Map([['/overlay/index.html','overlay/index.html'],['/overlay/renderer.js','overlay/renderer.js'],['/overlay/style.css','overlay/style.css'],['/overlay/combat-view.mjs','overlay/combat-view.mjs'],['/public/cube-alerts.js','public/cube-alerts.js']]);
await native.route(base+'/**',async route=>{const filename=localFiles.get(new URL(route.request().url()).pathname);if(!filename)return route.continue();const ext=path.extname(filename);await route.fulfill({body:fs.readFileSync(filename),contentType:ext==='.html'?'text/html':ext==='.css'?'text/css':'text/javascript'});});
const cube=(sequence,distance,trend='approaching',quality='observed',extra={})=>({id:'qa-'+sequence,sequence,status:'present',detectedAt:Date.now(),proximity:{fresh:true,quality,source:'move',at:Date.now(),ageMs:0,distance,horizontal:true,trend,...extra}});
const state=cubes=>({app:'aion-dps-lab',mode:'live',scope:'party',target:null,capture:{state:'capturing',issues:{}},coverage:{full:29,prefix:4},current:{id:1,damage:0,dps:0,seconds:0,players:[],healers:[],targets:[],chart:[],issues:{}},research:{active:false},cubes:{epoch:'proximity-ui',total:cubes.length,active:cubes,recent:cubes},history:[],archive:{ready:true,errors:[]}});
async function push(cubes,{connected=true,mode='live',capture='capturing'}={}){const s=state(cubes);s.mode=mode;s.capture.state=capture;await web.evaluate(({s,connected})=>{window.__source.onmessage({data:JSON.stringify(s)});if(!connected)window.__source.onerror();},{s,connected});await native.evaluate(({s,connected})=>{window.__envelope={panel:'cube',state:s,connected,interactive:false,cubeAlarm:{running:true,muted:true,alertVersion:0}};window.__overlayUpdate(window.__envelope);},{s,connected});}
async function labels(text,distance){assert.equal(await native.locator('#cube-trend').textContent(),text);const hint=await web.locator('[data-cube-proximity="qa-1"]').textContent();assert.ok(hint.includes(text),hint);if(distance){assert.equal(await native.locator('#cube-distance').textContent(),distance);assert.ok(hint.includes(distance),hint);}else assert.equal(await native.locator('#cube-distance').textContent(),'');}
try{
 await web.goto(base);await web.waitForFunction(()=>typeof window.__source?.onmessage==='function');await web.locator('[data-view="cube"]').click();
 await native.goto(base+'/overlay/index.html?panel=cube');await native.waitForFunction(()=>typeof window.__overlayUpdate==='function');
 await push([cube(1,34)]);await labels('Yaklaşıyorsun','≈ 34 m yatay');assert.equal(await native.locator('#cube-quality').textContent(),'Gözlenen');
 await push([cube(1,39,'receding','estimated')]);await labels('Uzaklaşıyorsun','≈ 39 m yatay');assert.equal(await native.locator('#cube-quality').textContent(),'Tahmini');
 await push([cube(1,39,'steady')]);await labels('Belirgin değişim yok','≈ 39 m yatay');
 await push([cube(1,39,'unknown')]);await labels('Ölçüm bekleniyor','≈ 39 m yatay');
 await push([cube(1,39,'approaching','observed',{fresh:false})]);await labels('Yakınlık bilinmiyor');
 await push([cube(1,39,'approaching','observed',{at:Date.now()-3500})]);await labels('Yakınlık bilinmiyor');
 await push([cube(1,34)],{connected:false});await labels('Yakınlık bilinmiyor');
 await push([cube(1,34)],{capture:'delayed'});await labels('Yakınlık bilinmiyor');
 await push([cube(1,34)],{mode:'replay'});await labels('Yakınlık bilinmiyor');
 await push([]);assert.equal(await native.locator('#cube-trend').textContent(),'Yakınlık bilinmiyor');assert.equal(await web.locator('[data-cube-proximity]').count(),0);
 // Closest distance and incoming array order must not change the overlay target.
 await push([cube(2,1,'receding'),cube(1,50,'approaching')]);await labels('Yaklaşıyorsun','≈ 50 m yatay');assert.match(await native.locator('#cube-detail').textContent(),/#1/);assert.match(await web.locator('[data-cube-proximity="qa-2"]').textContent(),/≈ 1 m yatay.*Uzaklaşıyorsun/);
 const fit=await native.locator('#cube-body').evaluate(el=>({horizontal:el.scrollWidth>el.clientWidth,vertical:el.scrollHeight>el.clientHeight}));assert.deepEqual(fit,{horizontal:false,vertical:false},'Cube UI must fit the existing 206×206 window.');
 fs.mkdirSync('tmp',{recursive:true});await native.screenshot({path:'tmp/cube-proximity-overlay.png'});await web.screenshot({path:'tmp/cube-proximity-web.png',fullPage:true});
 // Measurement expires locally before the API-snapshot deadline.
 await push([cube(1,34,'approaching','observed',{at:Date.now()-2500,ageMs:2500})]);await labels('Yaklaşıyorsun','≈ 34 m yatay');await native.waitForFunction(()=>document.getElementById('cube-trend').textContent==='Yakınlık bilinmiyor',{},{timeout:1800});await web.waitForFunction(()=>document.querySelector('[data-cube-proximity="qa-1"]').textContent==='Yakınlık bilinmiyor',{},{timeout:1800});
 // With no further API/SSE/IPC feed, the visible label clears after 2.5 seconds.
 await push([cube(1,34)]);await labels('Yaklaşıyorsun','≈ 34 m yatay');await native.waitForFunction(()=>document.getElementById('cube-trend').textContent==='Yakınlık bilinmiyor',{},{timeout:4000});await web.waitForFunction(()=>document.querySelector('[data-cube-proximity="qa-1"]').textContent==='Yakınlık bilinmiyor',{},{timeout:4000});
 await push([cube(1,34)]);await web.setViewportSize({width:390,height:844});assert.equal(await web.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await web.screenshot({path:'tmp/cube-proximity-mobile.png',fullPage:true});
 for(const p of [web,native])assert.equal(await p.evaluate(()=>window.__audioConstructions),0);
 assert.deepEqual(errors,[]);assert.deepEqual(mutations,[]);
 console.log(JSON.stringify({approach:'passed',recede:'passed',steady:'passed',collecting:'passed',unknown:'passed',stalePosition:'passed',connectionLoss:'passed',unhealthy:'passed',modeChange:'passed',noCube:'passed',stableFirstCube:'passed',perCubeLabels:'passed',localApiHangExpiry:'passed',localMeasurementExpiry:'passed',compact206:'passed',mobile:'passed',noAudio:'passed',noMutations:'passed',browserErrors:errors},null,2));
}finally{await browser.close();}
