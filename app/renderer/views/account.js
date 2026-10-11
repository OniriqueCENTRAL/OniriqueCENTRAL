import { h, eyebrow, field, button, date, attempt, toast } from '../ui.js';
import { state, call, refresh } from '../app.js';

export function accountView() {
  const { me, settings } = state.data;

  const name = h('input', { type: 'text', maxLength: 80, value: me.user.name });
  const profile = h('form', {
    class: 'stack',
    onsubmit: async (event) => {
      event.preventDefault();
      if (await attempt(() => call('api', 'POST', '/api/me/profile', { name: name.value }), 'Profil enregistré.')) await refresh();
    },
  },
    field('E-mail', h('input', { type: 'email', value: me.user.email, disabled: true })),
    field('Nom', name),
    h('div', null, h('button', { class: 'btn', type: 'submit' }, 'Enregistrer')));

  const current = h('input', { type: 'password', autocomplete: 'current-password', required: true });
  const next = h('input', { type: 'password', autocomplete: 'new-password', required: true, minLength: 8 });
  const password = h('form', {
    class: 'stack',
    onsubmit: async (event) => {
      event.preventDefault();
      if (await attempt(() => call('auth:password', current.value, next.value), 'Mot de passe changé. Les autres appareils sont déconnectés.')) {
        current.value = next.value = '';
      }
    },
  },
    field('Mot de passe actuel', current),
    field('Nouveau mot de passe (8 caractères minimum)', next),
    h('div', null, h('button', { class: 'btn', type: 'submit' }, 'Changer le mot de passe')));

  const server = h('input', { type: 'url', class: 'mono', value: settings.serverUrl });
  const changeServer = async () => {
    if (server.value.trim().replace(/\/+$/, '') === settings.serverUrl) return;
    try {
      await call('settings:server', server.value);
      toast('Serveur changé : reconnectez-vous.');
      await refresh();
    } catch (error) {
      toast(error.message, true);
    }
  };

  return [
    eyebrow('Compte'),
    h('h1', null, 'Votre ', h('em', null, 'compte')),
    h('p', { class: 'lede' }, `Membre depuis le ${date(me.user.createdAt)}.`),

    h('div', { class: 'grid2' },
      h('div', { class: 'panel' }, eyebrow('Profil'), profile),
      h('div', { class: 'panel', style: { 'margin-top': 0 } }, eyebrow('Sécurité'), password)),

    h('div', { class: 'panel' }, eyebrow('Cette installation'),
      h('div', { class: 'stack' },
        field('Dossier des plugins VST3', h('div', { class: 'row' },
          h('input', { class: 'mono', value: settings.vst3Dir, readOnly: true }),
          button('Changer', async () => { await call('settings:vst3Dir'); await refresh(); }),
          button('Par défaut', async () => { await call('settings:vst3Dir', true); await refresh(); }, 'quiet'))),
        field('Fichiers de licence (lus par les plugins)', h('input', { class: 'mono', value: settings.licenseDir, readOnly: true })),
        field('Serveur ONIRIQUE CENTRAL', h('div', { class: 'row' }, server, button('Appliquer', changeServer))),
        h('div', { class: 'muted mono', style: { 'font-size': '11px' } }, `ONIRIQUE CENTRAL ${settings.appVersion}`))),

    h('div', { class: 'row', style: { 'margin-top': '22px' } },
      button('Se déconnecter', async () => { await call('auth:logout'); await refresh(); }, 'danger')),
  ];
}
