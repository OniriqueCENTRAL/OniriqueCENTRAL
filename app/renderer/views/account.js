import { h, eyebrow, field, button, date, attempt, toast, pill, roleName } from '../ui.js';
import { state, call, refresh, avatar } from '../app.js';

export function accountView() {
  const { me, settings } = state.data;

  const name = h('input', { type: 'text', maxLength: 80, value: me.user.name });
  // Instagram : affiché avec le nom de l'ingé sous les crédits du site.
  const instagram = h('input', { type: 'text', maxLength: 200, placeholder: '@votrecompte ou lien du profil', spellcheck: false,
    value: me.user.instagram ? '@' + me.user.instagram.replace(/^https:\/\/www\.instagram\.com\//, '').replace(/\/$/, '') : '' });
  const profile = h('form', {
    class: 'stack',
    onsubmit: async (event) => {
      event.preventDefault();
      if (await attempt(() => call('api', 'POST', '/api/me/profile', { name: name.value, instagram: instagram.value.trim() }), 'Profil enregistré.')) await refresh();
    },
  },
    field('E-mail', h('input', { type: 'email', value: me.user.email, disabled: true })),
    field('Nom', name),
    field('Instagram (facultatif)', instagram),
    h('div', null, h('button', { class: 'btn', type: 'submit' }, 'Enregistrer')));

  // Photo de profil : la même que sur le site. Une image de 2 Mo au plus, choisie sur cet ordinateur.
  const photo = h('div', { class: 'row', style: { 'margin-bottom': '18px' } }, avatar(me.user, true),
    button('Changer la photo', async () => {
      try {
        if (await call('me:avatar')) { toast('Photo enregistrée.'); await refresh(); }
      } catch (error) {
        toast(error.message, true);
      }
    }),
    me.user.avatar ? button('Retirer', async () => {
      if (await attempt(() => call('api', 'DELETE', '/api/me/avatar'), 'Photo retirée.')) await refresh();
    }, 'quiet') : null);

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

  // Les nouveautés d'ONIRIQUE par e-mail : le même réglage que sur la page compte du site.
  const news = h('label', { class: 'check', style: { 'margin-top': '14px' } }, h('input', {
    type: 'checkbox', checked: !!me.user.newsletter,
    onchange: async (event) => {
      if (await attempt(() => call('api', 'POST', '/api/me/newsletter', { enabled: event.target.checked }),
        event.target.checked ? 'Inscrit aux nouveautés d\'ONIRIQUE.' : 'Désinscrit des nouveautés d\'ONIRIQUE.')) await refresh();
    },
  }), 'Recevoir par e-mail les nouveautés, offres et codes promo d\'ONIRIQUE');

  // Parrainage : le lien à partager, ce que chacun y gagne, les amis venus et les codes gagnés.
  const r = me.referral;
  const referral = r && r.enabled ? (() => {
    const attach = h('input', { class: 'mono', maxLength: 12, placeholder: 'CODE DE L\'AMI', style: { 'text-transform': 'uppercase' } });
    const perk = (big, small) => h('div', { class: 'panel tile', style: { 'margin-top': 0 } }, h('div', { class: 'value' }, big), h('div', { class: 'muted', style: { 'font-size': '13px' } }, small));
    const done = r.milestone ? r.milestone - r.toMilestone : 0;
    return h('div', { class: 'panel' }, eyebrow('Parrainage'),
      h('p', { class: 'muted', style: { margin: '0 0 14px' } }, `Partagez votre lien. Votre ami a ${r.friendPercent} % de remise sur son premier plugin ONIRIQUE ; vous, un code de -${r.rewardPercent} % dès qu'il fait son premier achat`
        + (r.milestone ? `, et un plugin ONIRIQUE offert tous les ${r.milestone} amis acheteurs.` : '.')),
      h('div', { class: 'grid3' }, perk(`-${r.friendPercent} %`, 'pour votre ami, sur son premier plugin ONIRIQUE'), perk(`-${r.rewardPercent} %`, 'pour vous, à chaque ami qui achète'),
        r.milestone ? perk('Offert', `un plugin ONIRIQUE tous les ${r.milestone} amis acheteurs`) : null),
      h('div', { class: 'row', style: { 'margin-top': '16px' } }, h('input', { class: 'mono grow', value: r.link, readOnly: true }),
        button('Copier le lien', () => attempt(() => call('clipboard', r.link), 'Lien copié : envoyez-le à vos amis.'), 'primary')),
      h('p', { class: 'muted', style: { margin: '14px 0 0' } }, `${r.invited} ami(s) inscrit(s) · ${r.converted} ami(s) acheteur(s) · ${r.rewards.length} code(s) gagné(s)`
        + (r.milestone ? ` · plus que ${r.toMilestone} ami(s) acheteur(s) avant votre plugin offert` : '')),
      r.milestone ? h('div', { class: 'progress', style: { 'margin-top': '8px' } }, h('i', { style: { width: `${Math.round(done / r.milestone * 100)}%` } })) : null,
      r.rewards.length ? h('div', { class: 'stack', style: { 'margin-top': '14px', gap: '8px' } }, r.rewards.map((g) => h('div', { class: 'row between wrap' },
        h('div', null, h('button', { class: 'key copy', type: 'button', title: 'Copier le code', onclick: () => attempt(() => call('clipboard', g.code), 'Code copié.') }, g.code),
          h('div', { class: 'muted', style: { 'font-size': '12px' } }, g.label + (g.expiresAt ? ` · jusqu'au ${date(g.expiresAt)}` : ''))),
        pill(g.used ? 'Utilisé' : g.expired ? 'Expiré' : 'À utiliser', g.used || g.expired ? '' : 'hot')))) : null,
      r.welcomePercent ? h('p', { class: 'muted', style: { margin: '14px 0 0' } }, `Invité par ${r.sponsor} : ${r.welcomePercent} % de remise sur votre premier plugin ONIRIQUE, appliqués tout seuls au moment d'acheter.`) : null,
      r.canAttach ? h('div', { class: 'row', style: { 'margin-top': '14px' } }, attach, button('Valider le code d\'un ami', async () => {
        if (await attempt(() => call('api', 'POST', '/api/me/referrer', { code: attach.value.trim() }), 'Parrainage enregistré : votre remise s\'appliquera à votre premier plugin ONIRIQUE.')) await refresh();
      })) : null);
  })() : null;

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
    h('p', { class: 'lede' }, `Membre depuis le ${date(me.user.createdAt)}.`,
      me.user.role !== 'user' ? h('span', { style: { 'margin-left': '12px' } }, pill(roleName(me.user.role), 'hot')) : null),

    h('div', { class: 'grid2' },
      h('div', { class: 'panel' }, eyebrow('Profil'), photo, profile, news),
      h('div', { class: 'panel', style: { 'margin-top': 0 } }, eyebrow('Sécurité'), password)),

    referral,

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
