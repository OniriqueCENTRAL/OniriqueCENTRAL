// Le pop-up d'invitation : reçoit l'invitation de l'application et lui renvoie la réponse.
const $ = (id) => document.getElementById(id);
window.oniriqueInvite.onShow((x) => {
  $("who").textContent = x.says;
  $("what").textContent = "« " + x.name + " »";
  $("avatar").src = x.avatar || "assets/sigil.png";
  for (const [k, v] of Object.entries(x.accent || {})) document.documentElement.style.setProperty(k, v);
  const box = document.querySelector(".invite");
  box.style.animation = "none"; void box.offsetWidth; box.style.animation = ""; // l'entrée rejouée à chaque invitation
});
$("no").onclick = () => window.oniriqueInvite.answer(false);
$("yes").onclick = () => window.oniriqueInvite.answer(true);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") window.oniriqueInvite.answer(false); });
