// ONIRIQUE SESSION dans ONIRIQUE CENTRAL : dépôt des pistes, reconnaissance (stem-kind.js), infos du morceau, choix du
// DAW, création. L'application (app/main/session/, par window.oniriqueSession) donne les fichiers déposés ou choisis,
// les dossiers clients et les templates, et écrit le projet. Même interface que l'application ONIRIQUE Session.
const $ = (id) => document.getElementById(id);
const A = OniriqueAudio, S = OniriqueStems;
const RATE = 22050, MIX_SECONDS = 240;
const EN = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const keyName = (k) => EN[k.tonic] + (k.mode === "major" ? " major" : " minor");
const DAWS = {
  fl: { name: "FL Studio", note: "Un .flp prêt à ouvrir : un clip et un insert par piste, chaque insert routé vers son bus, les bus vers le master." },
  protools: { name: "Pro Tools", note: "Pro Tools doit être ouvert : la session y est créée directement (pistes, bus, sorties). Template : un .ptxt du dossier « Session Templates »." },
  luna: { name: "LUNA", note: "LUNA se prépare pour l'instant dans l'application ONIRIQUE Session." },
};

let api = null, settings = {}, stems = [], mix = null, daw = "fl", template = null, analysing = 0;
const TOKEN = sessionStorage.getItem("onirique.token") || localStorage.getItem("onirique.token");
// Dans ONIRIQUE CENTRAL : la page se fond dans l'application (session.css, html.in-central).
if (window.oniriqueSession) document.documentElement.classList.add("in-central");

//----------------------------------------------------------------------------------------------------------------------
// Les pistes.
const groupOf = (kind) => Object.entries(settings.groups || {}).find(([, g]) => g.kinds.includes(kind))?.[0] || null;
const live = () => stems.filter((s) => !s.removed);

window.addFiles = async (list) => {
  $("error").textContent = "";
  $("done").hidden = true; // le projet créé ne contient pas ces pistes
  const known = new Map(stems.map((s) => [s.path, s]));
  // Une piste retirée puis déposée à nouveau revient, déjà écoutée.
  const back = list.map((f) => known.get(f.path)).filter((s) => s?.removed);
  for (const s of back) s.removed = false;
  const fresh = list.filter((f) => !known.has(f.path)).map((f) => ({ ...f, ...S.classify(f.name, null), features: null, track: null }));
  if (!fresh.length) { if (back.length) show(); return; }
  stems.push(...fresh);
  guessFromNames();
  show();
  analysing += fresh.length;
  // Deux pistes à la fois : chacune est décodée en entier par la page, la mémoire suit.
  const queue = [...fresh];
  const worker = async () => {
    for (let s; (s = queue.shift());) {
      // Un nom qui dit le type suffit : la piste n'est écoutée que pour le tempo et la tonalité, s'ils restent à trouver.
      // Les voix le sont toujours : leur rôle (lead, backs, adlibs) se lit en les comparant ; une « Melo » aussi, pour
      // savoir si c'est un piano, une guitare ou un synthé.
      const ear = s.from !== "nom" || ["Lead", "Backs", "Adlibs", "Melodie"].includes(s.kind);
      if (ear || !s.seconds || !($("i-bpm").value && $("i-key").value)) {
        status(`Écoute de « ${s.name} »… (${analysing} restantes)`);
        await listen(s, ear).catch((e) => { s.unread = e.message || String(e); }); // reconnue au nom seulement
      }
      analysing--;
      show();
    }
  };
  await Promise.all(Array.from({ length: Math.min(2, fresh.length) }, worker));
  S.refine(live());
  status("");
  show();
  if (!$("i-bpm").value || !$("i-key").value) measureTempo();
};

/** Décode la piste, la reconnaît (le nom d'abord, le son sinon) et l'ajoute au mélange qui donne tempo et tonalité. */
async function listen(s, ear = true) {
  // Le fichier lu par l'application (un AIFF arrive en WAV), décodé ici, puis rendu en mono à 22 050 Hz. La durée, la
  // fréquence et les voies d'origine viennent de l'en-tête lu par l'application ; à défaut (MP3, M4A), du décodage.
  const bytes = await api.read(s.id);
  const audio = await A.decode(new File([bytes], s.name.replace(/\.(aif|aiff|aifc)$/i, ".wav")));
  s.seconds ??= audio.duration;
  s.rate ??= audio.sampleRate;
  s.channels ??= audio.numberOfChannels;
  const mono = (await A.render(audio, { rate: RATE, channels: 1 })).getChannelData(0);
  if (ear) {
    s.features = S.features(mono, RATE);
    if (s.from !== "toi") Object.assign(s, S.classify(s.name, s.features));
  }
  mix ??= new Float32Array(MIX_SECONDS * RATE);
  for (let i = 0, n = Math.min(mono.length, mix.length); i < n; i++) mix[i] += mono[i];
}

function measureTempo() {
  if (!mix) return;
  const worker = new Worker("assets/bpm-key-worker.js?v=3");
  worker.onmessage = ({ data }) => {
    worker.terminate();
    const bpm = data.tempo && data.tempo.bpm; // le worker rend { bpm, strength }
    if (Number.isFinite(bpm) && bpm > 0 && !$("i-bpm").value) $("i-bpm").value = String(Math.round(bpm * 10) / 10).replace(/\.0$/, "");
    if (data.key && !$("i-key").value) $("i-key").value = keyName(data.key);
    $("found").textContent = data.tempo ? "Mesurés sur toutes les pistes jouées ensemble : corrige-les si besoin." : "";
    readout();
    target();
  };
  worker.postMessage({ samples: mix.slice(), sampleRate: RATE }); // une copie : le mélange reste pour des pistes ajoutées
}

/** Ce que les noms disent déjà : « 130BPM », « Bb min », un préfixe commun (« Mirage_Kick », « Mirage_Snare »). */
function guessFromNames() {
  const names = stems.map((s) => s.name.replace(/\.[^.]+$/, "")).join(" | ");
  const bpm = names.match(/(\d{2,3}(?:[.,]\d)?)\s?bpm/i);
  if (bpm && !$("i-bpm").value) $("i-bpm").value = bpm[1].replace(",", ".");
  const key = names.match(/(^|[^a-z0-9])([a-g])\s?(#|b)?\s?(maj(?:or)?|min(?:or)?|m)(?![a-z])/i);
  if (key && !$("i-key").value) {
    const tonic = NOTES[(key[2] + (key[3] || "")).toLowerCase()];
    $("i-key").value = keyName({ tonic, mode: /^maj/i.test(key[4]) ? "major" : "minor" });
  }
}
// Sans « (?<! » : le Safari des Mac d'avant 2023 refuse tout le fichier qui en contient. La lettre ou le chiffre qui
// précède la tonalité est pris avec elle, puis retiré.
const tags = (n) => [...n.matchAll(/@[\w.]+|\d{2,3}(?:[.,]\d)?\s?bpm|(?:^|[^a-z0-9])[a-g]\s?(?:#|b)?\s?(?:maj(?:or)?|min(?:or)?|m)(?![a-z])/gi)]
  .map((m) => m[0].replace(/^[^a-z0-9@]/i, ""));
const NOTES = { c: 0, "c#": 1, db: 1, d: 2, "d#": 3, eb: 3, e: 4, f: 5, "f#": 6, gb: 6, g: 7, "g#": 8, ab: 8, a: 9, "a#": 10, bb: 10, b: 11 };

//----------------------------------------------------------------------------------------------------------------------
// Les étapes : une à la fois, comme dans CUT ; les suivantes s'ouvrent quand il y a des pistes.
const STEPS = ["pistes", "morceau", "template", "projet"];
let step = "pistes";

function showStep(name) {
  step = name;
  const at = STEPS.indexOf(name);
  document.querySelectorAll("[data-panel]").forEach((p) => (p.hidden = p.dataset.panel !== name));
  document.querySelectorAll("[data-step]").forEach((b) => {
    b.setAttribute("aria-selected", String(b.dataset.step === name));
    b.toggleAttribute("data-done", STEPS.indexOf(b.dataset.step) < at);
  });
  playhead();
  scrollTo({ top: 0 });
}

/** La tête de lecture se pose au début de l'étape en cours. */
function playhead() {
  const b = document.querySelector(`[data-step="${step}"]`);
  $("playhead").style.left = b.offsetLeft - 1 + "px";
}

// Le texte d'un clip, lisible sur sa couleur : sombre sur une couleur claire, clair sur une foncée.
const ink = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#160709" : "#FFF4F5";
};

function readout() {
  const bpm = $("i-bpm").value.trim(), key = $("i-key").value;
  $("readout").innerHTML = "";
  $("readout").append(bpm ? bpm + " BPM" : "tempo…", Object.assign(document.createElement("i"), { textContent: "·" }), key || "tonalité…");
}

// Les pistes.
function show() {
  const list = live();
  $("drop").hidden = !!stems.length;
  $("add").hidden = $("table").hidden = !stems.length;
  document.querySelectorAll("[data-needs-stems]").forEach((e) => (e.hidden = !list.length));
  document.querySelectorAll("[data-step]").forEach((b) => (b.disabled = b.dataset.step !== "pistes" && !list.length));
  const plan = S.names(list.map((s) => ({ name: s.name, kind: s.kind, s })), { tagFiles: false });
  for (const { stem, name } of plan) {
    stem.s.file = name;
    // Le type, suivi de ce que le nom d'origine avait d'utile : « REC 2_2 - @prodhilen 130BPM Bb min » → « Instru - @prodhilen 130BPM Bb min ».
    const kept = tags(stem.s.name.replace(/\.[^.]+$/, ""));
    stem.s.auto = name.replace(/^\d+\s+/, "").replace(/\.[^.]+$/, "") + (kept.length ? " - " + kept.join(" ") : "");
  }
  $("count").textContent = list.length + " piste" + (list.length > 1 ? "s" : "");
  $("state").textContent = analysing ? `écoute en cours (${analysing})` : sameLength(list);
  const longest = Math.max(1, ...list.map((s) => s.seconds || 0));
  $("rows").replaceChildren(...plan.map(({ stem: { s } }) => row(s, longest)));
  readout();
  target();
}

function sameLength(list) {
  const lengths = new Set(list.filter((s) => s.seconds).map((s) => Math.round(s.seconds * 10)));
  return lengths.size > 1 ? "durées différentes : vérifie qu'elles partent toutes du même point" : "";
}

/** Une ligne par stem, comme une piste du DAW : sa couleur, son type, son nom, son clip (à la longueur de sa durée), son bus. */
function row(s, longest) {
  const el = (tag, props = {}) => Object.assign(document.createElement(tag), props);
  const lane = el("div", { className: "lane" });
  const kindColor = settings.kindColors[s.kind] || "#A9A9A9"; // la couleur de sa piste dans le DAW
  const swatch = el("span", { className: "swatch" });
  swatch.style.background = kindColor;
  swatch.style.boxShadow = `0 0 12px ${kindColor}`;

  const type = el("select");
  type.setAttribute("aria-label", "Type de « " + s.name + " »");
  type.append(...S.KINDS.map((kind) => el("option", { textContent: kind, selected: kind === s.kind })));
  type.onchange = () => { s.kind = type.value; s.from = "toi"; show(); };
  const warn = !!(s.twin || s.unread);
  const typeCell = el("div");
  typeCell.append(type, el("span", { className: "from" + (warn ? " warn" : ""), textContent: s.twin ? "doublon de « " + s.twin + " »" : s.kind === "Melodie" && s.features ? "instrument à préciser" : s.from === "nom" ? "au nom" : s.from === "toi" ? "choisi" : s.features ? "au son" : s.unread ? "illisible" : "écoute…",
    title: s.unread || (s.twin ? "La même prise, exportée deux fois : retire celle qui ne sert pas avec ×." : "") }));

  const track = el("input", { value: s.track ?? s.auto, ariaLabel: "Nom de la piste" });
  track.onchange = () => { s.track = track.value.trim() || null; if (!track.value.trim()) { s.removed = true; show(); } };

  const clip = el("div", { className: "clip", textContent: s.file.replace(/\.[^.]+$/, ""), title: s.file });
  clip.style.width = (s.seconds ? Math.max(30, (s.seconds / longest) * 100) : 100) + "%";
  clip.style.background = `linear-gradient(90deg, ${kindColor}, ${kindColor}73)`; // 73 : 45 % d'opacité (pas de color-mix, inconnu du Safari des anciens Mac)
  clip.style.color = ink(kindColor);
  const track$ = el("div", { className: "clip-track" });
  track$.append(clip);
  const meta = el("div", { className: "clip-meta" });
  meta.append(el("span", { textContent: s.name, title: s.path }), el("span", { textContent: s.seconds ? A.clock(s.seconds) : "—" }));
  const clipCell = el("div");
  clipCell.append(track$, meta);

  const group = groupOf(s.kind);
  const bus = el("span", { className: "bus", textContent: group || "master" });
  bus.style.background = group ? settings.groups[group].color : "#8C8C8C";
  const fmt = el("span", { className: "fmt", textContent: s.rate ? `${String(s.rate / 1000).replace(".", ",")} kHz · ${s.channels === 1 ? "mono" : "stéréo"}` : "—" });
  const remove = el("button", { type: "button", className: "remove", textContent: "×", title: "Retirer cette piste (la redéposer la remet)", ariaLabel: "Retirer « " + s.name + " »" });
  remove.onclick = () => { s.removed = true; show(); };
  lane.append(swatch, typeCell, track, clipCell, bus, fmt, remove);
  return lane;
}

//----------------------------------------------------------------------------------------------------------------------
// Le projet.
const FIELDS = ["artist", "title", "feat", "producer", "engineer", "label", "genre", "bpm", "key", "comments"];
const info = () => Object.fromEntries(FIELDS.map((k) => [k, $("i-" + k).value.trim()]));

/** Le morceau suivant : pistes et infos vidées ; DAW, template et dossier des clients restent. */
function reset() {
  stems = [];
  mix = null;
  picked = null;
  for (const k of FIELDS) $("i-" + k).value = "";
  $("found").textContent = $("error").textContent = "";
  $("done").hidden = true;
  show();
  showClients();
  showStep("pistes");
}

function projectName() {
  const i = info(), artist = [S.safe(i.artist), S.safe(i.feat)].filter(Boolean).join(" x ");
  return [artist, S.safe(i.title)].filter(Boolean).join(" - ") || "Session";
}

// Les clients : un bouton par sous-dossier du dossier choisi, de A à Z. L'artiste tapé choisit le sien, ou propose de
// le créer.
let clients = [], client = "", picked = null; // picked : le bouton cliqué, qui prime tant que l'artiste ne change pas
async function loadClients() {
  clients = (await api.subfolders()).sort((a, b) => a.localeCompare(b, "fr", { sensitivity: "base" }));
  showClients();
}

function showClients() {
  const artist = S.safe($("i-artist").value);
  const match = clients.find((c) => c.toLowerCase() === artist.toLowerCase());
  const options = [["", "Aucun"], ...clients.map((c) => [c, c])];
  if (artist && !match) options.push([artist, "+ Nouveau : " + artist]);
  // Un artiste sans dossier : un nouveau client, jamais le dernier cliqué (le projet partirait chez quelqu'un d'autre).
  client = picked ?? match ?? (artist || (clients.includes(settings.client) ? settings.client : ""));
  $("client").replaceChildren(...options.map(([value, text]) => {
    const b = Object.assign(document.createElement("button"), { type: "button", className: "pill", textContent: text });
    b.setAttribute("aria-pressed", String(value === client));
    b.onclick = () => { picked = settings.client = value; api.saveSettings({ client: value }); showClients(); };
    return b;
  }));
  target();
}

/** Ce qui sera créé, et le récapitulatif de l'étape Projet. */
function target() {
  $("target").textContent = "Sera créé : " + (client ? client + " › " : "") + projectName() + (daw === "fl" ? ".flp" : daw === "luna" ? ".aaf" : " (session Pro Tools)") + " dans son dossier, avec Audio/ et Infos.txt";
  const i = info();
  const rows = [["DAW", DAWS[daw].name], ["Template", template ? template.split(/[\\/]/).pop().replace(/\.[^.]+$/, "") : "aucune"],
    ["Client", client || "aucun"], ["Pistes", String(live().length)], ["Tempo", i.bpm ? i.bpm + " BPM" : "—"], ["Tonalité", i.key || "—"]];
  $("recap").replaceChildren(...rows.flatMap(([k, v]) => [Object.assign(document.createElement("dt"), { textContent: k }), Object.assign(document.createElement("dd"), { textContent: v })]));
}

function setDaw(next) {
  daw = next;
  document.querySelectorAll("[data-daw]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.daw === daw)));
  $("daw-note").textContent = DAWS[daw].note;
  template = (settings.templates || {})[daw] || null;
  $("template-pick").hidden = daw === "luna";
  loadTemplates();
  api?.saveSettings({ daw });
  target();
}

// Les templates : comme les clients, un bouton par template trouvée là où le DAW choisi range les siennes (les tiennes,
// groupées par dossier ; celles livrées avec le DAW repliées dessous). « Autre fichier… » pour une template ailleurs.
let templates = [];
async function loadTemplates() {
  const asked = daw;
  const found = daw === "luna" ? [] : await api.templates(daw);
  if (asked !== daw) return; // un autre DAW a été choisi pendant la recherche
  templates = found;
  showTemplate();
}

function templateButtons(list, withNone) {
  const nodes = [];
  if (withNone) nodes.push(templateButton(null, "Aucune"));
  let group = null;
  for (const t of list) {
    if (t.group !== group && (group = t.group)) nodes.push(Object.assign(document.createElement("p"), { className: "group", textContent: t.group }));
    nodes.push(templateButton(t.path, t.name));
  }
  return nodes;
}

function templateButton(path, text) {
  const b = Object.assign(document.createElement("button"), { type: "button", className: "pill", textContent: text, title: path || "" });
  b.setAttribute("aria-pressed", String(path === template));
  b.onclick = () => chooseTemplate(path);
  return b;
}

function chooseTemplate(path) {
  template = path;
  settings.templates = { ...(settings.templates || {}), [daw]: path };
  api.saveSettings({ templates: settings.templates });
  showTemplate();
  target();
}

async function showTemplate() {
  const mine = templates.filter((t) => !t.factory), factory = templates.filter((t) => t.factory);
  // Une template choisie ailleurs (« Autre fichier… ») garde son bouton, allumé.
  const other = template && !templates.some((t) => t.path === template)
    ? [{ path: template, name: template.split(/[\\/]/).pop().replace(/\.[^.]+$/, ""), group: "Autre fichier" }] : [];
  $("templates").hidden = daw === "luna";
  $("templates").replaceChildren(...templateButtons([...mine, ...other], true));
  $("factory").hidden = !factory.length;
  $("factory-title").textContent = `Livrées avec ${DAWS[daw].name} (${factory.length})`;
  $("factory-list").replaceChildren(...templateButtons(factory, false));
  if (factory.some((t) => t.path === template)) $("factory").open = true;
  $("template").textContent = template || (daw === "luna" ? "Ta template LUNA s'applique dans LUNA (Import Session Data)" : "Aucune : bus et routing créés par l'app");
  $("template-note").textContent = daw !== "luna" && !templates.length
    ? `Aucune template trouvée dans le dossier de ${DAWS[daw].name} : « Autre fichier… » pour en prendre une ailleurs.` : "";
  if (!template || daw !== "fl") return;
  const d = await api.describe(template);
  $("template-note").textContent = d.error ? d.error : d.slots.length
    ? "Pistes et bus nommés trouvés : " + d.slots.map((x) => x.name).join(", ") + ". Les stems s'y rangent par leur nom, le reste est ajouté et routé."
    : "Cette template n'a aucun insert nommé : tout sera ajouté.";
}

async function create() {
  const list = live();
  if (!list.length) return;
  if (analysing) { status("Attends la fin de l'écoute des pistes."); return; }
  $("create").disabled = true;
  $("done").hidden = true;
  status(daw === "protools" ? "Création de la session dans Pro Tools…" : "Création du projet…");
  const result = await api.create({
    daw, template, folder: settings.folder, client, info: info(), words: S.WORDS,
    stems: list.map((s) => ({ id: s.id, kind: s.kind, file: s.file, track: s.track ?? s.auto, seconds: s.seconds || 0, rate: s.rate || 0 })),
  });
  $("create").disabled = false;
  status("");
  // L'erreur sous le bouton : celle du haut de page est hors de vue quand on vient de cliquer « Créer ».
  if (result.error) { $("error").textContent = result.error; status(result.error, true); return; }
  $("done-text").textContent = `${DAWS[daw].name} : « ${result.project.split(/[\\/]/).pop()} » est prêt, avec ${list.length} pistes.`;
  $("done").hidden = false;
  $("done").scrollIntoView({ behavior: "smooth", block: "nearest" }); // sous le bouton, souvent hors de la fenêtre
  $("open").onclick = () => api.open(result.project);
  $("show").onclick = () => api.reveal(result.project);
}

const status = (text, failed = false) => { $("status").textContent = text; $("status").classList.toggle("error", failed); };

//----------------------------------------------------------------------------------------------------------------------
// L'accès, comme ONIRIQUE CUT : dans l'application ONIRIQUE CENTRAL (qui écrit le projet sur l'ordinateur), avec un
// compte qui a ONIRIQUE CLOUD (membres ONIRIQUE et abonnés).
function lock(title, text, href, label) {
  $("locked-title").textContent = title;
  $("locked-text").textContent = text;
  $("locked-go").href = href;
  $("locked-go").textContent = label;
  $("locked-go").hidden = !href;
  $("locked").hidden = false;
  $("tabs").hidden = true;
  document.querySelectorAll("[data-panel]").forEach((p) => (p.hidden = true));
}
async function gate() {
  if (!window.oniriqueSession) {
    lock("ONIRIQUE SESSION s'ouvre dans l'application", "Elle crée le projet FL Studio ou Pro Tools directement sur ton ordinateur : ouvre-la depuis ONIRIQUE CENTRAL, rubrique SESSION.", "boutique", "Télécharger ONIRIQUE CENTRAL");
    return false;
  }
  if (!TOKEN) { lock("Connecte-toi pour ouvrir ONIRIQUE SESSION", "Elle est incluse pour les membres ONIRIQUE et avec l'abonnement CLOUD.", "", ""); return false; }
  const response = await fetch("/api/me", { headers: { Authorization: "Bearer " + TOKEN } }).catch(() => null);
  if (!response || response.status === 401) { lock("Connecte-toi pour ouvrir ONIRIQUE SESSION", "Ta session a expiré.", "", ""); return false; }
  const me = await response.json().catch(() => ({}));
  if (!(me.rights || []).includes("sounds")) {
    lock("ONIRIQUE SESSION est réservée aux membres", "Elle est incluse pour les membres ONIRIQUE et avec l'abonnement CLOUD et page de liens (1,99 € par mois ou 19,99 € par an).", "cloud", "Voir l'abonnement");
    return false;
  }
  return true;
}

(async () => {
  $("i-key").append(Object.assign(document.createElement("option"), { value: "", textContent: "mesure…" }),
    ...["minor", "major"].flatMap((mode) => EN.map((_, tonic) => Object.assign(document.createElement("option"), { textContent: keyName({ tonic, mode }) }))));
  if (!(await gate())) return;
  api = window.oniriqueSession;
  settings = await api.settings();
  $("folder").textContent = settings.folder;
  await loadClients();
  $("i-artist").addEventListener("input", () => { picked = null; showClients(); });
  document.querySelectorAll("[data-daw]").forEach((b) => (b.onclick = () => setDaw(b.dataset.daw)));
  setDaw((settings.daws || []).includes(settings.daw) ? settings.daw : "fl"); // LUNA reste dans l'app ONIRIQUE Session
  for (const k of ["artist", "title", "feat", "bpm"]) $("i-" + k).addEventListener("input", target);
  $("i-key").addEventListener("change", target);
  for (const k of ["bpm", "key"]) $("i-" + k).addEventListener("input", readout);
  $("drop").onclick = $("add").onclick = async () => window.addFiles(await api.pickFiles());
  document.querySelectorAll("[data-step]").forEach((b) => (b.onclick = () => showStep(b.dataset.step)));
  document.querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => showStep(b.dataset.go)));
  addEventListener("resize", playhead);
  document.fonts.ready.then(playhead); // la largeur des étapes change quand la police arrive
  show();
  showStep("pistes");
  $("template-pick").onclick = async () => {
    const path = await api.pickTemplate(daw);
    if (path) chooseTemplate(path);
  };
  $("folder-pick").onclick = async () => {
    const path = await api.pickFolder(); // l'application garde le dossier choisi
    if (!path) return;
    settings.folder = path;
    $("folder").textContent = path;
    await loadClients();
    target();
  };
  $("create").onclick = create;
  $("again").onclick = reset;
  // Le dépôt : l'application donne le chemin des fichiers (et dossiers) glissés n'importe où sur la page.
  let depth = 0;
  addEventListener("dragenter", (e) => { e.preventDefault(); depth++; document.body.classList.add("dragging"); });
  addEventListener("dragleave", () => { if (--depth <= 0) { depth = 0; document.body.classList.remove("dragging"); } });
  addEventListener("dragover", (e) => e.preventDefault());
  addEventListener("drop", async (e) => {
    e.preventDefault();
    depth = 0;
    document.body.classList.remove("dragging");
    showStep("pistes");
    const paths = api.paths(e.dataTransfer?.files);
    if (paths.length) window.addFiles(await api.register(paths));
  });
})();
