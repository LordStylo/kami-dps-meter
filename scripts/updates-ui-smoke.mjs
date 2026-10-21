// Headless isolated UI QA. All update replies/install actions are synthetic.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_PATH||path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
let update={currentVersion:'0.7.0',status:'unavailable',latestVersion:null,checkedAt:Date.now(),downloadBytes:0,downloadTotal:null,error:null,canInstall:false};
let checks=0,installs=0,reads=0,installMode='blocked',finishInstall;
const writes=[],external=[],errors=[],publicRoot=path.resolve('public');
const server=http.createServer(async(req,res)=>{
 const pathname=new URL(req.url,'http://127.0.0.1').pathname;
 if(pathname==='/api/updates'){reads++;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(update));return;}
 if(req.method==='POST'){
  writes.push(pathname);let body='';for await(const chunk of req)body+=chunk;assert.deepEqual(JSON.parse(body),{});res.setHeader('Content-Type','application/json');
  if(pathname==='/api/updates/check'){checks++;await new Promise(resolve=>setTimeout(resolve,80));update={...update,status:'available',latestVersion:'0.8.0',error:null,canInstall:true};res.end(JSON.stringify(update));return;}
  assert.equal(pathname,'/api/updates/install');installs++;
  if(installMode==='blocked'){res.writeHead(409);res.end(JSON.stringify({error:'Savaş bitince güncellemeyi yeniden dene.'}));return;}
  update={...update,status:'downloading',canInstall:false,downloadBytes:0,downloadTotal:10000000};await new Promise(resolve=>{finishInstall=resolve;});update={...update,status:'installing',downloadBytes:10000000};res.end(JSON.stringify(update));return;
 }
 if(pathname.startsWith('/api/')){res.setHeader('Content-Type','application/json');res.end('[]');return;}
 const filename=path.resolve(publicRoot,'.'+(pathname==='/'?'/index.html':pathname));if(!filename.startsWith(publicRoot+path.sep)){res.writeHead(403).end();return;}
 try{const bytes=fs.readFileSync(filename);res.setHeader('Content-Type',filename.endsWith('.js')||filename.endsWith('.mjs')?'text/javascript':filename.endsWith('.css')?'text/css':'text/html');res.end(bytes);}catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,channel:'msedge'}),page=await browser.newPage({viewport:{width:1366,height:900}});
page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(new URL(request.url()).origin!==base)external.push(request.url());});
await page.addInitScript(()=>{window.__audio=0;window.AudioContext=class{constructor(){window.__audio++;throw Error('Audio excluded');}};window.EventSource=class{close(){}};});
const root=page.locator('[data-app-updates]');
async function status(value){await page.waitForFunction(value=>document.querySelector('[data-app-updates]').dataset.state===value,value);}
try{
 await page.goto(base+'/#live');await page.waitForTimeout(100);assert.equal(reads,0,'Update status is lazy outside settings');assert.deepEqual(writes,[]);
 await page.locator('[data-view="settings"]').click();await status('unavailable');assert.equal(await page.locator('[data-updates-current]').textContent(),'0.7.0');assert.match(await page.locator('[data-updates-status]').textContent(),/Henüz yayımlanmış/);assert.equal(await page.locator('[data-updates-install]').isHidden(),true);
 await page.waitForTimeout(1600);assert.ok(reads>=2);assert.deepEqual(writes,[],'Opening or polling settings must not check remotely or install');
 await page.evaluate(()=>{const b=document.querySelector('[data-updates-check]');b.click();b.click();});await status('available');assert.equal(checks,1);assert.match(await page.locator('[data-updates-status]').textContent(),/0\.8\.0/);assert.equal(await page.locator('[data-updates-install]').isVisible(),true);
 await page.locator('[data-updates-install]').click();await status('error');assert.match(await page.locator('[data-updates-status]').textContent(),/Savaş bitince/);assert.equal(installs,1);
 await page.locator('[data-updates-check]').click();await status('available');installMode='download';
 await page.evaluate(()=>{const b=document.querySelector('[data-updates-install]');b.click();b.click();});await status('downloading');assert.equal(installs,2);update={...update,downloadBytes:5000000};await page.waitForFunction(()=>document.querySelector('[data-updates-progress]').value===5000000);assert.equal(await page.locator('[data-updates-download]').isVisible(),true);assert.equal(await page.locator('[data-updates-check]').isDisabled(),true);
 finishInstall();await status('installing');assert.match(await page.locator('[data-updates-status]').textContent(),/yeniden başlatılacak/);assert.deepEqual(writes,['/api/updates/check','/api/updates/install','/api/updates/check','/api/updates/install']);
 await page.locator('[data-view="live"]').click();await page.waitForTimeout(100);const hiddenReads=reads;await page.waitForTimeout(1700);assert.equal(reads,hiddenReads,'A hidden update view must not poll');
 update={...update,status:'up-to-date',canInstall:false};await page.setViewportSize({width:390,height:844});await page.locator('[data-view="settings"]').click();await status('up-to-date');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.equal(await root.isVisible(),true);assert.match(await page.locator('[data-updates-status]').textContent(),/Güncel sürümü/);
 fs.mkdirSync('tmp',{recursive:true});await page.screenshot({path:'tmp/updates-mobile.png',fullPage:true});await page.setViewportSize({width:1366,height:900});await page.screenshot({path:'tmp/updates-desktop.png',fullPage:true});
 assert.equal(await page.evaluate(()=>window.__audio),0);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 console.log(JSON.stringify({lazyStatus:'passed',noAutomaticWrites:'passed',unpublishedRelease:'passed',explicitBoundedCheck:'passed',availableVersion:'passed',idleGuardError:'passed',explicitBoundedInstall:'passed',progressWhilePostPending:'passed',installingState:'passed',hiddenViewNoPolling:'passed',mobileNoOverflow:'passed',noCaptureAudioOrExternalCalls:'passed',browserErrors:errors},null,2));
}finally{finishInstall?.();await browser.close();await new Promise(resolve=>server.close(resolve));}
