// Page Films, réservée aux fondateurs : les nouveaux films (au cinéma, bientôt, populaires, les mieux notés, tendances),
// la recherche et la fiche d'un film, avec où le regarder en France, d'après l'API de TMDB (themoviedb.org).
// La clé reste sur le serveur (TMDB_API_KEY dans le .env, réglée par onirique-tmdb) ; la page elle-même n'est servie
// qu'à un fondateur, comme les potards.
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { HttpError, rateLimit } from './auth.js';

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

export function mountFilms(app, { requireUser, wrap }) {
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
}
