// Les prods volées : chaque prod d'un pack passe par la reconnaissance musicale d'ACRCloud, la base des titres sortis
// (Spotify, Apple Music, Deezer, YouTube…). Quelques extraits de la prod y sont cherchés : un titre sorti avec la prod
// ressort même avec une voix par-dessus, tant que la prod reste audible. Une prod lancée au dépôt, toutes avec « SCAN ».
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { config } from './config.js';
import { db, get, all, run, now } from './db.js';
import { HttpError, rateLimit } from './auth.js';
import { testing } from './mail.js';

db.exec(`CREATE TABLE IF NOT EXISTS sound_scans (
  track_id   INTEGER PRIMARY KEY REFERENCES sound_tracks(id) ON DELETE CASCADE,
  version_id INTEGER NOT NULL,
  status     TEXT NOT NULL DEFAULT 'wait',
  matches    TEXT NOT NULL DEFAULT '[]',
  error      TEXT,
  queued_at  INTEGER NOT NULL,
  scanned_at INTEGER
)`);

// Les titres que le beatmaker a écartés (« Ce n'est pas un vol ») : un nouveau scan ne les signale plus.
if (!db.prepare(`SELECT 1 FROM pragma_table_info('sound_scans') WHERE name = 'dismissed'`).get()) {
  db.exec(`ALTER TABLE sound_scans ADD COLUMN dismissed TEXT NOT NULL DEFAULT '[]'`);
}
const matchKey = (m) => String(m.id || `${m.title}|${m.artists}`).toLowerCase();
const kept = (matches, dismissed) => { const out = new Set(JSON.parse(dismissed || '[]')); return matches.filter((m) => !out.has(matchKey(m))); };

export const scanConfigured = () => !!(config.acrHost && config.acrKey && config.acrSecret);

// Quatre extraits de 12 s (ACRCloud en veut 10 à 15), répartis sur la prod : l'intro, souvent sans voix, et le reste.
const SAMPLE = 12;
const SPOTS = [0.08, 0.33, 0.58, 0.83];
const ffmpeg = (bin, args) => new Promise((resolve, reject) => execFile(bin, args, { encoding: 'buffer', maxBuffer: 8 * 1024 * 1024, timeout: 60_000 },
  (error, out, stderr) => (error ? reject(new Error(String(stderr || error.message).trim().split('\n').pop().slice(0, 200) || `${bin} a échoué.`)) : resolve(out))));
async function duration(file, known) {
  if (known > 0 || testing) return known || 60;
  return Number(String(await ffmpeg('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file])).trim()) || 0;
}
// Un extrait en MP3 mono : quelques centaines de Ko au lieu d'un WAV entier.
const excerpt = (file, start) => (testing ? Promise.resolve(Buffer.from(`extrait ${start}`))
  : ffmpeg('ffmpeg', ['-v', 'error', '-ss', start.toFixed(1), '-t', String(SAMPLE), '-i', file, '-ac', '1', '-ar', '44100', '-b:a', '128k', '-f', 'mp3', 'pipe:1']));

/** Les titres qui contiennent cet extrait (API d'identification d'ACRCloud, signée HMAC-SHA1). */
async function identify(sample) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = crypto.createHmac('sha1', config.acrSecret).update(['POST', '/v1/identify', config.acrKey, 'audio', '1', timestamp].join('\n')).digest('base64');
  const form = new FormData();
  for (const [k, v] of Object.entries({ access_key: config.acrKey, data_type: 'audio', signature_version: '1', signature, timestamp, sample_bytes: String(sample.length) })) form.append(k, v);
  form.append('sample', new Blob([sample]), 'extrait.mp3');
  const response = await fetch(`https://${config.acrHost}/v1/identify`, { method: 'POST', body: form, signal: AbortSignal.timeout(30_000) });
  const body = await response.json().catch(() => ({}));
  if (body.status?.code === 1001 || body.status?.code === 2004) return []; // rien de reconnu, ou extrait sans rien à reconnaître (silence)
  if (body.status?.code !== 0) throw new Error(`Reconnaissance indisponible : ${body.status?.msg || `erreur ${response.status}`}`);
  return body.metadata?.music || [];
}

const first = (value) => (Array.isArray(value) ? value[0] : value);
function matchView(m) {
  const x = m.external_metadata || {}, spotify = first(x.spotify), deezer = first(x.deezer), youtube = first(x.youtube);
  return {
    id: m.acrid, title: m.title || '', artists: (m.artists || []).map((a) => a.name).filter(Boolean).join(', '), album: m.album?.name || '', released: m.release_date || '',
    links: [
      spotify?.track?.id && { name: 'Spotify', url: `https://open.spotify.com/track/${encodeURIComponent(spotify.track.id)}` },
      deezer?.track?.id && { name: 'Deezer', url: `https://www.deezer.com/track/${encodeURIComponent(deezer.track.id)}` },
      youtube?.vid && { name: 'YouTube', url: `https://www.youtube.com/watch?v=${encodeURIComponent(youtube.vid)}` },
    ].filter(Boolean),
  };
}

// Un titre n'est retenu que si deux extraits au moins y sont reconnus au même décalage : un son fait sur la prod la suit
// dans l'ordre (extrait à 20 s et à 35 s → 15 s d'écart dans le titre aussi), alors qu'un sample ou une boucle commune
// ressort à des endroits sans rapport.
const ALIGN = 3; // secondes de tolérance sur le décalage
/** Les plus grands groupes d'extraits reconnus au même décalage. */
function aligned(hits) {
  let best = [];
  for (const h of hits) {
    const group = hits.filter((o) => Math.abs(o.shift - h.shift) <= ALIGN);
    if (group.length > best.length) best = group;
  }
  return best;
}

/** Les titres sortis qui contiennent la prod ; hits : les extraits reconnus au bon endroit, at : où la prod y commence à être reconnue (s). */
export async function scanFile(file, knownDuration) {
  const seconds = await duration(file, knownDuration);
  const starts = [...new Set(SPOTS.map((at) => Math.max(0, Math.min(seconds * at, seconds - SAMPLE))).map((s) => Math.round(s)))];
  const found = new Map();
  for (const start of starts) {
    const sample = await excerpt(file, start);
    if (sample.length < 1000 && !testing) continue; // au-delà de la fin du son
    if (!testing) await new Promise((resolve) => setTimeout(resolve, 600)); // ACRCloud refuse plus de 2 requêtes par seconde (essai)
    for (const m of await identify(sample)) {
      // Où l'extrait tombe dans le titre trouvé, moins où il est dans la prod : le décalage entre les deux.
      const inTitle = (m.db_begin_time_offset_ms ?? m.play_offset_ms ?? 0) / 1000, inProd = start + (m.sample_begin_time_offset_ms ?? 0) / 1000;
      const seen = found.get(m.acrid) || found.set(m.acrid, { match: matchView(m), hits: [] }).get(m.acrid);
      seen.hits.push({ start, shift: inTitle - inProd, inTitle });
    }
  }
  return [...found.values()].map(({ match, hits }) => ({ match, hits: aligned(hits) })).filter(({ hits }) => hits.length >= 2)
    .map(({ match, hits }) => ({ ...match, hits: hits.length, at: Math.round(Math.min(...hits.map((h) => h.inTitle))) }))
    .sort((a, b) => b.hits - a.hits);
}

// Une prod à la fois (chaque extrait est une requête payante, et le serveur n'a qu'un processeur) ; une file coupée
// par un redémarrage reprend au lancement.
let running = null, soundsDir = '';
/** Vide la file ; pendant qu'elle tourne, rend la même promesse (les prods ajoutées entre-temps y passent aussi). */
export function scanQueue() {
  if (!scanConfigured() || !soundsDir) return Promise.resolve();
  return (running ||= drain().finally(() => { running = null; }));
}
async function drain() {
  for (let s; (s = get(`SELECT * FROM sound_scans WHERE status = 'wait' ORDER BY queued_at, track_id LIMIT 1`));) {
    const v = get('SELECT stored_as, duration FROM sound_versions WHERE id = ?', s.version_id);
    // Une prod remise dans la file pendant son scan (nouvelle version, SCAN) garde sa place : ce résultat-là est ignoré.
    const done = (status, matches, error) => run(`UPDATE sound_scans SET status = ?, matches = COALESCE(?, matches), error = ?, scanned_at = ?
      WHERE track_id = ? AND version_id = ? AND queued_at = ?`, status, matches, error, now(), s.track_id, s.version_id, s.queued_at);
    try {
      if (!v) throw new Error('La version a été supprimée.');
      done('done', JSON.stringify(kept(await scanFile(path.join(soundsDir, v.stored_as), v.duration), s.dismissed)), null);
    } catch (error) {
      done('error', null, String(error.message).slice(0, 300));
    }
  }
}

/** Met des prods de packs dans la file (leur version actuelle) ; les résultats d'avant restent affichés en attendant. */
export function queueScan(trackIds) {
  if (!scanConfigured()) return 0;
  let n = 0;
  for (const id of trackIds) {
    const t = get(`SELECT t.current_id FROM sound_tracks t JOIN sound_projects p ON p.id = t.project_id WHERE t.id = ? AND p.kind = 'pack'`, id);
    if (!t?.current_id) continue;
    run(`INSERT INTO sound_scans (track_id, version_id, status, queued_at) VALUES (?, ?, 'wait', ?)
      ON CONFLICT(track_id) DO UPDATE SET version_id = excluded.version_id, status = 'wait', queued_at = excluded.queued_at`, id, t.current_id, now());
    n++;
  }
  if (n) scanQueue().catch((error) => console.error(`[scan] ${error.message}`));
  return n;
}

/** Le dernier scan de chaque prod des packs d'un membre, par prod. */
export const scansOf = (userId) => new Map(all(`SELECT s.* FROM sound_scans s JOIN sound_tracks t ON t.id = s.track_id JOIN sound_projects p ON p.id = t.project_id
  WHERE p.user_id = ?`, userId).map((s) => [s.track_id, { status: s.status, matches: JSON.parse(s.matches), error: s.error, at: s.scanned_at }]));

export function mountBeatScan(app, { me, soundsDir: dir }) {
  soundsDir = dir;
  // Titres trouvés avant la vérification du décalage (sans « at ») : effacés et revérifiés une fois.
  const stale = all(`SELECT track_id FROM sound_scans WHERE matches != '[]' AND matches NOT LIKE '%"at":%'`).map((s) => s.track_id);
  for (const id of stale) run(`UPDATE sound_scans SET matches = '[]' WHERE track_id = ?`, id);
  queueScan(stale);
  scanQueue().catch((error) => console.error(`[scan] ${error.message}`));
  // « Ce n'est pas un vol » : le badge « Volée ? » disparaît, et ces titres-là ne reviennent plus aux scans suivants.
  app.post('/api/me/sounds/tracks/:id/scan/dismiss', ...me, (req, res) => {
    const s = get(`SELECT s.* FROM sound_scans s JOIN sound_tracks t ON t.id = s.track_id JOIN sound_projects p ON p.id = t.project_id
      WHERE s.track_id = ? AND p.user_id = ?`, Number(req.params.id) || 0, req.user.id);
    if (!s) throw new HttpError(404, 'Prod introuvable.');
    const dismissed = [...new Set([...JSON.parse(s.dismissed || '[]'), ...JSON.parse(s.matches).map(matchKey)])];
    run(`UPDATE sound_scans SET matches = '[]', dismissed = ? WHERE track_id = ?`, JSON.stringify(dismissed), s.track_id);
    res.json({ ok: true });
  });
  // « SCAN » : toutes les prods de tous les packs du membre, quelques fois par jour au plus.
  app.post('/api/me/sounds/scan', ...me, (req, res) => {
    if (!scanConfigured()) throw new HttpError(503, "Le scan des prods n'est pas encore réglé sur le serveur.");
    rateLimit(`sounds-scan:${req.user.id}`, 5, 86400_000);
    const ids = all(`SELECT t.id FROM sound_tracks t JOIN sound_projects p ON p.id = t.project_id WHERE p.user_id = ? AND p.kind = 'pack' ORDER BY p.created_at DESC, t.position`, req.user.id);
    if (!ids.length) throw new HttpError(400, 'Aucune prod à scanner : dépose des prods dans un pack.');
    res.json({ queued: queueScan(ids.map((t) => t.id)) });
  });
}
