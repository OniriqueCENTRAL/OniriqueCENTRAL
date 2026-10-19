// Les crédits ONIRIQUE (titres et albums réalisés avec les plugins) : une carte par titre, avec ses plugins, son ingé
// (pseudo et Instagram) et le lecteur Spotify, chargé seulement à la demande (aucun traceur avant ce clic).
//   OniriqueCredits.render(élément, liste)        la liste de /api/credits, déjà rangée du plus connu au moins connu
window.OniriqueCredits = {
  render(root, list) {
    const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    // pochettes gardées par le serveur : la version WebP à la largeur voulue (voir /api/media?w=)
    const sized = (url, w) => /^\/api\/media\/[a-f0-9]{32}\.(png|jpg|webp)$/.test(url || "") ? url + "?w=" + w : url;
    // Les ingés du titre (plusieurs possibles) ; une ancienne réponse n'en donne qu'un.
    const engineers = (c) => c.engineers || (c.engineer ? [c.engineer] : []);
    const person = (e) => {
      const face = e.avatar ? `<img src="${esc(e.avatar)}" alt="" width="26" height="26" loading="lazy">` : "";
      return e.instagram
        ? `<a href="${esc(e.instagram)}" target="_blank" rel="noopener">${face}<b>${esc(e.name)}</b><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="4.2" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="17.4" cy="6.6" r="1.2" fill="currentColor"/></svg></a>`
        : `<span>${face}<b>${esc(e.name)}</b></span>`;
    };

  root.innerHTML = list.map(c => `
    <article class="credit reveal" style="--cover-img: ${c.cover ? `url('${esc(sized(c.cover, 160))}')` : "none"}">
      <div class="cover"><span>${esc(c.title.slice(0, 2))}</span>${c.cover ? `<img src="${esc(sized(c.cover, 640))}" alt="Pochette de ${esc(c.title)} par ${esc(c.artist)}" loading="lazy" onerror="this.remove()">` : ""}</div>
      <div class="credit-info">
        <span class="credit-kind">${esc(c.kind)}${c.released ? " · " + esc(String(c.released).slice(-4)) : ""}</span>
        <h3 class="credit-title">${esc(c.title)}</h3>
        <p class="credit-artist">${esc(c.artist)}</p>
        <dl class="credit-meta">
          ${c.released ? `<div><dt>Sortie</dt><dd>${esc(c.released)}</dd></div>` : ""}
          ${c.duration ? `<div><dt>Durée</dt><dd>${esc(c.duration)}</dd></div>` : ""}
          <div><dt>Format</dt><dd>${esc(c.kind)}</dd></div>
        </dl>
        <div class="plugins-used">${(c.plugins && c.plugins.length ? c.plugins : c.plugin ? [c.plugin] : [{ name: "Onirique VocalBox" }]).map((p, i) => `<a class="plugin-used" href="${p.slug ? "boutique.html?p=" + encodeURIComponent(p.slug) : "#vocalbox"}"><img src="assets/logo-small.webp?v=1" alt="" width="160" height="145"><span><b>${esc(p.name)}</b>${i === 0 && c.usedOn ? `<small>Utilisé sur : ${esc(c.usedOn)}</small>` : ""}</span></a>`).join("")}</div>
        ${engineers(c).length ? `<p class="credit-engineer">Par ${engineers(c).map(person).join('<span class="credit-and">&amp;</span>')}</p>` : ""}
      </div>
      <div class="credit-player">
        <div class="embed${c.spotifyType === "album" ? " album" : ""}"><button type="button" class="embed-load" data-spotify="${esc(c.spotifyId)}" data-type="${c.spotifyType === "album" ? "album" : "track"}" data-title="${esc(c.title)}">Charger le lecteur Spotify<small>Spotify déposera alors ses propres cookies. <a href="cookies.html">En savoir plus</a></small></button></div>
        <div class="open-links">${c.appleMusic ? `<a class="open-link" href="${esc(c.appleMusic)}" target="_blank" rel="noopener">Écouter sur Apple Music ↗</a>` : ""}<a class="open-link" href="https://open.spotify.com/${c.spotifyType === "album" ? "album" : "track"}/${esc(c.spotifyId)}" target="_blank" rel="noopener">${c.spotifyType === "album" ? "Écouter l'album sur Spotify ↗" : "Écouter en entier sur Spotify ↗"}</a></div>
      </div>
    </article>`).join("");
  
  // Le lecteur Spotify n'est inséré qu'à la demande : aucun traceur tiers avant ce clic.
  root.querySelectorAll(".embed-load").forEach(button => button.addEventListener("click", event => {
    if (event.target.closest("a")) return;
    const frame = document.createElement("iframe");
    frame.title = "Extrait de " + button.dataset.title + " sur Spotify";
    frame.src = "https://open.spotify.com/embed/" + (button.dataset.type === "album" ? "album" : "track") + "/" + encodeURIComponent(button.dataset.spotify) + "?theme=0";
    frame.allow = "autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture";
    button.replaceWith(frame);
  }));
  
  },
};
