import { h, field, toast } from '../ui.js';
import { state, call, refresh, render, globe } from '../app.js';

let mode = 'login';
let askCode = false; // le compte a l'A2F : le code de l'application d'authentification est demandé

const hero = () => [
  h('img', { class: 'hero', src: 'assets/sigil.png', alt: '' }),
  h('div', { class: 'wordmark' }, h('b', null, 'ONIRIQUE'), h('i', null, 'Central')),
];

/** Un système qui n'est pas en français : une fois, la proposition de passer l'application en anglais (écrite en anglais). */
function englishOffer() {
  const i18n = window.OniriqueI18n;
  let decided = true;
  try { decided = !!(localStorage.getItem('onirique.lang') || localStorage.getItem('onirique.lang.prompted')); } catch { /* stockage fermé */ }
  const languages = navigator.languages?.length ? navigator.languages : [navigator.language || ''];
  if (!i18n || i18n.lang !== 'fr' || decided || languages.some((l) => /^fr/i.test(l))) return null;
  const box = h('div', { class: 'lang-offer', lang: 'en', 'data-no-translate': '' },
    h('span', { style: { display: 'inline-flex', 'align-items': 'center', gap: '8px' } }, globe(15), h('strong', null, 'ONIRIQUE Central is available in English.')),
    h('button', { class: 'btn small primary', type: 'button', onclick: () => i18n.set('en') }, 'Switch to English'),
    h('button', { class: 'btn small quiet', type: 'button', title: 'Keep French',
      onclick: () => { try { localStorage.setItem('onirique.lang.prompted', '1'); } catch {} box.remove(); } }, '×'));
  return box;
}

export function authView() {
  const email = h('input', { type: 'email', autocomplete: 'username', required: true, placeholder: 'vous@exemple.com' });
  const password = h('input', { type: 'password', required: true, minLength: mode === 'register' ? 8 : 1,
    autocomplete: mode === 'register' ? 'new-password' : 'current-password' });
  const name = h('input', { type: 'text', maxLength: 80, placeholder: 'Nom ou pseudo' });
  const ref = h('input', { type: 'text', maxLength: 12, class: 'mono', placeholder: 'Facultatif', style: { 'text-transform': 'uppercase' } });
  const newsletter = h('input', { type: 'checkbox' });
  const code = h('input', { type: 'text', inputMode: 'numeric', autocomplete: 'one-time-code', maxLength: 11, class: 'mono', placeholder: '123456' });
  const codeField = field('Code de l\'application d\'authentification (ou code de secours)', code);
  codeField.style.display = askCode ? '' : 'none';
  const error = h('div', { class: 'error-text' });
  const submit = h('button', { class: 'btn primary', type: 'submit' }, mode === 'login' ? 'Se connecter' : 'Créer mon compte');

  const form = h('form', {
    class: 'panel stack',
    onsubmit: async (event) => {
      event.preventDefault();
      submit.disabled = true;
      error.textContent = '';
      try {
        if (mode === 'login') {
          if ((await call('auth:login', email.value, password.value, askCode ? code.value.trim() : ''))?.twoFactor) {
            codeField.style.display = '';
            askCode = true;
            submit.disabled = false;
            return code.focus();
          }
          askCode = false;
        } else await call('auth:register', email.value, password.value, name.value, ref.value.trim(), newsletter.checked);
        await refresh();
      } catch (e) {
        error.textContent = e.message;
        submit.disabled = false;
      }
    },
  },
    mode === 'register' ? field('Nom', name) : null,
    field('E-mail', email),
    field(mode === 'register' ? 'Mot de passe (8 caractères minimum)' : 'Mot de passe', password),
    mode === 'login' ? codeField : null,
    mode === 'register' ? field('Code de parrainage d\'un ami', ref) : null,
    mode === 'register' ? h('label', { class: 'check', style: { 'align-items': 'flex-start', 'font-size': '13px' } }, newsletter,
      h('span', null, 'J\'accepte de recevoir par e-mail les nouveautés, offres et codes promo d\'ONIRIQUE. Désinscription en un clic dans chaque message.')) : null,
    // Même consentement que sur la page compte du site ; les textes sont sur onirique.store.
    mode === 'register' ? h('label', { class: 'check', style: { 'align-items': 'flex-start', 'font-size': '13px' } },
      h('input', { type: 'checkbox', required: true }),
      h('span', { class: 'selectable' }, 'J\'accepte les conditions générales (onirique.store/cgv) et j\'ai lu la politique de confidentialité (onirique.store/confidentialite).')) : null,
    error, submit,
    mode === 'login' ? h('button', {
      class: 'btn small quiet', type: 'button',
      onclick: async () => {
        if (!email.reportValidity()) return;
        try {
          await call('api', 'POST', '/api/auth/forgot', { email: email.value });
          error.textContent = '';
          toast('Si un compte existe avec cette adresse, un lien vient d\'être envoyé. Il est valable une heure.');
        } catch (e) {
          error.textContent = e.message;
        }
      },
    }, 'Mot de passe oublié ?') : null);

  const tab = (id, label) => h('button', {
    type: 'button', class: mode === id ? 'active' : '', onclick: () => { mode = id; askCode = false; render(); },
  }, label);

  queueMicrotask(() => (mode === 'register' ? name : email).focus());
  return h('div', { class: 'auth-box' }, hero(), englishOffer(),
    h('div', { class: 'segmented' }, tab('login', 'Connexion'), tab('register', 'Créer un compte')),
    form,
    h('p', { class: 'muted mono', style: { 'font-size': '11px', 'margin-top': '16px' } }, state.data.settings.serverUrl));
}

/** Serveur injoignable : on laisse corriger l'adresse. */
export function offlineView() {
  const url = h('input', { type: 'url', class: 'mono', placeholder: 'https://central.exemple.com' });
  const error = h('div', { class: 'error-text' }, state.offline);
  const form = h('form', {
    class: 'panel stack',
    onsubmit: async (event) => {
      event.preventDefault();
      try {
        if (url.value.trim()) await call('settings:server', url.value);
        await refresh();
      } catch (e) {
        error.textContent = e.message;
      }
    },
  }, field('Adresse du serveur (laisser vide pour réessayer)', url), error,
    h('button', { class: 'btn primary', type: 'submit' }, 'Réessayer'));
  return h('div', { class: 'auth-box' }, hero(), form);
}
