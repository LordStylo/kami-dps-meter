const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('kamiOverlay',Object.freeze({
 init:()=>ipcRenderer.invoke('overlay:init'),
 onUpdate:callback=>{const listener=(_event,value)=>callback(value);ipcRenderer.on('overlay:update',listener);return()=>ipcRenderer.removeListener('overlay:update',listener);},
 collapse:()=>ipcRenderer.send('overlay:collapse'),
 drag:()=>ipcRenderer.send('overlay:drag'),
 dashboard:()=>ipcRenderer.send('overlay:dashboard')
}));
