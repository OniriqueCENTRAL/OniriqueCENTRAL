// Relais du VPN d'ONIRIQUE Navigateur : node test/vpn.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onirique-central-vpn-'));
process.env.DATA_DIR = dataDir;
const { autoriser, estAutorise, destination, creerRelais, jetonVpn, jetonValide, MODE_IP_JUSQUA } = await import('../src/vpn.js');

// Autorisations par adresse (anciens navigateurs) : 12 heures, l'adresse IPv4 vue en IPv6 compte pour la même.
const t0 = Math.min(Date.now(), MODE_IP_JUSQUA - 86400_000);
autoriser('::ffff:203.0.113.7', 1, t0);
assert.equal(estAutorise('203.0.113.7', t0 + 1000), true);
assert.equal(estAutorise('203.0.113.7', t0 + 13 * 3600_000), false);
assert.equal(estAutorise('198.51.100.1'), false);
assert.equal(autoriser('198.51.100.9', 1, MODE_IP_JUSQUA), null, 'après la date, plus d\'ouverture par adresse');

// Jetons : valables 3 jours, signés ; un jeton modifié ou expiré est refusé.
const basic = (mot) => `Basic ${Buffer.from(`onirique:${mot}`).toString('base64')}`;
const { jeton, expire } = jetonVpn(42, t0);
assert.equal(jetonValide(basic(jeton), t0 + 1000), true);
assert.equal(jetonValide(basic(jeton), expire + 1), false);
assert.equal(jetonValide(basic(jeton.replace(/^42\./, '43.')), t0), false, 'un autre compte ne se fabrique pas');
assert.equal(jetonValide(basic(`${jeton.slice(0, -2)}xx`), t0), false);
assert.equal(jetonValide('Bearer abc'), false);
assert.equal(jetonValide(undefined), false);

// Destinations : sites publics sur 80 et 443 seulement, jamais d'adresse interne.
const faux = (adresse) => async () => ({ address: adresse, family: adresse.includes(':') ? 6 : 4 });
assert.deepEqual(await destination('exemple.test', 443, faux('93.184.216.34')), { address: '93.184.216.34', port: 443 });
await assert.rejects(destination('exemple.test', 25, faux('93.184.216.34')));
await assert.rejects(destination('exemple.test', 4850, faux('93.184.216.34')));
for (const interne of ['127.0.0.1', '10.1.2.3', '192.168.1.1', '172.20.0.5', '169.254.169.254', '100.64.0.1', '::1', 'fe80::1', 'fd00::1', '0.0.0.0', '::ffff:10.0.0.1', '::ffff:127.0.0.1']) {
  await assert.rejects(destination('piege.test', 443, faux(interne)), `${interne} doit être refusée`);
}

// Le relais de bout en bout : un faux site, joint par tunnel (CONNECT) puis en HTTP simple.
const site = http.createServer((req, res) => res.end(`ok ${req.headers.host} ${req.url}`)).listen(0, '127.0.0.1');
await new Promise((r) => site.once('listening', r));
const verifier = async (hote, port) => {
  if (hote !== 'site.test') throw new Error('refusé');
  return { address: '127.0.0.1', port: site.address().port };
};
const relais = creerRelais({ verifier }).listen(0, '127.0.0.1');
await new Promise((r) => relais.once('listening', r));
const port = relais.address().port;

const connect = (cible, auth = '') => new Promise((resolve) => {
  const s = net.connect(port, '127.0.0.1', () => s.write(`CONNECT ${cible} HTTP/1.1\r\nHost: ${cible}\r\n${auth ? `Proxy-Authorization: ${auth}\r\n` : ''}\r\n`));
  let data = '';
  s.on('data', (d) => {
    data += d;
    if (data.includes('\r\n\r\n') && !data.startsWith('HTTP/1.1 200')) { s.destroy(); resolve({ statut: data.split(' ')[1] }); }
    else if (data.startsWith('HTTP/1.1 200') && !s.envoye) { s.envoye = true; s.write('GET /tunnel HTTP/1.1\r\nHost: site.test\r\nConnection: close\r\n\r\n'); }
    else if (data.includes('ok site.test /tunnel')) { s.destroy(); resolve({ statut: '200', corps: data }); }
  });
  s.on('error', () => resolve({ statut: 'erreur' }));
});

assert.equal((await connect('site.test:443')).statut, '407', 'sans jeton ni adresse annoncée, le relais demande le jeton');
assert.equal((await connect('site.test:443', basic('1.9999999999999.faux'))).statut, '407', 'un faux jeton ne passe pas');
const avecJeton = await connect('site.test:443', basic(jetonVpn(7).jeton));
assert.equal(avecJeton.statut, '200', 'le jeton ouvre le relais');
assert.match(avecJeton.corps, /ok site\.test \/tunnel/);
assert.equal((await connect('ailleurs.test:443', basic(jetonVpn(7).jeton))).statut, '403', 'même avec jeton, une destination refusée ne passe pas');
if (Date.now() < MODE_IP_JUSQUA) { // l'ancien mode, tant qu'il est accepté
  autoriser('127.0.0.1', 1);
  assert.equal((await connect('site.test:443')).statut, '200', 'une adresse annoncée passe sans jeton');
}

// En HTTP simple : le jeton est demandé, puis l'en-tête Proxy-Authorization ne part jamais vers le site.
const get = (headers) => new Promise((resolve) => http.get({ host: '127.0.0.1', port, path: 'http://site.test/page?x=1', headers },
  (r) => { let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => resolve({ statut: r.statusCode, defi: r.headers['proxy-authenticate'], corps: b })); }));
const sansJeton = await get({});
if (Date.now() >= MODE_IP_JUSQUA) assert.deepEqual([sansJeton.statut, sansJeton.defi], [407, 'Basic realm="ONIRIQUE VPN"']);
assert.equal((await get({ 'Proxy-Authorization': basic(jetonVpn(7).jeton) })).corps, 'ok site.test /page?x=1');

relais.close();
site.close();
fs.rmSync(dataDir, { recursive: true, force: true });
console.log('VPN : ok');
