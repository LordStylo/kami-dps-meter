import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_PATH||path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const base=process.env.AION_UI_TEST_URL||'http://127.0.0.1:4318';
const browser=await chromium.launch({headless:true,channel:'msedge'}),page=await browser.newPage({viewport:{width:1440,height:1100}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
  const state=await (await page.request.get(base+'/api/state')).json();
  state.mode='live';state.capture.state='capturing';state.research={active:false,armed:false,markers:[]};
  state.cubes={epoch:'synthetic-ui',total:0,active:[],recent:[]};
  await page.addInitScript(({initial})=>{
    window.__oscillatorStarts=0;window.__audioContexts=[];
    const Native=window.AudioContext;
    window.AudioContext=class extends Native{
      constructor(...args){super(...args);window.__audioContexts.push(this);}
      createOscillator(){const osc=super.createOscillator(),start=osc.start.bind(osc);osc.start=(...args)=>{window.__oscillatorStarts++;return start(...args);};return osc;}
    };
    window.EventSource=class{
      constructor(){window.__cubeFeed=s=>this.onmessage?.({data:JSON.stringify(s)});window.__cubeDisconnect=()=>this.onerror?.();setTimeout(()=>window.__cubeFeed(initial),0);}
    };
  },{initial:state});
  await page.goto(base);await page.waitForFunction(()=>document.querySelector('#cube-alert-count').textContent==='0');
  const add=seq=>({id:'test-'+seq,sequence:seq,detectedAt:Date.now(),status:'present'});
  state.cubes={...state.cubes,total:1,active:[add(1)],recent:[add(1)]};
  await page.evaluate(s=>window.__cubeFeed(s),state);assert.equal(await page.evaluate(()=>window.__oscillatorStarts),0,'No autoplay before click');
  await page.locator('#cube-sound-test').click();await page.waitForFunction(()=>window.__oscillatorStarts===3);
  assert.equal(await page.evaluate(()=>window.__audioContexts[0].state),'running');
  state.cubes={...state.cubes,total:2,active:[add(2)],recent:[add(2)]};
  await page.evaluate(s=>window.__cubeFeed(s),state);await page.waitForFunction(()=>window.__oscillatorStarts===6);
  await page.evaluate(s=>{window.__cubeFeed(s);window.__cubeFeed(s);},state);
  assert.equal(await page.evaluate(()=>window.__oscillatorStarts),6,'Repeated SSE must not repeat sound');
  await page.screenshot({path:'tmp/cube-alert-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:'tmp/cube-alert-mobile.png',fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.locator('#cube-sound-mute').click();state.cubes={...state.cubes,total:3,active:[add(3)],recent:[add(3)]};
  await page.evaluate(s=>window.__cubeFeed(s),state);assert.equal(await page.evaluate(()=>window.__oscillatorStarts),6);
  state.cubes.active=[];state.cubes.recent[0].status='disappeared';await page.evaluate(s=>window.__cubeFeed(s),state);
  assert.equal(await page.locator('#cube-alert-count').textContent(),'0');assert.match(await page.locator('#cube-detections').textContent(),/Kayboldu/);
  state.capture.state='stalled';state.capture.error='Paket okuma yanıt vermiyor. Cube alarmı şu anda güvenilir değil.';
  await page.evaluate(s=>window.__cubeFeed(s),state);
  assert.match(await page.locator('#cube-alert-state').textContent(),/yanıt vermiyor/);
  assert.equal(await page.locator('#cube-alert-count').textContent(),'—');
  assert.equal(await page.locator('#led').evaluate(e=>e.classList.contains('live')),false);
  state.capture.state='delayed';state.capture.error='Paket okuma 95 sn geriden geliyor.';
  await page.evaluate(s=>window.__cubeFeed(s),state);assert.match(await page.locator('#cube-alert-state').textContent(),/95 sn/);
  state.capture.state='capturing';state.capture.error=null;
  await page.evaluate(s=>window.__cubeFeed(s),state);assert.equal(await page.locator('#cube-alert-count').textContent(),'0');
  await page.evaluate(()=>window.__cubeDisconnect());assert.match(await page.locator('#cube-alert-state').textContent(),/kesildi/);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({nativeWebAudio:'running',soundTest:'passed',automaticSound:'passed',deduplication:'passed',mute:'passed',removal:'passed',captureHealth:'passed',disconnect:'passed',mobile:'passed',browserErrors:errors},null,2));
}finally{await browser.close();}
