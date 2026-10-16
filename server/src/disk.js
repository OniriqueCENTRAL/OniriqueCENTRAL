// L'espace du disque qui porte les données (base, plugins, médias, vidéos) : la jauge du panel admin, et la date
// à laquelle il sera plein au rythme où il se remplit.
import fs from 'node:fs';
import { config } from './config.js';
import { setting, setSetting } from './db.js';

const DAY = 86_400_000;

/** Date estimée où le disque sera plein, d'après les relevés [{ at, used }] : la pente entre le plus ancien et
    le plus récent. null tant qu'il n'y a pas une semaine de recul, ou si le disque ne se remplit pas. */
export function diskForecast(samples, freeBytes, nowMs) {
  if (samples.length < 2) return null;
  const first = samples[0], last = samples[samples.length - 1];
  const span = last.at - first.at;
  if (span < 7 * DAY) return null;
  const perDay = (last.used - first.used) / (span / DAY);
  if (perDay <= 0) return null;
  return { perDayBytes: Math.round(perDay), fullAt: Math.round(nowMs + (freeBytes / perDay) * DAY) };
}

/** Espace du disque, et un relevé par jour gardé 60 jours (pour l'estimation). null si le système ne le dit pas. */
export function diskSpace(nowMs = Date.now()) {
  let stats;
  try {
    stats = fs.statfsSync(config.dataDir);
  } catch {
    return null;
  }
  const totalBytes = stats.blocks * stats.bsize;
  const freeBytes = stats.bavail * stats.bsize;   // ce qui reste vraiment utilisable (sans la réserve de root)
  const usedBytes = totalBytes - stats.bfree * stats.bsize;

  const samples = setting('diskSamples', []);
  if (!samples.length || nowMs - samples[samples.length - 1].at >= DAY) {
    samples.push({ at: nowMs, used: usedBytes });
    setSetting('diskSamples', samples.filter((s) => nowMs - s.at <= 60 * DAY));
  }
  return { totalBytes, freeBytes, usedBytes, forecast: diskForecast(samples, freeBytes, nowMs) };
}
