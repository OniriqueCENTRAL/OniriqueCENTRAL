import { config } from './config.js';

// Les e-mails d'ONIRIQUE, mis en page à la charte du site : nuit, braise, étoile à quatre branches.
// Écrits pour les messageries (Gmail, Outlook, Apple Mail) : tableaux, styles en ligne, rien qui dépende d'un script ;
// la police du site ne s'affiche que là où la messagerie charge les polices (Apple Mail), une police système ailleurs.
//
//   renderEmail({ preheader, eyebrow, title, blocks, footer })  →  le HTML
//   blocks : [{ text }, { button: { label, url } }, { code, caption }, { image, alt, url }, { product }, { divider: true }]
//   textToBlocks(text)  →  les blocs d'un message écrit en texte simple (une adresse seule sur sa ligne devient un bouton)

const C = { night: '#0D0809', deep: '#1A080A', deep2: '#2A0A0E', line: '#3A1C20', mist: '#F6EEEE', haze: '#B39A9D', ember: '#E23444', bone: '#FFECEE' };
const FONT = "'Hanken Grotesk', 'Segoe UI', Helvetica, Arial, sans-serif";
const DISPLAY = "'Unbounded', 'Arial Black', 'Segoe UI', Helvetica, Arial, sans-serif";
const MONO = "'JetBrains Mono', Consolas, 'Courier New', monospace";

export const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = (url) => (/^(https?:|mailto:)/i.test(String(url || '')) ? escapeHtml(url) : '#');

/** Un texte court mis en forme : **gras**, [lien](https://…), les adresses deviennent des liens, retours à la ligne gardés. */
export function inline(text) {
  let html = escapeHtml(text);
  html = html.replace(/\*\*(.+?)\*\*/g, `<strong style="color:${C.mist};font-weight:700">$1</strong>`);
  html = html.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, (_m, label, url) => `<a href="${url}" style="color:${C.bone};text-decoration:underline">${label}</a>`);
  html = html.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (_m, before, url) => `${before}<a href="${url}" style="color:${C.bone};text-decoration:underline;word-break:break-all">${url}</a>`);
  return html.replace(/\n/g, '<br>');
}

const euros = (cents) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
const absolute = (url) => (/^https?:/i.test(url) ? url : `${config.siteUrl}${url.startsWith('/') ? '' : '/'}${url}`);

function block(b) {
  const pad = (inner, top = 14) => `<tr><td style="padding:${top}px 40px 0 40px">${inner}</td></tr>`;
  if (b.text !== undefined) {
    return pad(`<p style="margin:0;font:400 16px/1.65 ${FONT};color:${C.haze}">${inline(b.text)}</p>`);
  }
  if (b.heading) return pad(`<h2 style="margin:10px 0 0;font:800 17px/1.35 ${DISPLAY};letter-spacing:.02em;color:${C.mist}">${escapeHtml(b.heading)}</h2>`, 20);
  if (b.button) {
    return pad(`<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:10px 0 4px"><tr>
<td align="center" bgcolor="${C.mist}" style="border-radius:999px;box-shadow:0 10px 30px -10px rgba(226,52,68,.7)">
<a href="${safeUrl(b.button.url)}" style="display:inline-block;padding:15px 30px;font:700 15px/1 ${FONT};color:${C.night};text-decoration:none;border-radius:999px">${escapeHtml(b.button.label)}&nbsp;&nbsp;→</a>
</td></tr></table>`, 18);
  }
  if (b.code) {
    return pad(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0">
<tr><td align="center" style="padding:22px 16px;border:1px dashed ${C.ember};border-radius:16px;background:${C.deep2}">
${b.caption ? `<div style="font:500 11px/1 ${MONO};letter-spacing:.18em;text-transform:uppercase;color:${C.haze};padding-bottom:12px">${escapeHtml(b.caption)}</div>` : ''}
<div style="font:800 ${b.code.length > 22 || b.code.includes('\n') ? 16 : 26}px/1.5 ${MONO};letter-spacing:${b.code.length > 22 ? '.02em' : '.12em'};color:${C.bone}">${escapeHtml(b.code).replace(/\n/g, '<br>')}</div>
${b.detail ? `<div style="font:400 14px/1.5 ${FONT};color:${C.haze};padding-top:10px">${escapeHtml(b.detail)}</div>` : ''}
</td></tr></table>`, 18);
  }
  if (b.image) {
    const img = `<img src="${safeUrl(absolute(b.image))}" alt="${escapeHtml(b.alt || '')}" width="520" style="display:block;width:100%;max-width:520px;height:auto;border:1px solid ${C.line};border-radius:14px">`;
    return pad(b.url ? `<a href="${safeUrl(b.url)}">${img}</a>` : img, 18);
  }
  if (b.product) {
    const p = b.product;
    const url = `${config.siteUrl}/boutique.html?p=${encodeURIComponent(p.slug)}`;
    return pad(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${C.line};border-radius:16px;background:${C.deep};overflow:hidden">
${p.image ? `<tr><td><a href="${url}"><img src="${safeUrl(absolute(p.image))}" alt="Interface de ${escapeHtml(p.name)}" width="520" style="display:block;width:100%;height:auto;border-radius:16px 16px 0 0"></a></td></tr>` : ''}
<tr><td style="padding:20px 22px 22px">
<div style="font:500 11px/1 ${MONO};letter-spacing:.16em;text-transform:uppercase;color:${C.haze}">${escapeHtml(p.creatorLabel || 'ONIRIQUE')}</div>
<div style="font:800 20px/1.3 ${DISPLAY};color:${C.mist};padding-top:8px">${escapeHtml(p.name)}</div>
${p.tagline ? `<div style="font:400 15px/1.55 ${FONT};color:${C.haze};padding-top:6px">${escapeHtml(p.tagline)}</div>` : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:16px"><tr>
<td style="font:800 22px/1 ${DISPLAY};color:${C.mist}">${p.priceCents ? euros(p.priceCents) : 'Gratuit'}</td>
<td align="right"><a href="${url}" style="display:inline-block;padding:12px 20px;border-radius:999px;background:${C.ember};font:700 14px/1 ${FONT};color:#ffffff;text-decoration:none">Découvrir →</a></td>
</tr></table></td></tr></table>`, 18);
  }
  if (b.divider) return pad(`<div style="height:1px;background:${C.line};line-height:1px;font-size:0">&nbsp;</div>`, 24);
  return '';
}

export function renderEmail({ preheader = '', eyebrow = 'ONIRIQUE', title = '', blocks = [], footer = [] }) {
  const site = config.siteUrl;
  const logo = `${site}/assets/logo-small.png`;
  const star = `<span style="color:${C.ember}">&#10022;</span>`;
  return `<!doctype html>
<html lang="fr" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>${escapeHtml(title || 'ONIRIQUE')}</title>
<link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;700&family=Unbounded:wght@800&family=JetBrains+Mono:wght@500;800&display=swap" rel="stylesheet">
<style>
  body { margin:0; padding:0; background:${C.night}; }
  a { color:${C.bone}; }
  @media (max-width: 620px) {
    .shell { width:100% !important; border-radius:0 !important; }
    .px td, td.px { padding-left:22px !important; padding-right:22px !important; }
    h1 { font-size:26px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${C.night}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.night}">${escapeHtml(preheader)}&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.night}" style="background:${C.night};background-image:radial-gradient(120% 60% at 50% 0%, #5c0008 0%, ${C.night} 70%)">
<tr><td align="center" style="padding:36px 12px 40px">

<table role="presentation" class="shell" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px">
<tr><td align="center" style="padding:0 0 22px">
<a href="${site}" style="text-decoration:none"><img src="${logo}" width="64" alt="ONIRIQUE" style="display:block;width:64px;height:auto;margin:0 auto"></a>
<div style="font:800 15px/1 ${DISPLAY};letter-spacing:.32em;color:${C.mist};padding-top:12px">ONIRIQUE</div>
</td></tr>
</table>

<table role="presentation" class="shell px" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.deep}" style="width:600px;max-width:600px;background:${C.deep};border:1px solid ${C.line};border-radius:24px">
<tr><td style="height:4px;line-height:4px;font-size:0;border-radius:24px 24px 0 0;background:${C.ember};background-image:linear-gradient(90deg,#5c0008,${C.ember},#ff8f99,${C.ember},#5c0008)">&nbsp;</td></tr>
<tr><td style="padding:34px 40px 0 40px">
<div style="font:500 12px/1 ${MONO};letter-spacing:.2em;text-transform:uppercase;color:${C.haze}">${star}&nbsp;&nbsp;${escapeHtml(eyebrow)}</div>
${title ? `<h1 style="margin:16px 0 4px;font:800 30px/1.2 ${DISPLAY};color:${C.mist};letter-spacing:.01em">${escapeHtml(title)}</h1>` : ''}
</td></tr>
${blocks.map(block).join('\n')}
<tr><td style="padding:34px 40px 34px 40px">
<div style="height:1px;background:${C.line};line-height:1px;font-size:0">&nbsp;</div>
<p style="margin:18px 0 0;font:400 14px/1.6 ${FONT};color:${C.haze}">L'équipe ONIRIQUE</p>
</td></tr>
</table>

<table role="presentation" class="shell" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px">
<tr><td align="center" style="padding:26px 24px 0;font:400 12px/1.7 ${FONT};color:#8a7275">
<a href="${site}/boutique.html" style="color:#c9b3b6;text-decoration:none">Boutique</a>&nbsp;&nbsp;·&nbsp;&nbsp;<a href="${site}/compte.html" style="color:#c9b3b6;text-decoration:none">Mon compte</a>&nbsp;&nbsp;·&nbsp;&nbsp;<a href="${site}/support.html" style="color:#c9b3b6;text-decoration:none">Support</a>
${footer.map((line) => `<br>${line}`).join('')}
<br>ONIRIQUE · plugins audio · <a href="${site}" style="color:#8a7275">${escapeHtml(site.replace(/^https?:\/\//, ''))}</a>
</td></tr>
</table>

</td></tr>
</table>
</body>
</html>`;
}

/**
 * Un message écrit en texte simple, en blocs : paragraphes séparés par une ligne vide ; une adresse seule sur sa ligne
 * devient un bouton (« Ouvrir le lien »), une ligne en retrait de deux espaces devient un encadré.
 */
export function textToBlocks(text, buttonLabel = 'Ouvrir le lien') {
  const blocks = [];
  for (const chunk of String(text).split(/\n{2,}/)) {
    const lines = chunk.split('\n');
    if (lines.length === 1 && /^\s*https?:\/\/\S+\s*$/.test(lines[0])) { blocks.push({ button: { label: buttonLabel, url: lines[0].trim() } }); continue; }
    if (lines.every((line) => /^ {2}\S/.test(line))) { blocks.push({ code: lines.map((l) => l.trim()).join('\n') }); continue; }
    blocks.push({ text: chunk.trim() });
  }
  return blocks.filter((b) => b.text !== '' );
}
