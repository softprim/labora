// Serverul de laborator, pornit în interiorul aplicației pe calculatorul profesorului.
// Rulează într-un proces separat ca o eroare a serverului să nu închidă interfața.
const { fork } = require('node:child_process');
const path = require('node:path');
const { existsSync, mkdirSync } = require('node:fs');

const PORT = 4310;
let child = null, restarts = 0, restartTimer = null, stopping = false;

function dataDir() {
  const base = process.platform === 'win32' ? path.join(process.env.ProgramData || 'C:\ProgramData', 'Labora') : (process.env.LABORA_HOME || path.join(require('node:os').homedir(), '.labora'));
  mkdirSync(base, { recursive: true });
  return base;
}

function entrypoint() {
  // În pachet, server/ este livrat lângă codul desktop.
  const packaged = path.join(__dirname, '..', 'server', 'index.mjs');
  return existsSync(packaged) ? packaged : path.join(__dirname, '..', 'server', 'index.mjs');
}

// Pornește serverul și îl repornește dacă moare. Ora se pierde, dar laboratorul revine singur.
function start({ onLog = () => {}, onState = () => {} } = {}) {
  if (child || stopping) return;
  const base = dataDir();
  const env = {
    ...process.env,
    LABORA_HOST: '0.0.0.0',
    LABORA_PORT: String(PORT),
    LABORA_DATA: path.join(base, 'store.json'),
    LABORA_CERT_DIR: path.join(base, 'certs'),
    LABORA_ADVERTISE: '1',
  };
  child = fork(entrypoint(), [], { env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  onState({ running: true, restarts });
  child.stdout?.on('data', d => onLog(String(d).trim()));
  child.stderr?.on('data', d => onLog(String(d).trim()));
  child.on('exit', code => {
    child = null;
    onState({ running: false, restarts, code });
    if (stopping) return;
    // Repornire cu pas crescător, plafonat: un server care cade repetat nu blochează calculatorul.
    restarts += 1;
    const delay = Math.min(30000, 1000 * Math.min(restarts, 10));
    onLog(`Serverul s-a oprit (cod ${code}). Repornire în ${Math.round(delay / 1000)}s.`);
    restartTimer = setTimeout(() => start({ onLog, onState }), delay);
  });
  return child;
}

function stop() {
  stopping = true;
  clearTimeout(restartTimer);
  if (child) { child.kill(); child = null; }
}

module.exports = { start, stop, running: () => !!child, PORT, dataDir };
