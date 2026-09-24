import test from 'node:test';
import assert from 'node:assert/strict';
import { advertise, discover, parseAnnouncement, parseQuery, DISCOVERY_PORT } from '../server/discovery.mjs';

const PORT = 45311; // port de test, ca să nu ciocnim serviciul real

test('Discovery accepts only clean HTTPS origins from the local network', () => {
  const wrap = o => Buffer.from(JSON.stringify(o));
  const good = { magic: 'labora-discovery-1', type: 'server', url: 'https://10.0.0.5:4310/', name: 'Catedra' };
  assert.equal(parseAnnouncement(wrap(good)).url, 'https://10.0.0.5:4310');
  // HTTP simplu este refuzat: elevii nu trebuie să cadă pe o conexiune necriptată.
  assert.equal(parseAnnouncement(wrap({ ...good, url: 'http://10.0.0.5:4310/' })), null);
  // Cale, credențiale sau parametri în adresă sunt refuzate.
  assert.equal(parseAnnouncement(wrap({ ...good, url: 'https://10.0.0.5:4310/admin' })), null);
  assert.equal(parseAnnouncement(wrap({ ...good, url: 'https://a:b@10.0.0.5:4310/' })), null);
  assert.equal(parseAnnouncement(wrap({ ...good, url: 'https://10.0.0.5:4310/?x=1' })), null);
  // Mesaje străine sau stricate nu produc excepții.
  assert.equal(parseAnnouncement(Buffer.from('nu-i json')), null);
  assert.equal(parseAnnouncement(wrap({ magic: 'altceva', type: 'server', url: 'https://10.0.0.5/' })), null);
  assert.equal(parseQuery(Buffer.from('nu-i json')), null);
  assert.equal(parseQuery(wrap({ magic: 'labora-discovery-1', type: 'query' })).type, 'query');
});

test('A student finds the teacher server on the local network', async t => {
  const url = 'https://127.0.0.1:4310';
  const beacon = advertise({ url, name: 'Catedra Lab 1', fingerprint: 'AA:BB', port: PORT });
  t.after(() => beacon.close());
  await new Promise(r => setTimeout(r, 100));
  const found = await discover({ timeout: 1500, port: PORT });
  const server = found.find(s => s.url === url);
  assert.ok(server, 'serverul profesorului trebuie găsit prin broadcast');
  assert.equal(server.name, 'Catedra Lab 1');
  assert.equal(server.fingerprint, 'AA:BB');
});

test('Discovery resolves quickly when no server answers', async () => {
  const started = Date.now();
  const found = await discover({ timeout: 400, port: 45999 });
  assert.deepEqual(found, []);
  assert.ok(Date.now() - started < 3000, 'căutarea nu trebuie să blocheze pornirea aplicației');
});

test('The discovery port is stable', () => assert.equal(DISCOVERY_PORT, 4311));
