const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('kamiApplication',Object.freeze({
 copyText:text=>ipcRenderer.invoke('application:copy-text',text),
 showPetMap:payload=>ipcRenderer.invoke('application:show-pet-map',payload),
}));
