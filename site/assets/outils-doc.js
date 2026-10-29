// Fonctions partagées par les pages Presskit et Devis.
// Le brouillon reste dans le navigateur de l'artiste : rien n'est envoyé.
const Outils = {
  load(key, defaults) {
    try { return { ...defaults, ...JSON.parse(localStorage.getItem(key) || "{}") }; }
    catch { return structuredClone(defaults); }
  },
  save(key, state) {
    try { localStorage.setItem(key, JSON.stringify(state)); return true; }
    catch { return false; }
  },
  clear(key) { try { localStorage.removeItem(key); } catch {} },

  esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  },
  lines(text) { return String(text ?? "").split("\n").map((l) => l.trim()).filter(Boolean); },
  // Seuls les liens web sont acceptés (pas de « javascript: » glissé dans un champ).
  url(text) { const s = String(text).trim(); return /^https?:\/\//i.test(s) ? s : "https://" + s.replace(/^[a-z]+:/i, ""); },
  // « Titre — détail » → ["Titre", "détail"]
  split(line) { const m = /^(.*?)\s+[—–-]\s+(.+)$/.exec(line); return m ? [m[1], m[2]] : [line, ""]; },

  // Réduit l'image pour que le brouillon tienne dans le stockage du navigateur.
  readImage(file, max, type = "image/jpeg") {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(img.src);
        resolve(canvas.toDataURL(type, 0.85));
      };
      img.onerror = () => reject(new Error("Image illisible"));
      img.src = URL.createObjectURL(file);
    });
  },

  // Remplit le formulaire depuis l'état, puis garde l'état à jour à chaque saisie.
  bindForm(form, state, onChange) {
    for (const el of form.elements) {
      if (!el.name || el.type === "file" || el.closest("[data-rows]")) continue;
      if (el.type === "checkbox") el.checked = !!state[el.name];
      else if (el.type === "radio") el.checked = state[el.name] === el.value;
      else el.value = state[el.name] ?? "";
    }
    form.addEventListener("input", (e) => {
      const el = e.target;
      if (!el.name || el.type === "file" || el.closest("[data-rows]")) return;
      state[el.name] = el.type === "checkbox" ? el.checked : el.value;
      onChange(el.name);
    });
    form.addEventListener("submit", (e) => e.preventDefault());
  },
};
