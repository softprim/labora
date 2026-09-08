// Full-browser integration test for development/CI, with synthetic screen frames.
// Native capture, Windows input and the second-display window require Windows QA.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium,expect } from '@playwright/test';
const port=14311,base=`http://127.0.0.1:${port}`;
const harness=spawn(process.execPath,['tests/browser-harness.mjs','--port',String(port)],{stdio:'pipe'});
let browser;
try{
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Harness start timeout')),15000);harness.stdout.on('data',x=>{if(x.toString().includes('TEST ONLY:')){clearTimeout(timer);resolve();}});harness.once('error',reject);harness.once('exit',code=>{clearTimeout(timer);reject(Error('Harness exited '+code));});});
  browser=await chromium.launch({headless:true,...(process.env.UI_BROWSER_EXECUTABLE?{executablePath:process.env.UI_BROWSER_EXECUTABLE}:{})});
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  const teacher=await context.newPage(),student=await context.newPage(),admin=await context.newPage();
  const errors=[];for(const page of [teacher,student,admin])page.on('pageerror',e=>errors.push(e.message));
  await teacher.goto(base+'/teacher');await student.goto(base+'/student');await admin.goto(base+'/admin');
  await expect(teacher.getByRole('button',{name:'▶ Începe ora',exact:true})).toBeEnabled();
  await expect(teacher.locator('.device')).toHaveCount(12);
  await expect(teacher.getByRole('button',{name:'＋ Adaugă laborator',exact:true})).toBeHidden();
  await admin.getByRole('button',{name:'＋ Adaugă laborator',exact:true}).click();await admin.getByRole('textbox',{name:'Denumire',exact:true}).fill('Laborator robotică — test');await admin.getByRole('button',{name:'Creează laboratorul',exact:true}).click();
  await expect(admin.getByRole('heading',{name:'Laborator robotică — test',exact:true})).toBeVisible();
  console.log('PASS: role-specific UI and laboratory creation');
  await teacher.getByRole('button',{name:'▶ Începe ora',exact:true}).click();await expect(student.locator('#monitor-notice')).toBeVisible();
  await expect.poll(()=>teacher.locator('.device').first().evaluate(card=>{const v=card.querySelector('video'),i=card.querySelector('img');return (v?.videoWidth||0)+(i?.naturalWidth||0);}),{timeout:15000}).toBeGreaterThan(0);
  console.log('PASS: synthetic live screen received via WebRTC or authenticated fallback');
  await student.getByRole('button',{name:'✋ Am nevoie de ajutor',exact:true}).click();await expect(teacher.locator('#stat-help')).toHaveText('1');
  await teacher.getByRole('button',{name:'PC-01, conectat',exact:true}).click();await teacher.getByRole('button',{name:'Preia controlul',exact:true}).click();await expect(student.locator('#control-notice')).toBeVisible();
  await teacher.getByRole('button',{name:'Oprește controlul',exact:true}).click();await expect(student.locator('#control-notice')).toBeHidden();
  await teacher.getByRole('button',{name:'Trimite un mesaj',exact:true}).click();await teacher.getByRole('textbox',{name:'Mesaj pentru elev',exact:true}).fill('Mesaj de test');await teacher.getByRole('button',{name:'Trimite mesajul',exact:true}).click();await expect(student.locator('#student-message')).toHaveText('Mesaj de test');
  await teacher.getByRole('button',{name:'✓ Marchează ajutorul rezolvat',exact:true}).click();await expect(teacher.locator('#stat-help')).toHaveText('0');
  console.log('PASS: help, control signaling, direct messages and help resolution');
  await teacher.getByRole('button',{name:'▣ Trimite pe proiector',exact:true}).click();
  await expect.poll(async()=>{const r=await fetch(base+'/test/teacher/metrics',{method:'POST',body:'{}'});return (await r.json()).frames;},{timeout:10000}).toBeGreaterThan(0);
  console.log('PASS: projection frame delivery to test bridge (not native monitor placement)');
  await teacher.getByRole('button',{name:'Închide',exact:true}).click();await teacher.getByRole('button',{name:'Oprește proiecția',exact:true}).click();
  await teacher.getByRole('button',{name:'▧ Plan 2D',exact:true}).click();await expect(teacher.locator('#room')).toHaveClass('room map');await teacher.getByRole('button',{name:'◇ Perspectivă 3D',exact:true}).click();await expect(teacher.locator('#room')).toHaveClass('room space');await teacher.getByRole('button',{name:'▦ Ecrane',exact:true}).click();
  mkdirSync('test-results',{recursive:true});await teacher.screenshot({path:'test-results/labora-dashboard.png',fullPage:true});
  await teacher.getByRole('button',{name:'■ Încheie ora',exact:true}).click();await expect(student.locator('#monitor-notice')).toBeHidden();await expect.poll(()=>teacher.locator('.device video').first().evaluate(v=>v.srcObject===null)).toBe(true);
  assert.deepEqual(errors,[]);console.log('PASS: view switching, lesson teardown, no application page errors');
  await admin.getByRole('button',{name:'▦ Laborator informatică 1 12',exact:true}).click();
  for(const width of [390,720,1024,1440]){
    await admin.setViewportSize({width,height:1000});
    for(const mode of ['▧ Plan 2D','◇ Perspectivă 3D']){
      await admin.getByRole('button',{name:mode,exact:true}).click();
      const geometry=await admin.locator('.device').evaluateAll(cards=>cards.map(card=>{const r=card.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};}));
      for(let i=0;i<geometry.length;i++)for(let j=i+1;j<geometry.length;j++){const a=geometry[i],b=geometry[j];assert.ok(a.right<=b.left||b.right<=a.left||a.bottom<=b.top||b.bottom<=a.top,`Overlapping cards at ${width}px`);}
      assert.ok(await admin.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),`Horizontal overflow at ${width}px`);
    }
  }
  await admin.setViewportSize({width:1440,height:1000});await admin.getByRole('button',{name:'▧ Plan 2D',exact:true}).click();
  await admin.getByRole('button',{name:'PC-01, conectat',exact:true}).press('Alt+ArrowRight');await admin.getByRole('button',{name:'Salvează planul',exact:true}).click();
  await expect(admin.locator('#toast')).toHaveText('Planul laboratorului a fost salvat.');
  console.log('PASS: 390/720/1024/1440px room geometry, no overlaps, keyboard rearrangement');
}finally{await browser?.close();harness.kill('SIGTERM');}
