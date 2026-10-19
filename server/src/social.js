import crypto from 'node:crypto';
import { config } from './config.js';
import { all, get, run, now } from './db.js';
import { HttpError } from './auth.js';
import { seal, unseal } from './payments.js';

// Réponses automatiques aux commentaires Instagram, pour les fondateurs (page compte). Le compte Instagram se relie
// par la connexion officielle de Meta ; une automation vise une publication et des mots : chaque personne qui commente
// l'un de ces mots reçoit, une seule fois, une réponse publique sous son commentaire, puis un message privé
// (« réponse privée » de Meta, une par commentaire, dans les 7 jours). Pas de like : l'API d'Instagram ne le permet pas.
// Les commentaires arrivent par le webhook de Meta, et sont aussi relus toutes les deux minutes si un webhook se perd.

const IG_GRAPH = 'https://graph.instagram.com/v23.0';
const IG_SCOPE = 'instagram_business_basic,instagram_business_manage_comments,instagram_business_manage_messages';
// Longueurs acceptées par Instagram.
const LIMITS = { dm: 1000, reply: 2200 };

export const platformConfigured = () => !!(config.instagramAppId && config.instagramAppSecret);
const redirectUri = () => `${config.publicUrl}/api/social/instagram/callback`;

async function ig(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const reason = data.error?.message || data.error_message || data.error_description || data.error || `réponse ${response.status}`;
    throw new HttpError(502, `Instagram refuse : ${typeof reason === 'string' ? reason : JSON.stringify(reason)}`);
  }
  return data;
}

//============================================================================
//  Connexion du compte
//============================================================================
// Une demande de connexion en cours : Instagram la rend telle quelle au retour, elle dit de quel compte il s'agit.
const pending = new Map();

export function connectUrl(userId) {
  for (const [state, entry] of pending) if (entry.expires < now()) pending.delete(state);
  const state = crypto.randomBytes(24).toString('base64url');
  pending.set(state, { userId, expires: now() + 10 * 60_000 });
  return 'https://www.instagram.com/oauth/authorize?' + new URLSearchParams({
    client_id: config.instagramAppId, redirect_uri: redirectUri(), response_type: 'code', scope: IG_SCOPE, state, force_reauth: 'true',
  });
}

export async function finishConnect(state, code) {
  const entry = pending.get(state);
  pending.delete(state);
  if (!entry || entry.expires < now() || !code) throw new HttpError(400, 'Connexion Instagram expirée ou refusée : recommencez.');
  // Jeton court, échangé aussitôt contre un jeton de 60 jours, renouvelé ensuite tout seul (freshToken).
  const short = await ig('https://api.instagram.com/oauth/access_token', { method: 'POST', body: new URLSearchParams({
    client_id: config.instagramAppId, client_secret: config.instagramAppSecret, grant_type: 'authorization_code',
    redirect_uri: redirectUri(), code: code.replace(/#_$/, ''),
  }) });
  const long = await ig(`https://graph.instagram.com/access_token?${new URLSearchParams({
    grant_type: 'ig_exchange_token', client_secret: config.instagramAppSecret, access_token: short.access_token })}`);
  const me = await ig(`${IG_GRAPH}/me?${new URLSearchParams({ fields: 'id,user_id,username,account_type', access_token: long.access_token })}`);
  // Le compte a deux identifiants : le professionnel (user_id) et celui propre à l'application (id). Les deux sont
  // gardés : le webhook et les commentaires peuvent désigner le compte par l'un ou l'autre.
  run(`INSERT INTO social_accounts (user_id, platform, account_id, alt_id, username, access_token, expires_at, error, created_at)
       VALUES (?, 'instagram', ?, ?, ?, ?, ?, '', ?)
       ON CONFLICT(user_id, platform) DO UPDATE SET account_id = excluded.account_id, alt_id = excluded.alt_id, username = excluded.username,
         access_token = excluded.access_token, expires_at = excluded.expires_at, error = ''`,
    entry.userId, String(me.user_id || me.id), String(me.id || ''), me.username || '', seal(long.access_token), now() + (long.expires_in || 60 * 86_400) * 1000, now());
  // Les commentaires arrivent alors tout de suite par le webhook ; sinon la relecture régulière prend le relais.
  await ig(`${IG_GRAPH}/me/subscribed_apps?${new URLSearchParams({ subscribed_fields: 'comments', access_token: long.access_token })}`,
    { method: 'POST' }).catch(() => {});
}

const accountOf = (userId) => get(`SELECT * FROM social_accounts WHERE user_id = ? AND platform = 'instagram'`, userId);

export function disconnect(userId) {
  run(`DELETE FROM social_accounts WHERE user_id = ? AND platform = 'instagram'`, userId);
}

/** Le jeton dure 60 jours : il est renouvelé à moins de 30 jours de la fin (Instagram refuse avant 24 h d'âge). */
async function freshToken(account) {
  if (account.expires_at - now() < 30 * 86_400_000 && now() - account.created_at > 86_400_000) {
    const renewed = await ig(`https://graph.instagram.com/refresh_access_token?${new URLSearchParams({
      grant_type: 'ig_refresh_token', access_token: unseal(account.access_token) })}`);
    run(`UPDATE social_accounts SET access_token = ?, expires_at = ? WHERE user_id = ? AND platform = 'instagram'`,
      seal(renewed.access_token), now() + (renewed.expires_in || 60 * 86_400) * 1000, account.user_id);
    return renewed.access_token;
  }
  return unseal(account.access_token);
}

//============================================================================
//  Publications, commentaires, réponses
//============================================================================
/** Les dernières publications du compte, pour choisir celle que vise une automation. */
export async function recentPosts(userId) {
  const account = accountOf(userId);
  if (!account) throw new HttpError(400, "Reliez d'abord votre compte Instagram.");
  const { data = [] } = await ig(`${IG_GRAPH}/me/media?${new URLSearchParams({
    fields: 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp', limit: '30', access_token: await freshToken(account) })}`);
  return data.map((m) => ({ id: m.id, caption: (m.caption || '').slice(0, 300), thumb: m.thumbnail_url || (m.media_type === 'VIDEO' ? null : m.media_url) || null,
    url: m.permalink || null, at: Date.parse(m.timestamp) || null }));
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

const ours = (account, id) => !!id && (String(id) === account.account_id || (!!account.alt_id && String(id) === account.alt_id));

/**
 * Déjà contacté : le compte a écrit en privé à cette personne depuis la sortie de la publication (à la main ou par
 * une automation, même supprimée depuis). Elle a déjà son lien : rien ne repart, ni réponse ni message.
 */
async function alreadyMessaged(account, automation, comment, token) {
  if (!comment.fromId) return false;
  const found = await ig(`${IG_GRAPH}/${account.account_id}/conversations?${new URLSearchParams({ platform: 'instagram', user_id: comment.fromId, access_token: token })}`);
  const conversation = found.data?.[0];
  if (!conversation) return false;
  const since = automation.post_at || automation.created_at - 30 * 86_400_000;
  const { messages } = await ig(`${IG_GRAPH}/${conversation.id}?${new URLSearchParams({ fields: 'messages.limit(50){from,created_time}', access_token: token })}`);
  return (messages?.data || []).some((m) => ours(account, m.from?.id) && Date.parse(m.created_time) >= since);
}

/** Le compte a déjà répondu sous ce commentaire (à la main) : la réponse publique n'est pas refaite. */
async function alreadyReplied(account, comment, token) {
  const found = await ig(`${IG_GRAPH}/${comment.id}?${new URLSearchParams({ fields: 'replies{from}', access_token: token })}`);
  return (found.replies?.data || []).some((r) => ours(account, r.from?.id));
}

/**
 * Dans l'ordre : la réponse publique sous le commentaire, puis le message privé à son auteur. Rend la raison pour
 * laquelle rien n'est parti (personne déjà contactée), ou une chaîne vide.
 */
async function send(account, automation, comment) {
  const token = await freshToken(account);
  if (await alreadyMessaged(account, automation, comment, token)) return 'Déjà contacté en privé';
  const reply = fill(pick(automation.reply_text), comment);
  if (reply && !(await alreadyReplied(account, comment, token))) {
    await ig(`${IG_GRAPH}/${comment.id}/replies`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: new URLSearchParams({ message: reply }) });
  }
  if (automation.dm_text) {
    // « Réponse privée » : un message à l'auteur du commentaire, un seul par commentaire, dans les 7 jours.
    await ig(`${IG_GRAPH}/${account.account_id}/messages`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient: { comment_id: comment.id }, message: { text: fill(automation.dm_text, comment) } }),
    });
  }
  return '';
}

/**
 * Un commentaire reçu (webhook ou relecture) : réponse si une automation active de ce compte le vise, une seule fois
 * par commentaire et par personne. Jamais à ses propres commentaires (ni donc à ses propres réponses).
 */
export async function handleComment(account, comment) {
  if (!comment.id || !comment.text) return;
  if (comment.fromId === account.account_id || (account.alt_id && comment.fromId === account.alt_id)
    || (comment.username && comment.username === account.username)) return;
  const automations = all(`SELECT * FROM social_automations WHERE user_id = ? AND platform = 'instagram' AND post_id = ? AND active = 1`,
    account.user_id, String(comment.mediaId));
  for (const automation of automations) {
    if (comment.at && comment.at < automation.since) continue;
    if (!matches(automation.keywords, comment.text)) continue;
    const already = get(`SELECT 1 FROM social_replies WHERE automation_id = ? AND (comment_id = ? OR (commenter_id != '' AND commenter_id = ? AND status IN ('sent', 'skipped')))`,
      automation.id, comment.id, comment.fromId || '');
    if (already) continue;
    // Noté avant l'envoi : un webhook et une relecture qui arrivent ensemble ne répondent pas deux fois.
    const { changes } = run(`INSERT OR IGNORE INTO social_replies (automation_id, comment_id, commenter_id, commenter_name, comment_text, status, error, created_at)
                             VALUES (?, ?, ?, ?, ?, 'sending', '', ?)`, automation.id, comment.id, comment.fromId || '', comment.username || '', comment.text.slice(0, 500), now());
    if (!changes) continue;
    try {
      const skipped = await send(account, automation, comment);
      if (skipped) {
        run(`UPDATE social_replies SET status = 'skipped', error = ? WHERE automation_id = ? AND comment_id = ?`, skipped, automation.id, comment.id);
        continue;
      }
      run(`UPDATE social_replies SET status = 'sent' WHERE automation_id = ? AND comment_id = ?`, automation.id, comment.id);
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
    const accounts = all(`SELECT * FROM social_accounts WHERE platform = 'instagram' AND (account_id = ? OR alt_id = ?)`, String(entry.id), String(entry.id));
    for (const change of entry.changes || []) {
      if (change.field !== 'comments' || !change.value) continue;
      const v = change.value;
      const comment = { id: String(v.id || ''), text: v.text || '', fromId: String(v.from?.id || ''), username: v.from?.username || '',
        mediaId: String(v.media?.id || ''), at: entry.time ? (entry.time > 1e12 ? entry.time : entry.time * 1000) : now() };
      // Une ligne par commentaire reçu (sans son texte), pour comprendre une réponse qui ne part pas.
      console.log(`Instagram : commentaire ${comment.id} de @${comment.username || '?'} sur ${comment.mediaId || '?'} (compte ${entry.id}, ${accounts.length ? 'relié' : 'inconnu'})`);
      for (const account of accounts) await handleComment(account, comment);
    }
  }
}

//============================================================================
//  Relecture régulière des commentaires
//============================================================================
async function commentsOf(account, automation) {
  const found = [];
  let url = `${IG_GRAPH}/${automation.post_id}/comments?${new URLSearchParams({ fields: 'id,text,timestamp,username,from{id,username}', limit: '50', access_token: await freshToken(account) })}`;
  for (let page = 0; url && page < 6; page++) {
    const { data = [], paging } = await ig(url);
    found.push(...data.map((c) => ({ id: String(c.id), text: c.text || '', fromId: String(c.from?.id || ''), username: c.username || c.from?.username || '',
      mediaId: automation.post_id, at: Date.parse(c.timestamp) || now() })));
    url = paging?.next || null;
  }
  return found;
}

let busy = false;
/** Relit les commentaires de chaque automation active ; appelé toutes les deux minutes. */
export async function pollComments() {
  if (busy || !platformConfigured()) return;
  busy = true;
  try {
    // Les commentaires traités ne sont gardés que 90 jours (page Confidentialité).
    run('DELETE FROM social_replies WHERE created_at < ?', now() - 90 * 86_400_000);
    // Un compte relié avant que l'identifiant propre à l'application soit gardé : il est demandé une fois à Instagram.
    for (const account of all(`SELECT * FROM social_accounts WHERE platform = 'instagram' AND (alt_id IS NULL OR alt_id = '')`)) {
      try {
        const me = await ig(`${IG_GRAPH}/me?${new URLSearchParams({ fields: 'id', access_token: await freshToken(account) })}`);
        if (me.id) run(`UPDATE social_accounts SET alt_id = ? WHERE user_id = ? AND platform = 'instagram'`, String(me.id), account.user_id);
      } catch { /* réessayé à la prochaine relecture */ }
    }
    for (const automation of all(`SELECT * FROM social_automations WHERE active = 1 AND platform = 'instagram'`)) {
      const account = accountOf(automation.user_id);
      if (!account) continue;
      try {
        const comments = await commentsOf(account, automation);
        // Les plus anciens d'abord : les réponses partent dans l'ordre des commentaires.
        for (const comment of comments.sort((a, b) => a.at - b.at)) await handleComment(account, comment);
        if (account.error) run(`UPDATE social_accounts SET error = '' WHERE user_id = ? AND platform = 'instagram'`, account.user_id);
      } catch (error) {
        run(`UPDATE social_accounts SET error = ? WHERE user_id = ? AND platform = 'instagram'`, String(error.message).slice(0, 300), account.user_id);
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
  keywords: a.keywords, dmText: a.dm_text, replyText: a.reply_text, active: !!a.active, sent: a.sent_count, error: a.last_error,
  since: a.since, createdAt: a.created_at,
  recent: all(`SELECT commenter_name, comment_text, status, error, created_at FROM social_replies WHERE automation_id = ? ORDER BY created_at DESC LIMIT 8`, a.id)
    .map((r) => ({ name: r.commenter_name, text: r.comment_text, status: r.status, error: r.error, at: r.created_at })),
});

export function socialState(userId) {
  const a = accountOf(userId);
  return {
    accounts: { instagram: { configured: platformConfigured(), username: a ? a.username : null, connected: !!a, error: a?.error || '' } },
    automations: all(`SELECT * FROM social_automations WHERE user_id = ? AND platform = 'instagram' ORDER BY id DESC`, userId).map(automationView),
  };
}

const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

/** Les champs d'une automation, vérifiés : création (sans existing) ou modification. */
export function saveAutomation(userId, body, existing) {
  if (!existing && !accountOf(userId)) throw new HttpError(400, "Reliez d'abord votre compte Instagram.");
  const postId = existing ? existing.post_id : text(body.postId, 64);
  if (!/^[\w-]{1,64}$/.test(postId)) throw new HttpError(400, 'Choisissez la publication visée.');
  const keywords = text(body.keywords, 300);
  const dmText = text(body.dmText, LIMITS.dm);
  const replyText = text(body.replyText, 4000);
  if (replyText.split('\n').some((line) => line.trim().length > LIMITS.reply)) {
    throw new HttpError(400, `Instagram accepte ${LIMITS.reply} caractères au plus par réponse.`);
  }
  if (!dmText && !replyText) throw new HttpError(400, 'Écrivez la réponse, le message privé, ou les deux.');
  const active = body.active === undefined ? (existing ? existing.active : 1) : body.active ? 1 : 0;
  if (existing) {
    run('UPDATE social_automations SET keywords = ?, dm_text = ?, reply_text = ?, active = ? WHERE id = ?', keywords, dmText, replyText, active, existing.id);
    return existing.id;
  }
  if (get('SELECT COUNT(*) AS n FROM social_automations WHERE user_id = ?', userId).n >= 50) {
    throw new HttpError(400, "Cinquante automations au plus : retirez-en avant d'en ajouter.");
  }
  // Par défaut, seuls les commentaires écrits après la création reçoivent une réponse ; « earlier » reprend aussi les
  // commentaires des 7 derniers jours (au-delà, Instagram refuse le message privé).
  const since = body.earlier ? now() - 7 * 86_400_000 : now();
  // La date de la publication : un message privé envoyé depuis (à la main ou non) compte comme « déjà contacté ».
  const postAt = Number.isInteger(body.postAt) && body.postAt > 0 && body.postAt <= now() ? body.postAt : null;
  const { lastInsertRowid } = run(`INSERT INTO social_automations (user_id, platform, post_id, post_caption, post_thumb, post_url, post_at, keywords,
      dm_text, reply_text, active, since, sent_count, last_error, created_at) VALUES (?, 'instagram', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, '', ?)`,
    userId, postId, text(body.postCaption, 300), /^https:\/\//.test(body.postThumb || '') ? text(body.postThumb, 2000) : null,
    /^https:\/\//.test(body.postUrl || '') ? text(body.postUrl, 500) : null, postAt, keywords, dmText, replyText, active, since, now());
  return lastInsertRowid;
}
