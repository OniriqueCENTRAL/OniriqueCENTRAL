import { h, eyebrow, field, attempt } from '../ui.js';
import { state, call } from '../app.js';

export function supportView() {
  const { me, catalog, installs, settings } = state.data;
  const product = h('select', null, h('option', { value: '' }, 'Question générale'),
    catalog.products.map((p) => h('option', { value: p.id }, p.name)));
  const subject = h('input', { maxLength: 120, required: true, placeholder: 'En quelques mots' });
  const message = h('textarea', { maxLength: 3500, minLength: 10, required: true, rows: 9,
    placeholder: 'Décrivez ce qui se passe : ce que vous faisiez, ce que vous attendiez, votre DAW…' });
  const submit = h('button', { class: 'btn primary', type: 'submit' }, 'Envoyer');

  const form = h('form', {
    class: 'stack',
    onsubmit: async (event) => {
      event.preventDefault();
      const p = catalog.products.find((x) => String(x.id) === product.value);
      // Le contexte technique évite un aller-retour : plugin concerné, version installée, version de l'app.
      const context = [p && `${p.name} ${installs[p.id].version || 'non installé'}`, `Central ${settings.appVersion}`].filter(Boolean).join(' · ');
      submit.disabled = true;
      const sent = await attempt(() => call('api', 'POST', '/api/support', { subject: subject.value, message: message.value, context }),
        'Message envoyé. Nous vous répondons par e-mail.');
      submit.disabled = false;
      if (sent) subject.value = message.value = '';
    },
  },
    h('div', { class: 'grid2' }, field('Plugin concerné', product), field('Sujet', subject)),
    field('Message', message),
    h('div', { class: 'row' }, submit, h('span', { class: 'muted' }, `Réponse envoyée à ${me.user.email}`)));

  return [
    eyebrow('Support'),
    h('h1', null, 'Besoin d\'', h('em', null, 'aide')),
    h('p', { class: 'lede' }, 'Un souci d\'installation, de licence ou de son ? Écrivez-nous, le message arrive directement à l\'équipe.'),
    h('div', { class: 'panel' }, eyebrow('Nouveau message'), form),
  ];
}
