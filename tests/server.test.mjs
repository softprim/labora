import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { Store, passwordHash } from '../server/domain.mjs';
import { createApp,validInput } from '../server/index.mjs';

const password='test-only-password-12345';
async function fixture(t){
  const store=new Store();store.bootstrap('Școala Test','admin',password);const admin=store.data.users[0];
  const lab=store.createLab(admin,{name:'Informatică 1'}), other=store.createLab(admin,{name:'Informatică 2'});
  const teacher=store.createUser(admin,{name:'Profesor',username:'profesor',password,role:'teacher',labIds:[lab.id]});
  const enroll=(name,role,labId=lab.id)=>store.enroll(store.enrollment(admin,{name,role,labId}).token);
  const teacherDevice=enroll('Catedră','teacher'), student=enroll('PC-01','student'), stranger=enroll('PC-X','student',other.id);
  const app=createApp({store});app.server.listen(0,'127.0.0.1');await once(app.server,'listening');t.after(()=>app.close());
  const base=`http://127.0.0.1:${app.server.address().port}`;
  async function request(method,path,body,token){const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json()};}
  const login=await request('POST','/api/login',{username:'profesor',password});
  async function connect(device,token){
    const ws=new WebSocket(base.replace('http','ws')+'/connect');const messages=[];ws.on('message',raw=>messages.push(JSON.parse(raw)));await once(ws,'open');ws.send(JSON.stringify({type:'auth',deviceToken:device.deviceToken,token}));await until(()=>messages.some(m=>m.type==='ready'||m.type==='error'));return {ws,messages,send:m=>ws.send(JSON.stringify(m)),take:async type=>{await until(()=>messages.some(m=>m.type===type));const i=messages.findIndex(m=>m.type===type);return messages.splice(i,1)[0];}};
  }
  return {store,admin,teacher,lab,other,student,stranger,teacherDevice,request,connect,token:login.data.token,app};
}
async function until(fn){for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('Timed out waiting for message');}

test('Authentication and school/laboratory authorization are enforced on server',async t=>{
  const f=await fixture(t);
  assert.equal((await f.request('GET','/api/state')).status,401);
  assert.equal((await f.request('POST','/api/login',{username:'profesor',password:'wrong'})).status,401);
  const s=await f.request('GET','/api/state',undefined,f.token);assert.equal(s.data.labs.length,1);assert.equal(s.data.labs[0].id,f.lab.id);
  assert.equal(JSON.stringify(s.data).includes('tokenHash'),false);assert.equal(JSON.stringify(s.data).includes('passwordHash'),false);
  assert.equal((await f.request('POST','/api/labs',{name:'Hacked'},f.token)).status,403);
  assert.equal((await f.request('PUT','/api/layout',{labId:f.lab.id,layout:{}},f.token)).status,403);
  assert.equal((await f.request('POST','/api/enrollments',{labId:f.lab.id,name:'x',role:'teacher'},f.token)).status,403);
  assert.equal((await f.request('GET','/api/state',undefined,f.student.deviceToken)).status,401);
});
test('Enrollment codes are single-use, expiring and server-assigned',async t=>{
  const f=await fixture(t);const e=f.store.enrollment(f.admin,{name:'PC-02',role:'student',labId:f.lab.id});
  const r=await f.request('POST','/api/enroll',{token:e.token,role:'teacher',labId:f.other.id});assert.equal(r.status,200);assert.equal(r.data.role,'student');assert.equal(r.data.labId,f.lab.id);
  assert.equal((await f.request('POST','/api/enroll',{token:e.token})).status,401);
  const expired=f.store.enrollment(f.admin,{name:'PC-03',role:'student',labId:f.lab.id});f.store.data.enrollments.at(-1).expires=0;
  assert.equal((await f.request('POST','/api/enroll',{token:expired.token})).status,401);
});
test('Live signaling only reaches the active teacher and own laboratory',async t=>{
  const f=await fixture(t);const teacher=await f.connect(f.teacherDevice,f.token),student=await f.connect(f.student),stranger=await f.connect(f.stranger);
  teacher.send({type:'signal',to:f.student.deviceId,signal:{kind:'offer'}});await teacher.take('error');
  teacher.send({type:'lesson-start'});await student.take('lesson-started');
  student.send({type:'signal',to:f.teacherDevice.deviceId,signal:{kind:'offer',description:{type:'offer',sdp:'test'}}});const signal=await teacher.take('signal');assert.equal(signal.from,f.student.deviceId);
  teacher.send({type:'signal',to:f.stranger.deviceId,signal:{kind:'offer'}});await teacher.take('error');assert.equal(stranger.messages.some(m=>m.type==='signal'),false);
  student.send({type:'control-start',to:f.teacherDevice.deviceId});await student.take('error');
  teacher.send({type:'lesson-stop'});await student.take('lesson-ended');
});
test('Control requires explicit lease, validates inputs and ends when teacher disconnects',async t=>{
  const f=await fixture(t),teacher=await f.connect(f.teacherDevice,f.token),student=await f.connect(f.student);
  teacher.send({type:'lesson-start'});await student.take('lesson-started');
  teacher.send({type:'input',to:f.student.deviceId,event:{kind:'key',key:'A'}});await teacher.take('error');
  teacher.send({type:'control-start',to:f.student.deviceId});assert.equal((await student.take('control')).enabled,true);
  teacher.send({type:'input',to:f.student.deviceId,event:{kind:'pointer',x:3,y:0,action:'click'}});await teacher.take('error');
  teacher.send({type:'input',to:f.student.deviceId,event:{kind:'key',key:'A'}});assert.equal((await student.take('input')).event.key,'A');
  teacher.send({type:'control-stop'});assert.equal((await student.take('control')).enabled,false);
  teacher.ws.close();await student.take('lesson-ended');
});
test('A student cannot authenticate a teacher workstation without a permitted personal account',async t=>{
  const f=await fixture(t);const p=await f.connect(f.teacherDevice);assert.equal((await p.take('error')).type,'error');
});
test('Logout invalidates HTTP token and stops live lesson',async t=>{
  const f=await fixture(t),teacher=await f.connect(f.teacherDevice,f.token),student=await f.connect(f.student);
  teacher.send({type:'lesson-start'});await student.take('lesson-started');
  assert.equal((await f.request('POST','/api/logout',{},f.token)).status,200);await student.take('lesson-ended');
  assert.equal((await f.request('GET','/api/state',undefined,f.token)).status,401);
});
test('Help, projection and device revocation work and leave audit evidence',async t=>{
  const f=await fixture(t),teacher=await f.connect(f.teacherDevice,f.token),student=await f.connect(f.student);
  student.send({type:'help',message:'Nu înțeleg exercițiul'});await until(()=>teacher.messages.some(m=>m.type==='state'&&m.data.labs[0].devices.find(d=>d.id===f.student.deviceId)?.help));
  teacher.send({type:'lesson-start'});await student.take('lesson-started');teacher.send({type:'project',to:f.student.deviceId});await teacher.take('project-approved');await student.take('projected');
  const adminLogin=await f.request('POST','/api/login',{username:'admin',password});
  const closed=once(student.ws,'close');assert.equal((await f.request('POST','/api/revoke',{deviceId:f.student.deviceId},adminLogin.data.token)).status,200);await closed;
  assert.equal(f.store.device(f.student.deviceToken),undefined);assert.ok(f.store.data.audit.some(x=>x.action==='projection.start'));assert.ok(f.store.data.audit.some(x=>x.action==='device.revoke'));
});
test('Different schools cannot see or mutate each other',async t=>{
  const f=await fixture(t);const schoolId='other-school';f.store.data.schools.push({id:schoolId,name:'Altă școală'});
  const actor={id:'other-admin',schoolId,name:'Other',role:'admin',username:'other',passwordHash:passwordHash(password),labIds:[]};f.store.data.users.push(actor);
  const token=(await f.request('POST','/api/login',{username:'other',password})).data.token;
  assert.equal((await f.request('GET','/api/state',undefined,token)).data.labs.length,0);
  assert.equal((await f.request('POST','/api/enrollments',{labId:f.lab.id,name:'x',role:'teacher'},token)).status,403);
  assert.equal((await f.request('POST','/api/revoke',{deviceId:f.student.deviceId},token)).status,404);
});
test('Persistent layout survives restart, while invalid positions are rejected',()=>{
  const folder=mkdtempSync(join(tmpdir(),'labora-test-'));try{
    const path=join(folder,'store.json'),store=new Store(path);store.bootstrap('Școală','admin',password);const actor=store.data.users[0];const lab=store.createLab(actor,{name:'Laborator'});const d=store.enroll(store.enrollment(actor,{name:'PC-01',labId:lab.id,role:'student'}).token);
    assert.throws(()=>store.layout(actor,lab.id,{[d.deviceId]:{slot:-1}}));store.layout(actor,lab.id,{[d.deviceId]:{slot:0}});
    assert.deepEqual(new Store(path).data.labs[0].layout[d.deviceId],{slot:0});
  }finally{rmSync(folder,{recursive:true,force:true});}
});
test('Room slots cannot overlap or reference another laboratory',async t=>{
  const f=await fixture(t),second=f.store.enroll(f.store.enrollment(f.admin,{name:'PC-02',role:'student',labId:f.lab.id}).token);
  assert.throws(()=>f.store.layout(f.admin,f.lab.id,{[f.student.deviceId]:{slot:0},[second.deviceId]:{slot:0}}),/același loc/);
  assert.throws(()=>f.store.layout(f.admin,f.lab.id,{[f.stranger.deviceId]:{slot:0}}));
  f.store.layout(f.admin,f.lab.id,{[f.student.deviceId]:{slot:1},[second.deviceId]:{slot:0}});
  assert.equal(f.lab.layout[f.student.deviceId].slot,1);
});
test('Resizing a physical room preserves coordinates and refuses to discard occupied places',async t=>{
  const f=await fixture(t);f.store.layout(f.admin,f.lab.id,{[f.student.deviceId]:{slot:7}});
  f.store.shape(f.admin,f.lab.id,6,4);assert.equal(f.lab.layout[f.student.deviceId].slot,9);
  assert.throws(()=>f.store.shape(f.admin,f.lab.id,3,4),/zona eliminată/);
  assert.equal(f.lab.columns,6);assert.equal(f.lab.layout[f.student.deviceId].slot,9);
  assert.throws(()=>f.store.shape(f.teacher,f.lab.id,6,4),/administratorul/);
});
test('Fallback frames are bounded and delivered only within an active lesson',async t=>{
  const f=await fixture(t),teacher=await f.connect(f.teacherDevice,f.token),student=await f.connect(f.student),stranger=await f.connect(f.stranger);
  const frame='data:image/jpeg;base64,/9j/2Q==';
  student.send({type:'frame',frame});await student.take('error');
  teacher.send({type:'lesson-start'});await student.take('lesson-started');
  student.send({type:'frame',frame,to:f.stranger.deviceId});const received=await teacher.take('frame');assert.equal(received.from,f.student.deviceId);assert.equal(received.frame,frame);assert.equal(stranger.messages.some(m=>m.type==='frame'),false);
  student.send({type:'frame',frame:'data:text/html;base64,PHNjcmlwdD4='});await student.take('error');
  teacher.send({type:'frame',frame});await teacher.take('error');
  teacher.send({type:'lesson-stop'});await student.take('lesson-ended');student.send({type:'frame',frame});await student.take('error');
});
test('LAN listener refuses plaintext HTTP and input API accepts no arbitrary commands',()=>{
  assert.throws(()=>createApp({host:'0.0.0.0'}),/HTTPS/);
  assert.equal(validInput({kind:'shell',command:'whoami'}),false);assert.equal(validInput({kind:'key',key:'Control'}),false);assert.equal(validInput({kind:'pointer',x:Infinity,y:0,action:'click'}),false);assert.equal(validInput({kind:'pointer',x:.5,y:.5,action:'click'}),true);
});
