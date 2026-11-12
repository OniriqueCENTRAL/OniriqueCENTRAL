// VPN d'ONIRIQUE Navigateur : un relais (proxy) que seul le navigateur emprunte, comme celui d'Opera GX.
//
// Le navigateur s'annonce avec le compte connecté (POST /api/vpn) et reçoit un jeton signé, valable 3 jours, qu'il
// présente au relais (Proxy-Authorization en Basic, demandé par une réponse 407) ; il se réannonce toutes les 10 minutes
// tant que le VPN reste allumé. Une adresse IP partagée (4G, wifi d'école) ne suffit donc plus pour emprunter le relais.
// Le relais écoute en TLS sur le port 3129 avec le certificat du site : entre l'ordinateur et le serveur, rien ne
// circule en clair, jeton compris.
//
// Garde-fous : seuls les ports 80 et 443 sont joignables (pas d'envoi de courrier ni d'autre service), jamais une
// adresse privée ni le serveur lui-même (rien d'interne ne s'ouvre au public), 64 connexions à la fois par adresse.
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { config } from './config.js';

export const VPN_PORT = Number(process.env.VPN_PORT || 3129);
export const VPN_RELAIS = `https://onirique.store:${VPN_PORT}`;
const DUREE = 12 * 3600_000;
const DUREE_JETON = 3 * 86400_000; // le moteur garde le jeton tant qu'il marche : un jeton plus court l'interromprait
// Les navigateurs d'avant le jeton n'ont que leur adresse IP : ils l'annoncent encore jusqu'à cette date, le temps de se
// mettre à jour. Après, seule l'annonce avec jeton est acceptée.
export const MODE_IP_JUSQUA = Date.UTC(2026, 11, 31);

let cle;
const cleVpn = () => {
  if (cle) return cle;
  const fichier = path.join(config.keysDir, 'vpn.key');
  if (!fs.existsSync(fichier)) fs.writeFileSync(fichier, crypto.randomBytes(32), { mode: 0o600 });
  return (cle = fs.readFileSync(fichier));
};
const signer = (texte) => crypto.createHmac('sha256', cleVpn()).update(`vpn:${texte}`).digest('base64url');

/** Le jeton d'un compte : « id.expiration.signature », envoyé par le navigateur comme mot de passe du relais. */
export function jetonVpn(userId, maintenant = Date.now()) {
  const expire = maintenant + DUREE_JETON;
  return { jeton: `${userId}.${expire}.${signer(`${userId}.${expire}`)}`, expire };
}

/** Vrai si l'en-tête Proxy-Authorization porte un jeton valable (le nom d'utilisateur est ignoré). */
export function jetonValide(entete, maintenant = Date.now()) {
  const m = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(String(entete || '').trim());
  if (!m) return false;
  const mot = Buffer.from(m[1], 'base64').toString('utf8');
  const [id, expire, signature = ''] = mot.slice(mot.indexOf(':') + 1).split('.');
  if (!/^\d+$/.test(id || '') || !(Number(expire) > maintenant)) return false;
  const attendue = signer(`${id}.${expire}`);
  return signature.length === attendue.length && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(attendue));
}
const MAX_TUNNELS = 64;
const INACTIVITE = 5 * 60_000;

const autorises = new Map(); // adresse IP → { userId, expire }
const ouverts = new Map(); // adresse IP → connexions en cours
// shortcut: autorisations en mémoire, perdues au redémarrage du serveur (le navigateur se réannonce toutes les 10 min) ; les mettre en base si cela gêne.

export const normaliserIp = (ip) => String(ip || '').replace(/^::ffff:/, '');

/** L'ancien mode, par adresse IP ; null une fois MODE_IP_JUSQUA passé. */
export function autoriser(ip, userId, maintenant = Date.now()) {
  if (maintenant >= MODE_IP_JUSQUA) return null;
  const expire = maintenant + DUREE;
  autorises.set(normaliserIp(ip), { userId, expire });
  return expire;
}

export function estAutorise(ip, maintenant = Date.now()) {
  const cle = normaliserIp(ip);
  const a = autorises.get(cle);
  if (a && a.expire > maintenant) return true;
  if (a) autorises.delete(cle);
  return false;
}

const interdits = new net.BlockList();
for (const [a, p] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 3]]) interdits.addSubnet(a, p, 'ipv4');
for (const [a, p] of [['::', 127], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['64:ff9b::', 96]]) interdits.addSubnet(a, p, 'ipv6');
const propres = new Set(Object.values(os.networkInterfaces()).flat().map((i) => i.address));

/** Résout la destination demandée ; refuse tout ce qui n'est pas un site web public. */
export async function destination(hote, port, lookup = dns.lookup) {
  port = Number(port);
  if (port !== 80 && port !== 443) throw new Error('port refusé');
  const { address, family } = await lookup(String(hote).replace(/^\[|\]$/g, ''));
  if (interdits.check(address, family === 6 ? 'ipv6' : 'ipv4') || propres.has(address)) throw new Error('adresse refusée');
  return { address, port };
}

function compter(ip, n) {
  const v = (ouverts.get(ip) || 0) + n;
  if (v > 0) ouverts.set(ip, v); else ouverts.delete(ip);
}

const DEFI = 'Basic realm="ONIRIQUE VPN"';
function refuser(socket, code, texte) {
  const defi = code === 407 ? `Proxy-Authenticate: ${DEFI}\r\n` : '';
  if (!socket.destroyed) socket.end(`HTTP/1.1 ${code} ${texte}\r\n${defi}Connection: close\r\nContent-Length: 0\r\n\r\n`);
}

function entree(req) {
  const ip = normaliserIp(req.socket.remoteAddress);
  if (!jetonValide(req.headers['proxy-authorization']) && !estAutorise(ip)) return { ip, refus: [407, 'Proxy Authentication Required'] };
  if ((ouverts.get(ip) || 0) >= MAX_TUNNELS) return { ip, refus: [429, 'Too Many Requests'] };
  return { ip };
}

async function tunnel(req, client, tete, verifier) {
  client.on('error', () => {});
  const { ip, refus } = entree(req);
  if (refus) return refuser(client, ...refus);
  const m = /^\[?([^\]]+?)\]?:(\d+)$/.exec(req.url || '');
  let cible;
  try { if (!m) throw new Error('cible'); cible = await verifier(m[1], m[2]); } catch { return refuser(client, 403, 'Forbidden'); }

  compter(ip, 1);
  let fini = false;
  const fin = () => { if (!fini) { fini = true; compter(ip, -1); } };
  const amont = net.connect(cible.port, cible.address);
  amont.setTimeout(INACTIVITE, () => amont.destroy());
  amont.on('connect', () => {
    client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (tete?.length) amont.write(tete);
    amont.pipe(client);
    client.pipe(amont);
  });
  amont.on('error', () => refuser(client, 502, 'Bad Gateway'));
  amont.on('close', () => { client.destroy(); fin(); });
  client.on('close', () => { amont.destroy(); fin(); });
}

async function transmettre(req, res, verifier) {
  const { ip, refus } = entree(req);
  if (refus) { res.writeHead(refus[0], refus[0] === 407 ? { 'Proxy-Authenticate': DEFI } : {}).end(); return; }
  let url, cible;
  try {
    url = new URL(req.url);
    if (url.protocol !== 'http:') throw new Error('protocole');
    cible = await verifier(url.hostname, url.port || 80);
  } catch { res.writeHead(403).end(); return; }

  const headers = { ...req.headers, host: url.host };
  for (const h of Object.keys(headers)) if (h.startsWith('proxy-')) delete headers[h];
  compter(ip, 1);
  res.on('close', () => compter(ip, -1));
  const amont = http.request({ host: cible.address, port: cible.port, method: req.method, path: url.pathname + url.search, headers, setHost: false },
    (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  amont.setTimeout(INACTIVITE, () => amont.destroy());
  amont.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
  req.pipe(amont);
}

/** Le relais, sur le serveur donné (HTTPS en production, HTTP simple pour les tests). */
export function creerRelais({ creerServeur = (h) => http.createServer(h), verifier = destination } = {}) {
  const serveur = creerServeur((req, res) => transmettre(req, res, verifier));
  serveur.on('connect', (req, socket, tete) => tunnel(req, socket, tete, verifier));
  serveur.on('clientError', (_, socket) => socket.destroy());
  return serveur;
}

/** Démarre le relais de production si le certificat est en place (deploy/install-vpn.sh). */
export function demarrerRelais() {
  const dossier = process.env.VPN_CERT_DIR || '/var/lib/onirique-central/vpn';
  const lire = () => ({ cert: fs.readFileSync(`${dossier}/fullchain.pem`), key: fs.readFileSync(`${dossier}/privkey.pem`) });
  let tls;
  try { tls = lire(); } catch { console.warn('VPN : certificat absent, relais non démarré (deploy/install-vpn.sh).'); return null; }
  const serveur = creerRelais({ creerServeur: (h) => https.createServer(tls, h) });
  // Le certificat est renouvelé tous les deux mois : il est relu chaque jour.
  setInterval(() => { try { serveur.setSecureContext(lire()); } catch (e) { console.error('VPN : certificat illisible :', e.message); } }, 86400_000).unref();
  serveur.listen(VPN_PORT, () => console.log(`VPN : relais sur le port ${VPN_PORT}`));
  serveur.on('error', (e) => console.error('VPN :', e.message));
  return serveur;
}
