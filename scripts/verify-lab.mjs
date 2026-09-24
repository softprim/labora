// Verificarea laboratorului pentru ziua de configurare: arată ce calculatoare sunt înrolate,
// care sunt online și ce loc ocupă în plan, ca administratorul să confirme sala dintr-o privire.
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';

const base = process.env.LABORA_SERVER || 'https://127.0.0.1:4310';
// Certificatul din laborator este auto-semnat; verificarea rulează pe calculatorul profesorului.
if (process.env.LABORA_INSECURE === '1') process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

let muted = false;
const output = new Writable({ write(chunk, _e, cb) { if (!muted) process.stdout.write(chunk); cb(); } });
const rl = createInterface({ input: process.stdin, output, terminal: process.stdin.isTTY });

async function request(path, token, method = 'GET', body) {
  const r = await fetch(new URL(path, base), {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || `Cererea a eșuat (${r.status}).`);
  return data;
}

function report(lab) {
  const devices = lab.devices || [];
  const students = devices.filter(d => d.role === 'student');
  const teachers = devices.filter(d => d.role === 'teacher');
  const online = devices.filter(d => d.online);
  const placed = students.filter(d => Number.isInteger(lab.layout?.[d.id]?.slot));
  const capacity = (lab.columns || 4) * (lab.rows || 4);

  console.log(`\n=== ${lab.name} ===`);
  console.log(`Grilă: ${lab.columns}×${lab.rows} (${capacity} locuri)`);
  console.log(`Calculatoare: ${devices.length} înrolate — ${students.length} elevi, ${teachers.length} profesor`);
  console.log(`Online acum: ${online.length}/${devices.length}`);
  console.log(`Poziționate în plan: ${placed.length}/${students.length}`);

  const problems = [];
  if (!teachers.length) problems.push('Nu există niciun calculator înrolat ca profesor: ora nu poate porni.');
  if (students.length > capacity) problems.push('Sunt mai multe calculatoare decât locuri în grilă.');
  for (const d of students) if (!Number.isInteger(lab.layout?.[d.id]?.slot)) problems.push(`"${d.name}" nu are loc în plan.`);
  for (const d of devices) if (!d.online) problems.push(`"${d.name}" este offline.`);

  if (problems.length) { console.log('\nDe rezolvat:'); for (const p of problems) console.log(`  - ${p}`); }
  else console.log('\nLaboratorul este complet configurat și toate calculatoarele răspund.');
  return problems.length;
}

try {
  console.log(`Server: ${base}`);
  // Credențialele pot veni din mediu, pentru verificări automate în ziua de configurare.
  const username = process.env.LABORA_USER || await rl.question('Utilizator administrator: ');
  let password = process.env.LABORA_PASSWORD;
  if (!password) {
    process.stdout.write('Parolă (ascunsă): '); muted = true;
    password = await rl.question(''); muted = false; process.stdout.write(String.fromCharCode(10));
  }

  const session = await request('/api/login', undefined, 'POST', { username, password });
  const state = await request('/api/state', session.token);
  if (!state.labs.length) { console.log('Nu administrați niciun laborator.'); process.exit(1); }

  let problems = 0;
  for (const lab of state.labs) problems += report(lab);
  await request('/api/logout', session.token, 'POST').catch(() => {});

  console.log(problems ? `\n${problems} probleme de rezolvat înainte de prima oră.` : '\nToate laboratoarele sunt gata.');
  process.exitCode = problems ? 1 : 0;
} catch (e) {
  console.error(`Eroare: ${e.message}`);
  process.exitCode = 1;
} finally { muted = false; rl.close(); }
