const {app,BrowserWindow,ipcMain,screen,Menu,Tray,nativeImage,shell,session}=require('electron');
const fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const native=require('./windows.cjs');
const {boundsFor}=require('./layout.cjs');
const {interactionFor}=require('./interaction.cjs');
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
const windows=new Map(),ready=new Set();let tray,layout={},interactive=false,drag=null,lastState=null,connected=false,pollTimer,keyTimer,saveTimer,commandTimer,requestBusy=false,desktopEdit=false,hiddenByUser=false,gameProcesses=new Set(),gameCheckAt=0,returnGameWindow=null;
try{const value=JSON.parse(fs.readFileSync(path.join(profile,'layout.json'),'utf8'));if(value&&typeof value==='object')layout=value;}catch{}
const envelope=panel=>({panel,state:lastState,connected,interactive,desktopEdit,collapsed:panel==='dps'&&layout.dps?.collapsed===true});
function send(panel){const w=windows.get(panel);if(w&&!w.isDestroyed())w.webContents.send('overlay:update',envelope(panel));}
function broadcast(){for(const panel of windows.keys())send(panel);}
function persist(){clearTimeout(saveTimer);saveTimer=setTimeout(()=>{try{fs.writeFileSync(path.join(profile,'layout.json'),JSON.stringify(layout));}catch(e){console.error(e.message);}},200);}
function savePosition(panel){const w=windows.get(panel);if(!w||w.isDestroyed())return;const {x,y}=w.getBounds();layout[panel]={...layout[panel],x,y};persist();}
function setInteraction(value){
 value=!!value;if(value===interactive)return;interactive=value;
 if(!value&&!desktopEdit&&isOverlayForeground(native.input()))native.restoreGame(returnGameWindow,gameProcesses);
 for(const w of windows.values()){w.setIgnoreMouseEvents(!value,{forward:true});w.setFocusable(value);}
 if(!value)drag=null;broadcast();
}
function isOverlayForeground(input){return input.foregroundPid===process.pid&&[...windows.values()].some(w=>w.getNativeWindowHandle().readBigUInt64LE()===BigInt(input.foregroundWindow));}
function updateInput(){
 if(Date.now()-gameCheckAt>2000){gameProcesses=native.gamePids();gameCheckAt=Date.now();}
 const input=native.input(),directGame=gameProcesses.has(input.foregroundPid);
 if(directGame)returnGameWindow=input.foregroundWindow;
 const gameFocused=directGame||(!!returnGameWindow&&isOverlayForeground(input));
 const policy=interactionFor({gameFocused,alt:input.alt,desktopEdit,hiddenByUser}),visible=policy.visible;
 setInteraction(policy.interactive);
 if(!process.argv.includes('--test-overlay'))for(const [panel,w]of windows){if(!ready.has(panel))continue;if(visible&&!w.isVisible())w.showInactive();else if(!visible&&w.isVisible())w.hide();}
 const point=screen.getCursorScreenPoint();
 // A game can retain mouse capture even while drawing a cursor. Release that
 // capture by activating only the panel under the pointer while Alt is held.
 if(policy.interactive&&!process.argv.includes('--test-overlay'))for(const w of windows.values()){const b=w.getBounds();if(w.isVisible()&&point.x>=b.x&&point.x<b.x+b.width&&point.y>=b.y&&point.y<b.y+b.height&&!w.isFocused())w.focus();}
 stepDrag(point,input.left);
}
function setDesktopEdit(value){desktopEdit=!!value;hiddenByUser=false;updateInput();broadcast();}
function stepDrag(point,leftDown){
 if(!drag)return;if(!interactive||!leftDown){savePosition(drag.panel);drag=null;return;}
 const w=windows.get(drag.panel),b=w.getBounds(),area=screen.getDisplayNearestPoint(point).workArea;
 const x=Math.max(area.x,Math.min(drag.bounds.x+point.x-drag.cursor.x,area.x+area.width-b.width));
 const y=Math.max(area.y,Math.min(drag.bounds.y+point.y-drag.cursor.y,area.y+area.height-b.height));
 const target=boundsFor(drag.panel,{x,y,collapsed:layout[drag.panel]?.collapsed},area);
 w.setBounds(target,false);
}
function collapse(panel){
 if(panel!=='dps')return;
 layout.dps={...layout.dps,collapsed:!layout.dps?.collapsed};
 const w=windows.get(panel),area=screen.getDisplayMatching(w.getBounds()).workArea;
 w.setBounds(boundsFor(panel,{...w.getBounds(),collapsed:layout.dps.collapsed},area),false);
 savePosition(panel);send(panel);
}
function resetLayout(){
 layout={};const area=screen.getPrimaryDisplay().workArea;
 for(const [panel,w]of windows){w.setBounds(boundsFor(panel,null,area));savePosition(panel);send(panel);}updateInput();
}
function source(event){
 if(event.senderFrame!==event.sender.mainFrame)return null;
 for(const [panel,w]of windows)if(w.webContents===event.sender)return panel;
 return null;
}
async function poll(){
 if(requestBusy)return;requestBusy=true;
 try{const res=await fetch(origin+'/api/state',{signal:AbortSignal.timeout(1800)});if(!res.ok)throw Error('Local service unavailable');const s=await res.json();if(s.app!=='aion-dps-lab')throw Error('Unexpected service');lastState=s;connected=true;}
 catch{connected=false;}finally{requestBusy=false;broadcast();}
}
function createWindow(panel){
 const saved=layout[panel],area=saved&&Number.isFinite(saved.x)&&Number.isFinite(saved.y)?screen.getDisplayNearestPoint({x:Math.round(saved.x),y:Math.round(saved.y)}).workArea:screen.getPrimaryDisplay().workArea;
 const w=new BrowserWindow({...boundsFor(panel,saved,area),title:`Kami · ${panel==='dps'?'DPS':'Küp'}`,show:false,frame:false,thickFrame:false,transparent:true,backgroundColor:'#00000000',hasShadow:false,resizable:true,minimizable:false,maximizable:false,fullscreenable:false,focusable:false,skipTaskbar:true,alwaysOnTop:true,
  webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false,webSecurity:true}});
 windows.set(panel,w);w.setIgnoreMouseEvents(true,{forward:true});w.setAlwaysOnTop(true,'screen-saver');w.setMenu(null);
 // Keep programmatic resize available for collapsing. Prevent user resizing;
 // resizable:false also adds native size constraints at fractional Windows DPI.
 w.on('will-resize',event=>event.preventDefault());
 w.webContents.setWindowOpenHandler(()=>({action:'deny'}));w.webContents.on('will-navigate',e=>e.preventDefault());
 w.webContents.on('will-attach-webview',e=>e.preventDefault());
 w.on('move',()=>savePosition(panel));w.on('closed',()=>windows.delete(panel));
 w.once('ready-to-show',()=>{ready.add(panel);updateInput();send(panel);});
 w.loadFile(path.join(__dirname,'index.html'),{query:{panel}});
 return w;
}
function createTray(){
 const pixels=Buffer.alloc(20*20*4);for(let y=0;y<20;y++)for(let x=0;x<20;x++){const i=(y*20+x)*4,k=x===5&&y>=4&&y<=15||x>=6&&x<=13&&(y===19-x||y===x+1);pixels[i]=k?170:24;pixels[i+1]=k?235:30;pixels[i+2]=k?120:22;pixels[i+3]=255;}
 tray=new Tray(nativeImage.createFromBitmap(pixels,{width:20,height:20}));tray.setToolTip('Kami DPS · Alt ile taşı ve etkileş');
 tray.setContextMenu(Menu.buildFromTemplate([{label:'Masaüstünde düzenle',type:'checkbox',checked:false,click:item=>setDesktopEdit(item.checked)},{label:'Pencereleri oyunda göster',click:()=>{hiddenByUser=false;updateInput();}},{label:'Pencereleri gizle',click:()=>{hiddenByUser=true;updateInput();}},{label:'Konumları sıfırla',click:resetLayout},{label:'Tarayıcıda aç',click:()=>shell.openExternal(origin)},{type:'separator'},{label:'Overlay’i kapat',click:()=>app.quit()}]));
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
  ipcMain.on('overlay:drag',event=>{const panel=source(event);if(interactive&&panel)drag={panel,cursor:screen.getCursorScreenPoint(),bounds:windows.get(panel).getBounds()};});
  ipcMain.on('overlay:dashboard',event=>{if(source(event)&&interactive)shell.openExternal(origin);});
  fs.writeFileSync(path.join(profile,'host.json'),JSON.stringify({pid:process.pid,elevated:native.elevated(process.pid)}));
  try{fs.unlinkSync(quitRequest);}catch{}
  // A regular launcher cannot send Windows activation IPC to an elevated
  // instance. This local, quit-only request also works across that boundary.
  commandTimer=setInterval(()=>{if(fs.existsSync(quitRequest))app.quit();},200);
  createWindow('dps');createWindow('cube');createTray();poll();pollTimer=setInterval(poll,500);
  keyTimer=setInterval(updateInput,25);
  screen.on('display-removed',()=>{for(const [panel,w]of windows){const area=screen.getDisplayMatching(w.getBounds()).workArea;w.setBounds(boundsFor(panel,{...w.getBounds(),collapsed:layout[panel]?.collapsed},area));}});
 }).catch(e=>{console.error(e);app.quit();});
 app.on('window-all-closed',()=>app.quit());
 app.on('before-quit',()=>{clearInterval(pollTimer);clearInterval(keyTimer);clearInterval(commandTimer);clearTimeout(saveTimer);try{fs.writeFileSync(path.join(profile,'layout.json'),JSON.stringify(layout));if(JSON.parse(fs.readFileSync(path.join(profile,'host.json'),'utf8')).pid===process.pid)fs.unlinkSync(path.join(profile,'host.json'));fs.unlinkSync(quitRequest);}catch{}tray?.destroy();});
}
// Main-process exports permit tests of native window flags without injecting
// input into the user's game. They are not exposed to either renderer.
module.exports={windows,setInteraction,stepDrag,collapse,resetLayout,setDesktopEdit,updateInput,getLayout:()=>layout,pauseKeys:()=>clearInterval(keyTimer)};
