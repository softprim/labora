const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('projection',{
  onFrame:callback=>ipcRenderer.on('frame',(_event,frame)=>callback(frame))
});
