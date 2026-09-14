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
  for(const width of [320,390,720,1024,1440]){
    await admin.setViewportSize({width,height:1000});
    for(const mode of ['▧ Plan 2D','◇ Perspectivă 3D']){
      await admin.getByRole('button',{name:mode,exact:true}).click();
      await admin.waitForFunction(()=>document.querySelector('.floor-stage')?.style.transform.includes('scale'));
      const geometry=await admin.locator('.device').evaluateAll(cards=>cards.map(card=>{const r=card.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};}));
      for(let i=0;i<geometry.length;i++)for(let j=i+1;j<geometry.length;j++){const a=geometry[i],b=geometry[j];assert.ok(a.right<=b.left||b.right<=a.left||a.bottom<=b.top||b.bottom<=a.top,`Overlapping cards at ${width}px`);}
      assert.ok(await admin.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),`Horizontal overflow at ${width}px`);
    }
  }
  await admin.setViewportSize({width:1440,height:1000});await admin.getByRole('button',{name:'▧ Plan 2D',exact:true}).click();
  await admin.getByRole('button',{name:'PC-01, conectat',exact:true}).press('Alt+ArrowRight');await admin.getByRole('button',{name:'Salvează planul',exact:true}).click();
  await expect(admin.locator('#toast')).toHaveText('Planul laboratorului a fost salvat.');
  // Exercise real API persistence and physical slots across every viewing direction.
  const pc=admin.getByRole('button',{name:'PC-01, conectat',exact:true});
  for(let turn=0;turn<4;turn++){
    await admin.locator('#rotate-right').click();
    await admin.locator('#move-pc').click();
    const before=Number(await pc.getAttribute('data-slot'));
    const destination=admin.locator('.empty-slot').first();const slot=await destination.getAttribute('data-slot');
    await pc.click();await destination.click();await expect(pc).toHaveAttribute('data-slot',slot);
    await admin.locator('#save-layout').click();await expect(admin.locator('#save-layout')).toBeDisabled();
    await admin.locator('#move-pc').click();
    assert.notEqual(Number(slot),before);
  }
  const savedSlot=await pc.getAttribute('data-slot');
  await admin.reload();await admin.locator('[data-view="map"]').click();await expect(pc).toHaveAttribute('data-slot',savedSlot);
  // Consecutive keyboard moves keep focus on the same physical computer.
  await admin.locator('#move-pc').click();await pc.click();await admin.locator('[data-slot="0"]').click();await admin.locator('#move-pc').click();
  await pc.press('Alt+ArrowRight');await expect(pc).toBeFocused();await pc.press('Alt+ArrowRight');await expect(pc).toBeFocused();await expect(pc).toHaveAttribute('data-slot','2');
  await admin.locator('#save-layout').click();await expect(admin.locator('#save-layout')).toBeDisabled();
  // Maximum supported rectangular plan fits after all rotations, without page overflow.
  await admin.locator('#room-shape').click();await admin.locator('[name="columns"]').fill('12');await admin.locator('[name="rows"]').fill('16');await admin.locator('#modal-submit').click();await expect(admin.locator('#modal')).not.toBeVisible();
  for(const width of [320,720,1440]){
    await admin.setViewportSize({width,height:900});
    for(let turn=0;turn<4;turn++){
      await admin.locator('#rotate-right').click();
      await admin.waitForFunction(()=>document.querySelector('.floor-stage')?.style.transform.includes('scale'));
      const fits=await admin.locator('#room').evaluate(room=>{const r=room.getBoundingClientRect(),s=room.querySelector('.floor-stage').getBoundingClientRect();return s.width<=room.clientWidth+1&&s.height<=room.clientHeight+1&&s.left>=r.left&&document.documentElement.scrollWidth<=innerWidth+1;});
      assert.ok(fits,`Full 12x16 plan fits at ${width}, rotation ${turn}`);
    }
  }
  await admin.setViewportSize({width:1440,height:1000});
  await admin.locator('#room-shape').click();await admin.locator('[name="columns"]').fill('4');await admin.locator('[name="rows"]').fill('4');await admin.locator('#modal-submit').click();await expect(admin.locator('#modal')).not.toBeVisible();
  await expect(admin.locator('#toast')).toBeHidden({timeout:8000});await admin.locator('#zoom-fit').click();await admin.waitForFunction(()=>document.querySelector('.floor-stage')?.style.transform.includes('scale'));await admin.screenshot({path:'test-results/labora-plan-desktop.png',fullPage:true});
  await admin.setViewportSize({width:390,height:1000});await admin.locator('#zoom-fit').click();await admin.waitForFunction(()=>{const room=document.querySelector('#room');return room.querySelector('.floor-stage').getBoundingClientRect().width<=room.clientWidth;});await admin.screenshot({path:'test-results/labora-plan-mobile.png',fullPage:true});
  assert.deepEqual(errors,[]);
  console.log('PASS: responsive plan, four rotations, click movement, reload persistence, keyboard focus, 12x16 fit');
}finally{await browser?.close();harness.kill('SIGTERM');}

