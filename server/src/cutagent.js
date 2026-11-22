// LE SUPERVISEUR DE L'ARBORESCENCE DE CUT : une IA (Claude, API d'Anthropic) relit ce que l'arbre a appris et donne son avis
// aux fondateurs : pour ou contre chaque proposition, des alertes, un avis par branche, des leçons à écrire. Il ne décide
// rien : il écrit seulement son avis (réglage cut_agent), que le menu Arborescence affiche.
//
// Il ne peut pas gêner le site : une seule passe à la fois, en arrière-plan, bornée à 3 minutes ; toute panne (pas de clé,
// réseau, refus, réponse illisible) devient un état gardé avec le dernier avis valable, jamais une erreur levée.
// Claude et pas Gemini : l'offre gratuite de Gemini peut servir à entraîner les modèles de Google, pas l'API d'Anthropic.
import { config } from './config.js';
import { setting, setSetting, now } from './db.js';

const MODEL = process.env.CUT_AGENT_MODEL || 'claude-opus-5-5';
const VERDICTS = ['pour', 'contre', 'prudence'], LEVELS = ['info', 'attention', 'grave'];

const SYSTEM = `Tu es le superviseur de l'« arborescence » d'ONIRIQUE CUT, l'outil qui monte des TikToks de rap (réplique de film, puis le
couplet calé sur le beat). L'arborescence est ce que CUT a appris pour faire un TikTok qui marche : des branches (le son, les clips,
le style, le texte, l'image, le film, la publication), des réglages (feuilles) et des leçons. Elle est nourrie par les TikToks
exportés (réglages, images réduites, mesures du passage, textes), par les corrections des fondateurs après AUTOMATIQUE (le bouton
qui monte un TikTok tout seul avec ces réglages) et par les leçons des fondateurs. Quand les TikToks penchent pour un autre réglage,
une proposition attend la décision d'un fondateur.

Ton rôle : dire aux fondateurs, en français simple et direct, ce qui est bien et ce qui ne l'est pas dans ce que l'arbre apprend.
- Pour chaque proposition : pour, contre ou prudence, et pourquoi en une ou deux phrases (nombre de TikToks, qui les a faits,
  cohérence avec la recette et les leçons, risque de boucle avec AUTOMATIQUE).
- Des alertes : données trop minces ou venant d'une seule source, réglage qui contredit une leçon sans raison, AUTOMATIQUE qui se
  recopie, texte risqué pour TikTok (violence, suicide, haine, contenu sexuel), images ratées (noires, floues, texte coupé),
  feuilles jamais nourries qui comptent.
- Un avis court par branche qui a quelque chose à dire.
- Des leçons concrètes que les fondateurs pourraient écrire, tirées de ce que tu vois.
Tu ne sais pas combien de vues ont fait les TikToks : ne l'invente pas. Base-toi sur les données fournies, dis quand elles sont
trop minces. Tutoie les fondateurs. Pas de remplissage.

Réponds UNIQUEMENT par un objet JSON, sans texte autour :
{"resume": "3 phrases au plus",
 "propositions": [{"key": "clé de la feuille", "value": la valeur proposée telle quelle, "avis": "pour|contre|prudence", "pourquoi": "..."}],
 "alertes": [{"niveau": "info|attention|grave", "texte": "...", "feuille": "clé de feuille ou vide"}],
 "branches": {"id de branche": "avis"},
 "lecons": ["leçon proposée"],
 "images": "ce que montrent les images, en une ou deux phrases (vide s'il n'y en a pas)"}`;

const str = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u0009\u000b-\u001f]+/g, ' ').trim().slice(0, max) : '');

/** L'avis propre : seulement les champs attendus, bornés, et des clés qui existent dans l'arbre. */
export function cleanOpinion(raw, keys, branchIds) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    resume: str(r.resume, 900),
    propositions: (Array.isArray(r.propositions) ? r.propositions : []).filter((p) => p && keys.has(p.key) && VERDICTS.includes(p.avis)).slice(0, 60)
      .map((p) => ({ key: p.key, value: ['string', 'number', 'boolean'].includes(typeof p.value) ? p.value : null, avis: p.avis, pourquoi: str(p.pourquoi, 500) })),
    alertes: (Array.isArray(r.alertes) ? r.alertes : []).filter((a) => a && str(a.texte, 1)).slice(0, 20)
      .map((a) => ({ niveau: LEVELS.includes(a.niveau) ? a.niveau : 'info', texte: str(a.texte, 500), feuille: keys.has(a.feuille) ? a.feuille : '' })),
    branches: Object.fromEntries(Object.entries(r.branches && typeof r.branches === 'object' ? r.branches : {})
      .filter(([id, t]) => branchIds.has(id) && str(t, 1)).map(([id, t]) => [id, str(t, 600)])),
    lecons: (Array.isArray(r.lecons) ? r.lecons : []).map((t) => str(t, 400)).filter(Boolean).slice(0, 8),
    images: str(r.images, 500),
  };
}

/** Une question à Claude, avec des images ; le texte de la réponse, ou une erreur claire. */
async function ask(text, images) {
  const r = await fetch(`${config.anthropicApi}/v1/messages`, {
    method: 'POST',
    signal: AbortSignal.timeout(180_000),
    headers: { 'content-type': 'application/json', 'x-api-key': config.anthropicApiKey, 'anthropic-version': '2026-10-21',
      'anthropic-beta': 'server-side-fallback-2026-07-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: 16000, output_config: { effort: 'medium' }, fallbacks: 'default', system: SYSTEM,
      messages: [{ role: 'user', content: [...images.map((data) => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } })), { type: 'text', text }] }] }),
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`l'API répond ${r.status}${data?.error?.message ? ' (' + String(data.error.message).slice(0, 160) + ')' : ''}`);
  if (data?.stop_reason === 'refusal') throw new Error("l'IA a refusé de répondre");
  const answer = (data?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  const m = answer.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('réponse illisible');
  return { json: JSON.parse(m[0]), model: data.model || MODEL, usage: data.usage || null };
}

export const agentState = () => setting('cut_agent', null) || { status: 'jamais' };
let running = null;
export const agentRunning = () => Boolean(running);

/** Une passe du superviseur (une seule à la fois). state() : ce que voit le menu Arborescence ; images : JPEG en base64. */
export function runAgent(state) {
  if (running) return running;
  const before = agentState();
  if (!config.anthropicApiKey) {
    setSetting('cut_agent', { ...before, status: 'sans-cle', checkedAt: now() });
    return Promise.resolve();
  }
  running = (async () => {
    try {
      const s = state();
      const keys = new Set(s.branches.flatMap((b) => b.leaves.map((l) => l.key))), branchIds = new Set(s.branches.map((b) => b.id));
      const images = s.gallery.filter((g) => g.thumbs.length).slice(0, 4).flatMap((g) => g.thumbs).map((t) => t.replace(/^data:image\/jpeg;base64,/, '')).slice(0, 12);
      const view = {
        recette: s.source,
        branches: s.branches.map((b) => ({ id: b.id, nom: b.label, lecons_de_depart: b.lessons, reglages: b.leaves.map((l) => ({ key: l.key, nom: l.label,
          valeur: l.value, recette: l.base, change: l.source ? { par: l.source.by, comment: l.source.from, pourquoi: l.source.why } : null, choix_des_tiktoks: l.stats })) })),
        propositions: s.proposals, lecons_des_fondateurs: s.lessons.map((x) => ({ feuille: x.leaf, texte: x.text, reglage: x.settings, lien: x.link })),
        compteurs: s.counts, cette_semaine: s.week, tiktoks_des_fondateurs: s.founders,
        journal: s.journal.slice(0, 60).map((r) => ({ quoi: r.kind, fondateur: r.founder, reglages: r.settings, corrige: r.changed, lecon: r.note })),
        contenu_appris: s.content,
        derniers_montages: s.gallery.slice(0, 12).map((g) => ({ quoi: g.kind, fondateur: g.founder, texte: g.content.text, son: g.content.sound && { ...g.content.sound, envelope: undefined }, image: g.content.image })),
        avis_precedent: before.status === 'ok' ? { resume: before.resume, alertes: before.alertes } : null,
      };
      const text = `Voici l'état de l'arborescence${images.length ? ` et les images réduites des ${Math.min(4, s.gallery.length)} derniers montages (3 par montage : réplique, drop, suite)` : ''} :\n\n${JSON.stringify(view)}`;
      const { json, model, usage } = await ask(text, images);
      setSetting('cut_agent', { status: 'ok', at: now(), checkedAt: now(), model, usage, seenUntil: s.journal[0]?.id || 0, ...cleanOpinion(json, keys, branchIds) });
    } catch (error) {
      console.error('Superviseur de CUT :', error.message);
      setSetting('cut_agent', { ...before, status: 'erreur', error: String(error.message).slice(0, 300), checkedAt: now() });
    } finally {
      running = null;
    }
  })();
  return running;
}
