const {app,BrowserWindow,ipcMain,session,desktopCapturer,screen,powerMonitor}=require('electron');
const {readFileSync,existsSync}=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');
const WebSocket=require('ws');
const {pathToFileURL}=require('node:url');
const host=require('./host.cjs');
let win,projection,socket,config,authToken=null,lessonActive=false,controlActive=false,reconnectTimer,inputProcess;
let shuttingDown=false,locked=false,lastServerMessage=0,projectionApproved=false;
let serverState={running:false,restarts:0},serverLog=[];
const configPath=process.platform==='win32'?path.join(process.env.ProgramData||'C:\\ProgramData','Labora','device.json'):process.env.LABORA_DEVICE_CONFIG;
const indexPath=path.join(__dirname,'ui','index.html');
const localURL=pathToFileURL(indexPath).href;
function loadConfig(){
  if(configPath&&existsSync(configPath))return {...JSON.parse(readFileSync(configPath,'utf8').replace(/^\uFEFF/,'')),managed:true};
  return {serverUrl:'http://127.0.0.1:4310',role:'admin',managed:false};
}
// Calculatorul profesorului găzduiește serverul laboratorului: nu depinde de alt calculator.
function shouldHostServer(){return config.role==='teacher'&&config.managed&&process.env.LABORA_NO_HOST!=='1';}
function startHostedServer(){
  if(!shouldHostServer())return;
  host.start({
    onLog:line=>{serverLog=[...serverLog,line].slice(-100);emit({type:'server-log',line});},
    onState:st=>{serverState=st;emit({type:'server-state',...st});if(st.running)setTimeout(connect,1500);}
  });
}
function validateServer(url){
  const u=new URL(url);if(u.username||u.password||u.search||u.hash||u.pathname!=='/')throw Error('Adresa trebuie să conțină doar protocolul, serverul și portul.');
  if(u.protocol!=='https:'&&!(u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname)))throw Error('Folosiți HTTPS pentru rețeaua școlii.');
  return u.origin;
}
function trusted(event){if(event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame||event.senderFrame.url.split('?')[0]!==localURL)throw Error('IPC refuzat');}
function emit(data){if(win&&!win.isDestroyed())win.webContents.send('event',data);}
function stopInput(){controlActive=false;if(inputProcess){inputProcess.kill();inputProcess=null;}}
function stopMedia(){lessonActive=false;projectionApproved=false;stopInput();if(projection&&!projection.isDestroyed())projection.close();emit({type:'lesson-ended'});}
function input(event){
  if(!controlActive||!lessonActive||Date.now()-lastServerMessage>15000||process.platform!=='win32')return;
  const bridge=app.isPackaged?path.join(process.resourcesPath,'input-bridge','InputBridge.exe'):path.join(__dirname,'..','native','InputBridge','publish','InputBridge.exe');
  if(!existsSync(bridge)){emit({type:'error',message:'Componenta Windows de control nu este compilată.'});return;}
  if(!inputProcess){inputProcess=spawn(bridge,[],{stdio:['pipe','ignore','ignore'],windowsHide:true});inputProcess.on('error',()=>{inputProcess=null;emit({type:'error',message:'Controlul Windows nu a putut porni.'});});inputProcess.on('exit',()=>inputProcess=null);inputProcess.stdin.on('error',()=>{});}
  inputProcess.stdin.write(JSON.stringify(event)+'\n');
}
function connect(){
  clearTimeout(reconnectTimer);if(locked||shuttingDown||!config.deviceToken||(config.role==='teacher'&&!authToken))return;
  if(socket&&[WebSocket.OPEN,WebSocket.CONNECTING].includes(socket.readyState))return;
  const url=new URL('/connect',config.serverUrl);url.protocol=url.protocol==='https:'?'wss:':'ws:';
  const ws=new WebSocket(url);socket=ws;
  ws.on('open',()=>{lastServerMessage=Date.now();ws.send(JSON.stringify({type:'auth',deviceToken:config.deviceToken,token:authToken}));});
  ws.on('ping',()=>lastServerMessage=Date.now());
  ws.on('message',raw=>{
    lastServerMessage=Date.now();let m;try{m=JSON.parse(raw);}catch{return;}
    if(m.type==='lesson-started')lessonActive=true;
    if(m.type==='lesson-ended')stopMedia();
    if(m.type==='control'){controlActive=!!m.enabled;if(!controlActive)stopInput();}
    if(m.type==='input'){input(m.event);return;}
    if(m.type==='project-approved')projectionApproved=true;
    emit(m);
  });
  ws.on('error',()=>emit({type:'error',message:'Serverul nu este disponibil sau certificatul nu este valid.'}));
  ws.on('close',code=>{stopMedia();emit({type:'disconnected'});if(code===4001&&config.role==='teacher'){authToken=null;emit({type:'auth-expired'});}if(!shuttingDown&&![4001,4003].includes(code))reconnectTimer=setTimeout(connect,3000);});
}
const allowed=new Map([['POST /api/login',true],['POST /api/logout',true],['GET /api/state',true],['POST /api/labs',true],['POST /api/users',true],['POST /api/enrollments',true],['PUT /api/layout',true],['PUT /api/room-shape',true],['POST /api/revoke',true],['GET /api/audit',true]]);
if(!app.requestSingleInstanceLock())app.quit();
app.on('second-instance',()=>{if(win){win.show();win.focus();}});
app.whenReady().then(()=>{
  config=loadConfig();config.serverUrl=validateServer(config.serverUrl);
  win=new BrowserWindow({width:1440,height:960,minWidth:720,minHeight:600,title:'Labora',backgroundColor:'#f4f6fa',webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true}});
  win.setMenu(null);win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',event=>event.preventDefault());
  session.defaultSession.setPermissionRequestHandler((wc,permission,callback)=>callback(wc===win.webContents&&permission==='display-capture'&&config.role==='student'&&lessonActive));
  session.defaultSession.setDisplayMediaRequestHandler(async(request,callback)=>{
    try{if(config.role!=='student'||!lessonActive||request.frame!==win.webContents.mainFrame){callback({});return;}
      const sources=await desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:0,height:0}});
      const primary=screen.getPrimaryDisplay();const source=sources.find(s=>s.display_id===String(primary.id));
      if(!source||!lessonActive){callback({});return;}callback({video:source});
    }catch{callback({});}
  });
  ipcMain.handle('config',event=>{trusted(event);return {role:config.role,managed:config.managed,serverUrl:config.serverUrl,name:config.name,labId:config.labId,deviceId:config.deviceId,platform:process.platform};});
  ipcMain.handle('set-server',(event,url)=>{trusted(event);if(config.managed)throw Error('Configurația este administrată de IT.');config.serverUrl=validateServer(url);authToken=null;return true;});
  ipcMain.handle('api',async(event,{method,path:route,body})=>{
    trusted(event);if(config.role==='student'||!allowed.has(`${method} ${route}`))throw Error('Operație nepermisă.');
    const response=await fetch(new URL(route,config.serverUrl),{method,headers:{'Content-Type':'application/json',...(authToken?{Authorization:`Bearer ${authToken}`}:{})},body:method==='GET'?undefined:JSON.stringify(body||{}),signal:AbortSignal.timeout(10000),redirect:'error'});
    const data=await response.json();if(!response.ok)throw Error(data.error||'Cererea a eșuat.');
    if(route==='/api/login'){authToken=data.token;delete data.token;}
    if(route==='/api/logout'){authToken=null;clearTimeout(reconnectTimer);socket?.close(1000);stopMedia();}
    return data;
  });
  ipcMain.handle('connect',event=>{trusted(event);connect();return true;});
  ipcMain.handle('server-status',event=>{trusted(event);return {hosting:shouldHostServer(),...serverState,log:serverLog.slice(-30)};});
  // Căutarea serverului în LAN: elimină tastarea adreselor la configurarea laboratorului.
  ipcMain.handle('discover',async event=>{
    trusted(event);if(config.managed)throw Error('Configurația este administrată de IT.');
    const {discover}=await import(pathToFileURL(path.join(__dirname,'..','server','discovery.mjs')).href);
    return await discover({timeout:3000});
  });
  ipcMain.handle('send',(event,message)=>{trusted(event);if(!socket||socket.readyState!==WebSocket.OPEN)throw Error('Conexiune întreruptă.');if(JSON.stringify(message).length>65000)throw Error('Mesaj prea mare.');if(message.type==='auth')throw Error('Mesaj nepermis.');socket.send(JSON.stringify(message));return true;});
  ipcMain.handle('project',event=>{
    trusted(event);if(config.role!=='teacher'||!lessonActive||!projectionApproved)throw Error('Selectați un ecran în timpul orei.');
    if(projection&&!projection.isDestroyed()){projection.focus();return true;}
    const display=screen.getAllDisplays().find(d=>d.id!==screen.getPrimaryDisplay().id);
    if(!display)throw Error('Nu este detectat un ecran secundar. Configurați Windows → Extindere.');
    projection=new BrowserWindow({x:display.bounds.x,y:display.bounds.y,width:display.bounds.width,height:display.bounds.height,fullscreen:true,autoHideMenuBar:true,backgroundColor:'#080d19',webPreferences:{preload:path.join(__dirname,'projection-preload.cjs'),contextIsolation:true,sandbox:true,nodeIntegration:false}});
    projection.webContents.setWindowOpenHandler(()=>({action:'deny'}));projection.webContents.on('will-navigate',e=>e.preventDefault());
    projection.loadFile(path.join(__dirname,'ui','projection.html'));projection.on('closed',()=>{projection=null;projectionApproved=false;emit({type:'projection-closed'});});return true;
  });
  ipcMain.handle('stop-project',event=>{trusted(event);projection?.close();return true;});
  ipcMain.on('project-frame',(event,frame)=>{trusted(event);if(lessonActive&&projectionApproved&&projection&&!projection.isDestroyed()&&typeof frame==='string'&&frame.startsWith('data:image/jpeg;base64,')&&frame.length<1500000)projection.webContents.send('frame',frame);});
  powerMonitor.on('lock-screen',()=>{locked=true;socket?.close();stopMedia();});powerMonitor.on('unlock-screen',()=>{locked=false;connect();});
  powerMonitor.on('suspend',()=>{locked=true;socket?.close();stopMedia();});powerMonitor.on('resume',()=>{locked=false;connect();});
  setInterval(()=>{if(socket?.readyState===WebSocket.OPEN&&Date.now()-lastServerMessage>25000){socket.terminate();stopMedia();}},5000).unref();
  win.loadFile(indexPath);win.webContents.on('did-finish-load',()=>{startHostedServer();if(config.role==='student')connect();});
});
app.on('before-quit',()=>{shuttingDown=true;clearTimeout(reconnectTimer);socket?.close();stopInput();host.stop();});
app.on('window-all-closed',()=>app.quit());
