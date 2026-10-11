import { h, eyebrow, pill, button, attempt, confirm } from '../ui.js';
import { call, render } from '../app.js';

// Le panel support des admins : les mêmes demandes, et les mêmes gestes, que sur la page d'administration du site.
const api = (method, route) => call('api', method, `/api/admin${route}`);
const view = { data: null, loadedAt: 0, loading: false, error: null };

async function load() {
  view.loading = true;
  view.error = null;
  try {
    view.data = await api('GET', '/support');
  } catch (error) {
    view.error = error.message;
  }
  view.loadedAt = Date.now();
  view.loading = false;
  render();
}

const when = (ms) => new Date(ms).toLocaleString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

function messageRow(m) {
  return h('tr', null,
    h('td', { class: 'muted', style: { 'white-space': 'nowrap' } }, when(m.createdAt)),
    h('td', null, h('div', { class: 'selectable' }, m.email),
      h('div', { class: 'muted', style: { 'font-size': '12px' } }, [m.name, m.userId ? `compte n° ${m.userId}` : 'sans compte', m.context].filter(Boolean).join(' · '))),
    h('td', { class: 'selectable', style: { 'white-space': 'pre-wrap', 'overflow-wrap': 'anywhere' } }, h('strong', { style: { display: 'block' } }, m.subject), m.message),
    h('td', { class: 'actions' },
      // Répondre ouvre la messagerie de ce PC, avec le destinataire et le sujet déjà remplis.
      button('Répondre', () => attempt(() => call('open:mail', m.email, m.subject)), 'small'),
      button('Copier l\'e-mail', () => attempt(() => call('clipboard', m.email), 'Adresse copiée.'), 'small quiet'),
      button('Supprimer', () => confirm('Supprimer ce message ?', 'Il disparaît de cette liste. L\'e-mail reçu dans la boîte de support n\'est pas touché.',
        'Supprimer', async () => { if (await attempt(() => api('DELETE', `/support/${m.id}`), 'Message supprimé.')) await load(); }, 'danger'), 'small quiet danger')));
}

export function supportAdminView() {
  // Relu à l'arrivée sur l'écran, puis au plus toutes les trente secondes tant qu'on y reste.
  if (!view.loading && !view.error && Date.now() - view.loadedAt > 30_000) load();

  const head = [
    eyebrow('Studio'),
    h('h1', null, 'Panel ', h('em', null, 'support')),
    h('p', { class: 'lede' }, 'Les demandes envoyées depuis le site et depuis l\'application. Répondez par e-mail, puis retirez de la liste ce qui est réglé.'),
  ];

  if (view.error) return [...head, h('div', { class: 'panel empty' }, h('p', null, view.error), button('Réessayer', load))];
  if (!view.data) return [...head, h('div', { class: 'panel empty mono' }, 'Chargement…')];

  const { mailbox, messages } = view.data;
  return [
    ...head,
    h('div', { class: 'panel' },
      h('div', { class: 'row between wrap' },
        h('div', { class: 'row' }, eyebrow(`${messages.length} demande(s)`),
          mailbox ? pill(mailbox, '', true) : pill('Aucune boîte reliée : les demandes sont refusées', 'warn')),
        h('div', { class: 'row' },
          button('Actualiser', load, 'small quiet', { disabled: view.loading }),
          button('Ouvrir la boîte mail', () => attempt(() => call('open:webmail')), 'small'))),
      h('p', { class: 'muted', style: { margin: '10px 0 14px' } },
        'Chaque demande arrive aussi dans la boîte de support, où elle reste après avoir été supprimée d\'ici. Elles sont gardées ici trois ans au plus. La boîte complète s\'ouvre sur le webmail IONOS, avec son mot de passe.'),
      messages.length
        ? h('div', { class: 'table-scroll' }, h('table', null,
          h('thead', null, h('tr', null, ['Reçu le', 'De', 'Message', ''].map((t) => h('th', null, t)))),
          h('tbody', null, messages.map(messageRow))))
        : h('div', { class: 'empty' }, 'Aucune demande pour le moment.')),
  ];
}
