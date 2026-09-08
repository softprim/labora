const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('labora',Object.freeze({
  config:()=>ipcRenderer.invoke('config'),
  api:(method,path,body)=>ipcRenderer.invoke('api',{method,path,body}),
  connect:()=>ipcRenderer.invoke('connect'),
  send:message=>ipcRenderer.invoke('send',message),
  setServer:url=>ipcRenderer.invoke('set-server',url),
  project:()=>ipcRenderer.invoke('project'),
  stopProject:()=>ipcRenderer.invoke('stop-project'),
  projectFrame:frame=>ipcRenderer.send('project-frame',frame),
  onEvent:callback=>{const listener=(_event,data)=>callback(data);ipcRenderer.on('event',listener);return()=>ipcRenderer.removeListener('event',listener);}
}));
