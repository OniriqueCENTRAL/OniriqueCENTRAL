// Le mail d'un pack de prods : préparé par le beatmaker (destinataires, textes, couleurs, police, prods mises en avant)
// et rendu en HTML pour l'aperçu. Rien n'est envoyé d'ici.
import { config } from './config.js';
import { escapeHtml } from './mailtemplate.js';

const FONTS = {
  grotesk: "'Hanken Grotesk', 'Segoe UI', Helvetica, Arial, sans-serif",
  display: "'Unbounded', 'Arial Black', 'Segoe UI', Helvetica, Arial, sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  mono: "'JetBrains Mono', Consolas, 'Courier New', monospace",
};
export const MAIL_COLORS = { bg: '#0D0809', card: '#1A080A', accent: '#E23444', text: '#F6EEEE', muted: '#B39A9D', button: '#F6EEEE', buttonText: '#0D0809' };
const str = (value, max) => (typeof value === 'string' ? value.replace(/[^\S\n]+/g, ' ').trim().slice(0, max) : '');
const https = (value) => { const url = str(value, 500); return /^https?:\/\/[^\s"'<>]+$/i.test(url) ? url : ''; };
const absolute = (url) => (!url ? '' : /^https?:/i.test(url) ? url : config.siteUrl + url);

/** Un brouillon propre, quoi que le navigateur envoie. */
export function mailDraft(b = {}) {
  const colors = Object.fromEntries(Object.entries(MAIL_COLORS).map(([k, v]) => [k, /^#[0-9a-f]{6}$/i.test(b.colors?.[k]) ? b.colors[k] : v]));
  return {
    to: typeof b.to === 'string' ? b.to.slice(0, 150000) : '',
    from: str(b.from, 80), subject: str(b.subject, 140), preheader: str(b.preheader, 160), eyebrow: str(b.eyebrow, 40), title: str(b.title, 120),
    text: typeof b.text === 'string' ? b.text.replace(/\r\n?/g, '\n').slice(0, 8000) : '',
    image: https(b.image), buttonLabel: str(b.buttonLabel, 40), buttonUrl: https(b.buttonUrl), signature: str(b.signature, 200), footer: str(b.footer, 300),
    trackIds: Array.isArray(b.trackIds) ? [...new Set(b.trackIds.map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 50) : [],
    coverColors: b.coverColors !== false, font: FONTS[b.font] ? b.font : 'grotesk', titleFont: FONTS[b.titleFont] ? b.titleFont : 'display', colors,
  };
}

/** Les adresses d'une liste collée (virgules, points-virgules, lignes) : les valides, chacune une fois, et les autres. */
export function mailList(text) {
  const parts = String(text || '').split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  const valid = [...new Set(parts.filter((s) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(s)))];
  return { valid, invalid: parts.filter((s) => !valid.includes(s)) };
}

// **gras**, [texte](https://…) et les adresses nues, aux couleurs du mail ; go() réécrit l'adresse d'un lien (suivi).
function rich(text, c, go = (url) => url) {
  let html = escapeHtml(text);
  html = html.replace(/\*\*(.+?)\*\*/g, `<strong style="color:${c.text}">$1</strong>`);
  html = html.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, (_m, label, url) => `<a href="${escapeHtml(go(unescape(url)))}" style="color:${c.accent}">${label}</a>`);
  html = html.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (_m, before, url) => `${before}<a href="${escapeHtml(go(unescape(url)))}" style="color:${c.accent};word-break:break-all">${url}</a>`);
  return html.replace(/\n/g, '<br>');
}
const unescape = (html) => html.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

/**
 * Le mail en HTML. pack : { title, artist, cover, listenUrl, tracks: [{ id, title, bpm, key }] }, et pour
 * un envoi : link (réécrit chaque lien pour le suivi), pixel (image d'ouverture), unsubscribe (lien de désinscription).
 */
export function packMailHtml(d, pack) {
  const c = d.colors, font = FONTS[d.font], display = FONTS[d.titleFont], go = pack.link || ((url) => url);
  const pad = (inner, top = 14) => `<tr><td style="padding:${top}px 36px 0">${inner}</td></tr>`;
  const button = (label, url, bg, fg, { big = false, border = bg } = {}) => `<a href="${escapeHtml(go(url))}" style="display:inline-block;padding:${big ? '15px 28px' : '10px 18px'};border:1px solid ${border};border-radius:999px;background:${bg};color:${fg};font:700 ${big ? 15 : 13}px/1 ${font};text-decoration:none">${escapeHtml(label)}</a>`;
  const prods = d.trackIds.map((id) => pack.tracks.find((t) => t.id === id)).filter(Boolean).map((t) => {
    const badges = [t.bpm ? `${t.bpm} BPM` : '', t.key].filter(Boolean)
      .map((b) => `<span style="display:inline-block;margin:6px 6px 0 0;padding:3px 9px;border:1px solid ${c.accent};border-radius:999px;font:600 11px/1.4 ${FONTS.mono};letter-spacing:.06em;color:${c.accent}">${escapeHtml(b)}</span>`).join('');
    return `<tr><td style="padding:12px 0;border-top:1px solid ${c.muted}33">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
${pack.cover ? `<td width="64" valign="top" style="padding-right:14px"><img src="${escapeHtml(absolute(pack.cover))}?w=160" width="64" height="64" alt="" style="display:block;border-radius:10px;object-fit:cover"></td>` : ''}
<td valign="top"><div style="font:700 16px/1.3 ${font};color:${c.text}">${escapeHtml(t.title)}</div>${badges}</td>
<td align="right" valign="middle" style="white-space:nowrap;padding-left:10px">
${pack.listenUrl ? button('Écouter', pack.listenUrl, c.accent, '#ffffff') : ''}
</td></tr></table></td></tr>`;
  }).join('');
  const paragraphs = d.text.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean)
    .map((s) => pad(`<p style="margin:0;font:400 16px/1.65 ${font};color:${c.muted}">${rich(s, c, go)}</p>`)).join('');
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(d.subject || pack.title)}</title>
<link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;700&family=Unbounded:wght@800&family=JetBrains+Mono:wght@600&display=swap" rel="stylesheet">
<style>body{margin:0;padding:0;background:${c.bg}} @media (max-width:620px){.shell{width:100%!important;border-radius:0!important}}</style></head>
<body style="margin:0;padding:0;background:${c.bg}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(d.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${c.bg}" style="background:${c.bg}"><tr><td align="center" style="padding:32px 12px 40px">
<table role="presentation" class="shell" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="${c.card}" style="width:600px;max-width:600px;background:${c.card};border-radius:22px;overflow:hidden">
${d.image ? `<tr><td><img src="${escapeHtml(d.image)}" width="600" alt="" style="display:block;width:100%;height:auto"></td></tr>` : `<tr><td style="height:4px;line-height:4px;font-size:0;background:${c.accent}">&nbsp;</td></tr>`}
<tr><td style="padding:30px 36px 0">
${d.eyebrow ? `<div style="font:600 12px/1 ${FONTS.mono};letter-spacing:.2em;text-transform:uppercase;color:${c.accent}">${escapeHtml(d.eyebrow)}</div>` : ''}
<h1 style="margin:${d.eyebrow ? 14 : 0}px 0 0;font:800 28px/1.2 ${display};color:${c.text}">${escapeHtml(d.title || pack.title)}</h1>
</td></tr>
${paragraphs}
${prods ? pad(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${prods}</table>`, 22) : ''}
${d.buttonLabel && d.buttonUrl ? pad(button(d.buttonLabel, d.buttonUrl, c.button, c.buttonText, { big: true }), 22) : ''}
<tr><td style="padding:30px 36px 32px"><div style="height:1px;background:${c.muted}33;font-size:0;line-height:1px">&nbsp;</div>
<p style="margin:16px 0 0;font:400 14px/1.6 ${font};color:${c.muted}">${rich(d.signature || d.from || pack.artist, c, go)}</p></td></tr>
</table>
${d.footer ? `<p style="margin:20px 0 0;font:400 12px/1.6 ${font};color:${c.muted}">${rich(d.footer, c, go)}</p>` : ''}
${pack.unsubscribe ? `<p style="margin:14px 0 0;font:400 12px/1.6 ${font};color:${c.muted}"><a href="${escapeHtml(pack.unsubscribe)}" style="color:${c.muted}">Se désinscrire</a></p>` : ''}
${pack.pixel ? `<img src="${escapeHtml(pack.pixel)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0">` : ''}
</td></tr></table></body></html>`;
}
