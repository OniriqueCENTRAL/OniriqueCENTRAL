// La langue du site (et de l'application ONIRIQUE CENTRAL, qui en a une copie) : français par défaut, anglais au choix.
//
// Le français reste le texte d'origine partout. En anglais, chaque texte affiché est remplacé par sa traduction, y
// compris ceux qui apparaissent plus tard (erreurs, notifications, listes chargées) : un dictionnaire français →
// anglais (i18n-en.js, fabriqué par tools/i18n/build.mjs), où {} marque une partie variable (un nombre, un nom).
// Un texte sans traduction reste en français. Dates et nombres passent au format anglais.
//
//   OniriqueI18n.lang          "fr" ou "en"
//   OniriqueI18n.set("en")     change de langue (retenue sur l'appareil ; la page se recharge)
//   OniriqueI18n.t("Texte")    la traduction d'un texte, pour du code qui en a besoin
//
// À charger en premier dans <head>, sans defer : en anglais, il charge le dictionnaire avant le reste de la page.
(() => {
  const KEY = "onirique.lang";
  const asked = new URLSearchParams(location.search).get("lang");
  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch { /* stockage fermé : français, ou ?lang=en */ }
  if (asked === "en" || asked === "fr") { saved = asked; try { localStorage.setItem(KEY, asked); } catch {} }
  const lang = saved === "en" ? "en" : "fr";
  const base = (document.currentScript && document.currentScript.src) ? document.currentScript.src.replace(/i18n\.js(\?.*)?$/, "") : "assets/";

  const api = {
    lang,
    set(next) {
      try { localStorage.setItem(KEY, next === "en" ? "en" : "fr"); } catch {}
      document.dispatchEvent(new CustomEvent("onirique:lang", { detail: next }));
      // L'application (qui refuse les navigations de sa page) se recharge elle-même.
      if (window.central && window.central.window) { window.central.window("reload"); return; }
      const url = new URL(location.href);
      url.searchParams.delete("lang");
      if (url.toString() === location.href) location.reload();
      else location.replace(url.toString());
    },
    t: (text) => text,
  };
  window.OniriqueI18n = api;
  document.documentElement.lang = lang;
  if (lang !== "en") return;

  // Le dictionnaire, chargé tout de suite (avant que la page ne s'affiche en français).
  const version = ((document.currentScript && document.currentScript.src) || "").match(/[?&]v=([\w]+)/);
  if (!window.ONIRIQUE_EN) document.write(`<script src="${base}i18n-en.js?v=${version ? version[1] : 1}"><\/script>`);

  // Dates et nombres : les formats français demandés par le code deviennent anglais.
  const swap = (locale) => (typeof locale === "string" && /^fr/i.test(locale) ? "en-GB" : Array.isArray(locale) ? locale.map(swap) : locale);
  for (const [proto, name] of [[Date.prototype, "toLocaleDateString"], [Date.prototype, "toLocaleString"], [Date.prototype, "toLocaleTimeString"], [Number.prototype, "toLocaleString"]]) {
    const original = proto[name];
    proto[name] = function (locale, options) { return original.call(this, swap(locale), options); };
  }
  for (const name of ["NumberFormat", "DateTimeFormat", "RelativeTimeFormat", "PluralRules", "ListFormat"]) {
    const Original = Intl[name];
    if (!Original) continue;
    const Wrapped = function (locale, options) { return new Original(swap(locale), options); };
    Wrapped.prototype = Original.prototype;
    Wrapped.supportedLocalesOf = Original.supportedLocalesOf;
    Intl[name] = Wrapped;
  }

  let exact = null, patterns = null, translated = null, blocks = null;
  const prepare = () => {
    if (exact) return true;
    const dict = window.ONIRIQUE_EN;
    if (!dict) return false;
    blocks = new Map(Object.entries(window.ONIRIQUE_EN_HTML || {}));
    exact = new Map();
    patterns = [];
    translated = new Set();
    for (const [fr, en] of Object.entries(dict)) {
      translated.add(en);
      if (fr.includes("{}")) {
        const source = "^" + fr.split("{}").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("([\\s\\S]*?)") + "$";
        patterns.push({ re: new RegExp(source), en, head: fr.split("{}")[0] });
      } else {
        exact.set(fr, en);
      }
    }
    // Les modèles les plus longs d'abord : le plus précis gagne.
    patterns.sort((a, b) => b.head.length - a.head.length);
    return true;
  };

  const fill = (template, values) => {
    let i = 0;
    return template.replace(/\{(\d*)\}/g, (_, n) => (n ? values[Number(n) - 1] : values[i++]) ?? "");
  };
  function translate(text) {
    if (!prepare()) return text;
    const key = text.replace(/\s+/g, " ").trim();
    if (!key || !/[a-zà-ÿ]/i.test(key) || translated.has(key)) return text;
    let en = exact.get(key);
    if (en === undefined) {
      for (const p of patterns) {
        if (p.head && !key.startsWith(p.head)) continue;
        const m = p.re.exec(key);
        if (m) { en = fill(p.en, m.slice(1).map((v) => translate(v))); break; }
      }
    }
    if (en === undefined) return text;
    // Les espaces autour du texte sont gardés (la mise en page en dépend parfois).
    const lead = text.match(/^\s*/)[0], trail = text.match(/\s*$/)[0];
    return lead + en + trail;
  }
  api.t = translate;

  // Une phrase coupée par une mise en forme (« Nos <em>plugins.</em> ») : remplacée d'un bloc, balises comprises.
  const BLOCK_TAGS = new Set(["H1", "H2", "H3", "H4", "H5", "H6", "P", "LI", "LABEL", "SPAN", "DIV", "TD", "TH", "SMALL", "A", "BUTTON", "DT", "DD", "FIGCAPTION", "LEGEND", "SUMMARY", "STRONG", "EM", "B"]);
  function translateBlock(el) {
    if (!blocks || !blocks.size || !BLOCK_TAGS.has(el.tagName) || !el.firstElementChild || el.childElementCount > 12) return false;
    const en = blocks.get(el.innerHTML.replace(/\s+/g, " ").trim());
    if (en === undefined) return false;
    el.innerHTML = en;
    return true;
  }

  const ATTRIBUTES = ["placeholder", "title", "aria-label", "alt", "data-tip", "aria-valuetext"];
  const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "CODE", "PRE"]);
  const skipped = (el) => el && (SKIP.has(el.tagName) || el.closest("[data-no-translate], [contenteditable='true']"));
  function translateNode(node) {
    if (node.nodeType === 3) {
      if (skipped(node.parentElement)) return;
      const next = translate(node.nodeValue);
      if (next !== node.nodeValue) node.nodeValue = next;
      return;
    }
    if (node.nodeType !== 1 || skipped(node)) return;
    translateBlock(node);
    for (const name of ATTRIBUTES) {
      const value = node.getAttribute(name);
      if (value) { const next = translate(value); if (next !== value) node.setAttribute(name, next); }
    }
    if (node.tagName === "INPUT" && /^(button|submit|reset)$/i.test(node.type) && node.value) node.value = translate(node.value);
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let current;
    while ((current = walker.nextNode())) {
      if (current.nodeType === 1) {
        if (skipped(current)) continue;
        translateBlock(current);
        for (const name of ATTRIBUTES) {
          const value = current.getAttribute(name);
          if (value) { const next = translate(value); if (next !== value) current.setAttribute(name, next); }
        }
        if (current.tagName === "INPUT" && /^(button|submit|reset)$/i.test(current.type) && current.value) current.value = translate(current.value);
      } else if (!skipped(current.parentElement)) {
        const next = translate(current.nodeValue);
        if (next !== current.nodeValue) current.nodeValue = next;
      }
    }
  }

  const start = () => {
    if (!prepare()) return;
    document.title = translate(document.title);
    translateNode(document.body);
    new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "characterData") translateNode(record.target);
        else if (record.type === "attributes") translateNode(record.target);
        else record.addedNodes.forEach(translateNode);
      }
      const title = translate(document.title);
      if (title !== document.title) document.title = title;
    }).observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRIBUTES });
    // Les boîtes de dialogue du navigateur aussi.
    for (const name of ["alert", "confirm", "prompt"]) {
      const original = window[name];
      window[name] = (message, ...rest) => original.call(window, translate(String(message ?? "")), ...rest);
    }
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
