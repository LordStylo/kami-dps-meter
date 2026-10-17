const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('kamiOverlay',Object.freeze({
 init:()=>ipcRenderer.invoke('overlay:init'),
 onUpdate:callback=>{const listener=(_event,value)=>callback(value);ipcRenderer.on('overlay:update',listener);return()=>ipcRenderer.removeListener('overlay:update',listener);},
 collapse:()=>ipcRenderer.send('overlay:collapse'),
 settings:()=>ipcRenderer.send('overlay:settings'),
 transparency:value=>ipcRenderer.send('overlay:transparency',value),
 controls:()=>ipcRenderer.send('overlay:controls'),
 togglePanel:panel=>ipcRenderer.send('overlay:toggle-panel',panel),
 showDps:()=>ipcRenderer.send('overlay:show-dps'),
 autoHide:value=>ipcRenderer.send('overlay:auto-hide',value),
 mode:value=>ipcRenderer.send('overlay:mode',value),
 metric:value=>ipcRenderer.send('overlay:metric',value),
 cubeAction:action=>ipcRenderer.send('overlay:cube-action',action),
 drag:()=>ipcRenderer.send('overlay:drag'),
 resize:()=>ipcRenderer.send('overlay:resize'),
 dashboard:()=>ipcRenderer.send('overlay:dashboard')
}));
