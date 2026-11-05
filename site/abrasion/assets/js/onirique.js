// ABRASION sur onirique.store : mêmes prix, mêmes comptes et même paiement que la boutique ONIRIQUE.
// Un plugin ABRASION est vendu s'il est au catalogue ONIRIQUE (créateur « abrasion ») sous le même nom.
(() => {
  const A = window.ABRASION; if (!A) return;
  const token = () => { try { return sessionStorage.getItem("onirique.token") || localStorage.getItem("onirique.token"); } catch { return null; } };
  const login = () => { location.href = "/compte?next=" + encodeURIComponent(location.pathname); };
  const short = (name) => name.toUpperCase().replace(/^ONIRIQUE\s*[X×]\s*/, "").replace(/^ABRASION\s*(LABS\s*)?/, "").trim();
  const sold = {}; // id du plugin ABRASION → son produit ONIRIQUE, quand il s'achète

  fetch("/api/catalog").then((r) => (r.ok ? r.json() : null)).then((catalog) => {
    if (!catalog) return;
    const open = catalog.paymentsMode !== "off" && (!catalog.sellers || catalog.sellers.includes("abrasion"));
    for (const p of catalog.products) {
      if (p.creator !== "abrasion") continue;
      const a = Object.values(A.products).find((x) => x.name === short(p.name));
      if (!a) continue;
      a.price = p.priceCents;
      if (open || !p.priceCents) sold[a.id] = p; // comme la boutique : un plugin gratuit se prend même vente fermée
    }
    A.fillPrices();
  }).catch(() => { /* catalogue injoignable : « Prix à venir » reste affiché */ });

  document.addEventListener("abrasion:buy", async (e) => {
    const product = sold[e.detail.plugin];
    if (!product) return; // pas encore en vente : la fenêtre affiche « Paiement bientôt disponible »
    e.preventDefault();
    if (!token()) return login();
    try {
      const r = await fetch("/api/checkout", { method: "POST", headers: { Authorization: "Bearer " + token(), "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "product", id: product.id }) });
      if (r.status === 401) return login();
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "Achat impossible.");
      if (data.url) location.href = data.url;
      else A.toast("C'est ajouté à ton compte. Installe le plugin depuis Onirique Central.");
    } catch (err) {
      A.toast(err.message || "Achat impossible.");
    }
  });
})();
