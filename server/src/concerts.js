// Les concerts de rap à venir autour d'une ville de la carte des membres (carte.html), d'après l'API Discovery de
// Ticketmaster (genre Hip-Hop/Rap), avec le lien vers la billetterie. Clé réglée par onirique-ticketmaster ;
// sans clé, la carte ne montre pas de concerts. Chaque ville est gardée six heures en mémoire.
import { config } from './config.js';
import { HttpError, rateLimit } from './auth.js';
import { CITY } from './cities.js';

const RAP = 'KnvZfZ7vAv1'; // Ticketmaster : Music > Hip-Hop/Rap
const cache = new Map();
const TTL = 6 * 3600_000;

/** Les événements de la réponse Ticketmaster, regroupés par salle (la salle : nom, adresse, position). */
export function venuesOf(data) {
  const venues = new Map();
  for (const e of data?._embedded?.events || []) {
    const v = e._embedded?.venues?.[0];
    if (!v?.name || !e.url) continue;
    const key = v.id || v.name;
    if (!venues.has(key)) {
      venues.set(key, { id: key, name: v.name, city: v.city?.name || '', address: v.address?.line1 || '',
        lat: Number(v.location?.latitude) || null, lon: Number(v.location?.longitude) || null, events: [] });
    }
    const image = (e.images || []).filter((i) => i.ratio === '16_9').sort((a, b) => a.width - b.width).find((i) => i.width >= 300) || e.images?.[0];
    venues.get(key).events.push({ name: e.name, date: e.dates?.start?.localDate || '', time: e.dates?.start?.localTime?.slice(0, 5) || '',
      url: e.url, image: image?.url || null, soldOut: e.dates?.status?.code === 'offsale' });
  }
  return [...venues.values()].sort((a, b) => (a.events[0].date + a.events[0].time).localeCompare(b.events[0].date + b.events[0].time));
}

export function mountConcerts(app, { wrap }) {
  app.get('/api/concerts', wrap(async (req, res) => {
    if (!config.ticketmasterKey) return res.json({ enabled: false, venues: [] });
    const city = CITY.get(String(req.query.city || ''));
    if (!city) throw new HttpError(404, 'Ville inconnue.');
    const hit = cache.get(city.id);
    if (hit && Date.now() - hit.at < TTL) return res.set('Cache-Control', 'public, max-age=600').json({ enabled: true, venues: hit.venues });
    rateLimit('concerts', 2000, 86400_000); // l'offre gratuite de Ticketmaster : 5 000 demandes par jour
    const q = new URLSearchParams({ apikey: config.ticketmasterKey, genreId: RAP, latlong: `${city.lat},${city.lon}`, radius: '35', unit: 'km',
      sort: 'date,asc', size: '40', locale: '*', startDateTime: new Date().toISOString().slice(0, 19) + 'Z' });
    const r = await fetch(`${config.ticketmasterApi}/discovery/v2/events.json?${q}`, { signal: AbortSignal.timeout(8000) }).catch(() => null);
    if (!r?.ok) {
      console.error('Concerts :', r?.status);
      throw new HttpError(502, "La billetterie ne répond pas pour l'instant. Réessaie dans un moment.");
    }
    const venues = venuesOf(await r.json());
    cache.set(city.id, { at: Date.now(), venues });
    res.set('Cache-Control', 'public, max-age=600').json({ enabled: true, venues });
  }));
}
