import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

export class Fault extends Error { constructor(status, message) { super(message); this.status = status; } }
export const requireThat = (ok, status=400, message='Cerere invalidă') => { if (!ok) throw new Fault(status,message); };
export const secret = () => randomBytes(32).toString('base64url');
export const digest = x => createHash('sha256').update(x).digest('hex');
export function passwordHash(password, salt = randomBytes(16).toString('hex')) {
  requireThat(typeof password === 'string' && password.length >= 12 && password.length <= 256,400,'Parola trebuie să aibă între 12 și 256 de caractere.');
  return `${salt}:${scryptSync(password,salt,64).toString('hex')}`;
}
export function verifyPassword(password, encoded) {
  if (typeof password !== 'string' || password.length > 256) return false;
  const [salt, hash] = encoded.split(':');
  return timingSafeEqual(Buffer.from(hash,'hex'),scryptSync(password,salt,64));
}
export const name = value => { requireThat(typeof value === 'string' && value.trim().length > 0 && value.length <= 100); return value.trim(); };
export class Store {
  constructor(path) {
    this.path = path;
    this.data = path && existsSync(path) ? JSON.parse(readFileSync(path,'utf8')) : { schools:[], labs:[], users:[], devices:[], enrollments:[], audit:[] };
  }
  save() {
    if (!this.path) return;
    mkdirSync(dirname(this.path),{recursive:true,mode:0o700});
    writeFileSync(`${this.path}.tmp`,JSON.stringify(this.data,null,2),{mode:0o600});
    renameSync(`${this.path}.tmp`,this.path);
  }
  audit(actor, action, target) {
    this.data.audit.push({id:randomUUID(),at:new Date().toISOString(),schoolId:actor.schoolId,actorId:actor.id,action,target});
    this.data.audit=this.data.audit.slice(-10000); this.save();
  }
  bootstrap(schoolName, username, password) {
    requireThat(!this.data.users.length,409,'Serverul este deja configurat.');
    const school={id:randomUUID(),name:name(schoolName)};
    const user={id:randomUUID(),schoolId:school.id,name:'Administrator IT',username:name(username).toLowerCase(),passwordHash:passwordHash(password),role:'admin',labIds:[]};
    this.data.schools.push(school); this.data.users.push(user); this.save(); return school;
  }
  admin(actor) { requireThat(actor?.role==='admin',403,'Doar administratorul IT poate modifica această setare.'); }
  lab(actor,id) {
    const lab=this.data.labs.find(x=>x.id===id && x.schoolId===actor.schoolId);
    requireThat(lab && (actor.role==='admin' || actor.labIds?.includes(id)),403,'Nu aveți acces la acest laborator.'); return lab;
  }
  createLab(actor, body) {
    this.admin(actor); const lab={id:randomUUID(),schoolId:actor.schoolId,name:name(body.name),columns:4,rows:4,layout:{}};
    this.data.labs.push(lab); this.audit(actor,'lab.create',lab.id); return lab;
  }
  createUser(actor, body) {
    this.admin(actor); requireThat(['teacher','admin'].includes(body.role));
    const username=name(body.username).toLowerCase();
    requireThat(!this.data.users.some(x=>x.username===username),409,'Numele de utilizator există deja.');
    requireThat(Array.isArray(body.labIds)); body.labIds.forEach(id=>this.lab(actor,id));
    const user={id:randomUUID(),schoolId:actor.schoolId,name:name(body.name),username,passwordHash:passwordHash(body.password),role:body.role,labIds:[...new Set(body.labIds)]};
    this.data.users.push(user); this.audit(actor,'user.create',user.id); const {passwordHash:_,...safe}=user; return safe;
  }
  enrollment(actor, body) {
    this.admin(actor); this.lab(actor,body.labId); requireThat(['student','teacher'].includes(body.role));
    const token=secret(); const record={id:randomUUID(),schoolId:actor.schoolId,labId:body.labId,name:name(body.name),role:body.role,hash:digest(token),expires:Date.now()+15*60*1000};
    this.data.enrollments=this.data.enrollments.filter(x=>x.expires>Date.now());
    this.data.enrollments.push(record); this.audit(actor,'device.enrollment',record.id); return {token,expires:record.expires};
  }
  enroll(token) {
    requireThat(typeof token==='string',401,'Cod invalid.'); const hash=digest(token);
    const record=this.data.enrollments.find(x=>x.hash===hash && x.expires>Date.now());
    requireThat(record,401,'Cod invalid, expirat sau deja folosit.');
    const deviceToken=secret(); const device={id:randomUUID(),schoolId:record.schoolId,labId:record.labId,name:record.name,role:record.role,tokenHash:digest(deviceToken),revoked:false};
    const lab=this.data.labs.find(x=>x.id===device.labId);
    if(device.role==='student'){
      const occupied=this.data.devices.filter(d=>d.labId===lab.id&&d.role==='student'&&!d.revoked).length;
      const capacity=(lab.columns||4)*(lab.rows||4);requireThat(occupied<capacity,409,'Planul este plin. IT trebuie să mărească grila laboratorului.');
    }
    this.data.devices.push(device); this.data.enrollments=this.data.enrollments.filter(x=>x!==record);
    this.audit({id:device.id,schoolId:device.schoolId},'device.enroll',device.id);
    return {deviceId:device.id,deviceToken,labId:device.labId,role:device.role,name:device.name};
  }
  device(token) { return typeof token==='string' ? this.data.devices.find(x=>!x.revoked && x.tokenHash===digest(token)) : undefined; }
  layout(actor,labId,layout) {
    this.admin(actor); const lab=this.lab(actor,labId);
    requireThat(layout && typeof layout==='object' && !Array.isArray(layout));
    const devices=this.data.devices.filter(d=>d.labId===labId&&!d.revoked&&d.role==='student');const slots=new Set();
    for (const [id,p] of Object.entries(layout)) {
      requireThat(devices.some(d=>d.id===id));
      requireThat(p&&Number.isInteger(p.slot)&&p.slot>=0&&p.slot<(lab.columns||4)*(lab.rows||4),400,'Poziție invalidă în plan.');
      requireThat(!slots.has(p.slot),400,'Două calculatoare nu pot ocupa același loc.');slots.add(p.slot);
    }
    lab.layout=layout; this.audit(actor,'lab.layout',labId); return lab;
  }
  shape(actor,labId,columns,rows){
    this.admin(actor);const lab=this.lab(actor,labId);
    requireThat(Number.isInteger(columns)&&columns>=2&&columns<=12&&Number.isInteger(rows)&&rows>=1&&rows<=16,400,'Grila acceptă 2–12 coloane și 1–16 rânduri.');
    const devices=this.data.devices.filter(d=>d.labId===labId&&!d.revoked&&d.role==='student');
    requireThat(columns*rows>=devices.length,400,'Grila nu are suficiente locuri pentru toate calculatoarele.');
    const previousColumns=lab.columns||4,used=new Set(),positions=new Map();
    for(const d of devices){const slot=lab.layout[d.id]?.slot;if(Number.isInteger(slot)&&!used.has(slot)){positions.set(d.id,slot);used.add(slot);}}
    for(const d of devices)if(!positions.has(d.id)){let slot=0;while(used.has(slot))slot++;positions.set(d.id,slot);used.add(slot);}
    const layout={};for(const [id,slot]of positions){const row=Math.floor(slot/previousColumns),column=slot%previousColumns;
      requireThat(row<rows&&column<columns,409,'Există PC-uri în zona eliminată. Mutați-le pe locuri păstrate înainte de micșorarea grilei.');layout[id]={slot:row*columns+column};}
    lab.columns=columns;lab.rows=rows;lab.layout=layout;this.audit(actor,'lab.shape',labId);return lab;
  }
}
