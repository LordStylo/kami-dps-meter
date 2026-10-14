import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const bundle = process.env.PLAYWRIGHT_PATH || path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const { chromium } = require(bundle);
const baseUrl=process.env.AION_UI_TEST_URL || 'http://127.0.0.1:4317';
const browser = await chromium.launch({headless:true,channel:'msedge'});
const page = await browser.newPage({viewport:{width:1440,height:1150}});
const errors=[]; page.on('pageerror',error=>errors.push(error.message));
const iconErrors=[];page.on('response',r=>{if(r.url().includes('/icons/skills/')&&!r.ok())iconErrors.push(r.status());});
try {
  await page.goto(baseUrl);
  await page.waitForFunction(()=>document.querySelector('#connection').textContent!=='Bağlanıyor');
  await page.getByRole('button',{name:'Örnek savaş',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.player-row').length===4);
  assert.equal(await page.locator('.skill-head [role="columnheader"]').allTextContents().then(x=>x.join(',')),'YETENEK,DPS,PAY,HASAR,KRİTİK');
  assert.ok(await page.locator('.skill-dps').count());
  assert.match(await page.locator('#notice').textContent(),/sentetik/);
  await page.locator('.player-row').nth(1).click();
  assert.match(await page.locator('#detail-name').textContent(),/Nyra/);
  await page.getByRole('button',{name:'Yalnızca ben',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.player-row').length===1);
  await page.getByRole('button',{name:'Partim',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.player-row').length===4);
  fs.mkdirSync('tmp',{recursive:true});
  await page.screenshot({path:'tmp/ui-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'tmp/ui-mobile.png',fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Mobile horizontal overflow');
  await page.setViewportSize({width:1440,height:1150});
  const value=await page.locator('#recordings').inputValue();
  if(value){
    await page.getByRole('button',{name:/Kaydı aç/}).click();
    await page.waitForFunction(()=>document.querySelector('#notice').textContent.startsWith('YEREL KAYIT'));
    assert.match(await page.locator('#comparison').textContent(),/eşleşti/);
    const self=page.locator('.player-row').filter({has:page.locator('.identity em')});
    if(await self.count())await self.first().click();
    await page.waitForFunction(()=>[...document.querySelectorAll('.skill-icon img')].every(i=>i.complete&&i.naturalWidth>0));
    await page.screenshot({path:'tmp/ui-recording.png',fullPage:true});
  }
  const response=await page.request.get(`${baseUrl}/api/export`);assert.equal(response.status(),200);
  assert.equal((await response.json()).format,'aion-dps-lab/1');
  if(await page.locator('.skill-icon img').count()) {
    await page.waitForFunction(()=>[...document.querySelectorAll('.skill-icon img')].every(i=>i.complete&&i.naturalWidth>0));
  }
  assert.deepEqual(errors,[]);
  assert.deepEqual(iconErrors,[]);
  console.log(JSON.stringify({desktop:'passed',mobile:'passed',filters:'passed',skillSelection:'passed',recording:value?'passed':'not available',export:'passed',browserErrors:errors},null,2));
}finally{await browser.close();}
