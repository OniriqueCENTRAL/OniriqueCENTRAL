import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { all, get, run, now } from './db.js';
import { HttpError } from './auth.js';
import { seal, unseal } from './payments.js';

// Shorts YouTube programmés depuis la page compte : la chaîne est reliée par Google (OAuth), les vidéos attendent
// sur ce serveur, et chacune part sur la chaîne à l'heure choisie (publishDue, appelé chaque minute).

// Envoyer des vidéos, et lire la chaîne (son nom, les descriptions déjà publiées).
const SCOPE = 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly';
const API = 'https://www.googleapis.com/youtube/v3';

export const youtubeConfigured = () => !!(config.googleClientId && config.googleClientSecret);
const redirectUri = () => `${config.publicUrl}/api/youtube/callback`;

async function read(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new HttpError(502, `YouTube refuse : ${data.error?.message || data.error_description || data.error || 'réponse ' + response.status}`);
  }
  return data;
}
const google = async (url, options) => read(await fetch(url, options));
const token = (params) => google('https://oauth2.googleapis.com/token', {
  method: 'POST',
  body: new URLSearchParams({ client_id: config.googleClientId, client_secret: config.googleClientSecret, ...params }),
});

// Une demande de connexion en cours : Google la rend telle quelle au retour, c'est elle qui dit de quel compte il s'agit.
const pending = new Map();

export function connectUrl(userId) {
  for (const [state, entry] of pending) if (entry.expires < now()) pending.delete(state);
  const state = crypto.randomBytes(24).toString('base64url');
  pending.set(state, { userId, expires: now() + 10 * 60_000 });
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: config.googleClientId, redirect_uri: redirectUri(), response_type: 'code', scope: SCOPE,
    access_type: 'offline', prompt: 'consent', state, // « offline » et « consent » : Google rend un jeton qui dure
  });
}

export async function finishConnect(state, code) {
  const entry = pending.get(state);
  pending.delete(state);
  if (!entry || entry.expires < now() || !code) throw new HttpError(400, 'Connexion YouTube expirée ou refusée : recommencez.');
  const tokens = await token({ code, grant_type: 'authorization_code', redirect_uri: redirectUri() });
  if (!tokens.refresh_token) throw new HttpError(502, "Google n'a pas donné d'accès durable : recommencez.");
  const { items } = await google(`${API}/channels?part=snippet,contentDetails&mine=true`, { headers: { Authorization: `Bearer ${tokens.access_token}` } });
  const channel = items?.[0];
  if (!channel) throw new HttpError(400, "Ce compte Google n'a pas de chaîne YouTube.");
  run(`INSERT INTO youtube_accounts (user_id, refresh_token, channel_id, channel_title, uploads, created_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET refresh_token = excluded.refresh_token, channel_id = excluded.channel_id,
         channel_title = excluded.channel_title, uploads = excluded.uploads`,
    entry.userId, seal(tokens.refresh_token), channel.id, channel.snippet.title, channel.contentDetails.relatedPlaylists.uploads, now());
}

const accountOf = (userId) => get('SELECT * FROM youtube_accounts WHERE user_id = ?', userId);
const accessToken = async (account) => (await token({ refresh_token: unseal(account.refresh_token), grant_type: 'refresh_token' })).access_token;

export async function disconnect(userId) {
  const account = accountOf(userId);
  if (!account) return;
  // Google oublie l'accès de son côté aussi ; s'il ne répond pas, la chaîne est quand même détachée ici.
  await fetch('https://oauth2.googleapis.com/revoke', { method: 'POST', body: new URLSearchParams({ token: unseal(account.refresh_token) }) }).catch(() => {});
  run('DELETE FROM youtube_accounts WHERE user_id = ?', userId);
}

/** Les descriptions déjà utilisées : celles programmées ici, puis celles des derniers Shorts de la chaîne. */
async function descriptions(userId, account) {
  const found = all(`SELECT description FROM youtube_videos WHERE user_id = ? AND description != '' ORDER BY id DESC LIMIT 50`, userId).map((v) => v.description);
  if (account) {
    try {
      const headers = { Authorization: `Bearer ${await accessToken(account)}` };
      const list = (playlist) => google(`${API}/playlistItems?part=snippet&maxResults=50&playlistId=${playlist}`, { headers }).then((r) => r.items || [], () => []);
      // « UUSH… » est la liste des seuls Shorts d'une chaîne ; vide ou refusée, on prend toutes ses vidéos.
      let items = await list('UUSH' + account.channel_id.slice(2));
      if (!items.length) items = await list(account.uploads);
      found.push(...items.map((item) => (item.snippet?.description || '').trim()));
    } catch { /* YouTube injoignable ou accès retiré : il reste les descriptions gardées ici */ }
  }
  return [...new Set(found.filter(Boolean))].slice(0, 12);
}

export const videoView = (v) => ({
  id: v.id, filename: v.filename, size: v.size, title: v.title, description: v.description, publishAt: v.publish_at,
  status: v.status, error: v.error, url: v.youtube_id ? `https://www.youtube.com/shorts/${v.youtube_id}` : null,
});

export async function youtubeState(userId) {
  const account = accountOf(userId);
  return {
    configured: youtubeConfigured(),
    channel: account ? account.channel_title : null,
    videos: all('SELECT * FROM youtube_videos WHERE user_id = ? ORDER BY publish_at IS NULL DESC, publish_at, id', userId).map(videoView),
    descriptions: await descriptions(userId, account),
  };
}

export const videoFile = (video) => path.join(config.videosDir, video.stored_as);

async function publish(video) {
  const account = accountOf(video.user_id);
  if (!account) throw new Error('Chaîne YouTube déconnectée : reconnectez-la, puis reprogrammez la vidéo.');
  const authorization = `Bearer ${await accessToken(account)}`;
  // Envoi en deux temps : YouTube ouvre une session avec le titre et la description, puis reçoit le fichier.
  const session = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST',
    headers: { Authorization: authorization, 'Content-Type': 'application/json', 'X-Upload-Content-Type': video.mime, 'X-Upload-Content-Length': String(video.size) },
    body: JSON.stringify({
      snippet: { title: video.title, description: video.description },
      status: { privacyStatus: 'public', selfDeclaredMadeForKids: false },
    }),
  });
  await read(session);
  const sent = await google(session.headers.get('location'), {
    method: 'PUT', headers: { Authorization: authorization, 'Content-Type': video.mime }, body: await fs.openAsBlob(videoFile(video)),
  });
  if (!sent.id) throw new Error("YouTube n'a pas confirmé la vidéo.");
  return sent.id;
}

// Un envoi coupé par un redémarrage a peut-être abouti : il n'est pas refait tout seul, pour ne pas publier deux fois.
run(`UPDATE youtube_videos SET status = 'failed', error = 'Envoi interrompu par un redémarrage du serveur : regardez sur votre chaîne avant de reprogrammer.' WHERE status = 'uploading'`);

let busy = false;
/** Publie les vidéos dont l'heure est passée, une à la fois. Une vidéo publiée ne garde plus son fichier ici. */
export async function publishDue() {
  if (busy) return;
  busy = true;
  try {
    for (const video of all(`SELECT * FROM youtube_videos WHERE status = 'scheduled' AND publish_at <= ? ORDER BY publish_at`, now())) {
      run(`UPDATE youtube_videos SET status = 'uploading' WHERE id = ?`, video.id);
      try {
        const id = await publish(video);
        run(`UPDATE youtube_videos SET status = 'published', youtube_id = ?, error = '' WHERE id = ?`, id, video.id);
        fs.rmSync(videoFile(video), { force: true });
      } catch (error) {
        run(`UPDATE youtube_videos SET status = 'failed', error = ? WHERE id = ?`, String(error.message).slice(0, 300), video.id);
      }
    }
  } finally {
    busy = false;
  }
}
