// La fenêtre de confirmation : alert (OK), confirm (OK / Annuler) ou prompt (un champ). Entrée valide, Échap annule.
const q = new URLSearchParams(location.search);
const kind = q.get('kind');
// La couleur choisie dans les Paramètres (des variables --acc, rien d'autre).
if (/^[-a-z:;, !0-9]*$/.test(q.get('accent') || '')) document.documentElement.style.cssText += q.get('accent') || '';
const box = document.getElementById('box');
const field = document.getElementById('value');
document.getElementById('message').textContent = q.get('message') || '';
box.classList.add(kind);
if (kind === 'prompt') { field.hidden = false; field.value = q.get('value') || ''; }

let sent = false;
const answer = (value) => { if (!sent) { sent = true; window.oniriqueAnswer(value); } };
box.addEventListener('submit', (event) => { event.preventDefault(); answer(kind === 'prompt' ? field.value : true); });
document.getElementById('cancel').onclick = () => answer(kind === 'prompt' ? null : false);
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') answer(kind === 'prompt' ? null : kind === 'alert'); });
(kind === 'prompt' ? field : document.getElementById('ok')).focus();
if (kind === 'prompt') field.select();
