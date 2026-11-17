import { h, eyebrow, pill, button, attempt, confirm, modal, field } from '../ui.js';
import { call, render } from '../app.js';

// Le panel support des admins : les mêmes demandes, et les mêmes gestes, que sur la page d'administration du site.
const api = (method, route, body) => call('api', method, `/api/admin${route}`, body);
const view = { data: null, loadedAt: 0, loading: false, error: null, archives: false };

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

// La réponse s'écrit ici et part du serveur, depuis l'adresse d'ONIRIQUE : pas besoin de messagerie sur ce PC.
function reply(m) {
  const text = h('textarea', { rows: 10, maxLength: 20000, placeholder: 'Bonjour,\n\n' });
  modal(`Répondre à ${m.email}`, [
    h('p', { class: 'muted', style: { 'white-space': 'pre-wrap', 'max-height': '140px', overflow: 'auto' } }, h('strong', null, m.subject), '\n', m.message),
    field('Votre réponse (le message d\'origine est cité en dessous)', text),
  ], [{ label: 'Envoyer', run: async () => {
    if (!text.value.trim()) return false;
    if (!await attempt(() => api('POST', `/support/${m.id}/reply`, { text: text.value }), 'Réponse envoyée.')) return false;
    await load();
  } }], 'Support');
}

// « Je m'en occupe » : prendre ou libérer la demande d'un autre admin se confirme d'abord.
async function claim(m, take) {
  const run = (force) => attempt(() => api('POST', `/support/${m.id}/claim`, { take, force }), take ? 'Demande prise en charge.' : 'Demande libérée.')
    .then((ok) => ok && load());
  if (m.claimedBy && m.claimedBy !== view.data.me) {
    return confirm(take ? 'Reprendre cette demande ?' : 'Libérer cette demande ?', `${m.claimedByName} s'en occupe en ce moment.`,
      take ? 'Reprendre' : 'Libérer', () => run(true));
  }
  return run(false);
}

const archive = (m, archived) => attempt(() => api('POST', `/support/${m.id}/archive`, { archived }),
  archived ? 'Demande archivée.' : 'Demande remise dans la liste.').then((ok) => ok && load());

function messageRow(m) {
  const mine = m.claimedBy === view.data.me;
  return h('tr', null,
    h('td', { class: 'muted', style: { 'white-space': 'nowrap' } }, when(m.createdAt)),
    h('td', null, h('div', { class: 'selectable' }, m.email),
      h('div', { class: 'muted', style: { 'font-size': '12px' } }, [m.name, m.userId ? `compte n° ${m.userId}` : 'sans compte', m.context].filter(Boolean).join(' · '))),
    h('td', { class: 'selectable', style: { 'white-space': 'pre-wrap', 'overflow-wrap': 'anywhere' } }, h('strong', { style: { display: 'block' } }, m.subject), m.message),
    h('td', { class: 'actions' },
      m.claimedBy
        ? pill(mine ? 'Vous vous en occupez' : `${m.claimedByName} s'en occupe`, mine ? 'hot' : 'warn', true)
        : (m.archivedAt ? null : pill('Personne dessus', '', false)),
      m.archivedAt ? null : mine
        ? button('Libérer', () => claim(m, false), 'small quiet')
        : button(m.claimedBy ? 'Reprendre' : 'Je m\'en occupe', () => claim(m, true), 'small'),
      button(m.repliedAt ? 'Répondre encore' : 'Répondre', () => reply(m), 'small'),
      m.repliedAt ? h('div', { class: 'muted', style: { 'font-size': '12px' } }, `Répondu le ${when(m.repliedAt)}`) : null,
      button(m.archivedAt ? 'Désarchiver' : 'Archiver', () => archive(m, !m.archivedAt), 'small quiet'),
      m.archivedAt ? h('div', { class: 'muted', style: { 'font-size': '12px' } }, `Archivée le ${when(m.archivedAt)}`) : null,
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
    h('p', { class: 'lede' }, 'Les demandes envoyées depuis le site et depuis l\'application. Prenez une demande avec « Je m\'en occupe » pour que les autres sachent qui la traite, répondez, puis archivez ce qui est réglé.'),
  ];

  if (view.error) return [...head, h('div', { class: 'panel empty' }, h('p', null, view.error), button('Réessayer', load))];
  if (!view.data) return [...head, h('div', { class: 'panel empty mono' }, 'Chargement…')];

  const { mailbox } = view.data;
  const archived = view.data.messages.filter((m) => m.archivedAt);
  const messages = view.archives ? archived : view.data.messages.filter((m) => !m.archivedAt);
  return [
    ...head,
    h('div', { class: 'panel' },
      h('div', { class: 'row between wrap' },
        h('div', { class: 'row' }, eyebrow(view.archives ? `${messages.length} archivée(s)` : `${messages.length} demande(s) ouverte(s)`),
          mailbox ? pill(mailbox, '', true) : pill('Aucune boîte reliée : les demandes sont refusées', 'warn')),
        h('div', { class: 'row' },
          button(view.archives ? 'Demandes ouvertes' : `Archives (${archived.length})`, () => { view.archives = !view.archives; render(); }, 'small quiet'),
          button('Actualiser', load, 'small quiet', { disabled: view.loading }),
          button('Ouvrir la boîte mail', () => attempt(() => call('open:webmail')), 'small'))),
      h('p', { class: 'muted', style: { margin: '10px 0 14px' } },
        'Chaque demande arrive aussi dans la boîte de support, où elle reste après avoir été supprimée d\'ici. Elles sont gardées ici trois ans au plus. La boîte complète s\'ouvre sur le webmail IONOS, avec son mot de passe.'),
      messages.length
        ? h('div', { class: 'table-scroll' }, h('table', null,
          h('thead', null, h('tr', null, ['Reçu le', 'De', 'Message', ''].map((t) => h('th', null, t)))),
          h('tbody', null, messages.map(messageRow))))
        : h('div', { class: 'empty' }, view.archives ? 'Aucune demande archivée.' : 'Aucune demande ouverte pour le moment.')),
  ];
}
