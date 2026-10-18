import crypto from 'node:crypto';
import { config } from './config.js';
import { all, get, run, now } from './db.js';
import { HttpError } from './auth.js';
import { seal, unseal } from './payments.js';

// Réponses automatiques aux commentaires, pour les fondateurs (page compte). Un compte Instagram et un compte TikTok
// se relient par leur connexion officielle ; une automation vise une publication et des mots : chaque personne qui
// commente l'un de ces mots reçoit, une seule fois, ce qui est prévu.
//   Instagram : une réponse publique sous le commentaire, puis un message privé (« réponse privée » de Meta, une par
//               commentaire, dans les 7 jours). Pas de like : l'API d'Instagram ne le permet pas. Les commentaires
//               arrivent par le webhook de Meta, et sont aussi relus toutes les deux minutes si un webhook se perd.
//   TikTok    : le like du commentaire, puis une réponse publique dessous (l'API de TikTok n'envoie pas de messages
//               privés). Commentaires relus toutes les deux minutes (TikTok ne prévient pas).

const IG_GRAPH = 'https://graph.instagram.com/v23.0';
const IG_SCOPE = 'instagram_business_basic,instagram_business_manage_comments,instagram_business_manage_messages';
const TT_API = 'https://business-api.tiktok.com/open_api/v1.3';
const TT_SCOPE = 'user.info.basic,user.info.username,video.list,comment.list,comment.list.manage';

export const PLATFORMS = ['instagram', 'tiktok'];
const LABEL = { instagram: 'Instagram', tiktok: 'TikTok' };
export const platformConfigured = (platform) => platform === 'instagram'
  ? !!(config.instagramAppId && config.instagramAppSecret)
  : !!(config.tiktokClientKey && config.tiktokClientSecret);
const redirectUri = (platform) => `${config.publicUrl}/api/social/${platform}/callback`;
// Longueurs acceptées par chaque plateforme.
const LIMITS = { instagram: { dm: 1000, reply: 2200 }, tiktok: { dm: 0, reply: 150 } };

//============================================================================
//  Appels aux plateformes
//============================================================================
async function readJson(platform, response) {
  const data = await response.json().catch(() => ({}));
  // L'API Business de TikTok répond 200 avec un code d'erreur dans le corps.
  const failed = !response.ok || (platform === 'tiktok' && data.code !== undefined && data.code !== 0);
  if (failed) {
    const reason = data.error?.message || data.error_message || data.message || data.error_description || data.error || `réponse ${response.status}`;
    throw new HttpError(502, `${LABEL[platform]} refuse : ${typeof reason === 'string' ? reason : JSON.stringify(reason)}`);
  }
  return platform === 'tiktok' && 'data' in data ? data.data : data;
}
const ig = async (url, options) => readJson('instagram', await fetch(url, options));
const tt = async (route, accessToken, { method = 'GET', query, body } = {}) => readJson('tiktok', await fetch(
  `${TT_API}${route}${query ? '?' + new URLSearchParams(query) : ''}`,
  { method, headers: { ...(accessToken ? { 'Access-Token': accessToken } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined }));

//============================================================================
//  Connexion d'un compte
//============================================================================
// Une demande de connexion en cours : la plateforme la rend telle quelle au retour, elle dit de quel compte il s'agit.
const pending = new Map();

export function connectUrl(platform, userId) {
  for (const [state, entry] of pending) if (entry.expires < now()) pending.delete(state);
  const state = crypto.randomBytes(24).toString('base64url');
  pending.set(state, { platform, userId, expires: now() + 10 * 60_000 });
  if (platform === 'instagram') {
    return 'https://www.instagram.com/oauth/authorize?' + new URLSearchParams({
      client_id: config.instagramAppId, redirect_uri: redirectUri(platform), response_type: 'code', scope: IG_SCOPE, state,
      force_reauth: 'true',
    });
  }
  return 'https://www.tiktok.com/v2/auth/authorize/?' + new URLSearchParams({
    client_key: config.tiktokClientKey, redirect_uri: redirectUri(platform), response_type: 'code', scope: TT_SCOPE, state,
  });
}

function saveAccount(userId, platform, fields) {
  run(`INSERT INTO social_accounts (user_id, platform, account_id, username, access_token, refresh_token, expires_at, refresh_expires_at, error, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', ?)
       ON CONFLICT(user_id, platform) DO UPDATE SET account_id = excluded.account_id, username = excluded.username,
         access_token = excluded.access_token, refresh_token = excluded.refresh_token, expires_at = excluded.expires_at,
         refresh_expires_at = excluded.refresh_expires_at, error = ''`,
    userId, platform, fields.accountId, fields.username, seal(fields.accessToken), fields.refreshToken ? seal(fields.refreshToken) : null,
    fields.expiresAt, fields.refreshExpiresAt ?? null, now());
}

export async function finishConnect(platform, state, code) {
  const entry = pending.get(state);
  pending.delete(state);
  if (!entry || entry.platform !== platform || entry.expires < now() || !code) {
    throw new HttpError(400, `Connexion ${LABEL[platform]} expirée ou refusée : recommencez.`);
  }
  if (platform === 'instagram') {
    // Jeton court, échangé aussitôt contre un jeton de 60 jours, renouvelé ensuite tout seul (refreshTokens).
    const short = await ig('https://api.instagram.com/oauth/access_token', { method: 'POST', body: new URLSearchParams({
      client_id: config.instagramAppId, client_secret: config.instagramAppSecret, grant_type: 'authorization_code',
      redirect_uri: redirectUri(platform), code: code.replace(/#_$/, ''),
    }) });
    const long = await ig(`https://graph.instagram.com/access_token?${new URLSearchParams({
      grant_type: 'ig_exchange_token', client_secret: config.instagramAppSecret, access_token: short.access_token })}`);
    const me = await ig(`${IG_GRAPH}/me?${new URLSearchParams({ fields: 'user_id,username,account_type', access_token: long.access_token })}`);
    // Le webhook désigne le compte par son identifiant professionnel (user_id), pas par celui propre à l'application.
    saveAccount(entry.userId, platform, { accountId: String(me.user_id || me.id), username: me.username || '',
      accessToken: long.access_token, expiresAt: now() + (long.expires_in || 60 * 86_400) * 1000 });
    // Les commentaires arrivent alors tout de suite par le webhook ; sinon la relecture régulière prend le relais.
    await ig(`${IG_GRAPH}/me/subscribed_apps?${new URLSearchParams({ subscribed_fields: 'comments', access_token: long.access_token })}`,
      { method: 'POST' }).catch(() => {});
    return;
  }
  const tokens = await tt('/tt_user/oauth2/token/', null, { method: 'POST', body: {
    client_id: config.tiktokClientKey, client_secret: config.tiktokClientSecret, grant_type: 'authorization_code',
    auth_code: code, redirect_uri: redirectUri(platform),
  } });
  if (!tokens.access_token || !tokens.open_id) throw new HttpError(502, "TikTok n'a pas donné d'accès : recommencez.");
  const info = await tt('/business/get/', tokens.access_token, { query: { business_id: tokens.open_id, fields: JSON.stringify(['username', 'display_name']) } })
    .catch(() => ({}));
  saveAccount(entry.userId, platform, { accountId: tokens.open_id, username: info.username || info.display_name || '',
    accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expiresAt: now() + (tokens.expires_in || 86_400) * 1000,
    refreshExpiresAt: tokens.refresh_token_expires_in ? now() + tokens.refresh_token_expires_in * 1000 : null });
}

const accountOf = (userId, platform) => get('SELECT * FROM social_accounts WHERE user_id = ? AND platform = ?', userId, platform);

export function disconnect(userId, platform) {
  run('DELETE FROM social_accounts WHERE user_id = ? AND platform = ?', userId, platform);
}

/** Renouvelle les accès avant qu'ils n'expirent : Instagram 60 jours (renouvelé à 30 jours de la fin), TikTok 24 h. */
async function freshToken(account) {
  const left = account.expires_at - now();
  if (account.platform === 'instagram' && left < 30 * 86_400_000 && now() - account.created_at > 86_400_000) {
    const renewed = await ig(`https://graph.instagram.com/refresh_access_token?${new URLSearchParams({
      grant_type: 'ig_refresh_token', access_token: unseal(account.access_token) })}`);
    run('UPDATE social_accounts SET access_token = ?, expires_at = ? WHERE user_id = ? AND platform = ?',
      seal(renewed.access_token), now() + (renewed.expires_in || 60 * 86_400) * 1000, account.user_id, account.platform);
    return renewed.access_token;
  }
  if (account.platform === 'tiktok' && left < 60 * 60_000 && account.refresh_token) {
    const renewed = await tt('/tt_user/oauth2/refresh_token/', null, { method: 'POST', body: {
      client_id: config.tiktokClientKey, client_secret: config.tiktokClientSecret, grant_type: 'refresh_token',
      refresh_token: unseal(account.refresh_token),
    } });
    run('UPDATE social_accounts SET access_token = ?, refresh_token = ?, expires_at = ? WHERE user_id = ? AND platform = ?',
      seal(renewed.access_token), seal(renewed.refresh_token || unseal(account.refresh_token)), now() + (renewed.expires_in || 86_400) * 1000,
      account.user_id, account.platform);
    return renewed.access_token;
  }
  return unseal(account.access_token);
}

//============================================================================
//  Publications, commentaires, réponses
//============================================================================
/** Les dernières publications du compte, pour choisir celle que vise une automation. */
export async function recentPosts(userId, platform) {
  const account = accountOf(userId, platform);
  if (!account) throw new HttpError(400, `Reliez d'abord votre compte ${LABEL[platform]}.`);
  const token = await freshToken(account);
  if (platform === 'instagram') {
    const { data = [] } = await ig(`${IG_GRAPH}/me/media?${new URLSearchParams({
      fields: 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp', limit: '30', access_token: token })}`);
    return data.map((m) => ({ id: m.id, caption: (m.caption || '').slice(0, 300), thumb: m.thumbnail_url || (m.media_type === 'VIDEO' ? null : m.media_url) || null,
      url: m.permalink || null, at: Date.parse(m.timestamp) || null }));
  }
  const { videos = [] } = await tt('/business/video/list/', token, { query: { business_id: account.account_id, max_count: '20',
    fields: JSON.stringify(['item_id', 'thumbnail_url', 'caption', 'share_url', 'create_time']) } });
  return videos.map((v) => ({ id: String(v.item_id), caption: (v.caption || '').slice(0, 300), thumb: v.thumbnail_url || null,
    url: v.share_url || null, at: v.create_time ? v.create_time * 1000 : null }));
}

// Le texte comparé : minuscules, sans accents, réduit à ses mots. « Lien !! » et « LIEN » déclenchent tous deux « lien ».
const words = (text) => String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
export function matches(keywords, text) {
  const list = String(keywords || '').split(',').map((k) => words(k)).filter((k) => k.length);
  if (!list.length) return true; // aucun mot : tout commentaire déclenche la réponse
  const said = words(text);
  return list.some((k) => said.some((_, i) => k.every((w, j) => said[i + j] === w)));
}

// Plusieurs réponses publiques possibles, une par ligne : chacune est tirée au hasard, pour ne pas répéter la même.
const pick = (text) => { const lines = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean); return lines[crypto.randomInt(lines.length || 1)] || ''; };
const fill = (text, comment) => text.replace(/\{pseudo\}/gi, comment.username ? '@' + comment.username : '').replace(/\s{2,}/g, ' ').trim();

/**
 * Dans l'ordre : le like du commentaire, la réponse publique dessous, puis le message privé. Un like refusé n'empêche
 * pas la réponse ; il est seulement noté (rendu dans « note »).
 */
async function send(account, automation, comment) {
  const token = await freshToken(account);
  const reply = fill(pick(automation.reply_text), comment);
  let note = '';
  if (account.platform === 'instagram') {
    // L'API d'Instagram ne permet pas de liker un commentaire : seulement d'y répondre et d'écrire en privé.
    if (reply) await ig(`${IG_GRAPH}/${comment.id}/replies`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: new URLSearchParams({ message: reply }) });
    if (automation.dm_text) {
      // « Réponse privée » : un message à l'auteur du commentaire, un seul par commentaire, dans les 7 jours.
      await ig(`${IG_GRAPH}/${account.account_id}/messages`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient: { comment_id: comment.id }, message: { text: fill(automation.dm_text, comment) } }),
      });
    }
    return note;
  }
  if (automation.like_comment) {
    await tt('/business/comment/like/', token, { method: 'POST', body: { business_id: account.account_id, comment_id: comment.id, action: 'LIKE' } })
      .catch((error) => { note = `Like refusé (${error.message})`; });
  }
  if (reply) {
    await tt('/business/comment/reply/create/', token, { method: 'POST', body: {
      business_id: account.account_id, video_id: automation.post_id, comment_id: comment.id, text: reply,
    } });
  }
  return note;
}

/**
 * Un commentaire reçu (webhook ou relecture) : réponse si une automation active de ce compte le vise, une seule fois
 * par commentaire et par personne. Jamais à ses propres commentaires (ni donc à ses propres réponses).
 */
export async function handleComment(account, comment) {
  if (!comment.id || !comment.text) return;
  if (comment.fromId === account.account_id || (comment.username && comment.username === account.username)) return;
  const automations = all(`SELECT * FROM social_automations WHERE user_id = ? AND platform = ? AND post_id = ? AND active = 1`,
    account.user_id, account.platform, String(comment.mediaId));
  for (const automation of automations) {
    if (comment.at && comment.at < automation.since) continue;
    if (!matches(automation.keywords, comment.text)) continue;
    const already = get('SELECT 1 FROM social_replies WHERE automation_id = ? AND (comment_id = ? OR (commenter_id != \'\' AND commenter_id = ? AND status = \'sent\'))',
      automation.id, comment.id, comment.fromId || '');
    if (already) continue;
    // Noté avant l'envoi : un webhook et une relecture qui arrivent ensemble ne répondent pas deux fois.
    const { changes } = run(`INSERT OR IGNORE INTO social_replies (automation_id, comment_id, commenter_id, commenter_name, comment_text, status, error, created_at)
                             VALUES (?, ?, ?, ?, ?, 'sending', '', ?)`, automation.id, comment.id, comment.fromId || '', comment.username || '', comment.text.slice(0, 500), now());
    if (!changes) continue;
    try {
      const note = await send(account, automation, comment);
      run(`UPDATE social_replies SET status = 'sent', error = ? WHERE automation_id = ? AND comment_id = ?`, note, automation.id, comment.id);
      run(`UPDATE social_automations SET sent_count = sent_count + 1, last_error = '' WHERE id = ?`, automation.id);
    } catch (error) {
      const message = String(error.message).slice(0, 300);
      run(`UPDATE social_replies SET status = 'failed', error = ? WHERE automation_id = ? AND comment_id = ?`, message, automation.id, comment.id);
      run('UPDATE social_automations SET last_error = ? WHERE id = ?', message, automation.id);
    }
  }
}

//============================================================================
//  Webhook d'Instagram
//============================================================================
export const verifyToken = () => config.instagramVerifyToken;

export function verifyInstagramSignature(raw, header) {
  const expected = 'sha256=' + crypto.createHmac('sha256', config.instagramAppSecret).update(raw).digest('hex');
  const given = String(header || '');
  if (given.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
    throw new HttpError(401, 'Signature invalide.');
  }
}

export async function handleInstagramWebhook(body) {
  if (body?.object !== 'instagram') return;
  for (const entry of body.entry || []) {
    const accounts = all(`SELECT * FROM social_accounts WHERE platform = 'instagram' AND account_id = ?`, String(entry.id));
    for (const change of entry.changes || []) {
      if (change.field !== 'comments' || !change.value) continue;
      const v = change.value;
      const comment = { id: String(v.id || ''), text: v.text || '', fromId: String(v.from?.id || ''), username: v.from?.username || '',
        mediaId: String(v.media?.id || ''), at: entry.time ? (entry.time > 1e12 ? entry.time : entry.time * 1000) : now() };
      for (const account of accounts) await handleComment(account, comment);
    }
  }
}

//============================================================================
//  Relecture régulière des commentaires
//============================================================================
async function commentsOf(account, automation) {
  const token = await freshToken(account);
  const found = [];
  if (account.platform === 'instagram') {
    let url = `${IG_GRAPH}/${automation.post_id}/comments?${new URLSearchParams({ fields: 'id,text,timestamp,username,from', limit: '50', access_token: token })}`;
    for (let page = 0; url && page < 6; page++) {
      const { data = [], paging } = await ig(url);
      found.push(...data.map((c) => ({ id: String(c.id), text: c.text || '', fromId: String(c.from?.id || ''), username: c.username || c.from?.username || '',
        mediaId: automation.post_id, at: Date.parse(c.timestamp) || now() })));
      url = paging?.next || null;
    }
    return found;
  }
  let cursor = 0;
  for (let page = 0; page < 6; page++) {
    const data = await tt('/business/comment/list/', token, { query: { business_id: account.account_id, video_id: automation.post_id,
      sort_field: 'create_time', sort_order: 'desc', max_count: '30', cursor: String(cursor) } });
    const list = data.comments || [];
    found.push(...list.map((c) => ({ id: String(c.comment_id), text: c.text || '', fromId: String(c.user_id || ''), username: c.username || '',
      mediaId: automation.post_id, at: c.create_time ? c.create_time * 1000 : now() })));
    // Du plus récent au plus ancien : inutile d'aller plus loin que le début de l'automation.
    if (!data.has_more || !list.length || list.at(-1).create_time * 1000 < automation.since) break;
    cursor = data.cursor;
  }
  return found;
}

let busy = false;
/** Relit les commentaires de chaque automation active ; appelé toutes les deux minutes. */
export async function pollComments() {
  if (busy) return;
  busy = true;
  try {
    for (const automation of all('SELECT * FROM social_automations WHERE active = 1')) {
      const account = accountOf(automation.user_id, automation.platform);
      if (!account || !platformConfigured(automation.platform)) continue;
      try {
        const comments = await commentsOf(account, automation);
        // Les plus anciens d'abord : les réponses partent dans l'ordre des commentaires.
        for (const comment of comments.sort((a, b) => a.at - b.at)) await handleComment(account, comment);
        if (account.error) run(`UPDATE social_accounts SET error = '' WHERE user_id = ? AND platform = ?`, account.user_id, account.platform);
      } catch (error) {
        run('UPDATE social_accounts SET error = ? WHERE user_id = ? AND platform = ?', String(error.message).slice(0, 300), account.user_id, account.platform);
      }
    }
  } finally {
    busy = false;
  }
}

//============================================================================
//  Automations
//============================================================================
export const automationView = (a) => ({
  id: a.id, platform: a.platform, postId: a.post_id, postCaption: a.post_caption, postThumb: a.post_thumb, postUrl: a.post_url,
  keywords: a.keywords, like: !!a.like_comment, dmText: a.dm_text, replyText: a.reply_text, active: !!a.active, sent: a.sent_count, error: a.last_error,
  since: a.since, createdAt: a.created_at,
  recent: all(`SELECT commenter_name, comment_text, status, error, created_at FROM social_replies WHERE automation_id = ? ORDER BY created_at DESC LIMIT 8`, a.id)
    .map((r) => ({ name: r.commenter_name, text: r.comment_text, status: r.status, error: r.error, at: r.created_at })),
});

export function socialState(userId) {
  const accounts = {};
  for (const platform of PLATFORMS) {
    const a = accountOf(userId, platform);
    accounts[platform] = { configured: platformConfigured(platform), username: a ? a.username : null, connected: !!a, error: a?.error || '' };
  }
  return {
    accounts,
    automations: all('SELECT * FROM social_automations WHERE user_id = ? ORDER BY id DESC', userId).map(automationView),
  };
}

const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

/** Les champs d'une automation, vérifiés : création (sans id) ou modification. */
export function saveAutomation(userId, body, existing) {
  const platform = existing ? existing.platform : body.platform;
  if (!PLATFORMS.includes(platform)) throw new HttpError(400, 'Plateforme inconnue.');
  if (!existing && !accountOf(userId, platform)) throw new HttpError(400, `Reliez d'abord votre compte ${LABEL[platform]}.`);
  const postId = existing ? existing.post_id : text(body.postId, 64);
  if (!/^[\w-]{1,64}$/.test(postId)) throw new HttpError(400, 'Choisissez la publication visée.');
  const keywords = text(body.keywords, 300);
  const dmText = platform === 'instagram' ? text(body.dmText, LIMITS.instagram.dm) : '';
  const replyText = text(body.replyText, 2000);
  if (replyText.split('\n').some((line) => line.trim().length > LIMITS[platform].reply)) {
    throw new HttpError(400, `${LABEL[platform]} accepte ${LIMITS[platform].reply} caractères au plus par réponse.`);
  }
  if (!dmText && !replyText) throw new HttpError(400, platform === 'instagram' ? 'Écrivez le message privé, la réponse publique, ou les deux.' : 'Écrivez la réponse.');
  const active = body.active === undefined ? (existing ? existing.active : 1) : body.active ? 1 : 0;
  // Le like n'existe que sur TikTok (voir send) ; coché par défaut.
  const like = platform === 'tiktok' && body.like !== false ? 1 : 0;
  if (existing) {
    run(`UPDATE social_automations SET keywords = ?, like_comment = ?, dm_text = ?, reply_text = ?, active = ? WHERE id = ?`,
      keywords, like, dmText, replyText, active, existing.id);
    return existing.id;
  }
  if (get('SELECT COUNT(*) AS n FROM social_automations WHERE user_id = ?', userId).n >= 50) {
    throw new HttpError(400, "Cinquante automations au plus : retirez-en avant d'en ajouter.");
  }
  // Par défaut, seuls les commentaires écrits après la création reçoivent une réponse ; « earlier » reprend aussi les
  // commentaires des 7 derniers jours (au-delà, Instagram refuse le message privé).
  const since = body.earlier ? now() - 7 * 86_400_000 : now();
  const { lastInsertRowid } = run(`INSERT INTO social_automations (user_id, platform, post_id, post_caption, post_thumb, post_url, keywords, like_comment,
      dm_text, reply_text, active, since, sent_count, last_error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, '', ?)`,
    userId, platform, postId, text(body.postCaption, 300), /^https:\/\//.test(body.postThumb || '') ? text(body.postThumb, 2000) : null,
    /^https:\/\//.test(body.postUrl || '') ? text(body.postUrl, 500) : null, keywords, like, dmText, replyText, active, since, now());
  return lastInsertRowid;
}
