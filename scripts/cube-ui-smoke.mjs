// Browser contract test with synthetic research state; does not start capture.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_PATH||path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const base=process.env.AION_UI_TEST_URL||'http://127.0.0.1:4318';
const browser=await chromium.launch({headless:true,channel:'msedge'});
const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
try{
  const state=await (await page.request.get(base+'/api/state')).json();
  state.research={active:false,armed:false,messages:0,markers:[]};
  const mark=(phase,label)=>state.research.markers.push({phase,label,at:Date.now()});
  await page.route('**/api/events',route=>route.fulfill({contentType:'text/event-stream',body:'data: '+JSON.stringify(state)+'\n\n'}));
  await page.route('**/api/control',route=>{
    const {action}=route.request().postDataJSON(),r=state.research;
    if(action==='cube-arm'){Object.assign(r,{armed:true,active:false,id:null,bufferMs:60000,bufferMessages:1250,hotkeys:{found:true,opened:true},markers:[]});state.capture.state='capturing';state.mode='live';}
    else if(action==='cube-found'){Object.assign(r,{armed:false,active:true,id:'test-session',messages:1250});mark('near','Cube yanındayım');}
    else if(action==='cube-opened'){Object.assign(r,{armed:false,active:true,id:'test-session',messages:1250,autoStopAt:Date.now()+30000});mark('opened','Açıldı');}
    else if(action==='cube-stop')Object.assign(r,{armed:false,active:false,autoStopAt:null,hotkeys:{found:false,opened:false}});
    else throw Error('Unexpected test action '+action);
    return route.fulfill({contentType:'application/json',body:JSON.stringify(state)});
  });
  await page.goto(base);await page.waitForFunction(()=>!document.querySelector('#recordings').textContent.includes('yükleniyor'));
  await page.locator('#cube-panel>summary').click();
  await page.locator('#cube-arm').click();await page.waitForFunction(()=>document.querySelector('#cube-status').textContent.includes('kısayollar hazır'));
  assert.equal(await page.locator('#demo').isDisabled(),true);
  await page.locator('#cube-found').click();await page.waitForFunction(()=>document.querySelector('#cube-badge').textContent==='KAYDEDİLİYOR');
  assert.match(await page.locator('#cube-markers').textContent(),/Cube yanındayım/);
  await page.locator('#cube-opened').click();await page.waitForFunction(()=>document.querySelector('#cube-status').textContent.includes('otomatik tamamlanacak'));
  await page.waitForFunction(()=>[...document.querySelectorAll('.skill-icon img')].every(i=>i.complete));
  fs.mkdirSync('tmp',{recursive:true});await page.screenshot({path:'tmp/cube-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:'tmp/cube-mobile.png',fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.locator('#cube-stop').click();await page.waitForFunction(()=>document.querySelector('#cube-badge').textContent==='KAYIT BİTTİ');
  assert.equal(await page.locator('#cube-found').isDisabled(),true);
  await page.locator('#cube-arm').click();await page.locator('#cube-opened').click();
  await page.waitForFunction(()=>document.querySelector('#cube-markers').textContent.includes('Açıldı'));
  assert.doesNotMatch(await page.locator('#cube-markers').textContent(),/yanındayım/);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({syntheticUI:'passed',desktop:'passed',mobile:'passed',fastOpen:'passed',browserErrors:errors},null,2));
}finally{await browser.close();}
