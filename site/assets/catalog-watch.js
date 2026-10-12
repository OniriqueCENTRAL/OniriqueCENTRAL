// La boutique ouverte suit le catalogue : une fiche, une image ou une version changée sur le serveur (depuis
// l'application ou le panel admin) apparaît ici sans que le visiteur ait à recharger. La page n'est rechargée que si
// le catalogue a vraiment changé, et jamais pendant que le visiteur s'en sert.
(() => {
  let known = null;        // le catalogue tel que la page l'a affiché
  let lastTouch = Date.now();
  const read = () => fetch("/api/catalog", { cache: "no-store" }).then((r) => (r.ok ? r.text() : null)).catch(() => null);

  for (const type of ["pointerdown", "keydown", "wheel", "touchstart"]) {
    addEventListener(type, () => { lastTouch = Date.now(); }, { passive: true });
  }

  async function check() {
    if (document.hidden) return;
    const now = await read();
    if (now === null) return;
    if (known === null) { known = now; return; }
    if (now === known) return;
    const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName);
    if (typing || Date.now() - lastTouch < 30_000) return; // au passage suivant, une fois le visiteur au repos
    location.reload();
  }

  check();
  setInterval(check, 60_000);
  document.addEventListener("visibilitychange", check);
})();
