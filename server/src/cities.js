import { readFileSync } from 'node:fs';

// Les villes de la carte des membres (site/carte.html) : France, Belgique, Suisse et Luxembourg sur la carte (far: false),
// le reste de la francophonie dans la bande « Plus loin » (far: true). [id, nom, pays, longitude, latitude, far]
const LIST = [
  ['paris', 'Paris', 'France', 2.35, 48.86], ['marseille', 'Marseille', 'France', 5.37, 43.3], ['lyon', 'Lyon', 'France', 4.84, 45.76],
  ['toulouse', 'Toulouse', 'France', 1.44, 43.6], ['nice', 'Nice', 'France', 7.27, 43.7], ['nantes', 'Nantes', 'France', -1.55, 47.22],
  ['montpellier', 'Montpellier', 'France', 3.88, 43.61], ['strasbourg', 'Strasbourg', 'France', 7.75, 48.58], ['bordeaux', 'Bordeaux', 'France', -0.58, 44.84],
  ['lille', 'Lille', 'France', 3.06, 50.63], ['rennes', 'Rennes', 'France', -1.68, 48.11], ['reims', 'Reims', 'France', 4.03, 49.26],
  ['toulon', 'Toulon', 'France', 5.93, 43.12], ['saint-etienne', 'Saint-Étienne', 'France', 4.39, 45.44], ['le-havre', 'Le Havre', 'France', 0.11, 49.49],
  ['grenoble', 'Grenoble', 'France', 5.72, 45.19], ['dijon', 'Dijon', 'France', 5.04, 47.32], ['angers', 'Angers', 'France', -0.55, 47.47],
  ['nimes', 'Nîmes', 'France', 4.36, 43.84], ['clermont-ferrand', 'Clermont-Ferrand', 'France', 3.09, 45.78], ['le-mans', 'Le Mans', 'France', 0.2, 48.0],
  ['aix-en-provence', 'Aix-en-Provence', 'France', 5.45, 43.53], ['brest', 'Brest', 'France', -4.49, 48.39], ['tours', 'Tours', 'France', 0.69, 47.39],
  ['amiens', 'Amiens', 'France', 2.3, 49.89], ['limoges', 'Limoges', 'France', 1.26, 45.83], ['annecy', 'Annecy', 'France', 6.13, 45.9],
  ['perpignan', 'Perpignan', 'France', 2.9, 42.7], ['metz', 'Metz', 'France', 6.18, 49.12], ['besancon', 'Besançon', 'France', 6.02, 47.24],
  ['orleans', 'Orléans', 'France', 1.91, 47.9], ['rouen', 'Rouen', 'France', 1.1, 49.44], ['caen', 'Caen', 'France', -0.37, 49.18],
  ['mulhouse', 'Mulhouse', 'France', 7.34, 47.75], ['nancy', 'Nancy', 'France', 6.18, 48.69], ['avignon', 'Avignon', 'France', 4.81, 43.95],
  ['poitiers', 'Poitiers', 'France', 0.34, 46.58], ['la-rochelle', 'La Rochelle', 'France', -1.15, 46.16], ['pau', 'Pau', 'France', -0.37, 43.3],
  ['bayonne', 'Bayonne', 'France', -1.47, 43.49], ['cannes', 'Cannes', 'France', 7.01, 43.55], ['valence', 'Valence', 'France', 4.89, 44.93],
  ['chambery', 'Chambéry', 'France', 5.92, 45.57], ['troyes', 'Troyes', 'France', 4.07, 48.3], ['lorient', 'Lorient', 'France', -3.37, 47.75],
  ['quimper', 'Quimper', 'France', -4.1, 48.0], ['saint-malo', 'Saint-Malo', 'France', -2.0, 48.65], ['calais', 'Calais', 'France', 1.86, 50.95],
  ['ajaccio', 'Ajaccio', 'France', 8.74, 41.92], ['bastia', 'Bastia', 'France', 9.45, 42.7],
  ['bruxelles', 'Bruxelles', 'Belgique', 4.35, 50.85], ['liege', 'Liège', 'Belgique', 5.57, 50.63], ['charleroi', 'Charleroi', 'Belgique', 4.44, 50.41],
  ['namur', 'Namur', 'Belgique', 4.87, 50.47], ['mons', 'Mons', 'Belgique', 3.95, 50.45], ['anvers', 'Anvers', 'Belgique', 4.4, 51.22], ['gand', 'Gand', 'Belgique', 3.72, 51.05],
  ['geneve', 'Genève', 'Suisse', 6.14, 46.2], ['lausanne', 'Lausanne', 'Suisse', 6.63, 46.52], ['neuchatel', 'Neuchâtel', 'Suisse', 6.93, 46.99],
  ['fribourg', 'Fribourg', 'Suisse', 7.16, 46.8], ['berne', 'Berne', 'Suisse', 7.45, 46.95], ['zurich', 'Zurich', 'Suisse', 8.54, 47.37], ['bale', 'Bâle', 'Suisse', 7.59, 47.56],
  ['luxembourg', 'Luxembourg', 'Luxembourg', 6.13, 49.61], ['monaco', 'Monaco', 'Monaco', 7.42, 43.74],
  ['montreal', 'Montréal', 'Québec', -73.57, 45.5, true], ['quebec', 'Québec', 'Québec', -71.21, 46.81, true],
  ['fort-de-france', 'Fort-de-France', 'Martinique', -61.07, 14.6, true], ['pointe-a-pitre', 'Pointe-à-Pitre', 'Guadeloupe', -61.53, 16.24, true],
  ['cayenne', 'Cayenne', 'Guyane', -52.33, 4.94, true], ['saint-denis-reunion', 'Saint-Denis', 'La Réunion', 55.45, -20.88, true],
  ['mamoudzou', 'Mamoudzou', 'Mayotte', 45.23, -12.78, true], ['noumea', 'Nouméa', 'Nouvelle-Calédonie', 166.45, -22.27, true],
  ['papeete', 'Papeete', 'Polynésie', -149.57, -17.54, true],
  ['dakar', 'Dakar', 'Sénégal', -17.45, 14.69, true], ['abidjan', 'Abidjan', "Côte d'Ivoire", -4.01, 5.36, true], ['bamako', 'Bamako', 'Mali', -8.0, 12.64, true],
  ['douala', 'Douala', 'Cameroun', 9.7, 4.05, true], ['yaounde', 'Yaoundé', 'Cameroun', 11.5, 3.87, true], ['kinshasa', 'Kinshasa', 'RD Congo', 15.27, -4.32, true],
  ['brazzaville', 'Brazzaville', 'Congo', 15.28, -4.26, true], ['libreville', 'Libreville', 'Gabon', 9.45, 0.39, true], ['lome', 'Lomé', 'Togo', 1.22, 6.13, true],
  ['cotonou', 'Cotonou', 'Bénin', 2.42, 6.37, true], ['ouagadougou', 'Ouagadougou', 'Burkina Faso', -1.52, 12.37, true], ['conakry', 'Conakry', 'Guinée', -13.68, 9.64, true],
  ['antananarivo', 'Antananarivo', 'Madagascar', 47.52, -18.88, true], ['port-au-prince', 'Port-au-Prince', 'Haïti', -72.34, 18.54, true],
  ['casablanca', 'Casablanca', 'Maroc', -7.59, 33.57, true], ['rabat', 'Rabat', 'Maroc', -6.84, 34.02, true], ['marrakech', 'Marrakech', 'Maroc', -7.99, 31.63, true],
  ['alger', 'Alger', 'Algérie', 3.06, 36.75, true], ['oran', 'Oran', 'Algérie', -0.63, 35.7, true], ['tunis', 'Tunis', 'Tunisie', 10.18, 36.81, true],
  ['beyrouth', 'Beyrouth', 'Liban', 35.5, 33.89, true],
];
export const CITIES = LIST.map(([id, name, country, lon, lat, far]) => ({ id, name, country, lon, lat, far: !!far }));
export const CITY = new Map(CITIES.map((c) => [c.id, c]));

// Les métiers qu'on coche dans son CV numérique.
export const CV_ROLES = ['Artiste', 'Chanteur·se', 'Rappeur·se', 'Beatmaker', 'Compositeur·rice', 'Ingé son', 'Mix', 'Master', 'Musicien·ne',
  'DJ', 'Topliner', 'Graphiste', 'Clippeur·se', 'Photographe', 'Monteur·se', 'Manager', 'Label', 'Studio'];

// Toutes les communes de France (villes et villages), d'après l'API officielle geo.api.gouv.fr : leur identifiant est
// « fr-<code INSEE> ». La liste ci-dessus garde la Belgique, la Suisse, le Luxembourg et la francophonie.
const fold = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const commune = (c) => {
  const [lon, lat] = c.centre?.coordinates || [];
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  const overseas = String(c.code).startsWith('97');
  return { id: `fr-${c.code}`, name: c.nom, country: overseas ? c.departement?.nom || 'Outre-mer' : 'France', lon, lat, far: overseas,
    detail: c.departement ? `${c.departement.nom} (${c.departement.code})` : '' };
};
// Toutes les localités de Belgique (une par nom, avec son code postal), d'après zipcode-belgium (jief, GitHub) :
// leur identifiant est « be-<code postal>-<rang> ». [code postal, nom, longitude, latitude]
const BE = JSON.parse(readFileSync(new URL('./belgique.json', import.meta.url), 'utf8'))
  .map(([zip, name, lon, lat], i) => ({ id: `be-${zip}-${i}`, name, country: 'Belgique', lon, lat, far: false, detail: `Belgique (${zip})` }));
const BE_BY_ID = new Map(BE.map((c) => [c.id, c]));

/** Une commune par son identifiant « fr-<INSEE> », vérifiée auprès de l'API officielle (ou « be-… », dans la liste belge) ; null si elle n'existe pas. */
export async function communeById(id, geoApi) {
  if (String(id).startsWith('be-')) return BE_BY_ID.get(id) || null;
  const code = /^fr-([0-9][0-9AB][0-9]{3})$/.exec(String(id || ''))?.[1];
  if (!code) return null;
  const r = await fetch(`${geoApi}/communes/${code}?fields=nom,code,centre,departement`, { signal: AbortSignal.timeout(6000) }).catch(() => null);
  return r?.ok ? commune(await r.json()) : null;
}
/** La recherche d'un lieu : les villes de la liste qui correspondent, puis les communes de France (les plus peuplées d'abord). */
export async function searchPlaces(q, geoApi) {
  const needle = fold(q);
  if (needle.length < 2) return [];
  const listed = CITIES.filter((c) => fold(c.name).startsWith(needle)).slice(0, 5);
  const r = await fetch(`${geoApi}/communes?nom=${encodeURIComponent(q)}&fields=nom,code,centre,departement&boost=population&limit=10`, { signal: AbortSignal.timeout(6000) }).catch(() => null);
  const found = r?.ok ? (await r.json()).map(commune).filter(Boolean) : [];
  const belgian = BE.filter((c) => fold(c.name).startsWith(needle)).slice(0, 10);
  // Une grande ville déjà dans la liste (Paris, Liège…) n'est pas proposée deux fois.
  const known = new Set(listed.filter((c) => c.country === 'France' || c.country === 'Belgique').map((c) => c.country + fold(c.name)));
  const others = [...found, ...belgian].filter((c) => !known.has(c.country + fold(c.name)));
  // Les communes de France d'abord, sauf si le nom tapé est exactement celui d'une localité belge (Wavre, Arlon…).
  others.sort((a, b) => (fold(b.name) === needle) - (fold(a.name) === needle));
  return [...listed, ...others].slice(0, 12);
}
