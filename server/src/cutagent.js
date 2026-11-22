// LE SUPERVISEUR DE L'ARBORESCENCE DE CUT : une IA relit ce que l'arbre a appris et donne son avis aux fondateurs : pour ou
// contre chaque proposition, des alertes, un avis par branche, des leçons à écrire. Il ne décide rien : il écrit seulement son
// avis (réglage cut_agent), que le menu Arborescence affiche.
//
// L'IA est gratuite et tourne sur le VPS lui-même (Ollama, modèle gemma3:4b, licence Gemma ; installée par
// onirique-superviseur) : rien ne part à un service extérieur. Elle ne tourne que quand un fondateur demande son avis, et
// Ollama est bridé pour laisser la place au site (3 cœurs sur 8, priorité la plus basse, 6 Go au plus, modèle déchargé
// dès la réponse). Côté site : une seule passe à la fois, en arrière-plan ; toute panne (IA pas installée, trop lente,
// réponse illisible) devient un état gardé avec le dernier avis, jamais une erreur levée.
import { setting, setSetting, now } from './db.js';

const URL_ = (process.env.CUT_AGENT_URL || 'http://127.0.0.1:11434').replace(/\/+$/, '');
const MODEL = process.env.CUT_AGENT_MODEL || 'gemma3:4b';
const VERDICTS = ['pour', 'contre', 'prudence'], LEVELS = ['info', 'attention', 'grave'];

const SYSTEM = `Tu es le superviseur de l'« arborescence » d'ONIRIQUE CUT, l'outil qui monte des TikToks de rap (réplique de film, puis le
couplet calé sur le beat). L'arborescence est ce que CUT a appris pour faire un TikTok qui marche : des branches (le son, les clips,
le style, le texte, l'image, le film, la publication), des réglages (feuilles) et des leçons. Elle est nourrie par les TikToks
exportés (réglages, images réduites, mesures du passage, textes), par les corrections des fondateurs après AUTOMATIQUE (le bouton
qui monte un TikTok tout seul avec ces réglages) et par les leçons des fondateurs, parfois avec un TikTok d'exemple (sa description,
son auteur, ses vues et ses j'aime, sa couverture). Quand les TikToks penchent pour un autre réglage, une proposition attend la
décision d'un fondateur.

Ton rôle : dire aux fondateurs, en français simple et direct, ce qui est bien et ce qui ne l'est pas dans ce que l'arbre apprend.
- Pour chaque proposition : pour, contre ou prudence, et pourquoi en une ou deux phrases (nombre de TikToks, qui les a faits,
  cohérence avec la recette et les leçons, risque de boucle avec AUTOMATIQUE).
- Des alertes : données trop minces ou d'une seule source, réglage qui contredit une leçon, AUTOMATIQUE qui se recopie, texte
  risqué pour TikTok (violence, suicide, haine, contenu sexuel), images ratées (noires, floues, texte coupé).
- Un avis court par branche qui a quelque chose à dire.
- Des leçons concrètes que les fondateurs pourraient écrire, tirées de ce que tu vois (les TikToks d'exemple qui font beaucoup de
  vues comptent plus).
Base-toi seulement sur les données fournies, dis quand elles sont trop minces. Tutoie les fondateurs. Pas de remplissage.

Réponds UNIQUEMENT par un objet JSON :
{"resume": "3 phrases au plus",
 "propositions": [{"key": "clé de la feuille", "value": la valeur proposée telle quelle, "avis": "pour|contre|prudence", "pourquoi": "..."}],
 "alertes": [{"niveau": "info|attention|grave", "texte": "...", "feuille": "clé de feuille ou vide"}],
 "branches": {"id de branche": "avis"},
 "lecons": ["leçon proposée"],
 "images": "ce que montrent les images, en une ou deux phrases"}`;

const str = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u0009\u000b-\u001f]+/g, ' ').trim().slice(0, max) : '');

/** L'avis propre : seulement les champs attendus, bornés, et des clés qui existent dans l'arbre. */
export function cleanOpinion(raw, keys, branchIds) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    resume: str(r.resume, 900),
    propositions: (Array.isArray(r.propositions) ? r.propositions : []).filter((p) => p && keys.has(p.key) && VERDICTS.includes(p.avis)).slice(0, 60)
      .map((p) => ({ key: p.key, value: ['string', 'number', 'boolean'].includes(typeof p.value) ? String(p.value).slice(0, 80) : null, avis: p.avis, pourquoi: str(p.pourquoi, 500) })),
    alertes: (Array.isArray(r.alertes) ? r.alertes : []).filter((a) => a && str(a.texte, 1)).slice(0, 20)
      .map((a) => ({ niveau: LEVELS.includes(a.niveau) ? a.niveau : 'info', texte: str(a.texte, 500), feuille: keys.has(a.feuille) ? a.feuille : '' })),
    branches: Object.fromEntries(Object.entries(r.branches && typeof r.branches === 'object' ? r.branches : {})
      .filter(([id, t]) => branchIds.has(id) && str(t, 1)).map(([id, t]) => [id, str(t, 600)])),
    lecons: (Array.isArray(r.lecons) ? r.lecons : []).map((t) => str(t, 400)).filter(Boolean).slice(0, 8),
    images: str(r.images, 500),
  };
}

/** La forme imposée à la réponse (sortie structurée d'Ollama) : un petit modèle s'écarte sinon du format, invente des clés. */
export const opinionSchema = (keys, branchIds) => ({ type: 'object', required: ['resume', 'propositions', 'alertes', 'branches', 'lecons', 'images'],
  properties: {
    resume: { type: 'string' },
    propositions: { type: 'array', items: { type: 'object', required: ['key', 'value', 'avis', 'pourquoi'],
      properties: { key: { type: 'string', enum: [...keys] }, value: { type: 'string' }, avis: { type: 'string', enum: VERDICTS }, pourquoi: { type: 'string' } } } },
    alertes: { type: 'array', items: { type: 'object', required: ['niveau', 'texte', 'feuille'],
      properties: { niveau: { type: 'string', enum: LEVELS }, texte: { type: 'string' }, feuille: { type: 'string', enum: [...keys, ''] } } } },
    branches: { type: 'object', properties: Object.fromEntries([...branchIds].map((id) => [id, { type: 'string' }])) },
    lecons: { type: 'array', items: { type: 'string' } },
    images: { type: 'string' },
  } });

export class NoAI extends Error {}
let aiChain = Promise.resolve();
/** Une question à l'IA du VPS (une à la fois : le superviseur et l'analyse des comptes TikTok attendent leur tour), avec des
 *  images (JPEG en base64) et la forme imposée de la réponse ; l'objet JSON répondu, ou une erreur claire. */
export function askLocal(system, text, images, format) {
  const job = aiChain.then(() => ask(system, text, images, format));
  aiChain = job.catch(() => {});
  return job;
}
async function ask(system, text, images, format) {
  let r;
  try {
    r = await fetch(`${URL_}/api/chat`, {
      method: 'POST',
      signal: AbortSignal.timeout(25 * 60_000), // sur 3 cœurs, une relecture prend quelques minutes
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, stream: false, format, keep_alive: 0,
        options: { num_ctx: 16384, num_thread: 3, temperature: 0.3 },
        messages: [{ role: 'system', content: system }, { role: 'user', content: text, images }] }),
    });
  } catch (error) {
    if (error.name === 'TimeoutError') throw new Error("l'IA a mis plus de 25 minutes");
    throw new NoAI("l'IA du serveur ne répond pas : elle n'est sans doute pas installée");
  }
  const data = await r.json().catch(() => null);
  if (r.status === 404) throw new NoAI(`le modèle ${MODEL} n'est pas encore téléchargé`);
  if (!r.ok) throw new Error(`l'IA répond ${r.status}${data?.error ? ' (' + String(data.error).slice(0, 160) + ')' : ''}`);
  const answer = String(data?.message?.content || '');
  const m = answer.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('réponse illisible');
  return JSON.parse(m[0]);
}

export const agentState = () => setting('cut_agent', null) || { status: 'jamais' };
let running = null;
export const agentRunning = () => Boolean(running);

/** Une passe du superviseur (une seule à la fois). state() : ce que voit le menu Arborescence. */
export function runAgent(state) {
  if (running) return running;
  const before = agentState();
  running = (async () => {
    try {
      const s = state();
      const keys = new Set(s.branches.flatMap((b) => b.leaves.map((l) => l.key))), branchIds = new Set(s.branches.map((b) => b.id));
      // Peu d'images : chacune coûte du temps de calcul sur le processeur (2 couvertures de TikToks d'exemple, 1 montage).
      const covers = s.lessons.filter((x) => x.thumbs && x.thumbs.length).slice(0, 2).map((x) => x.thumbs[0]);
      const shots = s.gallery.filter((g) => g.thumbs.length).slice(0, 1).flatMap((g) => g.thumbs);
      // Seulement les réglages qui ont quelque chose à dire : changés, nourris, proposés ou visés par une leçon.
      const proposed = new Set(s.proposals.map((p) => p.key)), taught = new Set(s.lessons.map((x) => x.leaf));
      const telling = (l) => l.source || l.stats || proposed.has(l.key) || taught.has(l.key);
      const images = [...covers, ...shots].map((t) => t.replace(/^data:image\/jpeg;base64,/, ''));
      const view = {
        recette: s.source,
        branches: s.branches.map((b) => ({ id: b.id, nom: b.label, lecons_de_depart: b.lessons, reglages: b.leaves.filter(telling).map((l) => ({ key: l.key, nom: l.label,
          valeur: l.value, recette: l.base, change: l.source ? { par: l.source.by, comment: l.source.from, pourquoi: l.source.why } : null, choix_des_tiktoks: l.stats })),
          autres_reglages_de_la_recette: b.leaves.filter((l) => !telling(l)).map((l) => l.key) })),
        propositions: s.proposals,
        lecons_des_fondateurs: s.lessons.slice(0, 20).map((x) => ({ feuille: x.leaf, texte: x.text, reglage: x.settings, tiktok_exemple: x.tiktok || null })),
        compteurs: s.counts, cette_semaine: s.week, tiktoks_des_fondateurs: s.founders,
        journal: s.journal.slice(0, 15).map((r) => ({ quoi: r.kind, fondateur: r.founder, reglages: r.settings, corrige: r.changed, lecon: r.note })),
        contenu_appris: s.content,
        comptes_tiktok_analyses: s.accounts,
        derniers_montages: s.gallery.slice(0, 4).map((g) => ({ quoi: g.kind, fondateur: g.founder, texte: g.content.text, son: g.content.sound && { ...g.content.sound, envelope: undefined }, image: g.content.image })),
        avis_precedent: before.status === 'ok' ? { resume: before.resume, alertes: before.alertes } : null,
      };
      const text = `Voici l'état de l'arborescence${images.length ? `. Images jointes, dans l'ordre : ${covers.length} couverture(s) de TikToks d'exemple, puis ${shots.length} image(s) des derniers montages (réplique, drop, suite)` : ''} :\n\n${JSON.stringify(view)}`;
      const json = await askLocal(SYSTEM, text, images, opinionSchema(keys, branchIds));
      setSetting('cut_agent', { status: 'ok', at: now(), checkedAt: now(), model: MODEL, ...cleanOpinion(json, keys, branchIds) });
    } catch (error) {
      console.error('Superviseur de CUT :', error.message);
      setSetting('cut_agent', { ...before, status: error instanceof NoAI ? 'sans-ia' : 'erreur', error: String(error.message).slice(0, 300), checkedAt: now() });
    } finally {
      running = null;
    }
  })();
  return running;
}
