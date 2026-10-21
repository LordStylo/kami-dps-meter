// Native workbench QA uses hidden windows and an isolated loopback server.
// No system input, game messages, sounds, clipboard writes or capture controls.
import assert from 'node:assert/strict';
import path from 'node:path';
import http from 'node:http';
import {createRequire} from 'node:module';
import fs from 'node:fs';
const require=createRequire(import.meta.url);
const {_electron}=require(process.env.PLAYWRIGHT_PATH||path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const url=process.env.AION_UI_TEST_URL;
if(!url||new URL(url).hostname!=='127.0.0.1'||new URL(url).port==='4317')throw Error('Set AION_UI_TEST_URL to an isolated loopback test server; production port 4317 is excluded.');
const root=path.resolve('.'),entry=path.join(root,'overlay/main.cjs'),profile=path.join(root,'tmp',`application-smoke-${Date.now()}`);
const panels=['dps','cube','cube-map','pet-map','controls'],overlayCount=panels.length;
const runtime=process.env.AION_OVERLAY_TEST_RUNTIME||process.env.AION_ELECTRON_PATH||path.resolve('../Kami-DPS-Meter/runtime/electron/electron.exe');
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const before=await fetch(url+'/api/state').then(r=>r.json());
let deniedRequests=0;
const other=http.createServer((_req,res)=>{deniedRequests++;res.end('This origin must never be requested by the app window.');});
await new Promise(resolve=>other.listen(0,'127.0.0.1',resolve));
const otherUrl=`http://127.0.0.1:${other.address().port}/blocked`;
let app;const errors=[];
async function overlayFlags(){return app.evaluate((_electron,koffiPath)=>{
 const k=process.mainModule.require(koffiPath),user=k.load('user32.dll'),get=user.func('intptr __stdcall GetWindowLongPtrW(uintptr hwnd, int index)');
 return [...globalThis.overlayForTest.windows].map(([panel,w])=>({panel,focusable:w.isFocusable(),noActivate:!!(Number(get(w.getNativeWindowHandle().readBigUInt64LE(),-20))&0x8000000),topmost:w.isAlwaysOnTop()}));
},path.join(root,'node_modules/koffi'));}
try{
 app=await _electron.launch({executablePath:runtime,args:[entry,`--port=${new URL(url).port}`,`--profile=${profile}`,'--test-overlay'],env,timeout:30000});
 await app.firstWindow();
 await app.evaluate((_electron,filename)=>{
  globalThis.overlayForTest=process.mainModule.require(filename);globalThis.overlayForTest.pauseKeys();globalThis.overlayForTest.setDesktopEdit(true);
  // --test-overlay keeps both native overlays and the workbench hidden.
 },entry);
 for(let i=0;app.windows().length<overlayCount&&i<100;i++)await new Promise(r=>setTimeout(r,30));
 assert.equal(app.windows().length,overlayCount);
 for(const page of app.windows()){page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(()=>!!window.kamiOverlay);}
 assert.deepEqual(app.windows().map(page=>new URL(page.url()).searchParams.get('panel')).sort(),[...panels].sort());
 const flagsBefore=await overlayFlags();assert.equal(flagsBefore.length,overlayCount);assert.ok(flagsBefore.every(w=>!w.focusable&&w.noActivate&&w.topmost));
 const dps=app.windows().find(p=>p.url().includes('panel=dps'));
 const windowPromise=app.waitForEvent('window');
 await dps.locator('#details').dispatchEvent('click');
 let desktop=await windowPromise;desktop.on('pageerror',e=>errors.push(e.message));
 await desktop.waitForURL(url+'/#live');await desktop.waitForFunction(()=>!!window.kamiApplication&&document.querySelector('#connection').textContent!=='Bağlanıyor');
 assert.equal(app.windows().length,overlayCount+1);
 const prefs=await app.evaluate(({BrowserWindow,session},origin)=>{const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith(origin));const p=w.webContents.getLastWebPreferences();return {sandbox:p.sandbox,contextIsolation:p.contextIsolation,nodeIntegration:p.nodeIntegration,ownSession:w.webContents.session===session.fromPartition('persist:kami-workbench'),visible:w.isVisible()};},url);
 assert.deepEqual(prefs,{sandbox:true,contextIsolation:true,nodeIntegration:false,ownSession:true,visible:false});
 assert.deepEqual(await desktop.evaluate(()=>({keys:Object.keys(window.kamiApplication),node:typeof window.require,process:typeof window.process,overlay:typeof window.kamiOverlay})),{keys:['copyText','showPetMap'],node:'undefined',process:'undefined',overlay:'undefined'});
 assert.equal(await desktop.evaluate(async()=>{try{await window.kamiApplication.copyText('x'.repeat(16001));return false;}catch{return true;}}),true,'Oversized clipboard payload must be rejected without writing.');
 assert.equal(await desktop.evaluate(async other=>{try{await fetch(other);return false;}catch{return true;}},otherUrl),true);
 await desktop.evaluate(other=>{location.href=other;},otherUrl);await new Promise(r=>setTimeout(r,80));
 assert.ok(desktop.url().startsWith(url+'/'),'Cross-origin navigation must stay blocked.');
 await desktop.evaluate(other=>{window.open(other);},otherUrl);await new Promise(r=>setTimeout(r,80));assert.equal(app.windows().length,overlayCount+1);assert.equal(deniedRequests,0);
 await dps.locator('#dashboard').dispatchEvent('click');await new Promise(r=>setTimeout(r,60));assert.equal(app.windows().length,overlayCount+1,'Repeated requests must reuse the own application window.');
 // An explicit selected-pet button uses the restricted application IPC. List
 // selection/SSE alone must never create another window or change the overlay.
 await desktop.locator('[data-view="pets"]').dispatchEvent('click');await desktop.waitForFunction(()=>document.querySelectorAll('[data-pet-card]').length>0);
 await desktop.locator('[data-pets-search]').fill('Slink');await desktop.locator('[data-pet-open="1016"]').dispatchEvent('click');
 const petMap=app.windows().find(p=>new URL(p.url()).searchParams.get('panel')==='pet-map');assert.ok(petMap);
 assert.equal((await petMap.evaluate(()=>window.kamiOverlay.init())).panels['pet-map'],false);
 await desktop.locator('[data-pets-show-overlay]').dispatchEvent('click');await petMap.waitForFunction(async()=>{const value=await window.kamiOverlay.init();return value.panels['pet-map']&&value.petOverlay.pet?.id===1016;});
 const petWindowId=await app.evaluate(()=>globalThis.overlayForTest.windows.get('pet-map').id),selectionRevision=(await petMap.evaluate(()=>window.kamiOverlay.init())).petOverlay.revision;
 await desktop.locator('[data-pets-search]').fill('Fossa');await desktop.locator('[data-pet-open="1004"]').dispatchEvent('click');assert.equal((await petMap.evaluate(()=>window.kamiOverlay.init())).petOverlay.pet.id,1016,'Selecting another list row alone must not issue an overlay command');
 await desktop.evaluate(()=>{const button=document.querySelector('[data-pets-show-overlay]');button.click();button.click();});
 await petMap.waitForFunction(async()=>{const value=await window.kamiOverlay.init();return value.petOverlay.pet?.id===1004;});
 assert.equal((await petMap.evaluate(()=>window.kamiOverlay.init())).petOverlay.revision,selectionRevision+1,'A rapid double click must issue only one bounded explicit request');assert.equal(await app.evaluate(()=>globalThis.overlayForTest.windows.get('pet-map').id),petWindowId);assert.equal(app.windows().length,overlayCount+1);
 await petMap.locator('#pet-map-hide').dispatchEvent('click');await petMap.waitForFunction(async()=>!(await window.kamiOverlay.init()).panels['pet-map']);
 await desktop.locator('[data-pets-show-overlay]').dispatchEvent('click');await petMap.waitForFunction(async()=>(await window.kamiOverlay.init()).panels['pet-map']);
 const closePromise=desktop.waitForEvent('close');await app.evaluate(({BrowserWindow},origin)=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith(origin)).close(),url);
 await closePromise;assert.equal(app.windows().length,overlayCount);
 const after=await fetch(url+'/api/state').then(r=>r.json());assert.equal(after.app,'aion-dps-lab');assert.equal(after.mode,before.mode,'Closing application must preserve backend and capture mode.');
 const flagsAfter=await overlayFlags();assert.deepEqual(flagsAfter,flagsBefore);
 // The controls entry point also opens the same secure native application.
 const controls=app.windows().find(p=>p.url().includes('panel=controls'));
 await app.evaluate(()=>globalThis.overlayForTest.setDesktopEdit(true));
 assert.equal((await controls.evaluate(()=>window.kamiOverlay.init())).interactive,true);
 const controlsPromise=app.waitForEvent('window');await controls.locator('#app-details').dispatchEvent('click');desktop=await controlsPromise;
 await desktop.waitForURL(url+'/#live');await desktop.waitForFunction(()=>!!window.kamiApplication);
 assert.equal(app.windows().length,overlayCount+1);
 const controlsClose=desktop.waitForEvent('close');await app.evaluate(({BrowserWindow},origin)=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith(origin)).close(),url);await controlsClose;
 const host=JSON.parse(fs.readFileSync(path.join(profile,'host.json'),'utf8'));assert.ok(['application-window','combat-details','local-history','cube-map-overlay','pet-map-overlay'].every(feature=>host.features.includes(feature)));
 assert.equal(host.version,JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version);
 const launchWindow=app.waitForEvent('window');fs.writeFileSync(path.join(profile,'application.request'),'open');desktop=await launchWindow;await desktop.waitForURL(url+'/#live');await desktop.waitForFunction(()=>!!window.kamiApplication);
 assert.equal(app.windows().length,overlayCount+1,'Explicit local application request must open the own window.');assert.equal(fs.existsSync(path.join(profile,'application.request')),false,'Request must be consumed.');
 const ownWindowId=await app.evaluate(({BrowserWindow},origin)=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith(origin)).id,url);
 fs.writeFileSync(path.join(profile,'application.request'),'open');for(let i=0;fs.existsSync(path.join(profile,'application.request'))&&i<30;i++)await new Promise(r=>setTimeout(r,20));
 assert.equal(app.windows().length,overlayCount+1);assert.equal(await app.evaluate(({BrowserWindow},origin)=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith(origin)).id,url),ownWindowId,'Repeated local requests must reuse the window.');
 assert.equal(await app.evaluate(({BrowserWindow},origin)=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith(origin)).isVisible(),url),false);
 await app.close();app=null;
 app=await _electron.launch({executablePath:runtime,args:[entry,`--port=${new URL(url).port}`,`--profile=${profile}-initial`,'--test-overlay','--application'],env,timeout:30000});await app.firstWindow();
 for(let i=0;app.windows().length<overlayCount+1&&i<100;i++)await new Promise(r=>setTimeout(r,30));
 assert.equal(app.windows().length,overlayCount+1,'Initial --application must create the own window.');
 const initialApp=app.windows().find(p=>p.url().startsWith(url+'/'));assert.ok(initialApp);await initialApp.waitForFunction(()=>!!window.kamiApplication);
 assert.equal(await app.evaluate(({BrowserWindow},origin)=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith(origin)).isVisible(),url),false);
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({nativeApplication:'passed',explicitPetOverlayIPC:'passed',petWindowReuse:'passed',noImplicitSelectionWrites:'passed',rapidDoubleClickBounded:'passed',petManualHideReshow:'passed',detailsEntry:'passed',controlsEntry:'passed',windowReuse:'passed',initialApplicationFlag:'passed',localApplicationRequest:'passed',requestConsumed:'passed',hostFeatures:'passed',sandbox:'passed',preloadSurface:'passed',clipboardValidation:'passed',sameOriginNavigation:'passed',crossOriginNetworkBlocked:'passed',newWindowsDenied:'passed',applicationCloseKeepsBackend:'passed',overlayFocusFlags:'passed',hiddenNoFocusQA:'passed',browserErrors:errors},null,2));
}finally{if(app)await app.close();await new Promise(resolve=>other.close(resolve));}
