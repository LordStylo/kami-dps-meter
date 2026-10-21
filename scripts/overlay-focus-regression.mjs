// Runs in the isolated smoke app. Real native no-activation flags are checked,
// but foreground/key readings and visibility are simulated. No system input
// or window activation is sent to the game or the user's other applications.
export async function checkFocusTransitions(app,nativeFile){
 return app.evaluate(async({screen,ipcMain},filename)=>{
  const meter=globalThis.overlayForTest,native=process.mainModule.require(filename);
  const original={input:native.input,gamePids:native.gamePids,cursor:screen.getCursorScreenPoint,argv:[...process.argv]};
  const originals=new Map(),visible=new Map(),panels=[...meter.windows.keys()],savedEnabled=new Map();
  const enabled=panel=>['cube-map','pet-map'].includes(panel)?meter.getLayout()[panel]?.enabled===true:meter.getLayout()[panel]?.enabled!==false;
  const wc=meter.windows.get('controls').webContents,event={sender:wc,senderFrame:wc.mainFrame};
  const game={foregroundPid:424242,foregroundWindow:987654,alt:false,left:false,tab:false,escape:false,windows:false};
  let current={...game},activationCalls=0;
  function check(condition,message){if(!condition)throw Error(message);}
  function tick(patch={}){current={...current,...patch};meter.updateInput();}
  function noFocus(){
   check(activationCalls===0,'Overlay tried to activate a window');
   check([...meter.windows.values()].every(w=>!w.isFocusable()),'An interactive panel became focusable');
  }
  try{
   native.input=()=>({...current});native.gamePids=()=>new Set([game.foregroundPid]);
   screen.getCursorScreenPoint=()=>({x:50,y:50});
   for(const [panel,w]of meter.windows){
    visible.set(panel,false);
    const saved={};for(const key of ['getBounds','isVisible','showInactive','hide','focus'])saved[key]=w[key];originals.set(w,saved);
    // Deliberately overlap every native panel, including the optional map.
    w.getBounds=()=>({x:0,y:0,width:100,height:100});
    w.isVisible=()=>visible.get(panel);w.showInactive=()=>visible.set(panel,true);w.hide=()=>visible.set(panel,false);
    w.focus=()=>{activationCalls++;};
   }
   await new Promise(resolve=>setTimeout(resolve,2100));
   process.argv=process.argv.filter(arg=>arg!=='--test-overlay');
   meter.setDesktopEdit(false);tick({alt:true});
   // A manually hidden map is valid production state. Enable each optional
   // panel through the actual controls IPC before asserting focus visibility,
   // and restore those preferences when this isolated check ends.
   for(const panel of panels.filter(panel=>panel!=='controls')){
    savedEnabled.set(panel,enabled(panel));
    // The optional pet control requires an explicit catalog selection.
    if(panel==='pet-map'&&!meter.getLayout()[panel]?.petId)meter.showPetMap(1016);
    if(!enabled(panel))ipcMain.emit('overlay:toggle-panel',event,panel);
    check(enabled(panel),panel+' could not be enabled for the focus check');
   }
   for(let i=0;i<100;i++)tick();noFocus();
   for(const panel of panels.filter(panel=>panel!=='controls')){
    const wasEnabled=enabled(panel);
    ipcMain.emit('overlay:toggle-panel',event,panel);
    check(visible.get(panel)!==wasEnabled,'Panel toggle did not update visibility: '+panel);
    ipcMain.emit('overlay:toggle-panel',event,panel);
    check(visible.get(panel)===wasEnabled,'Panel toggle did not restore visibility: '+panel);
   }
   for(const panel of panels){
    tick({...game});tick({alt:true});noFocus();
    const page=meter.windows.get(panel).webContents;
    check((await page.executeJavaScript('window.kamiOverlay.init()')).interactive,panel+' cannot receive mouse input');
    tick({tab:true}); // Windows has not changed foreground ownership yet.
    check([...visible.values()].every(value=>!value),'Overlay stayed active during Alt+Tab');
    tick({tab:false});tick({...game,alt:true});
    check([...visible.values()].every(value=>!value),'App-switch gesture re-enabled interaction');
    tick({foregroundPid:333333,foregroundWindow:456789,alt:false});
    for(let i=0;i<100;i++)tick();
    check([...visible.values()].every(value=>!value),'Overlay stayed visible on desktop');noFocus();
    check(!(await page.executeJavaScript('window.kamiOverlay.init()')).interactive,'Desktop still accepts panel clicks');
   }
   tick({...game});tick({alt:true});tick({alt:false});noFocus();
   check([...visible.values()].every(Boolean),'Ordinary Alt release hid enabled panels');
   tick({foregroundPid:333333,foregroundWindow:456789});meter.setDesktopEdit(true);
   for(let i=0;i<100;i++)tick();noFocus();
   return {panels:panels.length,altTab:'all panels hidden and mouse input disabled',overlap:'100 ticks without activation',plainAltRelease:'all enabled panels visible without activation',desktopEdit:'interactive without activation',activationCalls};
  }finally{
   process.argv=original.argv;native.input=original.input;native.gamePids=original.gamePids;screen.getCursorScreenPoint=original.cursor;
   for(const [w,saved]of originals)Object.assign(w,saved);
   meter.setDesktopEdit(true);
   for(const [panel,value]of savedEnabled)if(enabled(panel)!==value)ipcMain.emit('overlay:toggle-panel',event,panel);
  }
 },nativeFile);
}
