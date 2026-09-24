import http from 'node:http';
import https from 'node:https';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { Store, Fault, requireThat, verifyPassword, secret, digest, ADMIN_ROLES } from './domain.mjs';

export function createApp({store=new Store(),tls,host='127.0.0.1'}={}) {
  requireThat(tls || ['127.0.0.1','::1','localhost'].includes(host),500,'HTTPS obligatoriu pentru acces în rețea.');
  const sessions=new Map(), peers=new Map(), lessons=new Map(), helps=new Map(), rates=new Map();
  const send=(ws,data)=>{if(ws?.readyState===WebSocket.OPEN && ws.bufferedAmount<1024*1024) ws.send(JSON.stringify(data));};
  const publicDevice=d=>({id:d.id,name:d.name,role:d.role,labId:d.labId,online:peers.has(d.id),help:helps.get(d.id)||null});
  const state=(actor)=>({school:store.data.schools.find(x=>x.id===actor.schoolId),user:{id:actor.id,name:actor.name,role:actor.role},labs:store.data.labs.filter(x=>x.schoolId===actor.schoolId && (actor.role==='admin'||actor.labIds?.includes(x.id))).map(l=>({...l,lesson:lessons.has(l.id)?{teacher:lessons.get(l.id).teacherName,owned:lessons.get(l.id).userId===actor.id}:null,devices:store.data.devices.filter(d=>d.labId===l.id&&!d.revoked).map(publicDevice)}))});
  const broadcast=()=>{for(const p of peers.values()) if(p.actor) send(p.ws,{type:'state',data:state(p.actor)});};
  const stopLesson=labId=>{
    const lesson=lessons.get(labId); if(!lesson)return;
    lessons.delete(labId);
    for(const p of peers.values())if(p.device.labId===labId)send(p.ws,{type:'lesson-ended'});
    store.audit({id:lesson.userId,schoolId:lesson.schoolId},'lesson.end',labId,labId); broadcast();
  };
  const sessionActor=token=>{const s=typeof token==='string'&&sessions.get(digest(token)); return s&&s.expires>Date.now()?store.data.users.find(u=>u.id===s.userId):null;};
  function rate(key,max=120,window=60000) { const now=Date.now(); let r=rates.get(key);if(!r||now-r.start>window){r={start:now,n:0};rates.set(key,r);}requireThat(++r.n<=max,429,'Prea multe cereri. Încercați mai târziu.'); }
  async function body(req) {let data='';for await(const chunk of req){data+=chunk;requireThat(Buffer.byteLength(data)<=65536,413,'Cerere prea mare.');}try{return JSON.parse(data||'{}');}catch{throw new Fault(400,'JSON invalid.');}}
  const handler=async(req,res)=>{
    res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    try{
      rate(`http:${req.socket.remoteAddress}`,600);
      const url=new URL(req.url,'http://localhost'); const path=url.pathname;
      if(req.method==='GET'&&path==='/health'){res.end(JSON.stringify({ok:true,version:'0.1.0'}));return;}
      requireThat(!req.headers.origin || req.headers.origin==='null',403,'Origine nepermisă.');
      const b=req.method==='GET'?{}:await body(req); let result;
      if(req.method==='POST'&&path==='/api/login'){
        rate(`login:${req.socket.remoteAddress}`,15);const user=store.data.users.find(x=>x.username===String(b.username).toLowerCase());
        // Perform the same expensive KDF for unknown users to reduce username timing leaks.
        const encoded=user?.passwordHash||store.data.users[0]?.passwordHash;
        const valid=encoded&&verifyPassword(b.password,encoded);requireThat(user&&valid,401,'Utilizator sau parolă incorectă.');
        const token=secret();sessions.set(digest(token),{userId:user.id,expires:Date.now()+8*60*60*1000});
        store.audit(user,'auth.login',user.id);result={token,...state(user)};
      }else if(req.method==='POST'&&path==='/api/enroll'){
        rate(`enroll:${req.socket.remoteAddress}`,20);result=store.enroll(b.token);
      }else{
        const token=req.headers.authorization?.replace(/^Bearer /,''); const actor=sessionActor(token);requireThat(actor,401,'Autentificare necesară.');
        if(req.method==='GET'&&path==='/api/state')result=state(actor);
        else if(req.method==='POST'&&path==='/api/logout'){
          sessions.delete(digest(token)); for(const p of peers.values())if(p.token===token)p.ws.close(4001,'Logout');result={ok:true};
        }else if(req.method==='POST'&&path==='/api/labs')result=store.createLab(actor,b);
        else if(req.method==='POST'&&path==='/api/users')result=store.createUser(actor,b);
        else if(req.method==='POST'&&path==='/api/enrollments')result=store.enrollment(actor,b);
        else if(req.method==='PUT'&&path==='/api/layout')result=store.layout(actor,b.labId,b.layout);
        else if(req.method==='PUT'&&path==='/api/room-shape')result=store.shape(actor,b.labId,b.columns,b.rows);
        else if(req.method==='POST'&&path==='/api/revoke'){
          const d=store.data.devices.find(x=>x.id===b.deviceId&&x.schoolId===actor.schoolId);requireThat(d,404);
          store.admin(actor,d.labId);
          d.revoked=true;peers.get(d.id)?.ws.close(4003,'Revoked');helps.delete(d.id);store.audit(actor,'device.revoke',d.id,d.labId);result={ok:true};
        }else if(req.method==='GET'&&path==='/api/audit') {
          requireThat(ADMIN_ROLES.includes(actor.role),403,'Doar administratorul poate vedea jurnalul.');
          const own=actor.role==='admin'?null:new Set(actor.labIds||[]);
          const visible=x=>!own||(x.labId?own.has(x.labId):x.actorId===actor.id);
          result=store.data.audit.filter(x=>x.schoolId===actor.schoolId&&visible(x)).slice(-200);
        }
        else throw new Fault(404,'Ruta nu există.');
      }
      broadcast();res.end(JSON.stringify(result));
    }catch(e){res.statusCode=e.status||500;res.end(JSON.stringify({error:e.status?e.message:'Eroare internă.'}));}
  };
  const server=tls?https.createServer(tls,handler):http.createServer(handler);
  const wss=new WebSocketServer({server,path:'/connect',maxPayload:65536});
  wss.on('connection',(ws,req)=>{
    if(req.headers.origin && req.headers.origin!=='null'){ws.close(4003);return;}
    let peer; const timer=setTimeout(()=>ws.close(4001,'Authenticate'),5000);
    ws.alive=true;ws.on('pong',()=>ws.alive=true);
    ws.on('message',raw=>{
      try{
        rate(`ws:${req.socket.remoteAddress}`,12000);const m=JSON.parse(raw);
        if(!peer){
          requireThat(m.type==='auth',401);const device=store.device(m.deviceToken);requireThat(device,401,'Dispozitiv neînregistrat.');
          const actor=device.role==='teacher'?sessionActor(m.token):null;
          if(device.role==='teacher'){requireThat(actor,401);store.lab(actor,device.labId);}
          requireThat(!peers.has(device.id),409,'Dispozitiv deja conectat.');
          peer={ws,device,actor,token:m.token};peers.set(device.id,peer);clearTimeout(timer);
          send(ws,{type:'ready',device:publicDevice(device)});if(actor)send(ws,{type:'state',data:state(actor)});
          const lesson=lessons.get(device.labId);if(lesson&&device.role==='student')send(ws,{type:'lesson-started',teacherId:lesson.deviceId,teacherName:lesson.teacherName});
          broadcast();return;
        }
        requireThat(!peer.device.revoked,403);
        if(peer.actor)requireThat(sessionActor(peer.token),401,'Sesiune expirată.');
        const labId=peer.device.labId;const lesson=lessons.get(labId);
        if(m.type==='lesson-start'){
          requireThat(peer.actor,403);requireThat(!lesson,409,'Laboratorul are deja o oră activă.');
          lessons.set(labId,{deviceId:peer.device.id,userId:peer.actor.id,schoolId:peer.actor.schoolId,teacherName:peer.actor.name,control:null});
          store.audit(peer.actor,'lesson.start',labId,labId);
          for(const p of peers.values())if(p.device.labId===labId&&(p.device.role==='student'||p===peer))send(p.ws,{type:'lesson-started',teacherId:peer.device.id,teacherName:peer.actor.name});broadcast();return;
        }
        if(m.type==='lesson-stop'){requireThat(lesson?.deviceId===peer.device.id,403);stopLesson(labId);return;}
        if(m.type==='help') {requireThat(peer.device.role==='student',403);rate(`help:${peer.device.id}`,5);helps.set(peer.device.id,{at:Date.now(),message:String(m.message||'Am nevoie de ajutor').slice(0,300)});broadcast();return;}
        requireThat(lesson,403,'Porniți mai întâi ora.');
        if(m.type==='frame'){
          requireThat(peer.device.role==='student',403);
          requireThat(typeof m.frame==='string'&&m.frame.length<=60000&&/^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/=]+$/.test(m.frame));
          rate(`frame:${peer.device.id}`,180);
          send(peers.get(lesson.deviceId)?.ws,{type:'frame',from:peer.device.id,frame:m.frame});return;
        }
        if(m.type==='signal'){
          const target=peers.get(m.to);requireThat(target&&target.device.labId===labId,403);
          const validPair=(peer.device.id===lesson.deviceId&&target.device.role==='student')||(peer.device.role==='student'&&target.device.id===lesson.deviceId);
          requireThat(validPair,403);requireThat(m.signal && ['offer','answer','candidate'].includes(m.signal.kind));
          send(target.ws,{type:'signal',from:peer.device.id,signal:m.signal});return;
        }
        requireThat(peer.device.id===lesson.deviceId,403);
        if(m.type==='control-stop'){
          if(lesson.control)send(peers.get(lesson.control)?.ws,{type:'control',enabled:false});lesson.control=null;send(ws,{type:'control-stopped'});return;
        }
        const target=peers.get(m.to);requireThat(target&&target.device.labId===labId&&target.device.role==='student',403);
        if(m.type==='control-start'){
          if(lesson.control)send(peers.get(lesson.control)?.ws,{type:'control',enabled:false});lesson.control=m.to;
          store.audit(peer.actor,'control.start',m.to,labId);send(target.ws,{type:'control',enabled:true});send(ws,{type:'control-started',deviceId:m.to});
        }else if(m.type==='input'){
          requireThat(lesson.control===m.to,403);requireThat(validInput(m.event));send(target.ws,{type:'input',event:m.event});
        }else if(m.type==='message'){
          requireThat(typeof m.text==='string'&&m.text.length>0&&m.text.length<=500);send(target.ws,{type:'message',text:m.text});
        }else if(m.type==='help-resolve'){helps.delete(m.to);broadcast();}
        else if(m.type==='project'){store.audit(peer.actor,'projection.start',m.to,labId);send(target.ws,{type:'projected'});send(ws,{type:'project-approved',deviceId:m.to});}
        else throw new Fault(400,'Comandă necunoscută.');
      }catch(e){send(ws,{type:'error',message:e.status?e.message:'Mesaj invalid.'});if(e.status===401)ws.close(4001);}
    });
    ws.on('close',()=>{clearTimeout(timer);if(peer&&peers.get(peer.device.id)===peer){peers.delete(peer.device.id);const lesson=lessons.get(peer.device.labId);if(lesson?.deviceId===peer.device.id)stopLesson(peer.device.labId);else if(lesson?.control===peer.device.id){lesson.control=null;send(peers.get(lesson.deviceId)?.ws,{type:'control-stopped'});}broadcast();}});
    ws.on('error',()=>{});
  });
  const heartbeat=setInterval(()=>{
    for(const [key,s]of sessions)if(s.expires<Date.now())sessions.delete(key);
    for(const [key,r]of rates)if(Date.now()-r.start>60000)rates.delete(key);
    for(const ws of wss.clients){if(!ws.alive){ws.terminate();continue;}ws.alive=false;ws.ping();}
    for(const p of peers.values())if(p.actor&&!sessionActor(p.token))p.ws.close(4001,'Expired');
  },10000);heartbeat.unref();
  return {server,store,close:async()=>{clearInterval(heartbeat);for(const ws of wss.clients)ws.terminate();await new Promise(r=>wss.close(r));await new Promise(r=>server.close(r));}};
}
export function validInput(e){
  if(!e||typeof e!=='object')return false;
  if(e.kind==='pointer')return Number.isFinite(e.x)&&e.x>=0&&e.x<=1&&Number.isFinite(e.y)&&e.y>=0&&e.y<=1&&['move','click','right'].includes(e.action);
  if(e.kind==='key')return typeof e.key==='string'&&(/^[a-zA-Z0-9]$/.test(e.key)||['Enter','Backspace','Tab','Escape','ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(e.key));
  return false;
}
// Materialul TLS: certificat furnizat de IT, altfel unul auto-semnat generat pe calculatorul
// profesorului. Pe loopback rămâne opțional, ca dezvoltarea să nu ceară certificat.
export async function resolveTls({host,dir}={}) {
  if (process.env.LABORA_TLS_CERT && process.env.LABORA_TLS_KEY)
    return {cert:readFileSync(process.env.LABORA_TLS_CERT),key:readFileSync(process.env.LABORA_TLS_KEY)};
  if (['127.0.0.1','::1','localhost'].includes(host)) return undefined;
  const {ensureCertificate}=await import('./certificate.mjs');
  const {pfx,passphrase,names,fingerprint}=ensureCertificate(dir||process.env.LABORA_CERT_DIR||undefined);
  return {pfx,passphrase,names,fingerprint};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const host=process.env.LABORA_HOST||'127.0.0.1';
  const tls=await resolveTls({host});
  const app=createApp({store:new Store(process.env.LABORA_DATA||'data/store.json'),host,tls});
  requireThat(app.store.data.users.length,500,'Rulați npm run setup înainte de pornire.');
  const port=Number(process.env.LABORA_PORT||4310);
  app.server.listen(port,host,async()=>{
    console.log(`Labora: ${tls?'https':'http'}://${host}:${port}`);
    if(tls?.names)console.log(`Certificat pentru: ${tls.names.join(', ')}`);
    // Anunțarea în LAN pornește doar pe calculatorul profesorului, peste HTTPS.
    if(process.env.LABORA_ADVERTISE==='1'&&tls){
      const {advertise}=await import('./discovery.mjs');
      const {localAddresses}=await import('./certificate.mjs');
      const address=localAddresses()[0];
      if(address){
        advertise({url:`https://${address}:${port}`,fingerprint:tls.fingerprint||''});
        console.log(`Anunțat în rețea: https://${address}:${port}`);
      }
    }
  });
}
