// Ce que la marketplace et ses fiches partagent : la liste de /api/marketplace et la carte d'un article.
(() => {
  const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids.filter((k) => k != null && k !== false && k !== "")); return n; };
  const euros = (cents) => (cents / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: cents % 100 ? 2 : 0 });
  const KIND = { visual: "Visuel", pack: "Prods" };
  // Les visuels sont des copies filigranées : ni glisser, ni menu « Enregistrer l'image ».
  const noSave = (img) => { img.draggable = false; img.oncontextmenu = (e) => e.preventDefault(); return img; };
  const sellerText = (x) => (x.seller.handle ? "@" + x.seller.handle : x.seller.name);
  const priceText = (x) => (x.from ? "dès " : "") + euros(x.price);
  const card = (x) => el("a", { className: "card", href: x.page },
    el("span", { className: "pic" }, x.image ? noSave(el("img", { src: x.image, alt: x.title, loading: "lazy" })) : null, el("span", { className: "kind", textContent: KIND[x.type] })),
    el("b", { textContent: x.title }),
    el("small", { textContent: sellerText(x) + (x.type === "pack" ? " · " + x.forSale + " prod" + (x.forSale > 1 ? "s" : "") + " en vente" : x.unique ? " · pièce unique" : "") }),
    el("span", { className: "price", textContent: priceText(x) }));
  let cache = null;
  const list = () => (cache ||= fetch("/api/marketplace").then((r) => (r.ok ? r.json() : Promise.reject(new Error()))));
  window.Market = { el, euros, KIND, noSave, card, list, priceText, sellerText };
})();
