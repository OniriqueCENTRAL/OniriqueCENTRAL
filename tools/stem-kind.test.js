// node tools/stem-kind.test.js — le classement des pistes, sur des sons fabriqués, et le .zip relu octet par octet.
const S = require("../site/assets/stem-kind.js");

const RATE = 22050, SECONDS = 8;
let failures = 0;
const check = (ok, what) => { console.log((ok ? "  ok    " : "  FAIL  ") + what); if (!ok) failures++; };

let seed = 12345;
const noise = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2147483648 - 1; };

/** Un son répété tous les `every` secondes ; voice(t) rend l'échantillon t secondes après l'attaque. */
function pattern(every, voice) {
  const out = new Float32Array(RATE * SECONDS);
  for (let start = 0; start < SECONDS; start += every) {
    for (let i = 0, at = Math.round(start * RATE); at + i < out.length && i < every * RATE; i++) out[at + i] += voice(i / RATE);
  }
  return out;
}
const highpassed = () => { let last = 0; return () => { const x = noise(), y = x - last; last = x; return y * 0.5; }; };

const hp = highpassed();
const sounds = {
  Kick: pattern(0.5, (t) => Math.sin(2 * Math.PI * (45 + 80 * Math.exp(-t * 30)) * t) * Math.exp(-t * 18)),
  "Hi-Hat": pattern(0.25, (t) => hp() * Math.exp(-t * 60)),
  Snare: pattern(1, (t) => (noise() * 0.6 + Math.sin(2 * Math.PI * 190 * t) * 0.4) * Math.exp(-t * 22)),
  808: pattern(2, (t) => Math.sin(2 * Math.PI * 48 * t) * Math.exp(-t * 1.6) * Math.min(1, t * 400)),
  Bass: pattern(8, (t) => Math.sin(2 * Math.PI * 62 * t) * 0.6 + Math.sin(2 * Math.PI * 124 * t) * 0.2),
  Melodie: pattern(2, (t) => [262, 330, 392, 523].reduce((sum, hz) => sum + Math.sin(2 * Math.PI * hz * t) + 0.3 * Math.sin(4 * Math.PI * hz * t), 0) * 0.15 * Math.min(1, t * 20)),
};
// Une batterie entière : le kick, la snare et le hi-hat ensemble.
sounds.Drums = sounds.Kick.map((v, i) => v * 0.8 + sounds.Snare[i] * 0.6 + sounds["Hi-Hat"][i] * 0.5);

console.log("Par le son, quand le nom ne dit rien");
for (const [kind, samples] of Object.entries(sounds)) {
  const f = S.features(samples, RATE), found = S.classify("Audio 07.wav", f);
  check(found.kind === kind && found.from === "son",
    `${kind} → ${found.kind}  (grave ${(f.sub + f.low).toFixed(2)}, aigu ${f.high.toFixed(2)}, centre ${Math.round(f.centroid)} Hz, attaques ${f.onsets.toFixed(1)}/s, retombée ${f.decay.toFixed(2)} s, bruit ${f.flatness.toFixed(2)})`);
}
check(S.classify("Audio 01.wav", S.features(new Float32Array(RATE * 2), RATE)).kind === "Autre", "une piste vide est « Autre »");

console.log("\nPar le nom");
const named = {
  "Kick.wav": "Kick", "BD_01.wav": "Kick", "808 kick.wav": "808", "MySong_808.wav": "808", "Snare top.wav": "Snare", "CLAP.wav": "Clap",
  "HiHat closed.wav": "Hi-Hat", "hh.wav": "Hi-Hat", "Open Hat.wav": "Hi-Hat", "Crash.wav": "Cymbale", "Perc loop.wav": "Perc",
  "Drums bus.wav": "Drums", "Sub Bass.wav": "Bass", "Basse.wav": "Bass", "Piano.wav": "Piano", "Gtr DI.wav": "Guitare", "Pad chaud.wav": "Synth",
  "Lead Vox.wav": "Voix", "Voix lead.wav": "Voix", "Adlibs.wav": "Backs", "Backs L.wav": "Backs", "Riser FX.wav": "FX", "Melody 2.wav": "Melodie",
  "Chat noir.wav": null, "Audio 07.wav": null, "Piste 3.wav": null, "what.wav": null,
};
for (const [name, kind] of Object.entries(named)) check(S.fromName(name) === kind, `${name} → ${S.fromName(name) || "rien, le son décide"}`);
check(S.classify("Kick.wav", S.features(sounds["Hi-Hat"], RATE)).kind === "Kick", "le nom passe avant le son");

console.log("\nLes noms du pack");
{
  const stems = ["Audio 3.wav", "hat 2.WAV", "Lead Vox.mp3", "kick.wav", "hat 1.wav", "808.wav"].map((name) => ({ name, kind: S.classify(name, sounds.Melodie && S.features(sounds.Melodie, RATE)).kind }));
  const list = S.names(stems, { bpm: "140", key: "F minor", tagFiles: true }).map((n) => n.name);
  console.log("        " + list.join("  |  "));
  check(JSON.stringify(list) === JSON.stringify(["01 Kick - 140 BPM - F minor.wav", "02 Hi-Hat 1 - 140 BPM - F minor.wav", "03 Hi-Hat 2 - 140 BPM - F minor.wav",
    "04 808 - 140 BPM - F minor.wav", "05 Melodie - 140 BPM - F minor.wav", "06 Voix - 140 BPM - F minor.mp3"]), "triés par type, numérotés, le tempo et la tonalité dans chaque nom");
  check(S.names(stems, { bpm: "140", key: "F minor", tagFiles: false })[0].name === "01 Kick.wav", "ou sans, si on ne les veut que sur le pack");
  check(S.safe('Mon/pack: "v2"?') === "Mon pack v2", "un nom de pack ne garde aucun caractère interdit");
  check(S.tag({ bpm: "93,5", key: "" }) === "93,5 BPM", "le pack ne porte que ce qu'on connaît");
}

console.log("\nLe .zip");
(async () => {
  check(S.crc32(new TextEncoder().encode("123456789")) === 0xCBF43926, "la somme de contrôle est celle de la norme");
  const files = [{ name: "Pack/01 Kick.wav", file: new Blob([new Uint8Array([1, 2, 3, 4, 5])]) }, { name: "Pack/02 Mélodie.wav", file: new Blob([new Uint8Array(70000).fill(7)]) }];
  const bytes = new Uint8Array(await (await S.zip(files)).arrayBuffer()), view = new DataView(bytes.buffer);
  const end = bytes.length - 22;
  check(view.getUint32(end, true) === 0x06054b50 && view.getUint16(end + 10, true) === 2, "il se termine par son sommaire, qui annonce deux fichiers");
  let at = view.getUint32(end + 16, true), ok = true;
  const found = [];
  for (let i = 0; i < 2; i++) {
    ok = ok && view.getUint32(at, true) === 0x02014b50;
    const length = view.getUint16(at + 28, true), size = view.getUint32(at + 24, true), local = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + length));
    const data = bytes.subarray(local + 30 + length, local + 30 + length + size);
    ok = ok && view.getUint32(local, true) === 0x04034b50 && S.crc32(data) === view.getUint32(at + 16, true);
    found.push(name + ":" + size);
    at += 46 + length;
  }
  check(ok && found.join(",") === "Pack/01 Kick.wav:5,Pack/02 Mélodie.wav:70000", "chaque fichier s'y retrouve, à sa place, avec son nom et son contenu");
  console.log(failures ? `\n${failures} échec(s)` : "\ntout est bon");
  process.exit(failures ? 1 : 0);
})();
