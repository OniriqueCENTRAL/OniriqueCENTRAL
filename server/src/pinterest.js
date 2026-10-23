// « Se connecter avec Pinterest » : le membre relie son compte (OAuth, API v5), et choisit l'image de ses vidéos parmi
// les épingles de ses tableaux et des tableaux qu'il suit. Pinterest ne donne à aucune application son fil d'accueil ni
// la recherche sur tout le site : « Pour toi » mêle les dernières épingles de ces tableaux, les plus récentes d'abord.
import crypto from 'node:crypto';
import { config } from './config.js';
import { db, get, run, now } from './db.js';
import { HttpError } from './auth.js';
import { seal, unseal } from './payments.js';

db.exec(`CREATE TABLE IF NOT EXISTS pinterest_accounts (
  user_id       INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  access_token  TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at    INTEGER NOT NULL,
  username      TEXT NOT NULL DEFAULT '',
  created_at    INTEGER NOT NULL
)`);

const API = 'https://api.pinterest.com/v5';
const SCOPE = 'boards:read,pins:read,user_accounts:read';
export const pinterestConfigured = () => !!(config.pinterestAppId && config.pinterestAppSecret);
const redirectUri = () => `${config.publicUrl}/api/pinterest/callback`;
const basic = () => `Basic ${Buffer.from(`${config.pinterestAppId}:${config.pinterestAppSecret}`).toString('base64')}`;

async function read(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new HttpError(response.status === 401 ? 401 : 502, `Pinterest refuse : ${data.message || data.error_description || data.error || response.status}`);
  return data;
}
const token = (params) => fetch(`${API}/oauth/token`, {
  method: 'POST', headers: { Authorization: basic(), 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params),
}).then(read);

// Les connexions en cours : Google et Stripe font pareil, le state rendu par Pinterest dit de quel membre il s'agit.
const pending = new Map();
export function pinterestConnectUrl(userId, back = '') {
  for (const [k, v] of pending) if (v.expires < now()) pending.delete(k);
  const state = crypto.randomBytes(24).toString('base64url');
  pending.set(state, { userId, back, expires: now() + 15 * 60_000 });
  return 'https://www.pinterest.com/oauth/?' + new URLSearchParams({ client_id: config.pinterestAppId, redirect_uri: redirectUri(), response_type: 'code', scope: SCOPE, state });
}
/** Le retour de Pinterest : le compte relié, puis la page où revenir (« #/p/12 »). */
export async function finishPinterest(state, code) {
  const entry = pending.get(state);
  pending.delete(state);
  if (!entry || entry.expires < now() || !code) throw Object.assign(new HttpError(400, 'Connexion à Pinterest expirée ou refusée : recommence.'), { back: entry?.back || '' });
  const t = await token({ grant_type: 'authorization_code', code, redirect_uri: redirectUri() });
  const me = await fetch(`${API}/user_account`, { headers: { Authorization: `Bearer ${t.access_token}` } }).then(read).catch(() => ({}));
  run(`INSERT INTO pinterest_accounts (user_id, access_token, refresh_token, expires_at, username, created_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET access_token = excluded.access_token, refresh_token = excluded.refresh_token, expires_at = excluded.expires_at, username = excluded.username`,
    entry.userId, seal(t.access_token), seal(t.refresh_token || ''), now() + (Number(t.expires_in) || 2592000) * 1000, String(me.username || ''), now());
  feeds.delete(entry.userId);
  return entry.back;
}
export const pinterestBack = (state) => pending.get(state)?.back || '';
export const pinterestAccount = (userId) => get('SELECT username FROM pinterest_accounts WHERE user_id = ?', userId);
export function disconnectPinterest(userId) {
  run('DELETE FROM pinterest_accounts WHERE user_id = ?', userId);
  feeds.delete(userId);
}

// Un jeton dure 30 jours : renouvelé un jour avant la fin ; un accès retiré chez Pinterest débranche le compte.
// Deux appels en même temps (tableaux et tableaux suivis) attendent le même renouvellement, fait une seule fois.
const refreshing = new Map();
function accessToken(userId) {
  const a = get('SELECT * FROM pinterest_accounts WHERE user_id = ?', userId);
  if (!a) return Promise.reject(new HttpError(400, 'Connecte d\'abord ton compte Pinterest.'));
  if (a.expires_at > now() + 86400_000) return Promise.resolve(unseal(a.access_token));
  if (!refreshing.has(userId)) refreshing.set(userId, refresh(userId, a).finally(() => refreshing.delete(userId)));
  return refreshing.get(userId);
}
async function refresh(userId, a) {
  try {
    const t = await token({ grant_type: 'refresh_token', refresh_token: unseal(a.refresh_token) });
    run('UPDATE pinterest_accounts SET access_token = ?, refresh_token = ?, expires_at = ? WHERE user_id = ?',
      seal(t.access_token), seal(t.refresh_token || unseal(a.refresh_token)), now() + (Number(t.expires_in) || 2592000) * 1000, userId);
    return t.access_token;
  } catch {
    disconnectPinterest(userId);
    throw new HttpError(401, 'Ton accès Pinterest a expiré : reconnecte ton compte.');
  }
}
const api = async (userId, route) => fetch(`${API}${route}`, { headers: { Authorization: `Bearer ${await accessToken(userId)}` }, signal: AbortSignal.timeout(15000) }).then(read);

// Une épingle telle qu'on la montre : l'image en grand (pour la vidéo), une vignette, et son lien.
const pinView = (p) => {
  const images = p.media?.images || {};
  const big = images['1200x']?.url || images['600x']?.url || images.originals?.url, thumb = images['236x']?.url || images['400x300']?.url || images['150x150']?.url || big;
  return big && { url: big, thumb, link: p.id ? `https://www.pinterest.com/pin/${p.id}/` : '', at: Date.parse(p.created_at) || 0 };
};
const boardView = (b) => ({ id: String(b.id), name: b.name || 'Tableau', owner: b.owner?.username || '', thumb: b.media?.image_cover_url || null });

/** Les tableaux du membre et ceux qu'il suit. */
export async function pinterestBoards(userId) {
  const [mine, following] = await Promise.all([
    api(userId, '/boards?page_size=100'), api(userId, '/user_account/following/boards?page_size=100').catch(() => ({ items: [] })),
  ]);
  return { mine: (mine.items || []).map(boardView), following: (following.items || []).map(boardView) };
}
/** Les épingles d'un tableau (les siennes ou un tableau suivi, s'il est public). */
export async function pinterestBoardPins(userId, boardId, size = 50) {
  if (!/^\d{1,30}$/.test(String(boardId))) throw new HttpError(400, 'Tableau inconnu.');
  return ((await api(userId, `/boards/${boardId}/pins?page_size=${size}`)).items || []).map(pinView).filter(Boolean);
}
// « Pour toi » : jusqu'à douze tableaux (les siens et ceux qu'il suit, à parts égales), leurs dernières épingles mêlées,
// gardé dix minutes (l'accès d'essai de Pinterest compte les appels).
const feeds = new Map();
export async function pinterestForYou(userId) {
  const cached = feeds.get(userId);
  if (cached && cached.until > now()) return cached.images;
  const { mine, following } = await pinterestBoards(userId);
  const picked = [...following.slice(0, 6), ...mine.slice(0, 12 - Math.min(6, following.length))];
  const lists = await Promise.all(picked.map((b) => pinterestBoardPins(userId, b.id, 15).catch(() => [])));
  const seen = new Set(), images = lists.flat().sort((a, b) => b.at - a.at).filter((p) => !seen.has(p.url) && seen.add(p.url)).slice(0, 80);
  feeds.set(userId, { images, until: now() + 10 * 60_000 });
  return images;
}
