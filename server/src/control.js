// Ce que l'équipe règle en direct depuis le panel admin : l'annonce affichée sur le site, le mode maintenance,
// les abonnements (texte, plugins compris, nouvelle formule), les packs, et la suppression d'un compte.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { all, get, run, now, transaction, setting, setSetting } from './db.js';
import { HttpError, isStaff } from './auth.js';
import { parseProductIds } from './licensing.js';

const str = (value, max = 200) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const int = (value, fallback = null) => (Number.isInteger(Number(value)) && value !== '' && value !== null ? Number(value) : fallback);

//==============================================================================
//  Annonce et maintenance
//==============================================================================
const TONES = ['ember', 'gold', 'calm'];

/** L'annonce en cours, telle que le site l'affiche ; null s'il n'y en a pas (ou plus : elle a une date de fin). */
export function announcementView() {
  const a = setting('announcement', null);
  if (!a?.active || !a.text || (a.endsAt && a.endsAt < now())) return null;
  return { id: a.id, text: a.text, link: a.link || null, linkLabel: a.linkLabel || null, tone: a.tone };
}

/** Le mode maintenance : le site public est remplacé par une page d'attente, l'équipe garde l'accès. */
export function maintenanceView() {
  const m = setting('maintenance', null);
  return m?.on ? { on: true, message: m.message || '' } : null;
}

/** Une adresse affichée sur le site : sur le site lui-même (/boutique.html…) ou en https. */
function siteLink(value) {
  const text = str(value, 300);
  if (!text) return '';
  if (/^\/[^/\\]/.test(text) || /^[a-z0-9-]+\.html([?#].*)?$/i.test(text)) return text;
  try {
    const url = new URL(text);
    if (url.protocol === 'https:') return url.href;
  } catch { /* plus bas */ }
  throw new HttpError(400, 'Lien invalide : une page du site (boutique.html) ou une adresse en https://.');
}

//==============================================================================
//  Abonnements et packs
//==============================================================================
/** Les plugins choisis pour une formule ou un pack : des plugins ONIRIQUE (les partenaires vendent à l'unité). */
function onirique(ids, { required = false } = {}) {
  const list = [...new Set((Array.isArray(ids) ? ids : []).map((id) => int(id, 0)).filter(Boolean))];
  if (required && list.length < 2) throw new HttpError(400, 'Un pack réunit au moins deux plugins.');
  for (const id of list) {
    const p = get('SELECT name, creator FROM products WHERE id = ?', id);
    if (!p) throw new HttpError(404, 'Plugin introuvable.');
    if (p.creator !== 'onirique') throw new HttpError(400, `${p.name} est vendu par son créateur : il ne peut pas entrer dans une formule ONIRIQUE.`);
  }
  return list;
}

export const planView = (p) => ({
  id: p.id, name: p.name, interval: p.interval, priceCents: p.price_cents, active: !!p.active, kind: p.kind,
  description: p.description || '', productIds: parseProductIds(p.product_ids),
});

export const packView = (p) => ({
  id: p.id, name: p.name, description: p.description, priceCents: p.price_cents, active: !!p.active,
  productIds: parseProductIds(p.product_ids) || [],
});

function price(value) {
  const cents = int(value);
  if (cents === null || cents < 0 || cents > 10_000_00) throw new HttpError(400, 'Prix invalide.');
  return cents;
}

//==============================================================================
//  Routes du panel
//==============================================================================
export function mountControl(admin) {
  const staff = (req) => { if (!isStaff(req.user)) throw new HttpError(403, "Réservé à l'équipe."); };

  admin.get('/live', (req, res) => {
    staff(req);
    res.json({ announcement: setting('announcement', null), maintenance: setting('maintenance', { on: false, message: '' }) });
  });

  admin.put('/live/announcement', (req, res) => {
    staff(req);
    const b = req.body || {};
    const text = str(b.text, 220);
    if (b.active && !text) throw new HttpError(400, "Écrivez le texte de l'annonce.");
    const endsAt = b.endsAt ? Date.parse(b.endsAt) : null;
    if (b.endsAt && !Number.isFinite(endsAt)) throw new HttpError(400, 'Date de fin invalide.');
    const before = setting('announcement', null);
    const next = {
      // Un nouveau texte reçoit un nouveau numéro : il réapparaît chez ceux qui avaient fermé le précédent.
      id: before && before.text === text ? before.id : crypto.randomBytes(4).toString('hex'),
      active: !!b.active, text, link: siteLink(b.link), linkLabel: str(b.linkLabel, 40),
      tone: TONES.includes(b.tone) ? b.tone : 'ember', endsAt,
    };
    setSetting('announcement', next);
    res.json(next);
  });

  admin.put('/live/maintenance', (req, res) => {
    staff(req);
    const next = { on: !!req.body?.on, message: str(req.body?.message, 400), since: req.body?.on ? now() : null };
    setSetting('maintenance', next);
    res.json(next);
  });

  // Abonnements : une nouvelle formule, ou le texte, le prix et les plugins d'une formule existante.
  admin.post('/plans', (req, res) => {
    staff(req);
    const b = req.body || {};
    const name = str(b.name, 60);
    if (!name) throw new HttpError(400, 'Donnez un nom à la formule.');
    if (!['month', 'year'].includes(b.interval)) throw new HttpError(400, 'Période invalide.');
    const ids = onirique(b.productIds);
    const { lastInsertRowid } = run(`INSERT INTO plans (name, interval, price_cents, active, kind, description, product_ids) VALUES (?, ?, ?, ?, 'all', ?, ?)`,
      name, b.interval, price(b.priceCents), b.active === false ? 0 : 1, str(b.description, 600), ids.length ? JSON.stringify(ids) : null);
    res.status(201).json(planView(get('SELECT * FROM plans WHERE id = ?', lastInsertRowid)));
  });

  admin.patch('/plans/:id', (req, res) => {
    staff(req);
    const plan = get('SELECT * FROM plans WHERE id = ?', int(req.params.id, 0));
    if (!plan) throw new HttpError(404, 'Formule introuvable.');
    const b = req.body || {};
    const ids = b.productIds !== undefined ? onirique(b.productIds) : parseProductIds(plan.product_ids) || [];
    if (plan.kind === 'pick' && b.productIds !== undefined) throw new HttpError(400, "La formule à la carte laisse l'abonné choisir ses plugins.");
    run('UPDATE plans SET name = ?, price_cents = ?, active = ?, description = ?, product_ids = ? WHERE id = ?',
      b.name !== undefined ? str(b.name, 60) || plan.name : plan.name,
      b.priceCents !== undefined ? price(b.priceCents) : plan.price_cents,
      b.active !== undefined ? (b.active ? 1 : 0) : plan.active,
      b.description !== undefined ? str(b.description, 600) : plan.description,
      ids.length ? JSON.stringify(ids) : null, plan.id);
    res.json(planView(get('SELECT * FROM plans WHERE id = ?', plan.id)));
  });

  // Une formule n'est supprimée que si personne n'y a jamais souscrit ; sinon, on la retire de la boutique.
  admin.delete('/plans/:id', (req, res) => {
    staff(req);
    const plan = get('SELECT * FROM plans WHERE id = ?', int(req.params.id, 0));
    if (!plan) throw new HttpError(404, 'Formule introuvable.');
    if (plan.kind === 'pick') throw new HttpError(400, 'La formule à la carte se retire de la boutique, elle ne se supprime pas.');
    if (get('SELECT 1 AS yes FROM subscriptions WHERE plan_id = ?', plan.id)) {
      throw new HttpError(409, 'Des comptes ont souscrit à cette formule : décochez « Dans la boutique » pour ne plus la proposer.');
    }
    run('DELETE FROM plans WHERE id = ?', plan.id);
    res.json({ ok: true });
  });

  admin.get('/packs', (req, res) => { staff(req); res.json(all('SELECT * FROM packs ORDER BY created_at DESC').map(packView)); });

  admin.post('/packs', (req, res) => {
    staff(req);
    const b = req.body || {};
    const name = str(b.name, 60);
    if (!name) throw new HttpError(400, 'Donnez un nom au pack.');
    const ids = onirique(b.productIds, { required: true });
    const { lastInsertRowid } = run('INSERT INTO packs (name, description, price_cents, product_ids, active, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      name, str(b.description, 600), price(b.priceCents), JSON.stringify(ids), b.active === false ? 0 : 1, now());
    res.status(201).json(packView(get('SELECT * FROM packs WHERE id = ?', lastInsertRowid)));
  });

  admin.patch('/packs/:id', (req, res) => {
    staff(req);
    const pack = get('SELECT * FROM packs WHERE id = ?', int(req.params.id, 0));
    if (!pack) throw new HttpError(404, 'Pack introuvable.');
    const b = req.body || {};
    run('UPDATE packs SET name = ?, description = ?, price_cents = ?, product_ids = ?, active = ? WHERE id = ?',
      b.name !== undefined ? str(b.name, 60) || pack.name : pack.name,
      b.description !== undefined ? str(b.description, 600) : pack.description,
      b.priceCents !== undefined ? price(b.priceCents) : pack.price_cents,
      b.productIds !== undefined ? JSON.stringify(onirique(b.productIds, { required: true })) : pack.product_ids,
      b.active !== undefined ? (b.active ? 1 : 0) : pack.active, pack.id);
    res.json(packView(get('SELECT * FROM packs WHERE id = ?', pack.id)));
  });

  // Les licences déjà accordées par un pack restent : supprimer le pack ne retire rien aux acheteurs.
  admin.delete('/packs/:id', (req, res) => {
    staff(req);
    run('DELETE FROM packs WHERE id = ?', int(req.params.id, 0));
    res.json({ ok: true });
  });

  // Les fondateurs, pour choisir l'ingé d'un crédit.
  admin.get('/founders', (req, res) => {
    staff(req);
    res.json(all(`SELECT id, name, email, instagram, engineer_name FROM users WHERE role = 'founder' ORDER BY name, email`)
      .map((u) => ({ id: u.id, name: u.engineer_name || u.name || u.email.split('@')[0], alias: !!u.engineer_name, instagram: u.instagram || '' })));
  });

  // Suppression d'un compte, après avoir tapé SUPPRIME. Ses licences sont révoquées (une clé ne revit pas sur un autre
  // compte), ses machines, sessions et abonnement disparaissent avec lui. Un abonnement payant doit être résilié avant.
  admin.delete('/users/:id', (req, res) => {
    staff(req);
    if (str(req.body?.confirm, 20) !== 'SUPPRIME') throw new HttpError(400, 'Tapez SUPPRIME pour confirmer.');
    const user = get('SELECT * FROM users WHERE id = ?', int(req.params.id, 0));
    if (!user) throw new HttpError(404, 'Compte introuvable.');
    if (user.id === req.user.id) throw new HttpError(400, 'Vous ne pouvez pas supprimer votre propre compte ici.');
    if (user.role === 'founder') throw new HttpError(403, "Un compte fondateur ne se supprime pas : retirez-lui d'abord ce rôle.");
    if (isStaff(user) && req.user.role !== 'founder') throw new HttpError(403, 'Seul un fondateur peut supprimer un compte admin.');
    const sub = get(`SELECT * FROM subscriptions WHERE user_id = ? AND status = 'active' AND current_period_end > ?`, user.id, now());
    if (sub?.stripe_subscription && !sub.cancel_at_period_end) {
      throw new HttpError(409, 'Ce compte a un abonnement payant en cours : résiliez-le dans Stripe avant de supprimer le compte.');
    }
    transaction(() => {
      run(`UPDATE licenses SET status = 'revoked', note = CASE WHEN note = '' THEN 'Compte supprimé' ELSE note || ' · compte supprimé' END WHERE user_id = ?`, user.id);
      run('DELETE FROM users WHERE id = ?', user.id);
    });
    if (user.avatar) fs.rmSync(path.join(config.mediaDir, user.avatar), { force: true });
    console.log(`Compte supprimé : #${user.id} par #${req.user.id}`);
    res.json({ ok: true });
  });
}
