// ANALYSER UN COMPTE TIKTOK (menu Arborescence de CUT, fondateurs) : on colle le lien d'un compte (ou de vidéos), le serveur
// va lire seul ses vidéos publiques et l'IA du VPS (cutagent.js) en tire ce qui marche, et des leçons pour l'arborescence.
//
//   1. la liste des vidéos du compte (yt-dlp) : description, vues, j'aime, commentaires, partages, enregistrements, durée,
//      musique, date, couverture ;
//   2. les couvertures, réduites ;
//   3. les vidéos qui font le plus de vues (et celle qui en fait le moins, pour comparer) : téléchargées en 480p le temps d'en
//      tirer 3 images et leurs sous-titres, puis effacées ;
//   4. l'IA compare ce qui marche et ce qui ne marche pas, et propose des leçons (que les fondateurs ajoutent d'un clic).
// Rien ne gêne le site : une analyse à la fois, en arrière-plan, yt-dlp et ffmpeg en priorité basse, chaque étape bornée dans
// le temps ; une panne s'arrête sur un état lisible, avec ce qui a déjà été lu. Gardé un an (comptes et vidéos publics).
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { config } from './config.js';
import { db, get, all, run, now } from './db.js';
import { HttpError, rateLimit } from './auth.js';
import { testing } from './mail.js';
import { ytdlpCommand, tiktokUrl } from './downloader.js';
import { askLocal, NoAI } from './cutagent.js';

db.exec(`CREATE TABLE IF NOT EXISTS cut_accounts (
  id         INTEGER PRIMARY KEY,
  handle     TEXT NOT NULL,                 -- @compte, ou '' pour une liste de vidéos
  links      TEXT NOT NULL DEFAULT '[]',    -- les liens de vidéos collés (sans compte)
  status     TEXT NOT NULL DEFAULT 'attente', -- attente | lecture | ia | fini | erreur
  step       TEXT NOT NULL DEFAULT '',
  progress   REAL NOT NULL DEFAULT 0,
  error      TEXT NOT NULL DEFAULT '',
  data       TEXT NOT NULL DEFAULT '{}',    -- { account, videos, opinion }
  thumbs     TEXT NOT NULL DEFAULT '{}',    -- { covers: { id: jpeg }, frames: { id: [jpeg] } }
  author     TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)`);
// Un redémarrage coupe une analyse en cours : elle le dit (on la relance d'un clic).
run("UPDATE cut_accounts SET status = 'erreur', error = 'Interrompue par un redémarrage du serveur : relance-la.' WHERE status IN ('attente', 'lecture', 'ia')");
const purge = () => run('DELETE FROM cut_accounts WHERE created_at < ?', now() - 365 * 864e5);
purge();
setInterval(purge, 864e5).unref();

const LIST_MAX = 40, DEEP = 3;
const str = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u0009\u000b-\u001f]+/g, ' ').trim().slice(0, max) : '');
const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null);
const parse = (s, d) => { try { return JSON.parse(s); } catch { return d; } };

/** Le compte d'un lien de profil (« https://www.tiktok.com/@nom » ou « @nom ») ; '' sinon (un lien de vidéo n'en est pas un). */
export function handleOf(raw) {
  const text = String(raw || '').trim();
  const m = text.match(/^@([A-Za-z0-9._]{2,24})$/) || text.match(/^https?:\/\/(?:www\.|m\.)?tiktok\.com\/@([A-Za-z0-9._]{2,24})\/?(?:[?#].*)?$/i);
  return m ? m[1] : '';
}
/** Ce qu'on a collé : un profil (le compte entier est analysé), sinon des liens de vidéos (20 au plus). */
export function targetOf(raw) {
  const lines = String(raw || '').split(/[\s,]+/).map((l) => l.trim()).filter(Boolean).slice(0, 30);
  const handle = lines.map(handleOf).find(Boolean) || '';
  return { handle, links: handle ? [] : [...new Set(lines.map(tiktokUrl).filter(Boolean))].slice(0, 20) };
}

const sh = (cmd, args, timeout) => new Promise((resolve, reject) => execFile(process.platform === 'win32' ? cmd : 'nice',
  process.platform === 'win32' ? args : ['-n', '19', cmd, ...args], { timeout, maxBuffer: 80e6 }, (error, stdout) => (error ? reject(error) : resolve(stdout))));
async function ytdlp(args, timeout) {
  const [cmd, extra] = await ytdlpCommand();
  return sh(cmd, [...extra, '--no-warnings', '--socket-timeout', '20', ...args], timeout);
}
/** Une vidéo telle que yt-dlp la décrit, ramenée à ce qui sert. */
const videoOf = (e) => ({
  id: String(e.id || ''), url: e.webpage_url || e.url || '', text: str(e.description || e.title, 600), views: num(e.view_count), likes: num(e.like_count),
  comments: num(e.comment_count), shares: num(e.repost_count), saves: num(e.save_count), duration: num(e.duration),
  music: str([...(e.artists || [e.artist]).filter(Boolean)].join(', ') + (e.track ? ' - ' + e.track : ''), 160), date: e.timestamp ? e.timestamp * 1000 : null,
  cover: (e.thumbnails || []).map((t) => t.url).filter((u) => /^https:\/\//.test(u || '')).at(-1) || e.thumbnail || '',
  hashtags: [...new Set((String(e.description || '').toLowerCase().match(/#[\p{L}\p{N}_]+/gu) || []))].slice(0, 15),
});
async function jpeg(buffer, width, height) {
  return 'data:image/jpeg;base64,' + (await sharp(buffer).resize(width, height, { fit: 'cover' }).jpeg({ quality: 68 }).toBuffer()).toString('base64');
}
async function coverOf(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  const raw = Buffer.from(await r.arrayBuffer());
  if (!r.ok || raw.length > 8e6) throw new Error('couverture');
  return jpeg(raw, 120, 213);
}
/** Le texte d'un fichier de sous-titres WebVTT, sans les temps ni les balises. */
export const vttText = (vtt) => [...new Set(String(vtt).split(/\r?\n/).filter((l) => l && !/-->|^WEBVTT|^\d+$|^NOTE|^Kind:|^Language:/.test(l))
  .map((l) => l.replace(/<[^>]*>/g, '').trim()).filter(Boolean))].join(' ').slice(0, 900);

const SYSTEM = `Tu analyses un compte TikTok (ou des vidéos TikTok) pour ONIRIQUE, un label de rap qui monte ses TikToks avec ONIRIQUE CUT :
une réplique de film puis le couplet calé sur le beat, des paroles à l'écran. Tu reçois les chiffres de chaque vidéo (vues, j'aime,
commentaires, partages, enregistrements, durée, musique, description, hashtags), les sous-titres de quelques vidéos et des images
(3 par vidéo : début, milieu, fin) des vidéos qui marchent le mieux et de celle qui marche le moins.
Dis aux fondateurs, en français simple et direct (tutoie-les), ce qui fait marcher ce compte : le format, la durée, l'accroche des
premières secondes, le texte à l'écran, le montage, la musique, les descriptions et hashtags, le rythme de publication. Compare les
vidéos fortes et faibles avec les chiffres. Puis propose des leçons concrètes pour l'arborescence de CUT ; quand une leçon touche un
réglage précis de CUT, donne sa clé (liste fournie) et la valeur conseillée, sinon laisse la feuille vide. Ne devine pas ce que les
données ne montrent pas. Réponds seulement par l'objet JSON demandé.`;
const schemaOf = (keys) => ({ type: 'object', required: ['resume', 'ce_qui_marche', 'ce_qui_marche_moins', 'format', 'textes', 'hashtags', 'lecons', 'images'],
  properties: {
    resume: { type: 'string' }, ce_qui_marche: { type: 'array', items: { type: 'string' } }, ce_qui_marche_moins: { type: 'array', items: { type: 'string' } },
    format: { type: 'string' }, textes: { type: 'string' }, hashtags: { type: 'array', items: { type: 'string' } },
    lecons: { type: 'array', items: { type: 'object', required: ['texte', 'feuille', 'valeur'],
      properties: { texte: { type: 'string' }, feuille: { type: 'string', enum: [...keys, ''] }, valeur: { type: 'string' } } } },
    images: { type: 'string' },
  } });
/** L'avis de l'IA, propre : des textes bornés, des feuilles qui existent. */
export function cleanAnalysis(raw, keys) {
  const r = raw && typeof raw === 'object' ? raw : {}, list = (v, n, max) => (Array.isArray(v) ? v : []).map((t) => str(t, max)).filter(Boolean).slice(0, n);
  return { resume: str(r.resume, 1200), works: list(r.ce_qui_marche, 10, 400), weaker: list(r.ce_qui_marche_moins, 8, 400), format: str(r.format, 600),
    texts: str(r.textes, 600), hashtags: list(r.hashtags, 15, 60), images: str(r.images, 500),
    lessons: (Array.isArray(r.lecons) ? r.lecons : []).filter((l) => l && str(l.texte, 1)).slice(0, 10)
      .map((l) => ({ text: str(l.texte, 400), leaf: keys.has(l.feuille) ? l.feuille : '', value: l.feuille && keys.has(l.feuille) ? str(String(l.valeur ?? ''), 60) : '' })) };
}

let queue = Promise.resolve();
/** Lance l'analyse d'une ligne de cut_accounts (une à la fois). leaves : Map des feuilles de l'arbre (clé → feuille). */
function analyze(id, leaves) {
  if (testing && !process.env.CUT_ACCOUNT_TEST) return;
  queue = queue.then(() => work(id, leaves).catch((error) => {
    console.error('Analyse de compte TikTok :', error.message);
    run("UPDATE cut_accounts SET status = 'erreur', error = ?, updated_at = ? WHERE id = ?", String(error.message).slice(0, 300), now(), id);
  }));
}
async function work(id, leaves) {
  const row = get('SELECT * FROM cut_accounts WHERE id = ?', id);
  if (!row) return;
  const set = (step, progress, more = {}) => run(`UPDATE cut_accounts SET status = ?, step = ?, progress = ?, updated_at = ?${more.data ? ', data = ?' : ''}${more.thumbs ? ', thumbs = ?' : ''} WHERE id = ?`,
    more.status || 'lecture', step, progress, now(), ...(more.data ? [JSON.stringify(more.data)] : []), ...(more.thumbs ? [JSON.stringify(more.thumbs)] : []), id);
  // 1. les vidéos
  set('Lecture de la liste des vidéos…', .05);
  let videos = [], account = { handle: row.handle };
  if (row.handle) {
    const out = await ytdlp(['--flat-playlist', '-J', '--playlist-end', String(LIST_MAX), `https://www.tiktok.com/@${row.handle}`], 150_000)
      .catch(() => { throw new Error('TikTok n’a pas donné la liste des vidéos de @' + row.handle + ' (compte privé, inexistant, ou lecture bloquée) : colle plutôt des liens de vidéos.'); });
    const j = JSON.parse(out);
    videos = (j.entries || []).map(videoOf).filter((v) => v.id);
    account = { handle: row.handle, name: str(j.uploader || j.channel || j.title, 80) };
  }
  for (const [k, link] of parse(row.links, []).entries()) {
    set(`Lecture des vidéos collées (${k + 1} / ${parse(row.links, []).length})…`, .05 + .1 * k / parse(row.links, []).length);
    try { const v = videoOf(JSON.parse(await ytdlp(['-J', '--skip-download', link], 90_000))); if (v.id && !videos.some((x) => x.id === v.id)) videos.push(v); } catch { /* vidéo illisible : on passe */ }
  }
  if (!videos.length) throw new Error('Aucune vidéo lisible : vérifie le lien (compte public ?) puis relance.');
  const ranked = [...videos].sort((a, b) => (b.views || 0) - (a.views || 0));
  const views = ranked.map((v) => v.views || 0), median = views[Math.floor(views.length / 2)] || 0;
  account = { ...account, videos: videos.length, totalViews: views.reduce((a, b) => a + b, 0), medianViews: median, bestViews: views[0] || 0 };
  const data = { account, videos: ranked };
  set('Les couvertures…', .2, { data });
  // 2. les couvertures
  const thumbs = { covers: {}, frames: {} };
  for (const [k, v] of ranked.entries()) {
    if (v.cover) thumbs.covers[v.id] = await coverOf(v.cover).catch(() => undefined);
    if (k % 5 === 4) set(`Les couvertures (${k + 1} / ${ranked.length})…`, .2 + .15 * k / ranked.length);
  }
  set('Les vidéos qui marchent…', .35, { thumbs });
  // 3. images et sous-titres des vidéos fortes, et de la plus faible
  const deep = [...ranked.slice(0, DEEP), ...(ranked.length > DEEP + 1 ? [ranked.at(-1)] : [])];
  const tmp = fs.mkdtempSync(path.join(config.dataDir, 'cut-account-'));
  try {
    for (const [k, v] of deep.entries()) {
      set(`Images et sous-titres de la vidéo ${k + 1} / ${deep.length}…`, .35 + .3 * k / deep.length);
      const base = path.join(tmp, String(k));
      try {
        await ytdlp(['-f', 'b[height<=480]/worst', '-o', base + '.%(ext)s', '--write-subs', '--write-auto-subs', '--sub-langs', 'fr.*,fra.*,en.*,eng.*',
          '--sub-format', 'vtt/best', '--no-playlist', v.url], 180_000);
        const file = fs.readdirSync(tmp).find((f) => f.startsWith(k + '.') && /\.(mp4|webm|mov)$/.test(f));
        const subs = fs.readdirSync(tmp).find((f) => f.startsWith(k + '.') && f.endsWith('.vtt'));
        if (subs) v.subtitles = vttText(fs.readFileSync(path.join(tmp, subs), 'utf8'));
        if (file) {
          const d = v.duration || 10, shots = [];
          for (const t of [Math.min(1, d / 10), d * .45, d * .85]) {
            const out = base + '-' + Math.round(t * 10) + '.jpg';
            await sh('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-ss', t.toFixed(2), '-i', path.join(tmp, file), '-frames:v', '1', '-vf', 'scale=240:-2', out], 60_000).catch(() => {});
            if (fs.existsSync(out)) shots.push(await jpeg(fs.readFileSync(out), 216, 384));
          }
          if (shots.length) thumbs.frames[v.id] = shots;
          fs.rmSync(path.join(tmp, file), { force: true });
        }
      } catch { /* vidéo non téléchargeable : on garde ses chiffres */ }
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  set('L’IA analyse le compte (quelques minutes)…', .7, { status: 'ia', data, thumbs });
  // 4. l'IA
  const keys = new Set(leaves.keys());
  const view = { compte: account,
    videos: ranked.map((v) => ({ id: v.id, vues: v.views, jaime: v.likes, commentaires: v.comments, partages: v.shares, enregistrements: v.saves, duree_s: v.duration,
      musique: v.music, date: v.date ? new Date(v.date).toISOString().slice(0, 10) : null, description: v.text.slice(0, 220), sous_titres: v.subtitles || undefined })),
    reglages_de_cut: [...leaves.values()].map((l) => ({ key: l.key, nom: l.label, valeur: l.value, choix: l.options ? Object.keys(l.options) : l.type })) };
  const shotIds = deep.filter((v) => thumbs.frames[v.id]).slice(0, 3);
  const images = shotIds.flatMap((v) => thumbs.frames[v.id]).map((t) => t.replace(/^data:image\/jpeg;base64,/, ''));
  const order = shotIds.map((v) => `${v.id} (${v.views ?? '?'} vues)`).join(', ');
  try {
    const json = await askLocal(SYSTEM, `Images jointes, 3 par vidéo dans cet ordre : ${order || 'aucune'}.\n\n${JSON.stringify(view)}`, images, schemaOf(keys));
    data.opinion = cleanAnalysis(json, keys);
    set('Fini', 1, { status: 'fini', data });
  } catch (error) {
    // Les chiffres et les images restent : seule l'analyse manque.
    data.opinion = null;
    run("UPDATE cut_accounts SET status = 'erreur', step = '', progress = 1, error = ?, data = ?, updated_at = ? WHERE id = ?",
      (error instanceof NoAI ? 'L’IA du serveur n’est pas installée (onirique-superviseur) : ' : 'L’IA n’a pas pu analyser : ') + String(error.message).slice(0, 200), JSON.stringify(data), now(), id);
  }
}

const view = (r) => ({ id: r.id, handle: r.handle, links: parse(r.links, []), status: r.status, step: r.step, progress: r.progress, error: r.error, author: r.author,
  at: r.created_at, updated: r.updated_at, ...parse(r.data, {}), thumbs: parse(r.thumbs, {}) });
/** Les analyses pour le superviseur : leur résumé et leurs leçons, sans images. */
export const accountsForAgent = () => all("SELECT handle, data FROM cut_accounts WHERE status = 'fini' ORDER BY id DESC LIMIT 3").map((r) => {
  const d = parse(r.data, {});
  return { compte: r.handle, chiffres: d.account, avis: d.opinion && { resume: d.opinion.resume, ce_qui_marche: d.opinion.works, lecons: d.opinion.lessons } };
});

export function mountCutAccounts(app, { requireUser, founder, leaves }) {
  app.get('/api/cut/brain/accounts', requireUser, founder, (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ accounts: all('SELECT * FROM cut_accounts ORDER BY id DESC LIMIT 12').map(view) });
  });
  app.post('/api/cut/brain/accounts', requireUser, founder, (req, res) => {
    rateLimit(`cut-account:${req.user.id}`, 10, 3600_000);
    const { handle, links } = targetOf(req.body?.url);
    if (!handle && !links.length) throw new HttpError(400, 'Colle le lien d’un compte TikTok (https://www.tiktok.com/@nom) ou des liens de vidéos.');
    if (get("SELECT COUNT(*) AS n FROM cut_accounts WHERE status IN ('attente', 'lecture', 'ia')").n >= 3) throw new HttpError(429, 'Trois analyses attendent déjà : patiente un peu.');
    const id = run("INSERT INTO cut_accounts (handle, links, author, created_at, updated_at, step) VALUES (?, ?, ?, ?, ?, 'En attente de son tour…')",
      handle, JSON.stringify(links), req.user.name || req.user.email, now(), now()).lastInsertRowid;
    analyze(Number(id), leaves());
    res.status(202).json({ ok: true, id: Number(id) });
  });
  app.post('/api/cut/brain/accounts/:id/retry', requireUser, founder, (req, res) => {
    const row = get("SELECT id FROM cut_accounts WHERE id = ? AND status IN ('erreur', 'fini')", Number(req.params.id) || 0);
    if (!row) throw new HttpError(404, 'Analyse introuvable ou en cours.');
    run("UPDATE cut_accounts SET status = 'attente', step = 'En attente de son tour…', progress = 0, error = '', updated_at = ? WHERE id = ?", now(), row.id);
    analyze(row.id, leaves());
    res.status(202).json({ ok: true });
  });
  app.delete('/api/cut/brain/accounts/:id', requireUser, founder, (req, res) => {
    run("DELETE FROM cut_accounts WHERE id = ? AND status IN ('erreur', 'fini')", Number(req.params.id) || 0);
    res.json({ ok: true });
  });
}
