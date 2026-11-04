// Page Films, réservée aux fondateurs : les nouveaux films (au cinéma, bientôt, populaires, les mieux notés, tendances),
// la recherche et la fiche d'un film, avec où le regarder en France, d'après l'API de TMDB (themoviedb.org).
// La clé reste sur le serveur (TMDB_API_KEY dans le .env, réglée par onirique-tmdb) ; la page elle-même n'est servie
// qu'à un fondateur, comme les potards.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { HttpError, rateLimit } from './auth.js';
import { db, get, all, run, now, setting, setSetting } from './db.js';

// Les fichiers déposés par les fondateurs pour un film (vidéos et sous-titres) : la source « Mes vidéos ».
db.exec(`
CREATE TABLE IF NOT EXISTS film_files (
  id INTEGER PRIMARY KEY,
  tmdb_id INTEGER NOT NULL,
  kind TEXT NOT NULL,              -- video | subtitle
  label TEXT NOT NULL,
  lang TEXT NOT NULL DEFAULT '',
  mime TEXT NOT NULL,
  stored_as TEXT NOT NULL,
  size INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS film_files_tmdb ON film_files (tmdb_id);
`);
export const filmsDir = path.join(config.dataDir, 'films');
const VIDEO_MAX = 2 * 1024 ** 3;   // la limite d'envoi de nginx
const SUB_MAX = 2 * 1024 ** 2;

const IMG = 'https://image.tmdb.org/t/p/';
const LISTS = { now_playing: 'movie/now_playing', upcoming: 'movie/upcoming', popular: 'movie/popular', top_rated: 'movie/top_rated', trending: 'trending/movie/week' };
const text = (value, max = 2000) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);
// Une image n'est gardée que si son chemin a la forme de ceux de TMDB (rien d'autre n'arrive dans un src).
const image = (pathname, size) => (typeof pathname === 'string' && /^\/[\w-]+\.(jpg|jpeg|png|svg)$/.test(pathname) ? IMG + size + pathname : null);

async function tmdb(route, params = {}) {
  const key = config.tmdbKey;
  if (!key) throw new HttpError(503, "La clé TMDB n'est pas encore réglée sur le serveur.");
  const url = new URL(`${config.tmdbApi}/${route}`);
  url.search = new URLSearchParams({ language: 'fr-FR', region: 'FR', ...params });
  // Une clé « v4 » (jeton de lecture) passe en en-tête ; une clé « v3 » passe dans l'adresse.
  const v4 = key.startsWith('eyJ');
  if (!v4) url.searchParams.set('api_key', key);
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { Accept: 'application/json', ...(v4 ? { Authorization: `Bearer ${key}` } : {}) } });
  } catch {
    throw new HttpError(502, 'TMDB ne répond pas, réessaie dans un instant.');
  }
  if (response.status === 401) throw new HttpError(502, 'TMDB refuse la clé réglée sur le serveur.');
  if (response.status === 404) throw new HttpError(404, 'Film introuvable.');
  if (!response.ok) throw new HttpError(502, 'TMDB ne répond pas, réessaie dans un instant.');
  return response.json().catch(() => { throw new HttpError(502, 'Réponse illisible de TMDB.'); });
}

const card = (m) => ({
  id: m.id, title: text(m.title, 200) || text(m.original_title, 200), original: text(m.original_title, 200),
  date: /^\d{4}-\d{2}-\d{2}$/.test(m.release_date) ? m.release_date : null, rating: num(m.vote_average), votes: num(m.vote_count),
  poster: image(m.poster_path, 'w342'), overview: text(m.overview, 600),
});
const page = (data) => ({
  page: num(data?.page) || 1, pages: Math.min(num(data?.total_pages) || 1, 500),   // TMDB ne sert pas au-delà de la page 500
  results: (Array.isArray(data?.results) ? data.results : []).filter((m) => Number.isInteger(m?.id) && (m.media_type ?? 'movie') === 'movie').map(card),
});
const pageNumber = (value) => Math.min(Math.max(Number.parseInt(value, 10) || 1, 1), 500);

export async function filmList(kind, n) {
  if (!LISTS[kind]) throw new HttpError(400, 'Liste inconnue.');
  return page(await tmdb(LISTS[kind], { page: String(pageNumber(n)) }));
}

export async function filmSearch(query, n) {
  const q = text(query, 100);
  if (q.length < 2) throw new HttpError(400, 'Tape au moins deux lettres.');
  return page(await tmdb('search/movie', { query: q, page: String(pageNumber(n)), include_adult: 'false' }));
}

export async function filmDetails(id) {
  if (!/^\d{1,9}$/.test(String(id))) throw new HttpError(404, 'Film introuvable.');
  const m = await tmdb(`movie/${id}`, { append_to_response: 'videos,credits,watch/providers', include_video_language: 'fr,en' });
  const videos = (m.videos?.results || []).filter((v) => v.site === 'YouTube' && /^[\w-]{11}$/.test(v.key));
  const trailer = videos.find((v) => v.type === 'Trailer' && v.iso_639_1 === 'fr') || videos.find((v) => v.type === 'Trailer') || videos[0];
  const fr = m['watch/providers']?.results?.FR || {};
  const providers = (list) => (Array.isArray(list) ? list : []).map((p) => ({ name: text(p.provider_name, 80), logo: image(p.logo_path, 'w92') })).filter((p) => p.name);
  let watchLink = null;
  try { const u = new URL(fr.link); if (u.protocol === 'https:' && /(^|\.)themoviedb\.org$/.test(u.hostname)) watchLink = u.href; } catch {}
  return {
    ...card(m),
    tagline: text(m.tagline, 300), overview: text(m.overview), runtime: num(m.runtime), backdrop: image(m.backdrop_path, 'w1280'),
    genres: (m.genres || []).map((g) => text(g.name, 40)).filter(Boolean),
    directors: (m.credits?.crew || []).filter((c) => c.job === 'Director').map((c) => text(c.name, 80)).slice(0, 3),
    cast: (m.credits?.cast || []).slice(0, 10).map((c) => ({ name: text(c.name, 80), role: text(c.character, 80), photo: image(c.profile_path, 'w185') })),
    trailer: trailer ? `https://www.youtube-nocookie.com/embed/${trailer.key}` : null,
    watch: { stream: providers(fr.flatrate), rent: providers(fr.rent), buy: providers(fr.buy), link: watchLink },
    tmdb: `https://www.themoviedb.org/movie/${m.id}`, imdb: /^tt\d{1,10}$/.test(m.imdb_id) ? `https://www.imdb.com/title/${m.imdb_id}/` : null,
  };
}

// ——— Les sources de lecture ———
// Chaque fournisseur est un adaptateur { name, enabled(), sources(tmdbId) } qui rend des sources
// { label, type: 'mp4' | 'webm' | 'hls', url } et des sous-titres { label, lang, url } en WebVTT. Le lecteur de la page
// ne connaît que ce format. N'entre ici qu'un fournisseur dont le droit de diffuser les films est établi.
function signKey() {
  let key = setting('films_key', null);
  if (!key) { key = crypto.randomBytes(32).toString('hex'); setSetting('films_key', key); }
  return key;
}
const sign = (value) => crypto.createHmac('sha256', signKey()).update(value).digest('base64url');
// Un lecteur <video> n'envoie pas de jeton : l'adresse du fichier est signée et vaut six heures.
const fileUrl = (id) => { const e = now() + 6 * 3600_000; return `/api/film-file/${id}?e=${e}&s=${sign(`${id}.${e}`)}`; };
const uploads = {
  name: 'Mes vidéos',
  enabled: () => true,
  sources(tmdbId) {
    const rows = all('SELECT * FROM film_files WHERE tmdb_id = ? ORDER BY kind, created_at', tmdbId);
    const out = (f) => ({ id: f.id, label: f.label, lang: f.lang, size: f.size, url: fileUrl(f.id), type: f.mime === 'video/webm' ? 'webm' : 'mp4', removable: true });
    return { sources: rows.filter((f) => f.kind === 'video').map(out), subtitles: rows.filter((f) => f.kind === 'subtitle').map(out) };
  },
};
export const ADAPTERS = [uploads];

export async function filmSources(id) {
  if (!/^\d{1,9}$/.test(String(id))) throw new HttpError(404, 'Film introuvable.');
  const sources = [], subtitles = [];
  for (const adapter of ADAPTERS.filter((a) => a.enabled())) {
    // Un fournisseur en panne ne prive pas le lecteur des autres.
    const r = await Promise.resolve().then(() => adapter.sources(Number(id))).catch(() => null);
    if (r) { sources.push(...r.sources.map((s) => ({ ...s, from: adapter.name }))); subtitles.push(...r.subtitles); }
  }
  return { sources, subtitles };
}

/** Le type d'une vidéo d'après ses premiers octets : seuls MP4 et WebM se lisent dans un navigateur. */
function videoType(file) {
  const head = Buffer.alloc(12);
  const fd = fs.openSync(file, 'r');
  try { fs.readSync(fd, head, 0, 12, 0); } finally { fs.closeSync(fd); }
  if (head.toString('latin1', 4, 8) === 'ftyp') return 'video/mp4';
  if (head.readUInt32BE(0) === 0x1a45dfa3) return 'video/webm';
  return null;
}
/** Des sous-titres SRT ou WebVTT, rendus en WebVTT (null s'ils sont illisibles). */
export function toVtt(raw) {
  const body = raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n').trim();
  if (/^WEBVTT/.test(body)) return body + '\n';
  if (!/\d{2}:\d{2}:\d{2}[,.]\d{3} --> \d{2}:\d{2}:\d{2}[,.]\d{3}/.test(body)) return null;
  return 'WEBVTT\n\n' + body.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2') + '\n';
}
const tmdbIdOf = (req) => { if (!/^\d{1,9}$/.test(req.params.id)) throw new HttpError(404, 'Film introuvable.'); return Number(req.params.id); };
const addFile = (req, tmdbId, kind, mime, file, fallback) => run(
  'INSERT INTO film_files (tmdb_id, kind, label, lang, mime, stored_as, size, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  tmdbId, kind, text(req.query.label, 60) || fallback, text(req.query.lang, 10), mime, file.storedAs, file.size, req.user.id, now()).lastInsertRowid;

export function mountFilms(app, { requireUser, receiveFile, wrap }) {
  fs.mkdirSync(filmsDir, { recursive: true });
  // Le fichier, par son adresse signée (hors de /api/films : un lecteur <video> n'a pas de jeton). Range géré par sendFile.
  app.get('/api/film-file/:id', (req, res) => {
    const id = Number.parseInt(req.params.id, 10), e = Number(req.query.e), s = String(req.query.s || ''), good = sign(`${id}.${e}`);
    if (!(e > now()) || s.length !== good.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(good))) throw new HttpError(403, 'Ce lien de lecture a expiré : recharge la page.');
    const f = get('SELECT * FROM film_files WHERE id = ?', id);
    if (!f) throw new HttpError(404, 'Fichier introuvable.');
    res.set({ 'Content-Type': f.mime, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' });
    res.sendFile(path.join(filmsDir, f.stored_as));
  });

  // Tout ce qui est sous /api/films, page comprise, est refusé à qui n'est pas fondateur.
  app.use('/api/films', (req, res, next) => requireUser(req, res, (error) => next(error
    || (req.user.role === 'founder' ? undefined : new HttpError(403, 'Réservé aux fondateurs.')))));
  app.use('/api/films', (req, _res, next) => { rateLimit(`films:${req.user.id}`, 300); next(); });
  app.get('/api/films/page', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.sendFile(fileURLToPath(new URL('films.html', import.meta.url)));
  });
  app.get('/api/films/list/:kind', wrap(async (req, res) => res.json(await filmList(req.params.kind, req.query.page))));
  app.get('/api/films/search', wrap(async (req, res) => res.json(await filmSearch(req.query.q, req.query.page))));
  app.get('/api/films/movie/:id', wrap(async (req, res) => res.json(await filmDetails(req.params.id))));
  app.get('/api/films/movie/:id/sources', wrap(async (req, res) => res.json(await filmSources(req.params.id))));

  // Déposer une vidéo ou des sous-titres pour un film (corps brut ; nom et langue dans l'adresse).
  app.post('/api/films/movie/:id/videos', wrap(async (req, res) => {
    const tmdbId = tmdbIdOf(req), file = await receiveFile(req, filmsDir, VIDEO_MAX), target = path.join(filmsDir, file.storedAs), mime = videoType(target);
    if (!mime) { fs.rmSync(target, { force: true }); throw new HttpError(400, 'Seules les vidéos MP4 et WebM se lisent dans un navigateur.'); }
    res.status(201).json({ id: addFile(req, tmdbId, 'video', mime, file, 'Vidéo') });
  }));
  app.post('/api/films/movie/:id/subtitles', wrap(async (req, res) => {
    const tmdbId = tmdbIdOf(req), file = await receiveFile(req, filmsDir, SUB_MAX), target = path.join(filmsDir, file.storedAs);
    const vtt = toVtt(fs.readFileSync(target, 'utf8'));
    if (!vtt) { fs.rmSync(target, { force: true }); throw new HttpError(400, 'Sous-titres illisibles : il faut un fichier SRT ou VTT.'); }
    fs.writeFileSync(target, vtt);
    res.status(201).json({ id: addFile(req, tmdbId, 'subtitle', 'text/vtt; charset=utf-8', { ...file, size: Buffer.byteLength(vtt) }, 'Sous-titres') });
  }));
  app.delete('/api/films/files/:fid', (req, res) => {
    const f = get('SELECT * FROM film_files WHERE id = ?', Number.parseInt(req.params.fid, 10));
    if (!f) throw new HttpError(404, 'Fichier introuvable.');
    run('DELETE FROM film_files WHERE id = ?', f.id);
    fs.rmSync(path.join(filmsDir, f.stored_as), { force: true });
    res.json({ ok: true });
  });
}
