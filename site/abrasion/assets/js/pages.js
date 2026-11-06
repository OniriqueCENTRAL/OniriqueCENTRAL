/* ==========================================================================
   abrasion — les pages de service : textes légaux, support, compte.
   Tout passe par ONIRIQUE (mêmes comptes, mêmes licences, même support) ; seule
   la mise en page change. Les textes légaux sont lus sur leur page ONIRIQUE :
   une seule version à tenir, ici à la DA d'abrasion.
   ========================================================================== */
(() => {
"use strict";
const doc = document, page = doc.body.dataset.page;
const $ = (s, r = doc) => r.querySelector(s);
const $$ = (s, r = doc) => Array.from(r.querySelectorAll(s));
const el = (tag, props = {}, ...kids) => { const n = Object.assign(doc.createElement(tag), props); n.append(...kids.filter((k) => k != null && k !== false)); return n; };
const TOKEN = "onirique.token";
const token = () => { try { return sessionStorage.getItem(TOKEN) || localStorage.getItem(TOKEN); } catch (e) { return null; } };
const forget = () => { try { sessionStorage.removeItem(TOKEN); localStorage.removeItem(TOKEN); } catch (e) {} };
async function api(method, path, body) {
  const t = token();
  const r = await fetch("/api" + path, { method, headers: { ...(t ? { Authorization: "Bearer " + t } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined }).catch(() => { throw new Error("Serveur injoignable. Réessaie dans un instant."); });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error || "Erreur " + r.status + "."), { status: r.status, data });
  return data;
}
// Les plugins abrasion du catalogue ONIRIQUE (créateur « abrasion ») : leur nom court, comme sur les fiches.
const short = (name) => String(name || "").toUpperCase().replace(/^ONIRIQUE\s*[X×]\s*/, "").replace(/^ABRASION\s*(LABS\s*)?/, "").trim();
const NAMES = ["RAW", "RAW 2", "OMNIS"];
const catalog = () => fetch("/api/catalog").then((r) => (r.ok ? r.json() : null)).catch(() => null);

/* ---------------------------------------------------------------- textes légaux */
// Les pages qui ont leur version abrasion : un lien vers l'une d'elles reste dans abrasion.
const HERE = ["mentions-legales", "cgv", "remboursement", "confidentialite", "cookies", "support"];
function keepInside(root) {
  $$("a[href]", root).forEach((a) => {
    let u; try { u = new URL(a.getAttribute("href"), location.origin + "/"); } catch (e) { return; }
    if (u.origin !== location.origin) { a.target = "_blank"; a.rel = "noopener"; return; }
    const name = u.pathname.replace(/^\/+/, "").replace(/\.html$/, "");
    if (HERE.includes(name)) a.href = "/abrasion/" + name + u.search + u.hash;
    else if (name === "compte") a.href = "/abrasion/compte" + u.hash;
    else a.href = u.pathname + u.search + u.hash; // une autre page ONIRIQUE : depuis la racine du site
  });
}
async function legal() {
  const out = $(".ab-doc"), toc = $(".ab-toc ol");
  try {
    const html = await fetch("/" + page).then((r) => (r.ok ? r.text() : Promise.reject(new Error(r.status))));
    const src = new DOMParser().parseFromString(html, "text/html").querySelector("main");
    if (!src) throw new Error("vide");
    $$("script, style, form, button, .eyebrow", src).forEach((n) => n.remove());
    keepInside(src);
    // Un tableau large défile dans sa boîte, au lieu d'élargir la page sur téléphone.
    $$("table", src).forEach((t) => { const box = el("div", { className: "ab-tablewrap" }); t.replaceWith(box); box.append(t); });
    // Le haut (titre, date, introduction), puis une section par titre de niveau 2.
    const head = el("section"), sections = [head];
    for (const node of Array.from(src.children)) {
      if (node.tagName === "H1") { head.append(el("p", { className: "meta", textContent: "abrasion · infos légales" }), node); continue; }
      if (node.classList.contains("updated")) { node.className = "meta"; head.append(node); continue; }
      if (node.tagName === "H2") sections.push(el("section"));
      sections[sections.length - 1].append(node);
    }
    out.replaceChildren(...sections.filter((s) => s.childElementCount));
    if (!$("h1", out)) out.prepend(el("h1", { textContent: doc.title.split(" · ")[0] }));
    // Le sommaire, et sa ligne allumée pendant la lecture.
    const titles = $$("section > h2", out);
    titles.forEach((h, i) => { if (!h.id) h.id = "s" + (i + 1); });
    if (toc) {
      toc.replaceChildren(...titles.map((h) => el("li", {}, el("a", { href: "#" + h.id, textContent: h.textContent.replace(/^\d+\.\s*/, "") }))));
      const links = $$("a", toc), mark = (id) => links.forEach((a) => a.setAttribute("aria-current", String(a.hash === "#" + id)));
      const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) mark(e.target.id); }), { rootMargin: "-25% 0px -65% 0px" });
      titles.forEach((h) => io.observe(h));
      if (!titles.length) toc.closest(".ab-toc").hidden = true;
    }
    if (location.hash) { const t = doc.getElementById(location.hash.slice(1)); if (t) t.scrollIntoView(); }
  } catch (e) {
    out.replaceChildren(el("section", {}, el("h1", { textContent: doc.title.split(" · ")[0] }),
      el("p", {}, "Le texte ne se charge pas pour l’instant. Il est aussi sur ", el("a", { href: "/" + page, textContent: "onirique.store/" + page }), ".")));
    const t = $(".ab-toc"); if (t) t.hidden = true;
  }
}

/* ---------------------------------------------------------------- support */
async function support() {
  const form = $("#ab-support"), err = $(".ab-formerr", form), done = $("#ab-sent");
  let account = null;
  if (token()) {
    try { account = (await api("GET", "/me")).user; } catch (e) { account = null; }
    if (account) { $("#f-identity").hidden = true; form.elements.email.required = false;
      const as = $("#f-as"); as.textContent = "Tu écris en tant que " + account.email + ". La réponse arrivera à cette adresse."; as.hidden = false; }
  }
  // Le plugin concerné : ceux d'abrasion, même avant leur mise en vente.
  const list = form.elements.product, names = new Set(NAMES);
  const cat = await catalog();
  for (const p of (cat && cat.products) || []) if (p.creator === "abrasion") names.add(short(p.name));
  for (const n of names) list.append(el("option", { value: n, textContent: n }));
  const pre = new URLSearchParams(location.search).get("plugin");
  if (pre && names.has(pre.toUpperCase())) list.value = pre.toUpperCase();
  form.addEventListener("submit", async (e) => {
    e.preventDefault(); err.textContent = "";
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const send = $("button[type=submit]", form); send.disabled = true;
    const email = account ? account.email : form.elements.email.value.trim();
    try {
      await api("POST", "/support", { email, name: form.elements.name.value.trim(), subject: form.elements.subject.value.trim(), message: form.elements.message.value.trim(),
        context: ["abrasion", list.value].filter(Boolean).join(" · "), website: form.elements.website.value });
      $("#ab-sent-email").textContent = email; form.hidden = true; done.hidden = false; $("h2", done).focus();
    } catch (error) { err.textContent = error.message; send.disabled = false; }
  });
}

/* ---------------------------------------------------------------- compte */
function next() {
  const n = new URLSearchParams(location.search).get("next") || "";
  return /^\/abrasion\/[\w.-]*$/.test(n) && n !== "/abrasion/compte" ? n : null;
}
async function account() {
  const auth = $("#ab-auth"), me = $("#ab-me"), form = $("#ab-login"), err = $(".ab-formerr", form), note = $(".ab-formnote", form);
  let mode = "login";
  const setMode = (m, msg) => {
    mode = m;
    $$("[data-mode]", auth).forEach((b) => b.setAttribute("aria-selected", String(b.dataset.mode === m)));
    $("#f-name").hidden = m !== "register"; form.elements.name.required = m === "register";
    $("#f-pass").hidden = m === "forgot"; form.elements.password.required = m !== "forgot";
    form.elements.password.autocomplete = m === "register" ? "new-password" : "current-password";
    form.elements.password.minLength = m === "register" ? 8 : 1;
    $("#f-pass-l").textContent = m === "register" ? "Mot de passe (8 caractères minimum)" : "Mot de passe";
    $("#f-legal").hidden = m !== "register"; form.elements.terms.required = m === "register"; // comme sur ONIRIQUE : CGU acceptées pour créer un compte
    $("#f-code").hidden = true; form.elements.code.value = "";
    $("#f-forgot").hidden = m !== "login";
    $("button[type=submit]", form).textContent = m === "register" ? "Créer mon compte" : m === "forgot" ? "Recevoir le lien" : "Se connecter";
    err.textContent = ""; note.textContent = msg || "";
  };
  $$("[data-mode]", auth).forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));
  $("#f-forgot").addEventListener("click", () => setMode("forgot", "Indique l’e-mail de ton compte : un lien arrive pour choisir un nouveau mot de passe."));
  form.addEventListener("submit", async (e) => {
    e.preventDefault(); err.textContent = "";
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const send = $("button[type=submit]", form); send.disabled = true;
    const body = { email: form.elements.email.value.trim(), password: form.elements.password.value, name: form.elements.name.value.trim(),
      ...(!$("#f-code").hidden ? { code: form.elements.code.value.trim() } : {}) };
    try {
      if (mode === "forgot") { await api("POST", "/auth/forgot", { email: body.email }); setMode("login", "Si un compte existe avec cette adresse, un lien vient d’être envoyé. Il est valable une heure."); }
      else {
        const { token: t } = await api("POST", mode === "register" ? "/auth/register" : "/auth/login", body);
        forget(); (form.elements.remember.checked ? localStorage : sessionStorage).setItem(TOKEN, t);
        form.elements.password.value = "";
        if (next()) { location.href = next(); return; }
        await show();
      }
    } catch (error) {
      err.textContent = error.message;
      // Double authentification : le mot de passe est juste, le code est demandé.
      if (error.data && error.data.twoFactor) { $("#f-code").hidden = false; form.elements.code.focus(); }
    }
    send.disabled = false;
  });
  $("#ab-logout").addEventListener("click", async () => {
    await fetch("/api/auth/logout", { method: "POST", headers: { Authorization: "Bearer " + token() } }).catch(() => {});
    forget(); location.reload();
  });

  async function show() {
    let data = null;
    if (token()) { try { data = await api("GET", "/me"); } catch (e) { if (e.status === 401) forget(); } }
    auth.hidden = !!data; me.hidden = !data;
    if (!data) return;
    const u = data.user;
    $("#ab-hello").textContent = u.name || u.email;
    $("#ab-email").textContent = u.email;
    $("#ab-verify").hidden = u.emailVerified !== false;
    // Les licences des plugins abrasion (le reste du compte ONIRIQUE est sur sa page).
    const cat = await catalog(), ours = new Set();
    for (const p of (cat && cat.products) || []) if (p.creator === "abrasion") ours.add(p.id);
    const mine = (data.licenses || []).filter((l) => ours.has(l.productId) || NAMES.includes(short(l.productName)));
    const list = $("#ab-licences");
    if (!mine.length) { list.replaceChildren(el("p", { className: "ab-p", textContent: "Aucun plugin abrasion sur ce compte pour l’instant." }),
      el("a", { className: "ab-btn ghost sm mt-s", href: "/abrasion/plugins", textContent: "Voir les plugins" })); return; }
    list.replaceChildren(...mine.map((l) => {
      const expired = l.expiresAt && l.expiresAt < Date.now(), on = l.status === "active" && !expired;
      return el("li", {},
        el("span", { className: "k", textContent: short(l.productName) || l.productName }),
        el("code", { textContent: l.key }),
        el("span", { className: "st" + (on ? " on" : ""), textContent: l.status !== "active" ? "révoquée" : expired ? "expirée" : "active" }));
    }));
  }
  const p = new URLSearchParams(location.search);
  if (p.get("mode") === "register") setMode("register"); else setMode("login");
  await show();
}

if (["mentions-legales", "cgv", "remboursement", "confidentialite", "cookies"].includes(page)) legal();
else if (page === "support") support();
else if (page === "compte") account();
})();
