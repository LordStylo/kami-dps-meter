import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const entry=fileURLToPath(new URL('../overlay/main.cjs',import.meta.url));
const require=createRequire(entry),area={x:0,y:0,width:1920,height:1040};
const state=(sequence=0,epoch='host-test')=>({app:'aion-dps-lab',mode:'live',capture:{state:'capturing'},cubes:{epoch,active:sequence?[{id:'cube'+sequence,sequence,status:'present'}]:[]}});

async function host(t,saved={},initial=state()){
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'kami-map-host-'));t.after(()=>fs.rmSync(profile,{recursive:true,force:true}));
 fs.writeFileSync(path.join(profile,'layout.json'),JSON.stringify(saved));
 const app=new EventEmitter(),screen=new EventEmitter(),ipc=new EventEmitter(),handlers=new Map(),intervals=[],policies=[],released=[];
 let current=initial,input={foregroundPid:500,alt:false,left:false},requestFilter;
 Object.assign(app,{setPath(){},setName(){},requestSingleInstanceLock:()=>true,whenReady:()=>Promise.resolve(),quit(){app.emit('before-quit');}});
 Object.assign(screen,{getPrimaryDisplay:()=>({workArea:area}),getDisplayNearestPoint:()=>({workArea:area}),getDisplayMatching:()=>({workArea:area}),getCursorScreenPoint:()=>({x:800,y:600})});
 ipc.handle=(name,callback)=>handlers.set(name,callback);
 const defaultSession={setPermissionRequestHandler(){},setPermissionCheckHandler(){},webRequest:{onBeforeRequest(callback){requestFilter=callback;}}};
 let windowSequence=0;
 class Window extends EventEmitter {
  constructor(options){super();this.options=options;this.bounds={x:options.x,y:options.y,width:options.width,height:options.height};this.visible=false;this.id=++windowSequence;
   this.webContents=new EventEmitter();Object.assign(this.webContents,{mainFrame:{},messages:[],send:(channel,value)=>this.webContents.messages.push({channel,value}),setWindowOpenHandler:callback=>{this.openHandler=callback;}});
  }
  isDestroyed(){return false;}getBounds(){return {...this.bounds};}setBounds(bounds){this.bounds={...bounds};}
  getNativeWindowHandle(){const bytes=Buffer.alloc(8);bytes.writeBigUInt64LE(BigInt(this.id));return bytes;}
  setTitle(value){this.title=value;}setIgnoreMouseEvents(value){this.ignored=value;}setAlwaysOnTop(value){this.topmost=value;}setMenu(){}loadFile(filename,options){this.loaded={filename,options};}
  isVisible(){return this.visible;}showInactive(){this.visible=true;}hide(){this.visible=false;}
  focus(){assert.fail('Overlay must never request keyboard focus');}setFocusable(){assert.fail('Overlay focusability must remain fixed');}
 }
 class Tray extends EventEmitter {setToolTip(){}setContextMenu(){}destroy(){}}
 const diagnostics={attachProcess(){},record(){},error(){},watchWindow(){},beforeQuit(){}};
 const modules={electron:{app,BrowserWindow:Window,ipcMain:ipc,screen,Menu:{setApplicationMenu(){},buildFromTemplate:template=>Object.assign(template,{getMenuItemById:id=>template.find(item=>item.id===id)})},Tray,nativeImage:{createFromBitmap:()=>({})},shell:{openExternal(){}},session:{defaultSession},dialog:{},clipboard:{}},
  './windows.cjs':{gamePids:()=>new Set([500]),input:()=>input,elevated:()=>false},'./mouse-window.cjs':{allowMouseWithoutActivation:handle=>{policies.push(handle);return()=>released.push(handle);}},
  './diagnostics.cjs':{createDiagnostics:()=>diagnostics},koffi:{version:'test'}};
 const module={exports:{}};
 const context={require:name=>name in modules?modules[name]:require(name),module,exports:module.exports,__dirname:path.dirname(entry),Buffer,console,URL,AbortSignal,
  process:{argv:['node',entry,`--profile=${profile}`],versions:{...process.versions,electron:'test'},pid:process.pid},
  setInterval:(callback,ms)=>{const timer={callback,ms};intervals.push(timer);return timer;},clearInterval(){},setTimeout:()=>({}),clearTimeout(){},
  fetch:async()=>({ok:true,json:async()=>structuredClone(current)})};
 vm.runInNewContext(fs.readFileSync(entry,'utf8'),context,{filename:entry});
 for(let count=0;count<8;count++)await Promise.resolve();
 const api=module.exports;assert.equal(api.windows.size,5);
 for(const window of api.windows.values())window.emit('ready-to-show');
 const event=panel=>{const sender=api.windows.get(panel).webContents;return {sender,senderFrame:sender.mainFrame};};
 return {api,profile,app,ipc,policies,released,event,input:value=>{input={...input,...value};},
  init:panel=>handlers.get('overlay:init')(event(panel)),requestAllowed:url=>{let result;requestFilter({url},value=>{result=!value.cancel;});return result;},
  async poll(value){current=value;await intervals.find(timer=>timer.ms===500).callback();},
  command(panel,name,value){ipc.emit(name,event(panel),value);}};
}

test('host creates five permanently nonactivating local-only overlays and sends catalog only to the map',async t=>{
 const h=await host(t);assert.deepEqual([...h.api.windows.keys()],['dps','cube','cube-map','pet-map','controls']);
 assert.equal(h.init('controls').panels['cube-map'],false);assert.equal(h.api.windows.get('cube-map').isVisible(),false);
 for(const [panel,window]of h.api.windows){
  assert.equal(window.options.focusable,false,panel);assert.equal(window.options.show,false);assert.equal(window.options.resizable,true);assert.equal(window.options.webPreferences.sandbox,true);assert.equal(window.options.webPreferences.nodeIntegration,false);assert.equal(window.options.webPreferences.contextIsolation,true);
  assert.equal(window.ignored,true);assert.equal(window.openHandler().action,'deny');assert.equal(window.loaded.options.query.panel,panel);
  if(panel==='cube-map'){assert.equal(h.init(panel).mapCatalog.version,1);assert.equal(h.init(panel).mapCatalog.maps.length,7);}
  else assert.equal('mapCatalog' in h.init(panel),false);
 }
 assert.equal(h.policies.length,5);assert.equal(h.requestAllowed('http://127.0.0.1:4317/api/maps'),false);assert.equal(h.requestAllowed('https://example.org/map.webp'),false);
 assert.equal(h.requestAllowed(new URL('../public/maps/World_L_Starter.webp',import.meta.url).href),true);
 const marker=JSON.parse(fs.readFileSync(path.join(h.profile,'host.json'),'utf8'));assert.equal(marker.version,require('../package.json').version);assert.ok(marker.features.includes('cube-map-overlay'));
 h.api.setDesktopEdit(true);for(const window of h.api.windows.values())assert.equal(window.ignored,false);
 h.api.setDesktopEdit(false);for(const window of h.api.windows.values())assert.equal(window.ignored,true);
 h.api.windows.get('cube-map').emit('closed');assert.equal(h.released.length,1);
});

test('host map opens without starting sound, respects own hide and controls IPC, and accepts only new cube sequences',async t=>{
 const h=await host(t);h.api.setDesktopEdit(true);await h.poll(state(1));
 assert.equal(h.init('cube-map').panels['cube-map'],true);assert.equal(h.init('cube').cubeAlarm.running,false);
 h.command('cube-map','overlay:toggle-panel','cube-map');assert.equal(h.init('controls').panels['cube-map'],false);
 await h.poll(state(1));await h.poll(state());await h.poll(state(1));assert.equal(h.init('controls').panels['cube-map'],false);
 h.command('cube-map','overlay:toggle-panel','dps');assert.equal(h.init('controls').panels.dps,true);
 h.command('cube','overlay:toggle-panel','cube-map');assert.equal(h.init('controls').panels['cube-map'],false);
 h.command('controls','overlay:toggle-panel','cube-map');assert.equal(h.init('controls').panels['cube-map'],true);
 h.command('cube-map','overlay:toggle-panel','cube-map');await h.poll({...state(2),capture:{state:'delayed'}});await h.poll(state(2));assert.equal(h.init('controls').panels['cube-map'],false);
 await h.poll(state(3));assert.equal(h.init('controls').panels['cube-map'],true);
 h.command('cube-map','overlay:toggle-panel','cube-map');await h.poll(state(1,'new-epoch'));assert.equal(h.init('controls').panels['cube-map'],true);
 const frameEvent={...h.event('cube-map'),senderFrame:{}};h.ipc.emit('overlay:toggle-panel',frameEvent,'cube-map');assert.equal(h.init('controls').panels['cube-map'],true,'Subframes cannot issue panel commands');
 h.api.setInteraction(false);h.command('cube-map','overlay:toggle-panel','cube-map');assert.equal(h.init('controls').panels['cube-map'],true,'Without Alt/desktop interaction, renderer commands are rejected');
});

test('map layout and manual hiding persist while focus switching uses the common five-window policy',async t=>{
 const h=await host(t,{'cube-map':{enabled:true,x:900,y:300}}),map=h.api.windows.get('cube-map');
 assert.deepEqual(map.getBounds(),{x:900,y:300,width:360,height:360});assert.equal(map.isVisible(),true);
 h.input({alt:true});h.api.updateInput();for(const window of h.api.windows.values())assert.equal(window.ignored,false);
 h.input({tab:true});h.api.updateInput();for(const window of h.api.windows.values()){assert.equal(window.ignored,true);assert.equal(window.isVisible(),false);}
 h.input({alt:false,tab:false});h.api.updateInput();h.api.updateInput();assert.equal(map.isVisible(),true);
 h.api.setDesktopEdit(true);map.setBounds({x:700,y:500,width:360,height:360});map.emit('move');h.command('cube-map','overlay:toggle-panel','cube-map');
 h.app.emit('before-quit');const saved=JSON.parse(fs.readFileSync(path.join(h.profile,'layout.json'),'utf8'));assert.deepEqual(saved['cube-map'],{enabled:false,x:700,y:500,detection:{epoch:'host-test',sequence:0}});
 const restarted=await host(t,saved);assert.equal(restarted.init('controls').panels['cube-map'],false);assert.deepEqual(restarted.api.windows.get('cube-map').getBounds(),{x:700,y:500,width:360,height:360});
});

test('a manually hidden active cube stays hidden across overlay restart on the same backend epoch',async t=>{
 const first=await host(t,{},state(7));assert.equal(first.init('controls').panels['cube-map'],true);
 first.api.setDesktopEdit(true);first.command('cube-map','overlay:toggle-panel','cube-map');first.app.emit('before-quit');
 const saved=JSON.parse(fs.readFileSync(path.join(first.profile,'layout.json'),'utf8'));
 assert.deepEqual(saved['cube-map'].detection,{epoch:'host-test',sequence:7});assert.equal(saved['cube-map'].enabled,false);
 const restarted=await host(t,saved,state(7));assert.equal(restarted.init('controls').panels['cube-map'],false);
 await restarted.poll(state(8));assert.equal(restarted.init('controls').panels['cube-map'],true);
 restarted.api.setDesktopEdit(true);restarted.command('cube-map','overlay:toggle-panel','cube-map');
 await restarted.poll(state(1,'new-backend'));assert.equal(restarted.init('controls').panels['cube-map'],true);
});

test('pet selections reuse the fifth window, expose only selected local data and cannot toggle other panels',async t=>{
 const h=await host(t),window=h.api.windows.get('pet-map'),windowId=window.id;
 assert.equal(h.init('pet-map').panels['pet-map'],false);assert.equal(h.init('pet-map').petOverlay.pet,null);
 const selected=h.api.showPetMap(1016,1110);assert.equal(selected.ok,true);assert.equal(selected.petId,1016);
 assert.equal(h.api.windows.size,5);assert.equal(h.api.windows.get('pet-map').id,windowId);
 const envelope=h.init('pet-map');assert.equal(envelope.petOverlay.pet.id,1016);assert.ok(envelope.petOverlay.spawns.length>0);assert.ok(envelope.petOverlay.maps.some(m=>m.id===1110));assert.ok(envelope.petOverlay.maps.some(m=>m.id===22));
 for(const panel of ['dps','cube','cube-map','controls'])assert.equal('petOverlay' in h.init(panel),false);
 h.api.showPetMap(1004,1010);assert.equal(h.init('pet-map').petOverlay.pet.id,1004);assert.equal(h.api.windows.get('pet-map').id,windowId);
 const revision=h.init('pet-map').petOverlay.revision;assert.throws(()=>h.api.showPetMap('../1016',1110));assert.equal(h.init('pet-map').petOverlay.revision,revision);
 h.api.setDesktopEdit(true);h.command('pet-map','overlay:toggle-panel','dps');assert.equal(h.init('controls').panels.dps,true);
 h.command('pet-map','overlay:toggle-panel','pet-map');assert.equal(h.init('controls').panels['pet-map'],false);
 await h.poll(state());assert.equal(h.init('controls').panels['pet-map'],false);
 h.api.showPetMap(1004,1010);assert.equal(h.init('controls').panels['pet-map'],true);assert.equal(h.init('cube').cubeAlarm.running,false);
});
