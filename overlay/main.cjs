const {app,BrowserWindow,ipcMain,screen,Menu,Tray,nativeImage,shell,session,dialog,clipboard}=require('electron');
const fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const native=require('./windows.cjs');
const {allowMouseWithoutActivation}=require('./mouse-window.cjs');
const {boundsFor,transparencyFor,resizeBounds,migrateDpsLayout}=require('./layout.cjs');
const {panelVisible}=require('./interaction.cjs');
const {FocusSession}=require('./focus.cjs');
const {shutdownBackend}=require('./shutdown.cjs');
const {CubeAlarm}=require('./cube-alarm.cjs');
const {CubeMapVisibility}=require('./cube-map-visibility.cjs');
const {PetMapSelection}=require('./pet-map-state.cjs');
const {createDiagnostics}=require('./diagnostics.cjs');
const root=path.resolve(__dirname,'..');
const {runtimePaths}=require('./runtime-paths.cjs');
const option=name=>process.argv.find(x=>x.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const port=Number(option('port')||4317);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid local server port');
const origin=`http://127.0.0.1:${port}`;
const paths=runtimePaths({root,port,profile:option('profile'),env:{...process.env,...option('data-dir')?{AION_DATA_DIR:option('data-dir')}:{}}}),profile=paths.profile;
const quitRequest=path.join(profile,'quit.request');
const applicationRequest=path.join(profile,'application.request');
const petMapRequest=path.join(profile,'pet-map.request'),petMapResponse=path.join(profile,'pet-map.response');
fs.mkdirSync(path.join(profile,'browser'),{recursive:true});app.setPath('userData',path.join(profile,'browser'));
app.setName('Kami DPS Overlay');
const quitting=process.argv.includes('--quit-overlay');
const applicationRequested=process.argv.includes('--application');
if(quitting)fs.writeFileSync(quitRequest,'quit');
const owned=app.requestSingleInstanceLock({command:quitting?'quit':applicationRequested?'application':'show'});
const diagnostics=owned&&!quitting?createDiagnostics({directory:profile}):null;
diagnostics?.attachProcess();
diagnostics?.record('runtime',{electron:process.versions.electron,node:process.versions.node,koffi:require('koffi').version});
const windows=new Map(),ready=new Set(),focusSession=new FocusSession();let tray,applicationWindow=null,layout={},interactive=false,drag=null,lastState=null,connected=false,pollTimer,keyTimer,saveTimer,commandTimer,requestBusy=false,desktopEdit=false,hiddenByUser=false,gameProcesses=new Set(),gameCheckAt=0;
try{const value=JSON.parse(fs.readFileSync(path.join(profile,'layout.json'),'utf8'));if(value&&typeof value==='object')layout=value;}catch{}
layout.dps=migrateDpsLayout(layout.dps);
layout['cube-map']={...layout['cube-map'],enabled:layout['cube-map']?.enabled===true};
layout['pet-map']={...layout['pet-map'],enabled:layout['pet-map']?.enabled===true};
let settingsOpen=false,controlsOpen=false,suppressControlClickUntil=0,trayMenu,closingAll=false,manualDpsReveal=false;
const inCombat=state=>state?.combat?.active??(state?.current?.damage>0);
const cubeAlarm=new CubeAlarm();
const cubeMapVisibility=new CubeMapVisibility(layout['cube-map']?.detection);
let mapCatalog={version:1,maps:[]};
try{const catalog=JSON.parse(fs.readFileSync(path.join(root,'data','world-maps.json'),'utf8'));if(catalog.version!==1||!Array.isArray(catalog.maps))throw Error('Invalid world-map catalog');mapCatalog={version:1,maps:catalog.maps};}
catch(error){diagnostics?.error('map-catalog-error',error);}
let petMapSelection=null;
try{petMapSelection=new PetMapSelection(root);if(Number.isSafeInteger(layout['pet-map']?.petId))petMapSelection.select(layout['pet-map'].petId,layout['pet-map'].mapId??null);}
catch(error){diagnostics?.error('pet-map-catalog-error',error);layout['pet-map']={...layout['pet-map'],enabled:false};}
const envelope=panel=>({panel,state:lastState,connected,interactive,desktopEdit,collapsed:panel==='dps'&&layout.dps?.collapsed===true,settingsOpen:panel==='dps'&&settingsOpen,transparency:panel==='dps'?transparencyFor(layout.dps?.transparency):8,
 controlsOpen:panel==='controls'&&controlsOpen,autoHide:layout.dps?.autoHide!==false,manualDpsReveal,panels:{dps:layout.dps?.enabled!==false,cube:layout.cube?.enabled!==false,'cube-map':layout['cube-map']?.enabled===true,'pet-map':layout['pet-map']?.enabled===true},cubeAlarm:cubeAlarm.snapshot(),...(panel==='cube-map'?{mapCatalog}:{}),...(panel==='pet-map'?{petOverlay:petMapSelection?.snapshot()||{revision:0,pet:null,spawns:[],maps:[]}}:{}),...(panel==='controls'?{petMapSelection:petMapSelection?.summary()}:{}),metric:layout.dps?.metric==='healing'?'healing':'damage',dpsMode:layout.dps?.mode==='individual'?'individual':'party'});
const windowState=panel=>({...layout[panel],settingsOpen:panel==='dps'&&settingsOpen,controlsOpen:panel==='controls'&&controlsOpen});
const position=w=>{const {x,y}=w.getBounds();return {x,y};};
function send(panel){const w=windows.get(panel);if(w&&!w.isDestroyed())w.webContents.send('overlay:update',envelope(panel));}
function broadcast(){for(const panel of windows.keys())send(panel);}
function persist(){clearTimeout(saveTimer);saveTimer=setTimeout(()=>{try{fs.writeFileSync(path.join(profile,'layout.json'),JSON.stringify(layout));}catch(e){console.error(e.message);}},200);}
function savePosition(panel){const w=windows.get(panel);if(!w||w.isDestroyed())return;const {x,y}=w.getBounds();layout[panel]={...layout[panel],x,y};persist();}
function setInteraction(value){
 value=!!value;if(value===interactive)return;interactive=value;
 // Mouse interaction must never transfer keyboard focus away from the game.
 // Changing focusability on Alt left the game's relative mouse mode stuck
 // after Alt+Tab. WS_EX_NOACTIVATE stays set for the window's whole lifetime.
 for(const w of windows.values())w.setIgnoreMouseEvents(!value,{forward:true});
 if(!value)finishDrag();broadcast();
}
function updateInput(){
 if(Date.now()-gameCheckAt>2000){gameProcesses=native.gamePids();gameCheckAt=Date.now();}
 const input=native.input(),foreground=gameProcesses.has(input.foregroundPid)?'game':'other';
 const policy=focusSession.update({foreground,alt:input.alt,tab:input.tab,escape:input.escape,windows:input.windows,desktopEdit,hiddenByUser}),visible=policy.visible;
 setInteraction(policy.interactive);
 if(!process.argv.includes('--test-overlay'))for(const [panel,w]of windows){if(!ready.has(panel))continue;const show=panelVisible(panel,layout,visible,{state:lastState,connected,desktopEdit,manualDpsReveal,settingsOpen});if(show&&!w.isVisible())w.showInactive();else if(!show&&w.isVisible())w.hide();}
 stepDrag(screen.getCursorScreenPoint(),input.left);
}
function setDesktopEdit(value){desktopEdit=!!value;hiddenByUser=false;updateInput();broadcast();}
function finishDrag(){if(!drag)return;diagnostics?.record('drag-end',{panel:drag.panel,source:drag.resize?'resize':'move'});if(drag.panel==='controls'&&drag.moved)suppressControlClickUntil=Date.now()+300;savePosition(drag.panel);drag=null;}
function stepDrag(point,leftDown){
 if(!drag)return;if(!interactive||!leftDown){finishDrag();return;}
 if(!drag.moved&&Math.hypot(point.x-drag.cursor.x,point.y-drag.cursor.y)<4)return;
 drag.moved=true;
 if(drag.resize){
  const target=resizeBounds(drag.bounds,{x:point.x-drag.cursor.x,y:point.y-drag.cursor.y},drag.area);
  // Store the requested DIP dimensions, never the native rounded result.
  // Reusing getBounds() on each tick makes fractional-DPI windows creep.
  layout.dps={...layout.dps,width:target.width,height:target.height};
  windows.get('dps').setBounds(target,false);persist();return;
 }
 const w=windows.get(drag.panel),b=w.getBounds(),area=screen.getDisplayNearestPoint(point).workArea;
 const x=Math.max(area.x,Math.min(drag.bounds.x+point.x-drag.cursor.x,area.x+area.width-b.width));
 const y=Math.max(area.y,Math.min(drag.bounds.y+point.y-drag.cursor.y,area.y+area.height-b.height));
 const target=boundsFor(drag.panel,{...windowState(drag.panel),x,y},area);
 w.setBounds(target,false);
}
function collapse(panel){
 if(panel!=='dps')return;
 layout.dps={...layout.dps,collapsed:settingsOpen||!layout.dps?.collapsed};settingsOpen=false;
 resizeDps();
}
function resizeDps(){
 const panel='dps';
 const w=windows.get(panel),area=screen.getDisplayMatching(w.getBounds()).workArea;
 w.setBounds(boundsFor(panel,{...windowState(panel),...position(w)},area),false);
 savePosition(panel);send(panel);
}
function resetLayout(){
 settingsOpen=false;controlsOpen=false;const area=screen.getPrimaryDisplay().workArea;
 for(const [panel,w]of windows){layout[panel]={...layout[panel]};delete layout[panel].x;delete layout[panel].y;w.setBounds(boundsFor(panel,windowState(panel),area));savePosition(panel);send(panel);}updateInput();
}
function toggleControls(){
 if((drag?.panel==='controls'&&drag.moved)||Date.now()<suppressControlClickUntil)return;
 // A click and a drag share the small launcher surface. End an unmoved press
 // before resizing, so the next input tick cannot restore its old bounds.
 if(drag?.panel==='controls')drag=null;
 controlsOpen=!controlsOpen;
 const w=windows.get('controls'),area=screen.getDisplayMatching(w.getBounds()).workArea;
 w.setBounds(boundsFor('controls',{...windowState('controls'),...position(w)},area),false);
 savePosition('controls');send('controls');
}
function source(event){
 if(event.senderFrame!==event.sender.mainFrame)return null;
 for(const [panel,w]of windows)if(w.webContents===event.sender)return panel;
 return null;
}
function syncPetMapMenu(){const item=trayMenu?.getMenuItemById('pet-map');if(item){item.enabled=!!petMapSelection?.pet;item.checked=layout['pet-map']?.enabled===true;}}
function showPetMap(petId,mapId=null){
 if(!petMapSelection)throw Error('Yerel pet haritası hazırlanamadı');
 const selection=petMapSelection.select(petId,mapId);
 layout['pet-map']={...layout['pet-map'],enabled:true,petId:selection.petId,mapId:selection.mapId};
 windows.get('pet-map')?.setTitle('Kami · Pet haritası · '+selection.name);
 hiddenByUser=false;persist();syncPetMapMenu();updateInput();broadcast();
 return {ok:true,petId:selection.petId,mapId:selection.mapId};
}
function consumePetMapRequest(){
 if(!fs.existsSync(petMapRequest))return;
 let request;
 try{const stat=fs.lstatSync(petMapRequest);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>4096)throw Error('Geçersiz pet haritası istek dosyası');request=JSON.parse(fs.readFileSync(petMapRequest,'utf8'));}
 catch(error){diagnostics?.error('pet-map-request-error',error);}
 finally{try{fs.unlinkSync(petMapRequest);}catch{}}
 if(typeof request?.requestId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(request.requestId))return;
 let response;
 try{if(typeof request.at!=='number'||!Number.isFinite(request.at)||Date.now()-request.at>10000||request.at-Date.now()>2000)throw Error('Pet haritası isteğinin süresi doldu');response={requestId:request.requestId,...showPetMap(request.petId,request.mapId??null)};}
 catch(error){response={requestId:request.requestId,ok:false,error:String(error.message||error).slice(0,200)};}
 const temporary=petMapResponse+'.tmp-'+process.pid;
 try{fs.writeFileSync(temporary,JSON.stringify(response));fs.renameSync(temporary,petMapResponse);}catch(error){diagnostics?.error('pet-map-response-error',error);try{fs.unlinkSync(temporary);}catch{}}
}
async function poll(){
 if(requestBusy)return;requestBusy=true;
 try{const res=await fetch(origin+'/api/state',{signal:AbortSignal.timeout(1800)});if(!res.ok)throw Error('Local service unavailable');const s=await res.json();if(s.app!=='aion-dps-lab')throw Error('Unexpected service');if(inCombat(s))manualDpsReveal=false;lastState=s;connected=true;}
 catch{connected=false;}finally{requestBusy=false;syncCubeAlarm();syncCubeMap();broadcast();}
}
function syncCubeAlarm(){
 if(cubeAlarm.update(lastState,connected)){
  layout.cube={...layout.cube,enabled:true};persist();updateInput();
 }
}
function syncCubeMap(){
 const before=cubeMapVisibility.snapshot(),show=cubeMapVisibility.update(lastState,connected),detection=cubeMapVisibility.snapshot();
 if(before.epoch!==detection.epoch||before.sequence!==detection.sequence){
  layout['cube-map']={...layout['cube-map'],detection,...(show?{enabled:true}:{})};persist();
 }
 if(show)updateInput();
}
function createWindow(panel){
 const saved=windowState(panel),area=saved&&Number.isFinite(saved.x)&&Number.isFinite(saved.y)?screen.getDisplayNearestPoint({x:Math.round(saved.x),y:Math.round(saved.y)}).workArea:screen.getPrimaryDisplay().workArea;
 const w=new BrowserWindow({...boundsFor(panel,saved,area),title:`Kami · ${{dps:'DPS',cube:'Küp','cube-map':'Küp haritası','pet-map':'Pet haritası',controls:'Arayüz'}[panel]}`,show:false,frame:false,thickFrame:false,transparent:true,backgroundColor:'#00000000',hasShadow:false,resizable:true,minimizable:false,maximizable:false,fullscreenable:false,focusable:false,skipTaskbar:true,alwaysOnTop:true,
  webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false,webSecurity:true}});
 diagnostics?.watchWindow(w,panel);
 windows.set(panel,w);w.setIgnoreMouseEvents(true,{forward:true});w.setAlwaysOnTop(true,'screen-saver');w.setMenu(null);
 const releaseMousePolicy=allowMouseWithoutActivation(w.getNativeWindowHandle().readBigUInt64LE());
 w.once('closed',releaseMousePolicy);
 // Use our Alt-gated corner grip instead of native resize hit testing.
 // resizable:false also adds native size constraints at fractional Windows DPI.
 w.on('will-resize',event=>event.preventDefault());
 w.webContents.setWindowOpenHandler(()=>({action:'deny'}));w.webContents.on('will-navigate',e=>e.preventDefault());
 w.webContents.on('will-attach-webview',e=>e.preventDefault());
 w.on('move',()=>savePosition(panel));w.on('closed',()=>windows.delete(panel));
 w.once('ready-to-show',()=>{w.setBounds(boundsFor(panel,{...windowState(panel),...position(w)},area),false);ready.add(panel);updateInput();send(panel);});
 w.loadFile(path.join(__dirname,'index.html'),{query:{panel}});
 return w;
}
// This ordinary app window opens only from an explicit menu/button click.
// The game overlays keep their permanent nonactivating focus policy.
function openApplication(){
 if(applicationWindow&&!applicationWindow.isDestroyed()){
  if(applicationWindow.isMinimized())applicationWindow.restore();
  if(!process.argv.includes('--test-overlay'))applicationWindow.show();return applicationWindow;
 }
 const appSession=session.fromPartition('persist:kami-workbench');
 appSession.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
 appSession.setPermissionCheckHandler(()=>false);
 appSession.webRequest.onBeforeRequest((details,callback)=>{let allowed=false;try{allowed=new URL(details.url).origin===origin;}catch{}callback({cancel:!allowed});});
 const w=new BrowserWindow({width:1320,height:900,minWidth:800,minHeight:600,title:'Kami · Savaş analizi',show:false,backgroundColor:'#0d1117',autoHideMenuBar:true,
  webPreferences:{partition:'persist:kami-workbench',preload:path.join(__dirname,'application-preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
 applicationWindow=w;diagnostics?.watchWindow(w,'application');w.setMenu(null);
 w.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 w.webContents.on('will-navigate',(event,url)=>{try{if(new URL(url).origin!==origin)event.preventDefault();}catch{event.preventDefault();}});
 w.webContents.on('will-attach-webview',event=>event.preventDefault());
 w.once('ready-to-show',()=>{if(!process.argv.includes('--test-overlay'))w.show();});w.once('closed',()=>{if(applicationWindow===w)applicationWindow=null;});
 w.loadURL(origin+'/#live');return w;
}
async function quitAll(item){
 if(closingAll)return;
 closingAll=true;item.enabled=false;
 try{await shutdownBackend(origin);app.quit();}
 catch(error){
  closingAll=false;item.enabled=true;
  await dialog.showMessageBox({type:'error',title:'Kami DPS',message:'Tamamen kapatılamadı',detail:`Veri toplamanın kapandığı doğrulanamadı; overlay açık bırakıldı.\n${error.message}`,buttons:['Tamam']});
 }
}
function createTray(){
 const pixels=Buffer.alloc(20*20*4);for(let y=0;y<20;y++)for(let x=0;x<20;x++){const i=(y*20+x)*4,k=x===5&&y>=4&&y<=15||x>=6&&x<=13&&(y===19-x||y===x+1);pixels[i]=k?170:24;pixels[i+1]=k?235:30;pixels[i+2]=k?120:22;pixels[i+3]=255;}
 tray=new Tray(nativeImage.createFromBitmap(pixels,{width:20,height:20}));tray.setToolTip('Kami DPS · Alt ile taşı ve etkileş');
 trayMenu=Menu.buildFromTemplate([{label:'Kami uygulamasını aç',click:openApplication},{id:'pet-map',label:'Pet haritası',type:'checkbox',enabled:!!petMapSelection?.pet,checked:layout['pet-map']?.enabled===true,click:item=>{layout['pet-map']={...layout['pet-map'],enabled:item.checked};persist();updateInput();broadcast();}},{type:'separator'},{label:'Masaüstünde düzenle',type:'checkbox',checked:false,click:item=>setDesktopEdit(item.checked)},{label:'Pencereleri oyunda göster',click:()=>{hiddenByUser=false;updateInput();}},{label:'Pencereleri gizle',click:()=>{hiddenByUser=true;updateInput();}},{label:'Konumları sıfırla',click:resetLayout},{label:'Tarayıcıda aç',click:()=>shell.openExternal(origin)},{type:'separator'},{label:'Overlay’i kapat (veri toplama sürer)',click:()=>app.quit()},{id:'quit-all',label:'Tamamen kapat',click:item=>{void quitAll(item);}}]);
 tray.setContextMenu(trayMenu);
 tray.on('double-click',()=>{hiddenByUser=false;updateInput();});
}
if(!owned||quitting){app.quit();}
else{
 app.on('second-instance',(_e,_argv,_cwd,data)=>{if(data?.command==='quit')app.quit();else{hiddenByUser=false;updateInput();if(data?.command==='application')void app.whenReady().then(openApplication);}});
 app.whenReady().then(()=>{
  Menu.setApplicationMenu(null);
  session.defaultSession.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  session.defaultSession.setPermissionCheckHandler(()=>false);
  // Renderers load only the bundled UI/assets. HTTP is handled in the main
  // process against the fixed loopback origin, never arbitrary renderer URLs.
  session.defaultSession.webRequest.onBeforeRequest((details,callback)=>callback({cancel:!details.url.startsWith(pathToFileURL(root+path.sep).href)&&!details.url.startsWith('devtools://')}));
  ipcMain.handle('overlay:init',event=>{const panel=source(event);return panel?envelope(panel):null;});
  ipcMain.on('overlay:collapse',event=>{const panel=source(event);if(interactive&&panel)collapse(panel);});
  ipcMain.on('overlay:settings',event=>{if(interactive&&source(event)==='dps'){settingsOpen=!settingsOpen;resizeDps();}});
  ipcMain.on('overlay:transparency',(event,value)=>{if(!interactive||source(event)!=='dps'||typeof value!=='number'||!Number.isFinite(value))return;layout.dps={...layout.dps,transparency:transparencyFor(value)};persist();send('dps');});
  ipcMain.on('overlay:controls',event=>{if(interactive&&source(event)==='controls')toggleControls();});
  ipcMain.on('overlay:toggle-panel',(event,panel)=>{
   const sender=source(event),mapPanel=['cube-map','pet-map'].includes(panel);if(!interactive||!['dps','cube','cube-map','pet-map'].includes(panel)||(sender!=='controls'&&!(mapPanel&&sender===panel))||panel==='pet-map'&&!petMapSelection?.pet)return;
   const enabled=mapPanel?layout[panel]?.enabled===true:layout[panel]?.enabled!==false;
   layout[panel]={...layout[panel],enabled:mapPanel&&sender===panel?false:!enabled};
   if(panel==='dps'){manualDpsReveal=layout.dps.enabled&&!inCombat(lastState)&&layout.dps.autoHide!==false;if(!layout.dps.enabled)settingsOpen=false;}persist();syncPetMapMenu();updateInput();broadcast();
  });
  ipcMain.on('overlay:show-dps',event=>{
   if(!interactive||source(event)!=='controls')return;
   if(manualDpsReveal)manualDpsReveal=false;
   else{layout.dps={...layout.dps,enabled:true,collapsed:false};manualDpsReveal=!inCombat(lastState)&&layout.dps.autoHide!==false;}
   settingsOpen=false;resizeDps();persist();updateInput();broadcast();
  });
  ipcMain.on('overlay:auto-hide',(event,value)=>{
   if(!interactive||source(event)!=='dps'||typeof value!=='boolean')return;
   layout.dps={...layout.dps,autoHide:value};manualDpsReveal=false;persist();updateInput();broadcast();
  });
  ipcMain.on('overlay:mode',(event,value)=>{if(!interactive||source(event)!=='dps'||!['party','individual'].includes(value))return;layout.dps={...layout.dps,mode:value};persist();send('dps');});
  ipcMain.on('overlay:metric',(event,value)=>{if(!interactive||source(event)!=='dps'||!['damage','healing'].includes(value))return;layout.dps={...layout.dps,metric:value};persist();send('dps');});
  ipcMain.on('overlay:cube-action',(event,action)=>{
   if(!interactive||source(event)!=='cube')return;
   if(action==='hide'){layout.cube={...layout.cube,enabled:false};persist();updateInput();}
   else if(!cubeAlarm.command(action))return;
   syncCubeAlarm();broadcast();
  });
  ipcMain.on('overlay:drag',event=>{const panel=source(event);if(interactive&&panel){drag={panel,cursor:screen.getCursorScreenPoint(),bounds:windows.get(panel).getBounds()};diagnostics?.record('drag-start',{panel,source:'move'});}});
  ipcMain.on('overlay:resize',event=>{if(!interactive||source(event)!=='dps'||layout.dps?.collapsed||settingsOpen)return;const w=windows.get('dps'),area=screen.getDisplayMatching(w.getBounds()).workArea;drag={panel:'dps',resize:true,cursor:screen.getCursorScreenPoint(),bounds:boundsFor('dps',{...windowState('dps'),...position(w)},area),area};diagnostics?.record('drag-start',{panel:'dps',source:'resize'});});
  ipcMain.on('overlay:dashboard',event=>{if(source(event)&&interactive)openApplication();});
  ipcMain.handle('application:copy-text',(event,text)=>{
   if(!applicationWindow||event.sender!==applicationWindow.webContents||event.senderFrame!==event.sender.mainFrame||typeof text!=='string'||text.length>16000)throw Error('Geçersiz kopyalama isteği');
   clipboard.writeText(text);return true;
  });
  ipcMain.handle('application:show-pet-map',(event,selection)=>{
   if(!applicationWindow||event.sender!==applicationWindow.webContents||event.senderFrame!==event.sender.mainFrame)throw Error('Geçersiz uygulama isteği');
   if(!selection||typeof selection!=='object'||Array.isArray(selection))throw Error('Geçersiz pet haritası seçimi');
   return showPetMap(selection.petId,selection.mapId??null);
  });
  try{fs.unlinkSync(applicationRequest);}catch{}
  fs.writeFileSync(path.join(profile,'host.json'),JSON.stringify({version:require('../package.json').version,pid:process.pid,instanceId:paths.instanceId,root,dataDir:paths.dataDir,elevated:native.elevated(process.pid),runtime:{electron:process.versions.electron,koffi:require('koffi').version,mousePolicy:'native-v1'},features:['controls','dps-modes','transparency','compact-resize','quit-all','nonactivating-interaction','combat-auto-hide','cube-alarm-controls','cube-map-overlay','pet-map-overlay','healing-view','manual-dps-view','crash-diagnostics','native-mouse-policy','application-window','combat-details','local-history']}));
  try{fs.unlinkSync(quitRequest);}catch{}
  // A regular launcher cannot send Windows activation IPC to an elevated
  // instance. Fixed local open/quit requests work across that boundary and do
  // not start another Chromium process against the same profile.
  commandTimer=setInterval(()=>{if(fs.existsSync(quitRequest)){app.quit();return;}if(fs.existsSync(applicationRequest)){try{fs.unlinkSync(applicationRequest);}catch{return;}openApplication();}consumePetMapRequest();},200);
  createWindow('dps');createWindow('cube');createWindow('cube-map');createWindow('pet-map');createWindow('controls');createTray();poll();pollTimer=setInterval(poll,500);
  if(applicationRequested)openApplication();
  keyTimer=setInterval(updateInput,25);
  screen.on('display-removed',()=>{for(const [panel,w]of windows){const area=screen.getDisplayMatching(w.getBounds()).workArea;w.setBounds(boundsFor(panel,{...windowState(panel),...position(w)},area));}});
 }).catch(e=>{diagnostics?.error('startup-error',e);console.error(e);app.quit();});
 app.on('child-process-gone',(_event,details)=>diagnostics?.record('child-process-gone',{type:details.type,reason:details.reason,exitCode:details.exitCode}));
 app.on('window-all-closed',()=>app.quit());
 app.on('before-quit',()=>{diagnostics?.beforeQuit();clearInterval(pollTimer);clearInterval(keyTimer);clearInterval(commandTimer);clearTimeout(saveTimer);try{fs.writeFileSync(path.join(profile,'layout.json'),JSON.stringify(layout));if(JSON.parse(fs.readFileSync(path.join(profile,'host.json'),'utf8')).pid===process.pid)fs.unlinkSync(path.join(profile,'host.json'));fs.unlinkSync(quitRequest);}catch{}try{fs.unlinkSync(applicationRequest);}catch{}tray?.destroy();});
}
// Main-process exports permit tests of native window flags without injecting
// input into the user's game. They are not exposed to either renderer.
module.exports={windows,openApplication,showPetMap,setInteraction,stepDrag,collapse,resetLayout,setDesktopEdit,updateInput,getLayout:()=>layout,getTrayMenu:()=>trayMenu,pauseKeys:()=>clearInterval(keyTimer)};
