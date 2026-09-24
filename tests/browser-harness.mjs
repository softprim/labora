// Development-only harness. Never bundled or started by the production server.
// Uses the REAL domain, API and WebSocket server with synthetic identities/media.
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve,extname,sep } from 'node:path';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { Store } from '../server/domain.mjs';
import { createApp } from '../server/index.mjs';
const store=new Store();store.bootstrap('Școală de test · date fictive','admin','browser-test-only-1234');const admin=store.data.users[0];
const lab=store.createLab(admin,{name:'Laborator informatică 1'});store.createLab(admin,{name:'Laborator informatică 2'});
store.createUser(admin,{name:'Profesor de test',username:'profesor',password:'browser-test-only-1234',role:'teacher',labIds:[lab.id]});
const enroll=(name,role)=>store.enroll(store.enrollment(admin,{name,role,labId:lab.id}).token);
const teacherDevice=enroll('Catedră','teacher'),studentDevice=enroll('PC-01','student');
for(let i=2;i<=12;i++)enroll(`PC-${String(i).padStart(2,'0')}`,'student');
const backend=createApp({store});backend.server.listen(0,'127.0.0.1');await once(backend.server,'listening');const base=`http://127.0.0.1:${backend.server.address().port}`;
const clients={teacher:{device:teacherDevice,queue:[]},student:{device:studentDevice,queue:[]},admin:{queue:[]}};
async function request(client,method,path,body){const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(client.token?{Authorization:`Bearer ${client.token}`}:{})},body:method==='GET'?undefined:JSON.stringify(body||{})});const data=await r.json();if(!r.ok)throw Error(data.error);return data;}
for(const [role,client]of Object.entries(clients)){
  if(role!=='student'){const result=await request(client,'POST','/api/login',{username:role==='admin'?'admin':'profesor',password:'browser-test-only-1234'});client.token=result.token;delete result.token;client.queue.push({type:'state',data:result});}
  if(client.device){client.ws=new WebSocket(base.replace('http','ws')+'/connect');client.ws.on('message',raw=>client.queue.push(JSON.parse(raw)));await once(client.ws,'open');client.ws.send(JSON.stringify({type:'auth',deviceToken:client.device.deviceToken,token:client.token}));}
}
const ui=resolve('desktop/ui');
const bridge=role=>`
const role=${JSON.stringify(role)};
let cb;
const NativePeer=window.RTCPeerConnection;
window.RTCPeerConnection=class extends NativePeer{
 constructor(options){super(options);let candidates=0;this.addEventListener('icecandidate',e=>{if(e.candidate)candidates++;});const timer=setInterval(async()=>{let frames=0;try{for(const r of (await this.getStats()).values())if(r.type==='inbound-rtp')frames+=r.framesDecoded||0;}catch{}let badge=document.querySelector('#test-media-status');if(!badge){badge=document.createElement('p');badge.id='test-media-status';badge.style='position:fixed;bottom:0;right:0;background:#fff1bd;color:#735300;padding:8px;z-index:40;font:11px monospace';document.body.appendChild(badge);}badge.textContent='TEST · WebRTC: '+this.connectionState+' · ICE: '+candidates+' · cadre decodate: '+frames;if(this.connectionState==='closed')clearInterval(timer);},1000);}
};
const call=async(path,body)=>{const r=await fetch('/test/'+role+'/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{})});const d=await r.json();if(!r.ok)throw Error(d.error);return d;};
window.labora={config:()=>call('config'),api:(method,path,body)=>call('api',{method,path,body}),connect:async()=>true,setServer:async()=>true,send:m=>call('send',m),project:()=>call('project'),stopProject:async()=>{cb?.({type:'projection-closed'});},projectFrame:frame=>call('frame',{length:frame.length}),onEvent:f=>{cb=f;return()=>{};}};
setTimeout(()=>{setInterval(async()=>{try{for(const m of await call('events'))cb?.(m);}catch{}},150);},600);
if(role==='student')Object.defineProperty(navigator,'mediaDevices',{value:{getDisplayMedia:async()=>{const c=document.createElement('canvas');c.width=1280;c.height=720;const ctx=c.getContext('2d');let frame=0;const timer=setInterval(()=>{ctx.fillStyle='#1c3647';ctx.fillRect(0,0,1280,720);ctx.fillStyle='#74d6b9';ctx.font='bold 48px sans-serif';ctx.fillText('CADRE DE TEST · WebRTC',80,140);ctx.fillStyle='#f3fbf8';ctx.font='28px sans-serif';ctx.fillText('Nu este captura unui calculator real.',80,215);ctx.fillText('Cadru '+(++frame),80,305);ctx.fillStyle='#6acbb0';ctx.fillRect(80+(frame*8)%950,440,110,100);},100);const stream=c.captureStream(10);stream.getVideoTracks()[0].addEventListener('ended',()=>clearInterval(timer));return stream;}}});
`;
const harness=http.createServer(async(req,res)=>{
  try{
    const u=new URL(req.url,'http://localhost');const pieces=u.pathname.split('/');
    if(u.searchParams.has('viewport')){const width=Number(u.searchParams.get('viewport'));if(![390,720,768,1024,1280].includes(width))throw Error('Invalid test viewport');res.setHeader('Content-Type','text/html');res.end(`<html><body style="margin:0;background:#dde3e7"><p style="font:14px sans-serif;padding:8px">TEST RESPONSIVE · ${width}px · date fictive</p><iframe title="Aplicația Labora" src="${['/admin','/student','/teacher'].includes(u.pathname)?u.pathname:'/admin'}" style="width:${width}px;height:1100px;border:0;background:white"></iframe></body></html>`);return;}
    if(pieces[1]==='test'){
      const client=clients[pieces[2]];if(!client)throw Error('Unknown test role');let text='';for await(const c of req)text+=c;const b=JSON.parse(text||'{}');let result;
      switch(pieces[3]){
        case 'config':if(client.token)client.queue.push({type:'state',data:await request(client,'GET','/api/state')});if(client.device)client.queue.push({type:'ready',device:{id:client.device.deviceId}});result={role:pieces[2],managed:true,deviceId:client.device?.deviceId,labId:lab.id,name:client.device?.name,serverUrl:base,platform:'test'};break;
        case 'api':result=await request(client,b.method,b.path,b.body);break;
        case 'events':result=client.queue.splice(0);break;
        case 'send':client.ws.send(JSON.stringify(b));result=true;break;
        case 'project':client.projected=true;result=true;break;
        case 'frame':client.frames=(client.frames||0)+1;result=true;break;
        case 'metrics':result={frames:client.frames||0,projected:!!client.projected};break;
        default:throw Error('Unknown operation');
      }
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));return;
    }
    if(u.pathname==='/bridge.js'){res.setHeader('Content-Type','application/javascript');res.end(bridge(u.searchParams.get('role')||'teacher'));return;}
    if(['/', '/teacher','/student','/admin'].includes(u.pathname)){
      const role=u.pathname.slice(1)||'teacher';let html=readFileSync(resolve(ui,'index.html'),'utf8');html=html.replace("connect-src 'self'","connect-src 'self'").replace('<script src="app.js">',`<script src="bridge.js?role=${role}"></script><script src="app.js">`);res.setHeader('Content-Type','text/html');res.end(html);return;
    }
    const file=resolve(ui,'.'+u.pathname);if(!file.startsWith(ui+sep))throw Error('Invalid path');res.setHeader('Content-Type',({'.js':'application/javascript','.css':'text/css','.html':'text/html'})[extname(file)]||'application/octet-stream');res.end(readFileSync(file));
  }catch(e){res.statusCode=400;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:e.message}));}
});
const portFlag=process.argv.indexOf('--port');const port=Number(portFlag>=0?process.argv[portFlag+1]:process.env.PORT||4311);
harness.listen(port,'0.0.0.0',()=>console.log(`TEST ONLY: http://0.0.0.0:${port}/teacher, /student, /admin`));
