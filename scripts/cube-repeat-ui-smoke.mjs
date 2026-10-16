import assert from 'node:assert/strict';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_PATH||path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const base=process.env.AION_UI_TEST_URL||'http://127.0.0.1:4318';
// Reads the served UI; all incoming states are synthetic and no server controls
// are invoked. Audio is observed through a real browser AudioContext.
const browser=await chromium.launch({headless:true,channel:'msedge'}),page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
try{
 const state=await(await page.request.get(base+'/api/state')).json();
 state.mode='live';state.capture.state='capturing';state.capture.error=null;
 state.research={active:false,armed:false,markers:[]};
 // An existing cube with no position must repeat after sound is unlocked.
 state.cubes={epoch:'repeat-test',total:1,active:[{id:'one',sequence:1,status:'present',detectedAt:Date.now()-60000,proximity:null}],recent:[]};
 await page.addInitScript(({initial})=>{
  window.__sounds=[];const Native=window.AudioContext;
  window.AudioContext=class extends Native{createOscillator(){const osc=super.createOscillator(),start=osc.start.bind(osc);osc.start=(...args)=>{if(osc.frequency.value===659.25)window.__sounds.push(Date.now());return start(...args);};return osc;}};
  window.EventSource=class{constructor(){
   window.__state=initial;window.__feed=()=>this.onmessage?.({data:JSON.stringify(window.__state)});window.__disconnect=()=>this.onerror?.();
   window.__tick=setInterval(()=>window.__feed(),250);setTimeout(()=>window.__feed(),0);
  }};
 },{initial:state});
 await page.goto(base);await page.waitForFunction(()=>document.querySelector('#cube-alert-count').textContent==='1');
 assert.equal(await page.evaluate(()=>window.__sounds.length),0,'No autoplay');
 await page.locator('#cube-sound-test').click();
 await page.waitForFunction(()=>window.__sounds.length===3,{},{timeout:9000});
 const starts=await page.evaluate(()=>window.__sounds),intervals=starts.slice(1).map((at,i)=>at-starts[i]);
 assert.ok(intervals.every(ms=>ms>=3000&&ms<4000),`Three-second intervals: ${intervals}`);
 await page.screenshot({path:'tmp/cube-repeat-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'tmp/cube-repeat-mobile.png',fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 const silent=async label=>{
  const count=await page.evaluate(()=>window.__sounds.length);
  await page.waitForTimeout(3300);assert.equal(await page.evaluate(()=>window.__sounds.length),count,label);
 };
 await page.evaluate(()=>{const c=window.__state.cubes.active[0];window.__cube=c;window.__state.cubes.active=[];window.__state.cubes.recent=[{...c,status:'disappeared'}];window.__feed();});
 await silent('Removal must stop reminders');
 assert.match(await page.locator('#cube-detections').textContent(),/Kayboldu/);
 await page.locator('#cube-sound-mute').click();
 await page.evaluate(()=>{window.__state.cubes.active=[window.__cube];window.__feed();});
 await silent('Mute must stop reminders');
 await page.locator('#cube-sound-test').click();
 await page.evaluate(()=>{window.__state.capture.state='stalled';window.__state.capture.error='Test: paket okuma durdu';window.__feed();});
 await silent('Stalled capture must stop reminders');
 await page.evaluate(()=>{window.__state.capture.state='capturing';window.__state.capture.error=null;});
 await page.locator('#cube-sound-test').click();
 await page.evaluate(()=>{window.__feed();clearInterval(window.__tick);});
 await silent('Missing SSE heartbeats must stop reminders before the next repeat');
 await page.evaluate(()=>window.__disconnect());
 await silent('Disconnected UI must remain silent');
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({intervalsMs:intervals,missingPosition:'repeats',removal:'silent',mute:'silent',stalled:'silent',missingHeartbeat:'silent',disconnect:'silent',mobile:'passed',errors},null,2));
}finally{await browser.close();}
