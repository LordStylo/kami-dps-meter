import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const baseUrl=process.env.AION_UI_TEST_URL;
if(!baseUrl||new URL(baseUrl).hostname!=='127.0.0.1'||new URL(baseUrl).port==='4317')throw Error('Set AION_UI_TEST_URL to an isolated loopback test server; live port 4317 is excluded.');
const {chromium}=require(process.env.PLAYWRIGHT_PATH||path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const browser=await chromium.launch({headless:true,channel:'msedge'});
fs.mkdirSync('tmp',{recursive:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()!=='GET')requests.push({method:r.method(),url:r.url()});});
const nav=async view=>{await page.locator(`[data-view="${view}"]`).click();await page.locator('#view-'+view).waitFor({state:'visible'});};
try{
 await page.goto(baseUrl);await page.waitForFunction(()=>document.querySelector('#connection').textContent!=='Bağlanıyor');
 await page.getByRole('button',{name:'Örnek savaş',exact:true}).click();
 await page.waitForFunction(()=>document.querySelectorAll('.player-row').length===4);
 for(const name of ['Alınan hasar','Bufflar','Destek / rDPS','Rotasyon','Boss HP / Stagger']){
  await page.locator('#live-detail-tabs').getByRole('tab',{name,exact:true}).click();
  assert.equal(await page.locator('#live-advanced').isVisible(),true);
 }
 await page.locator('#live-detail-tabs').getByRole('tab',{name:'Özet',exact:true}).click();
 const history=await page.request.get(baseUrl+'/api/history?limit=1').then(r=>r.json());
 assert.ok(history.total>=1,'Seed at least one encounter into the isolated test archive.');
 const saved=await page.request.get(baseUrl+'/api/history/'+history.items[0].id).then(r=>r.json());
 const beforeMode=await page.request.get(baseUrl+'/api/state').then(r=>r.json()).then(s=>s.mode);
 const mutationCount=requests.length;
 await nav('history');await page.locator('#history-list [data-open-fight]').first().waitFor();
 await page.locator('#history-list [data-open-fight]').first().click();await page.locator('#archive-detail').waitFor({state:'visible'});
 for(const name of ['Özet','Hasar','Alınan hasar','İyileştirme','Bufflar','Destek / rDPS','Rotasyon','Boss HP / Stagger']){
  await page.locator('#archive-detail').getByRole('tab',{name,exact:true}).click();
  if(name==='Destek / rDPS'){
   const p=saved.snapshot.players?.[0];if(p)assert.match(await page.locator('#archive-detail .data-table tbody tr').filter({hasText:p.name}).first().textContent(),new RegExp(p.dps.toLocaleString('tr-TR',{maximumFractionDigits:0}).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
   await page.screenshot({path:'tmp/workbench-archive-support.png',fullPage:true});
  }
  if(name==='Boss HP / Stagger')await page.screenshot({path:'tmp/workbench-archive-boss.png',fullPage:true});
 }
 await page.locator('#archive-detail').getByRole('tab',{name:'Özet',exact:true}).click();
 await page.locator('[data-copy-archive]').click();
 await page.waitForFunction(()=>!document.querySelector('#toast').hidden||document.querySelector('#copy-dialog').open);
 if(await page.locator('#copy-dialog').evaluate(el=>el.open))await page.locator('#copy-dialog button').click();
 const exported=await page.request.get(baseUrl+'/api/history/'+history.items[0].id+'/export');assert.equal(exported.status(),200);assert.ok((await exported.json()).snapshot);
 await nav('runs');await page.locator('#runs-list .run-card, #runs-list .data-empty').first().waitFor();
 if(await page.locator('#runs-list [data-open-run]').count()){await page.locator('#runs-list [data-open-run]').first().click();await page.locator('#run-detail').waitFor({state:'visible'});}
 await nav('records');await page.locator('#records-list .data-table-wrap, #records-list .data-empty').first().waitFor();
 await nav('pvp');await page.locator('#pvp-list .data-table-wrap, #pvp-list .data-empty').first().waitFor();
 const afterMode=await page.request.get(baseUrl+'/api/state').then(r=>r.json()).then(s=>s.mode);assert.equal(afterMode,beforeMode,'Archive navigation must not change capture mode.');
 assert.equal(requests.length,mutationCount,'History/run/record browsing must use GET only.');
 await nav('history');await page.locator('#history-list [data-open-fight]').first().waitFor();
 await page.locator('#toast').evaluate(el=>el.hidden=true);await page.screenshot({path:'tmp/workbench-history-desktop.png',fullPage:true});
 await nav('live');await page.locator('#live-detail-tabs').getByRole('tab',{name:'Özet',exact:true}).click();await page.screenshot({path:'tmp/workbench-live-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'tmp/workbench-mobile.png',fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Mobile body should not overflow horizontally.');
 await nav('history');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'History table scroll should stay inside its container.');
 await nav('cube');assert.equal(await page.locator('#cube-panel').isVisible(),true);assert.equal(await page.locator('#cube-sound-test').isVisible(),true);
 await nav('settings');assert.equal(await page.locator('#recordings').isVisible(),true);
 assert.deepEqual(errors,[]);console.log(JSON.stringify({desktop:'passed',mobile:'passed',analyticsTabs:'passed',history:'passed',archiveKeepsCaptureMode:'passed',archiveReadOnly:'passed',export:'passed',chatCopy:'passed',runs:'passed',records:'passed',pvp:'passed',cubeControls:'passed',browserErrors:errors},null,2));
}finally{await browser.close();}
