import { createSocket } from 'node:dgram';
import { hostname } from 'node:os';

// Descoperire în LAN prin broadcast UDP. Elevul întreabă, serverul din laborator răspunde.
// Rezolvă schimbarea adresei IP: nimeni nu configurează manual adrese în laborator.
export const DISCOVERY_PORT = 4311;
const MAGIC = 'labora-discovery-1';

export function parseQuery(buffer) {
  try {
    const m = JSON.parse(buffer.toString('utf8').slice(0, 512));
    return m && m.magic === MAGIC && m.type === 'query' ? m : null;
  } catch { return null; }
}

export function parseAnnouncement(buffer) {
  try {
    const m = JSON.parse(buffer.toString('utf8').slice(0, 1024));
    if (!m || m.magic !== MAGIC || m.type !== 'server') return null;
    if (typeof m.url !== 'string') return null;
    const u = new URL(m.url);
    // Acceptăm doar o origine curată: fără cale, credențiale sau parametri.
    if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash || u.pathname !== '/') return null;
    return { url: u.origin, name: typeof m.name === 'string' ? m.name.slice(0, 100) : '', fingerprint: typeof m.fingerprint === 'string' ? m.fingerprint.slice(0, 200) : '' };
  } catch { return null; }
}

// Pornită pe calculatorul profesorului, alături de server.
export function advertise({ url, name = hostname(), fingerprint = '', port = DISCOVERY_PORT } = {}) {
  const socket = createSocket({ type: 'udp4', reuseAddr: true });
  const payload = Buffer.from(JSON.stringify({ magic: MAGIC, type: 'server', url, name, fingerprint }));
  socket.on('message', (msg, remote) => {
    if (!parseQuery(msg)) return;
    socket.send(payload, remote.port, remote.address, () => {});
  });
  socket.on('error', () => socket.close());
  socket.bind(port, () => { try { socket.setBroadcast(true); } catch {} });
  return { socket, close: () => new Promise(r => socket.close(r)) };
}

// Rulată pe calculatorul elevului la pornire, când nu are încă o adresă validă.
export function discover({ timeout = 2500, port = DISCOVERY_PORT } = {}) {
  return new Promise(resolve => {
    const socket = createSocket({ type: 'udp4', reuseAddr: true });
    const found = [];
    const done = () => { try { socket.close(); } catch {} resolve(found); };
    const timer = setTimeout(done, timeout);
    timer.unref?.();
    socket.on('message', msg => {
      const server = parseAnnouncement(msg);
      if (server && !found.some(s => s.url === server.url)) found.push(server);
    });
    socket.on('error', () => { clearTimeout(timer); done(); });
    socket.bind(() => {
      socket.setBroadcast(true);
      const query = Buffer.from(JSON.stringify({ magic: MAGIC, type: 'query' }));
      socket.send(query, port, '255.255.255.255', err => { if (err) { clearTimeout(timer); done(); } });
    });
  });
}
