// Règles des votes /mute et /ban (votes.js), sans discord.js pour être testées partout.
import { readFileSync, writeFileSync, renameSync } from 'node:fs';

export const VOTE_TIME = 60_000;
export const MIN_VOTES = Math.max(1, Number(process.env.VOTE_MIN) || 3);
export const MAX = 28 * 86_400_000; // limite de Discord pour une exclusion temporaire
export const MUTES = process.env.MUTES_STATE || '/var/lib/onirique-discord-bot/mutes.json';
export const UNITS = { s: 1000, m: 60_000, min: 60_000, h: 3_600_000, j: 86_400_000, d: 86_400_000 };

export const VOTE_COMMANDS = [
  ['mute', 'Propose un vote de 60 s pour rendre muet un membre en vocal un moment'],
  ['ban', 'Propose un vote de 60 s pour exclure temporairement un membre (plus d’écrit ni de vocal)'],
].map(([name, description]) => ({
  name, description,
  options: [
    { name: 'membre', description: 'La personne visée', type: 6, required: true },
    { name: 'durée', description: 'Par exemple 10m, 2h ou 1j', type: 3, required: true },
  ],
}));

// « 10m », « 2h », « 1j30m », « 90 » (minutes) → millisecondes.
export function parseDuration(text) {
  const s = String(text).trim().toLowerCase().replace(/\s+/g, '');
  let ms = 0;
  if (/^\d+$/.test(s)) ms = Number(s) * 60_000;
  else {
    const parts = [...s.matchAll(/(\d+)(min|s|m|h|j|d)/g)];
    if (!parts.length || parts.map((p) => p[0]).join('') !== s) throw new Error('Durée illisible : écris par exemple 10m, 2h ou 1j.');
    for (const [, n, u] of parts) ms += Number(n) * UNITS[u];
  }
  if (ms < 60_000) throw new Error('La durée minimale est 1 minute.');
  if (ms > MAX) throw new Error(`La durée maximale est ${formatDuration(MAX)}.`);
  return ms;
}

export function formatDuration(ms) {
  const parts = [];
  for (const [label, size] of [['j', 86_400_000], ['h', 3_600_000], ['min', 60_000]]) {
    const n = Math.floor(ms / size);
    if (n) { parts.push(`${n} ${label}`); ms -= n * size; }
  }
  return parts.join(' ') || 'moins d’une minute';
}

// votes : Map id du votant → true (pour) / false (contre).
export function tally(votes, min = MIN_VOTES) {
  let yes = 0, no = 0;
  for (const v of votes.values()) v ? yes++ : no++;
  return { yes, no, passed: yes >= min && yes > no };
}

// Mutes vocaux votés : [{ guildId, userId, until }].
export function loadMutes(file = MUTES) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return []; }
}
export function saveMutes(list, file = MUTES) {
  try { writeFileSync(`${file}.tmp`, JSON.stringify(list)); renameSync(`${file}.tmp`, file); } catch (e) { console.error('Mutes :', e.message); }
}
export const same = (a, b) => a.guildId === b.guildId && a.userId === b.userId;
export const forget = (entry) => saveMutes(loadMutes().filter((m) => !(same(m, entry) && m.until === entry.until)));

