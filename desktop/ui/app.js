/* Local Electron renderer: no credentials, file access or network authority. */
const $=s=>document.querySelector(s), api=window.labora;
let config,state,labId,view='grid',selectedId=null,controlId=null,projectId=null,layoutDirty=false;
let lesson=false,capture=null,teacherId=null,modalAction,connected=false,projectionTimer,toastTimer,adminPoll,fallbackTimer,captureVideo;
const peers=new Map(),earlyCandidates=new Map(),fallbackFrames=new Map();
const hasFallback=id=>{const f=fallbackFrames.get(id);return !!(f?.ready&&Date.now()-f.at<3000);};
const hasScreen=id=>!!peers.get(id)?.hasFrame||hasFallback(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const currentLab=()=>state?.labs.find(x=>x.id===labId);
const devices=()=>currentLab()?.devices.filter(d=>d.role==='student')||[];
const selected=()=>devices().find(d=>d.id===selectedId);
const planPreferences=new Map();
function preferences(){const key=state.user.id+':'+labId;if(!planPreferences.has(key)){let rotation=0;try{rotation=Number(localStorage.getItem('labora-view:'+key))||0;}catch{}planPreferences.set(key,{rotation:((rotation%4)+4)%4,zoom:1});}return planPreferences.get(key);}
function physicalSlots(){const lab=currentLab();return window.LaboraLayout.place(devices(),lab.layout,(lab.columns||4)*(lab.rows||4));}
function orderedDevices(){return physicalSlots().filter(Boolean);}
function moveDevice(id,targetSlot){if(state.user.role!=='admin')return;const slots=physicalSlots(),from=slots.findIndex(d=>d?.id===id),to=Number(targetSlot);if(from<0||!Number.isInteger(to)||to<0||to>=slots.length||from===to)return;[slots[from],slots[to]]=[slots[to],slots[from]];currentLab().layout=Object.fromEntries(slots.flatMap((d,slot)=>d?[[d.id,{slot}]]:[]));layoutDirty=true;renderRoom();toast('Poziția a fost actualizată. Salvează planul pentru a o păstra.');}
function toast(message,error=false){$('#toast').textContent=message;$('#toast').classList.remove('hidden');$('#toast').classList.toggle('error-toast',error);clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.add('hidden'),6000);}
async function action(fn){try{return await fn();}catch(e){toast(e.message,true);}}
const send=m=>api.send(m);
function show(id){for(const s of ['login','workspace','student'])$('#'+s).classList.toggle('hidden',s!==id);}
function setState(next){
  if(layoutDirty&&state){const prior=currentLab();const incoming=next.labs.find(x=>x.id===labId);if(prior&&incoming)incoming.layout=prior.layout;}
  state=next;if(!next.labs.some(l=>l.id===labId))labId=next.labs.find(l=>l.id===config.labId)?.id||next.labs[0]?.id;
  render();
}
function render(){
  if(!state)return;show('workspace');const lab=currentLab();
  $('#school-name').textContent=state.school.name;$('#user-name').textContent=state.user.name;$('#avatar').textContent=state.user.name[0];$('#user-role').textContent=state.user.role==='admin'?'Administrator IT':'Profesor';
  document.querySelectorAll('.admin-only').forEach(el=>el.classList.toggle('hidden',state.user.role!=='admin'));
  $('#lab-nav').innerHTML=state.labs.map(l=>`<button class="nav-item ${l.id===labId?'active':''}" data-lab="${esc(l.id)}">▦ &nbsp; ${esc(l.name)} <span class="count">${l.devices.filter(d=>d.role==='student').length}</span></button>`).join('');
  $('#empty-school').classList.toggle('hidden',!!lab);$('#lab-content').classList.toggle('hidden',!lab);$('#lesson-toggle').classList.toggle('hidden',!lab||config.role!=='teacher'||lab.id!==config.labId);
  if(!lab)return;
  $('#breadcrumb').textContent=lab.name;$('#lab-title').textContent=lab.name;$('#lab-description').textContent='Fiecare ecran, un elev. Tot laboratorul, într-un singur loc.';
  $('#stat-online').innerHTML=`${devices().filter(d=>d.online).length} <small>/ ${devices().length}</small>`;
  $('#stat-help').textContent=devices().filter(d=>d.help).length;$('#stat-session').textContent=lab.lesson?'Oră în desfășurare':'În așteptare';$('#session-teacher').textContent=lab.lesson?lab.lesson.teacher:'Pornește o nouă sesiune';
  $('#lesson-toggle').textContent=lesson?'■ Încheie ora':'▶ Începe ora';$('#lesson-toggle').disabled=!connected||!!(lab.lesson&&!lesson);
  $('#room-caption').textContent=`${devices().length} calculatoare · ${view==='grid'?'Ecranele elevilor':view==='map'?'Planul laboratorului':'Perspectivă izometrică a planului'}`;
  $('#save-layout').classList.toggle('hidden',state.user.role!=='admin'||view==='grid');
  $('#room-hint').textContent=view!=='grid'&&state.user.role==='admin'?'Trage un PC pe un loc liber sau peste alt PC. Alt + săgeți mută din tastatură. Salvează planul.':'Selectează un calculator pentru a vedea ecranul și a oferi ajutor.';
  renderRoom();renderDetail();
}
function renderRoom(){
  const lab=currentLab(),room=$('#room'),isPlan=view!=='grid',pref=preferences();room.className=`room ${view}`;room.style.height='';$('#workspace').classList.toggle('plan-mode',isPlan);
  $('#plan-controls').classList.toggle('hidden',!isPlan);$('#view-direction').textContent=['Catedra sus','Catedra în dreapta','Catedra jos · Privirea profesorului','Catedra în stânga'][pref.rotation];$('#zoom-fit').textContent=pref.zoom===1?'Potrivește':Math.round(pref.zoom*100)+'%';
  const slots=physicalSlots();
  function card(d,slot){return `<article class="device ${d.online?'':'offline'} ${d.help?'needs-help':''} ${selectedId===d.id?'selected':''}" tabindex="0" role="button" aria-label="${esc(d.name)}${d.online?', conectat':', offline'}" data-device="${esc(d.id)}" data-slot="${slot}" ${isPlan?`draggable="${state.user.role==='admin'}"`:''}><div class="screen-area"><div class="screen-placeholder"><span>▣</span>${d.online?(lesson?'Se așteaptă ecranul…':'Pregătit pentru oră'):'Calculator offline'}</div><video autoplay muted playsinline class="hidden"></video>${d.help?'<span class="help-badge">✋ Ajutor</span>':''}</div><div class="device-footer"><div><strong>${esc(d.name)}</strong><small>${isPlan?`Locul ${slot+1}`:d.online?'Conectat la laborator':'Offline'}</small></div><i class="status-dot"></i></div></article>`;}
  if(isPlan){const columns=lab.columns||4,rows=lab.rows||4,visualColumns=pref.rotation%2?rows:columns;
    const cells=window.LaboraLayout.viewSlots(slots,columns,rows,pref.rotation).map(({device,slot})=>device?card(device,slot):`<div class="empty-slot" data-slot="${slot}" aria-label="Loc liber ${slot+1}"><span>＋</span><small>Loc liber ${slot+1}</small></div>`).join('');
    room.innerHTML=`<div class="floor-stage facing-${pref.rotation}" style="width:${pref.zoom*100}%"><div class="teacher-desk">▣ Catedră</div><div class="floor-grid" style="grid-template-columns:repeat(${visualColumns},minmax(0,1fr))">${cells}</div></div>`;
  }else room.innerHTML=slots.flatMap((d,slot)=>d?[card(d,slot)]:[]).join('');
  if(!devices().length&&!isPlan)room.innerHTML='<div class="empty"><h2>Adaugă calculatoarele laboratorului</h2><p>Configurează dimensiunea sălii, apoi înrolează calculatoarele.</p></div>';
  if(isPlan)requestAnimationFrame(fitFloor);
  for(const [id,p]of peers)if(p.stream)attachStream(id,p.stream);for(const id of fallbackFrames.keys())attachFrame(id);
}
function fitFloor(){const room=$('#room'),stage=room.querySelector('.floor-stage');if(!stage||!state)return;const width=Math.max(220,room.clientWidth-26),height=Math.max(240,Math.min(window.innerHeight*.68,window.innerHeight-room.getBoundingClientRect().top-30));room.style.maxHeight=height+'px';stage.style.width=width+'px';const scale=Math.min(1,(height-26)/Math.max(1,stage.scrollHeight));stage.style.width=Math.max(220,Math.floor(width*scale*preferences().zoom))+'px';}
let resizeTimer;window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(state&&view!=='grid')fitFloor();},120);});
function attachFrame(id){
  const f=fallbackFrames.get(id);if(!f||Date.now()-f.at>=3000||peers.get(id)?.hasFrame)return;
  const card=document.querySelector(`[data-device="${CSS.escape(id)}"]`);if(!card)return;
  let img=card.querySelector('img');if(!img){img=document.createElement('img');img.alt='Ecran live prin serverul local';card.querySelector('.screen-area').appendChild(img);const badge=document.createElement('span');badge.className='fallback-label';badge.textContent='Live · mod de rezervă';card.querySelector('.screen-area').appendChild(badge);}
  img.onload=()=>{f.ready=true;if(selectedId===id)renderDetail();};img.src=f.frame;card.querySelector('.screen-placeholder').classList.add('hidden');card.querySelector('video').classList.add('hidden');
}
function attachStream(id,stream){const card=document.querySelector(`[data-device="${CSS.escape(id)}"]`);if(card){const video=card.querySelector('video');video.onloadeddata=()=>{const p=peers.get(id);if(p){p.hasFrame=true;card.querySelector('img')?.remove();card.querySelector('.fallback-label')?.remove();video.classList.remove('hidden');if(selectedId===id)renderDetail();}};video.srcObject=stream;video.classList.remove('hidden');card.querySelector('.screen-placeholder').classList.add('hidden');}if(selectedId===id)$('#detail-video').srcObject=stream;}
function renderDetail(){
  const d=selected();$('#detail').classList.toggle('hidden',!d);if(!d)return;
  $('#detail-name').textContent=d.name;$('#detail-status').textContent=d.help?`✋ ${d.help.message}`:d.online?'Conectat la laborator':'Calculator offline';
  const direct=!!peers.get(d.id)?.hasFrame;
  $('#detail-video').srcObject=direct?peers.get(d.id)?.stream:null;
  $('#detail-video').classList.toggle('hidden',!direct&&hasFallback(d.id));
  $('#detail-frame').classList.toggle('hidden',direct||!hasFallback(d.id));
  if(!direct&&hasFallback(d.id)){$('#detail-frame').src=fallbackFrames.get(d.id).frame;$('#detail-status').textContent+=' · Live prin server · până la 2 cadre/s';}else $('#detail-frame').removeAttribute('src');
  const available=lesson&&d.online&&config.labId===labId&&config.role==='teacher';
  for(const id of ['control-button','project-button','message-button','resolve-help'])$('#'+id).disabled=!available;
  $('#control-button').disabled=!available||!hasScreen(d.id);$('#project-button').disabled=!available||!hasScreen(d.id);
  $('#control-button').textContent=controlId===d.id?'Oprește controlul':'Preia controlul';
  $('#resolve-help').classList.toggle('hidden',!d.help);
}
function modal(title,html,submit,fn){$('#modal-title').textContent=title;$('#modal-body').innerHTML=html;$('#modal-error').textContent='';$('#modal-submit').textContent=submit;$('#modal-submit').classList.toggle('hidden',!fn);modalAction=fn;$('#modal').showModal();}
$('#modal-close').onclick=()=>$('#modal').close();
$('#modal-form').onsubmit=async e=>{e.preventDefault();$('#modal-error').textContent='';if(!modalAction)return;$('#modal-submit').disabled=true;try{await modalAction(new FormData(e.target));}catch(err){$('#modal-error').textContent=err.message;}finally{$('#modal-submit').disabled=false;}};
async function refresh(){setState(await api.api('GET','/api/state'));}
function addLab(){modal('Noul laborator','<p class="muted">Fiecare laborator are propriile calculatoare și propriul plan.</p><label>Denumire<input name="name" required maxlength="100" placeholder="Laborator informatică 1"></label>','Creează laboratorul',async data=>{const lab=await api.api('POST','/api/labs',{name:data.get('name')});labId=lab.id;$('#modal').close();await refresh();});}
$('#add-lab').onclick=addLab;$('#empty-add').onclick=addLab;
$('#enroll-device').onclick=()=>modal('Adaugă un calculator',`<p class="muted">Laborator: ${esc(currentLab().name)}. Codul poate fi folosit o singură dată, timp de 15 minute.</p><label>Numele calculatorului<input name="name" required maxlength="100" placeholder="PC-01"></label><label>Rol<select name="role"><option value="student">Calculator elev</option><option value="teacher">PC-ul profesorului</option></select></label>`,'Generează codul',async data=>{
  const result=await api.api('POST','/api/enrollments',{labId,name:data.get('name'),role:data.get('role')});
  modal('Cod de înrolare creat',`<p class="muted">IT folosește acest cod în scriptul de configurare Windows. Nu îl trimite elevilor.</p><pre>${esc(result.token)}</pre><p class="muted">Expiră la ${new Date(result.expires).toLocaleTimeString('ro-RO')}. Înrolarea fixează laboratorul și rolul pe server.</p>`,null,null);
});
$('#manage-users').onclick=()=>modal('Adaugă profesor sau administrator',`<label>Nume complet<input name="name" required maxlength="100"></label><label>Utilizator<input name="username" required maxlength="100"></label><label>Parolă inițială<input name="password" type="password" required minlength="12" maxlength="256" autocomplete="new-password"></label><label>Rol<select name="role"><option value="teacher">Profesor</option><option value="admin">Administrator IT</option></select></label><p>Laboratoare accesibile profesorului</p><div class="checks">${state.labs.map(l=>`<label><input type="checkbox" name="labs" value="${esc(l.id)}">${esc(l.name)}</label>`).join('')}</div>`,'Creează contul',async data=>{await api.api('POST','/api/users',{name:data.get('name'),username:data.get('username'),password:data.get('password'),role:data.get('role'),labIds:data.getAll('labs')});$('#modal').close();toast('Contul a fost creat.');});
$('#audit-button').onclick=()=>action(async()=>{const rows=await api.api('GET','/api/audit');modal('Jurnal de activitate',rows.reverse().map(r=>`<div class="audit-row"><strong>${esc(r.action)}</strong><small>${esc(new Date(r.at).toLocaleString('ro-RO'))} · ${esc(r.actorId)}<br>${esc(r.target)}</small></div>`).join('')||'<p>Nu există încă activitate.</p>',null,null);});
$('#revoke-device').onclick=()=>modal('Revocă înrolarea',`<p>Calculatorul <strong>${esc(selected().name)}</strong> va fi deconectat și va necesita o nouă înrolare de către IT.</p>`,'Revocă acest calculator',async()=>{await api.api('POST','/api/revoke',{deviceId:selectedId});selectedId=null;$('#modal').close();await refresh();});
$('#lab-nav').onclick=e=>{const el=e.target.closest('[data-lab]');if(el){if(layoutDirty){toast('Salvează planul înainte să schimbi laboratorul.',true);return;}labId=el.dataset.lab;selectedId=null;render();}};
document.querySelectorAll('[data-view]').forEach(el=>el.onclick=()=>{view=el.dataset.view;document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b===el));render();});

function rotatePlan(delta){const pref=preferences();pref.rotation=(pref.rotation+delta+4)%4;try{localStorage.setItem('labora-view:'+state.user.id+':'+labId,String(pref.rotation));}catch{}renderRoom();}
$('#rotate-left').onclick=()=>rotatePlan(-1);$('#rotate-right').onclick=()=>rotatePlan(1);
$('#zoom-in').onclick=()=>{preferences().zoom=Math.min(3,preferences().zoom+.25);renderRoom();};
$('#zoom-out').onclick=()=>{preferences().zoom=Math.max(.5,preferences().zoom-.25);renderRoom();};
$('#zoom-fit').onclick=()=>{preferences().zoom=1;renderRoom();};
$('#room-shape').onclick=()=>{if(layoutDirty){toast('Salvează mai întâi pozițiile modificate.',true);return;}const lab=currentLab();modal('Așezarea reală a sălii',`<p class="muted">Grila reprezintă locurile fizice. Lasă celulele libere pentru culoare sau bănci fără calculator. Rotirea schimbă doar perspectiva profesorului.</p><label>Locuri pe rând<input name="columns" type="number" min="2" max="12" required value="${lab.columns||4}"></label><label>Rânduri<input name="rows" type="number" min="1" max="16" required value="${lab.rows||4}"></label>`,'Actualizează sala',async data=>{await api.api('PUT','/api/room-shape',{labId,columns:Number(data.get('columns')),rows:Number(data.get('rows'))});$('#modal').close();await refresh();});};

$('#save-layout').onclick=()=>action(async()=>{await api.api('PUT','/api/layout',{labId,layout:currentLab().layout});layoutDirty=false;toast('Planul laboratorului a fost salvat.');});
$('#room').onclick=e=>{const card=e.target.closest('[data-device]');if(card){selectedId=card.dataset.device;renderDetail();}};
$('#room').onkeydown=e=>{
  if(e.altKey&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)&&view!=='grid'&&state.user.role==='admin'){
    const lab=currentLab(),columns=lab.columns||4,rows=lab.rows||4,turn=preferences().rotation,visualColumns=turn%2?rows:columns;
    const all=window.LaboraLayout.viewSlots(physicalSlots(),columns,rows,turn),i=all.findIndex(x=>x.device?.id===e.target.dataset.device);
    const delta={ArrowLeft:-1,ArrowRight:1,ArrowUp:-visualColumns,ArrowDown:visualColumns}[e.key],target=i+delta;
    if(i>=0&&target>=0&&target<all.length&&(!(e.key==='ArrowLeft'||e.key==='ArrowRight')||Math.floor(i/visualColumns)===Math.floor(target/visualColumns))){e.preventDefault();moveDevice(e.target.dataset.device,all[target].slot);}return;
  }
  if(['Enter',' '].includes(e.key)&&e.target.dataset.device){e.preventDefault();selectedId=e.target.dataset.device;renderDetail();}
};
function findHelp(){const waiting=devices().filter(d=>d.help).sort((a,b)=>a.help.at-b.help.at);if(!waiting.length){toast('Nu există cereri de ajutor în acest laborator.');return;}const next=waiting[(waiting.findIndex(d=>d.id===selectedId)+1)%waiting.length];selectedId=next.id;view='map';document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));render();document.querySelector(`[data-device="${CSS.escape(next.id)}"]`)?.scrollIntoView({behavior:'smooth',block:'nearest',inline:'center'});}
$('#find-help').onclick=findHelp;$('#find-help').onkeydown=e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();findHelp();}};

$('#room').ondragstart=e=>{const card=e.target.closest('[data-device]');if(!card||view==='grid'||state.user.role!=='admin'){e.preventDefault();return;}e.dataTransfer.setData('text/plain',card.dataset.device);};
$('#room').ondragover=e=>{if(view!=='grid'&&state.user.role==='admin')e.preventDefault();};
$('#room').ondrop=e=>{e.preventDefault();if(state.user.role!=='admin'||view==='grid')return;const target=e.target.closest('[data-slot]');if(target)moveDevice(e.dataTransfer.getData('text/plain'),target.dataset.slot);};
$('#close-detail').onclick=()=>{selectedId=null;renderDetail();};
$('#lesson-toggle').onclick=()=>action(()=>send({type:lesson?'lesson-stop':'lesson-start'}));
$('#control-button').onclick=()=>action(()=>send({type:controlId===selectedId?'control-stop':'control-start',to:selectedId}));
$('#resolve-help').onclick=()=>action(()=>send({type:'help-resolve',to:selectedId}));
$('#message-button').onclick=()=>modal('Mesaj către elev','<label>Mesaj pentru elev<textarea name="text" required maxlength="500" rows="4"></textarea></label>','Trimite mesajul',async data=>{await send({type:'message',to:selectedId,text:data.get('text')});$('#modal').close();toast('Mesaj trimis.');});
$('#project-button').onclick=()=>action(()=>send({type:'project',to:selectedId}));
$('#stop-projection').onclick=()=>action(()=>api.stopProject());
$('#help-button').onclick=()=>action(async()=>{await send({type:'help',message:'Am nevoie de ajutor'});toast('Profesorul a primit cererea de ajutor.');});
$('#logout').onclick=()=>action(async()=>{await api.api('POST','/api/logout');clearInterval(adminPoll);resetMedia();state=null;$('#password').value='';show('login');});
$('#login-form').onsubmit=async e=>{
  e.preventDefault();$('#login-error').textContent='';const button=e.target.querySelector('button');button.disabled=true;
  try{if(!config.managed)await api.setServer($('#server-url').value);const result=await api.api('POST','/api/login',{username:$('#username').value,password:$('#password').value});$('#password').value='';setState(result);await api.connect();
    if(config.role==='admin'){connected=true;$('#connection-status').textContent='Administrare conectată';clearInterval(adminPoll);adminPoll=setInterval(()=>refresh().catch(()=>{$('#connection-status').textContent='Server indisponibil';}),5000);}
  }catch(err){$('#login-error').textContent=err.message;}finally{button.disabled=false;}
};
function closePeer(id){const p=peers.get(id);if(p){clearTimeout(p.retry);p.pc.onconnectionstatechange=null;p.pc.close();peers.delete(id);}if(projectId===id)api.stopProject().catch(()=>{});}
function resetMedia(){lesson=false;controlId=null;teacherId=null;for(const id of peers.keys())closePeer(id);earlyCandidates.clear();fallbackFrames.clear();clearInterval(fallbackTimer);captureVideo?.pause();if(captureVideo)captureVideo.srcObject=null;captureVideo=null;capture?.getTracks().forEach(t=>t.stop());capture=null;clearInterval(projectionTimer);projectId=null;$('#detail-video').srcObject=null;$('#detail-frame').removeAttribute('src');$('#detail-frame').classList.add('hidden');$('#stop-projection').classList.add('hidden');$('#monitor-notice').classList.add('hidden');$('#control-notice').classList.add('hidden');if(state)render();}
function newPeer(id){
  closePeer(id);const pc=new RTCPeerConnection({iceServers:[]});const p={pc,stream:null,hasFrame:false,candidates:earlyCandidates.get(id)||[]};earlyCandidates.delete(id);peers.set(id,p);
  pc.onicecandidate=e=>{if(e.candidate)send({type:'signal',to:id,signal:{kind:'candidate',candidate:e.candidate.toJSON()}}).catch(()=>{});};
  pc.ontrack=e=>{p.stream=e.streams[0];attachStream(id,p.stream);if(state)renderDetail();};
  pc.onconnectionstatechange=()=>{
    if(pc.connectionState==='failed'||pc.connectionState==='disconnected'){
      p.stream=null;p.hasFrame=false;renderRoomIfTeacher();if(projectId===id)api.stopProject().catch(()=>{});
      if(config.role==='student'&&lesson)p.retry=setTimeout(()=>offer(id).catch(e=>toast(e.message,true)),2000);
    }
  };
  return p;
}
function renderRoomIfTeacher(){if(state){renderRoom();renderDetail();}}
async function offer(id){if(!lesson||!capture)return;const p=newPeer(id);capture.getTracks().forEach(t=>p.pc.addTrack(t,capture));await p.pc.setLocalDescription(await p.pc.createOffer());await send({type:'signal',to:id,signal:{kind:'offer',description:p.pc.localDescription.toJSON()}});}
async function signal(m){
  if(!lesson)return;let p=peers.get(m.from);
  if(m.signal.kind==='offer'){
    if(config.role!=='teacher')return;p=newPeer(m.from);await p.pc.setRemoteDescription(m.signal.description);for(const c of p.candidates)await p.pc.addIceCandidate(c);p.candidates=[];await p.pc.setLocalDescription(await p.pc.createAnswer());await send({type:'signal',to:m.from,signal:{kind:'answer',description:p.pc.localDescription.toJSON()}});
  }else if(m.signal.kind==='answer'){if(!p||config.role!=='student')return;await p.pc.setRemoteDescription(m.signal.description);for(const c of p.candidates)await p.pc.addIceCandidate(c);p.candidates=[];
  }else if(m.signal.kind==='candidate'){if(!p){const queued=earlyCandidates.get(m.from)||[];if(queued.length<64)queued.push(m.signal.candidate);earlyCandidates.set(m.from,queued);return;}if(p.pc.remoteDescription)await p.pc.addIceCandidate(m.signal.candidate);else if(p.candidates.length<64)p.candidates.push(m.signal.candidate);}
}
async function startCapture(m){
  teacherId=m.teacherId;$('#student-status').textContent=`Oră activă · ${m.teacherName}`;
  try{capture=await navigator.mediaDevices.getDisplayMedia({video:{frameRate:{ideal:15,max:20},width:{ideal:1280},height:{ideal:720}},audio:false});
    if(!lesson){capture.getTracks().forEach(t=>t.stop());capture=null;return;}$('#monitor-notice').classList.remove('hidden');capture.getVideoTracks()[0].onended=()=>{capture=null;clearInterval(fallbackTimer);$('#monitor-notice').classList.add('hidden');for(const id of peers.keys())closePeer(id);$('#student-status').textContent='Partajarea ecranului s-a oprit.';};await startFallback();await offer(teacherId);
  }catch(e){$('#student-status').textContent='Capturarea nu a pornit. Anunță profesorul sau suportul IT.';toast(e.message,true);}
}
async function startFallback(){
  captureVideo=document.createElement('video');captureVideo.muted=true;captureVideo.srcObject=capture;await captureVideo.play();
  const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');let busy=false;
  clearInterval(fallbackTimer);fallbackTimer=setInterval(async()=>{
    if(busy||!lesson||!capture||!teacherId||!captureVideo||captureVideo.readyState<2)return;busy=true;
    try{
      const ratio=captureVideo.videoHeight/captureVideo.videoWidth;let frame;
      for(const width of [960,720,480]){canvas.width=width;canvas.height=Math.round(width*ratio);ctx.drawImage(captureVideo,0,0,canvas.width,canvas.height);frame=canvas.toDataURL('image/jpeg',.55);if(frame.length<=60000)break;}
      if(frame.length<=60000)await send({type:'frame',frame});
    }catch{}finally{busy=false;}
  },500);
}
async function startProjection(id){
  if(!hasScreen(id))throw Error('Ecranul nu este încă disponibil.');await api.project();projectId=id;$('#stop-projection').classList.remove('hidden');clearInterval(projectionTimer);
  const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=720;const ctx=canvas.getContext('2d');
  projectionTimer=setInterval(()=>{if(!lesson)return;const card=document.querySelector(`[data-device="${CSS.escape(id)}"]`),v=card?.querySelector('video'),img=card?.querySelector('img');const source=peers.get(id)?.hasFrame&&v?.readyState>=2?v:hasFallback(id)&&img?.complete?img:null;if(!source)return;const sw=source.videoWidth||source.naturalWidth,sh=source.videoHeight||source.naturalHeight;if(!sw||!sh)return;ctx.fillStyle='#080d19';ctx.fillRect(0,0,1280,720);const ratio=Math.min(1280/sw,720/sh),w=sw*ratio,h=sh*ratio;ctx.drawImage(source,(1280-w)/2,(720-h)/2,w,h);api.projectFrame(canvas.toDataURL('image/jpeg',.78));},100);
}
// Normalize pointer coordinates to the contained video, excluding black bars.
function point(e){const v=peers.get(selectedId)?.hasFrame?$('#detail-video'):$('#detail-frame'),r=$('#detail-media').getBoundingClientRect();const sw=v.videoWidth||v.naturalWidth,sh=v.videoHeight||v.naturalHeight;if(!sw||!hasScreen(selectedId))return null;const ratio=Math.min(r.width/sw,r.height/sh),w=sw*ratio,h=sh*ratio;const x=(e.clientX-r.left-(r.width-w)/2)/w,y=(e.clientY-r.top-(r.height-h)/2)/h;return x>=0&&x<=1&&y>=0&&y<=1?{x,y}:null;}
$('#detail-media').onclick=e=>{if(controlId!==selectedId)return;const p=point(e);if(p)action(()=>send({type:'input',to:selectedId,event:{kind:'pointer',action:'click',...p}}));};
$('#detail-media').oncontextmenu=e=>{e.preventDefault();if(controlId!==selectedId)return;const p=point(e);if(p)action(()=>send({type:'input',to:selectedId,event:{kind:'pointer',action:'right',...p}}));};
$('#detail-media').onkeydown=e=>{if(controlId!==selectedId||!hasScreen(selectedId)||e.ctrlKey||e.altKey||e.metaKey)return;if(/^[a-zA-Z0-9]$/.test(e.key)||['Enter','Backspace','Tab','Escape','ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(e.key)){e.preventDefault();action(()=>send({type:'input',to:selectedId,event:{kind:'key',key:e.key}}));}};
api.onEvent(m=>action(async()=>{
  if(m.type==='state'){setState(m.data);const online=new Set(m.data.labs.flatMap(l=>l.devices.filter(d=>d.online).map(d=>d.id)));for(const id of peers.keys())if(!online.has(id))closePeer(id);}
  else if(m.type==='ready'){connected=true;$('#connection-status').textContent='Conectat la serverul școlii';$('#student-status').textContent='Conectat · Se așteaptă începerea orei';if(state)render();}
  else if(m.type==='lesson-started'){resetMedia();lesson=true;if(config.role==='student')await startCapture(m);else if(state)render();}
  else if(m.type==='lesson-ended'){resetMedia();$('#student-status').textContent='Ora s-a încheiat · Ecranul nu este partajat';}
  else if(m.type==='signal')await signal(m);
  else if(m.type==='frame'&&lesson){fallbackFrames.set(m.from,{frame:m.frame,at:Date.now(),ready:false});attachFrame(m.from);}
  else if(m.type==='disconnected'){connected=false;resetMedia();$('#connection-status').textContent='Deconectat · Reconectare automată';$('#student-status').textContent='Conexiune întreruptă · Partajarea și controlul sunt oprite';if(state)render();}
  else if(m.type==='auth-expired'){state=null;show('login');$('#login-error').textContent='Sesiunea a expirat. Autentifică-te din nou.';}
  else if(m.type==='control-started'){controlId=m.deviceId;renderDetail();$('#detail-media').focus();}
  else if(m.type==='control-stopped'){controlId=null;renderDetail();}
  else if(m.type==='control')$('#control-notice').classList.toggle('hidden',!m.enabled);
  else if(m.type==='message'){$('#student-message').textContent=m.text;$('#student-message').classList.remove('hidden');}
  else if(m.type==='projected')toast('Profesorul a selectat ecranul tău pentru proiecție.');
  else if(m.type==='project-approved')await startProjection(m.deviceId);
  else if(m.type==='projection-closed'){clearInterval(projectionTimer);projectId=null;$('#stop-projection').classList.add('hidden');}
  else if(m.type==='error')toast(m.message,true);
}));
setInterval(()=>{let changed=false;for(const [id,f]of fallbackFrames)if(Date.now()-f.at>=3000){fallbackFrames.delete(id);changed=true;}if(changed&&state){renderRoom();renderDetail();}},1000);
async function init(){config=await api.config();$('#server-url').value=config.serverUrl;$('#server-url').readOnly=config.managed;if(config.role==='student'){show('student');$('#student-name').textContent=config.name;}else show('login');$('#clock').textContent=new Date().toLocaleDateString('ro-RO',{day:'numeric',month:'short'});}
init().catch(e=>toast(e.message,true));
