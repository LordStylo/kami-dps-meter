const {app,BrowserWindow,ipcMain,screen,Menu,Tray,nativeImage,shell,session,dialog}=require('electron');
const fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const native=require('./windows.cjs');
const {allowMouseWithoutActivation}=require('./mouse-window.cjs');
const {boundsFor,transparencyFor,resizeBounds}=require('./layout.cjs');
const {panelVisible}=require('./interaction.cjs');
const {FocusSession}=require('./focus.cjs');
const {shutdownBackend}=require('./shutdown.cjs');
const {CubeAlarm}=require('./cube-alarm.cjs');
const {createDiagnostics}=require('./diagnostics.cjs');
const root=path.resolve(__dirname,'..');
const option=name=>process.argv.find(x=>x.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const port=Number(option('port')||4317);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid local server port');
const origin=`http://127.0.0.1:${port}`;
const profile=path.resolve(option('profile')||path.join(root,'settings',`overlay-${port}`));
const quitRequest=path.join(profile,'quit.request');
fs.mkdirSync(path.join(profile,'browser'),{recursive:true});app.setPath('userData',path.join(profile,'browser'));
app.setName('Kami DPS Overlay');
const quitting=process.argv.includes('--quit-overlay');
if(quitting)fs.writeFileSync(quitRequest,'quit');
const owned=app.requestSingleInstanceLock({command:quitting?'quit':'show'});
const diagnostics=owned&&!quitting?createDiagnostics({directory:profile}):null;
diagnostics?.attachProcess();
diagnostics?.record('runtime',{electron:process.versions.electron,node:process.versions.node,koffi:require('koffi').version});
const windows=new Map(),ready=new Set(),focusSession=new FocusSession();let tray,layout={},interactive=false,drag=null,lastState=null,connected=false,pollTimer,keyTimer,saveTimer,commandTimer,requestBusy=false,desktopEdit=false,hiddenByUser=false,gameProcesses=new Set(),gameCheckAt=0;
try{const value=JSON.parse(fs.readFileSync(path.join(profile,'layout.json'),'utf8'));if(value&&typeof value==='object')layout=value;}catch{}
let settingsOpen=false,controlsOpen=false,suppressControlClickUntil=0,trayMenu,closingAll=false,manualDpsReveal=false;
const inCombat=state=>state?.combat?.active??(state?.current?.damage>0);
const cubeAlarm=new CubeAlarm();
const envelope=panel=>({panel,state:lastState,connected,interactive,desktopEdit,collapsed:panel==='dps'&&layout.dps?.collapsed===true,settingsOpen:panel==='dps'&&settingsOpen,transparency:panel==='dps'?transparencyFor(layout.dps?.transparency):8,
 controlsOpen:panel==='controls'&&controlsOpen,autoHide:layout.dps?.autoHide!==false,manualDpsReveal,panels:{dps:layout.dps?.enabled!==false,cube:layout.cube?.enabled!==false},cubeAlarm:cubeAlarm.snapshot(),metric:layout.dps?.metric==='healing'?'healing':'damage',dpsMode:layout.dps?.mode==='individual'?'individual':'party'});
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
async function poll(){
 if(requestBusy)return;requestBusy=true;
 try{const res=await fetch(origin+'/api/state',{signal:AbortSignal.timeout(1800)});if(!res.ok)throw Error('Local service unavailable');const s=await res.json();if(s.app!=='aion-dps-lab')throw Error('Unexpected service');if(inCombat(s))manualDpsReveal=false;lastState=s;connected=true;}
 catch{connected=false;}finally{requestBusy=false;syncCubeAlarm();broadcast();}
}
function syncCubeAlarm(){
 if(cubeAlarm.update(lastState,connected)){
  layout.cube={...layout.cube,enabled:true};persist();updateInput();
 }
}
function createWindow(panel){
 const saved=windowState(panel),area=saved&&Number.isFinite(saved.x)&&Number.isFinite(saved.y)?screen.getDisplayNearestPoint({x:Math.round(saved.x),y:Math.round(saved.y)}).workArea:screen.getPrimaryDisplay().workArea;
 const w=new BrowserWindow({...boundsFor(panel,saved,area),title:`Kami · ${{dps:'DPS',cube:'Küp',controls:'Arayüz'}[panel]}`,show:false,frame:false,thickFrame:false,transparent:true,backgroundColor:'#00000000',hasShadow:false,resizable:true,minimizable:false,maximizable:false,fullscreenable:false,focusable:false,skipTaskbar:true,alwaysOnTop:true,
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
 trayMenu=Menu.buildFromTemplate([{label:'Masaüstünde düzenle',type:'checkbox',checked:false,click:item=>setDesktopEdit(item.checked)},{label:'Pencereleri oyunda göster',click:()=>{hiddenByUser=false;updateInput();}},{label:'Pencereleri gizle',click:()=>{hiddenByUser=true;updateInput();}},{label:'Konumları sıfırla',click:resetLayout},{label:'Tarayıcıda aç',click:()=>shell.openExternal(origin)},{type:'separator'},{label:'Overlay’i kapat (veri toplama sürer)',click:()=>app.quit()},{id:'quit-all',label:'Tamamen kapat',click:item=>{void quitAll(item);}}]);
 tray.setContextMenu(trayMenu);
 tray.on('double-click',()=>{hiddenByUser=false;updateInput();});
}
if(!owned||quitting){app.quit();}
else{
 app.on('second-instance',(_e,_argv,_cwd,data)=>{if(data?.command==='quit')app.quit();else{hiddenByUser=false;updateInput();}});
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
  ipcMain.on('overlay:toggle-panel',(event,panel)=>{if(!interactive||source(event)!=='controls'||!['dps','cube'].includes(panel))return;layout[panel]={...layout[panel],enabled:layout[panel]?.enabled===false};if(panel==='dps'){manualDpsReveal=layout.dps.enabled&&!inCombat(lastState)&&layout.dps.autoHide!==false;if(!layout.dps.enabled)settingsOpen=false;}persist();updateInput();broadcast();});
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
  ipcMain.on('overlay:dashboard',event=>{if(source(event)&&interactive)shell.openExternal(origin);});
  fs.writeFileSync(path.join(profile,'host.json'),JSON.stringify({pid:process.pid,elevated:native.elevated(process.pid),runtime:{electron:process.versions.electron,koffi:require('koffi').version,mousePolicy:'native-v1'},features:['controls','dps-modes','transparency','compact-resize','quit-all','nonactivating-interaction','combat-auto-hide','cube-alarm-controls','healing-view','manual-dps-view','crash-diagnostics','native-mouse-policy']}));
  try{fs.unlinkSync(quitRequest);}catch{}
  // A regular launcher cannot send Windows activation IPC to an elevated
  // instance. This local, quit-only request also works across that boundary.
  commandTimer=setInterval(()=>{if(fs.existsSync(quitRequest))app.quit();},200);
  createWindow('dps');createWindow('cube');createWindow('controls');createTray();poll();pollTimer=setInterval(poll,500);
  keyTimer=setInterval(updateInput,25);
  screen.on('display-removed',()=>{for(const [panel,w]of windows){const area=screen.getDisplayMatching(w.getBounds()).workArea;w.setBounds(boundsFor(panel,{...windowState(panel),...position(w)},area));}});
 }).catch(e=>{diagnostics?.error('startup-error',e);console.error(e);app.quit();});
 app.on('child-process-gone',(_event,details)=>diagnostics?.record('child-process-gone',{type:details.type,reason:details.reason,exitCode:details.exitCode}));
 app.on('window-all-closed',()=>app.quit());
 app.on('before-quit',()=>{diagnostics?.beforeQuit();clearInterval(pollTimer);clearInterval(keyTimer);clearInterval(commandTimer);clearTimeout(saveTimer);try{fs.writeFileSync(path.join(profile,'layout.json'),JSON.stringify(layout));if(JSON.parse(fs.readFileSync(path.join(profile,'host.json'),'utf8')).pid===process.pid)fs.unlinkSync(path.join(profile,'host.json'));fs.unlinkSync(quitRequest);}catch{}tray?.destroy();});
}
// Main-process exports permit tests of native window flags without injecting
// input into the user's game. They are not exposed to either renderer.
module.exports={windows,setInteraction,stepDrag,collapse,resetLayout,setDesktopEdit,updateInput,getLayout:()=>layout,getTrayMenu:()=>trayMenu,pauseKeys:()=>clearInterval(keyTimer)};
