// Le mini lecteur flottant : il montre le son de CLOUD qui continue sous une autre page et le pilote (lecture, pause,
// volume, retour à CLOUD). L'état arrive de l'application (main.js) toutes les secondes.
const $ = (id) => document.getElementById(id);
const PLAY = '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l12.5-7.5z" fill="currentColor"/></svg>';
const PAUSE = '<svg viewBox="0 0 24 24"><path d="M6.5 4.5h4v15h-4zM13.5 4.5h4v15h-4z" fill="currentColor"/></svg>';
let dragging = false;

window.oniriqueMini.onState((s) => {
  if (!s) return;
  $("title").textContent = s.title || "";
  $("sub").textContent = s.sub || "ONIRIQUE CLOUD";
  $("cover").hidden = !s.cover;
  $("cover-ph").hidden = !!s.cover;
  if (s.cover && $("cover").src !== s.cover) $("cover").src = s.cover;
  $("toggle").innerHTML = s.playing ? PAUSE : PLAY;
  $("toggle").setAttribute("aria-label", s.playing ? "Pause" : "Lecture");
  // Le lecteur intégré de Spotify garde son propre volume : le curseur n'a alors rien à régler.
  $("vol").disabled = s.volume == null;
  if (!dragging && s.volume != null) { $("vol").value = s.volume; $("vol").style.setProperty("--p", Math.round(s.volume * 100) + "%"); }
  if (s.accent) document.documentElement.style.setProperty("--acc", s.accent);
});
$("toggle").onclick = () => window.oniriqueMini.control("toggle");
$("open").onclick = () => window.oniriqueMini.control("open");
$("vol").addEventListener("pointerdown", () => { dragging = true; });
$("vol").addEventListener("pointerup", () => { dragging = false; });
$("vol").addEventListener("input", () => {
  $("vol").style.setProperty("--p", Math.round($("vol").value * 100) + "%");
  window.oniriqueMini.control("volume", Number($("vol").value));
});
