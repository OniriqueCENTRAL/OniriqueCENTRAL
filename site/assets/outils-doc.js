// Fonctions partagées par les pages Presskit et Devis.
// Le brouillon reste dans le navigateur de l'artiste ; seul ce qu'il envoie (mail, devis à signer) passe par le serveur.
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
  //---------------------------------------------------------------------------- Compte et boîte mail
  token() { try { return sessionStorage.getItem("onirique.token") || localStorage.getItem("onirique.token"); } catch { return null; } },
  async api(method, path, body) {
    const response = await fetch("/api" + path, {
      method,
      headers: { ...(Outils.token() ? { Authorization: "Bearer " + Outils.token() } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    }).catch(() => { throw new Error("Serveur injoignable. Réessaie dans un instant."); });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Erreur " + response.status);
    return data;
  },

  // La boîte mail d'où partent les envois : la même que pour les mails des packs (Mes sons). onChange(boîte ou null).
  async mailbox(box, back, onChange) {
    const { esc } = Outils;
    const google = new URLSearchParams(location.search).get("google");
    if (google) {
      history.replaceState(null, "", location.pathname);
      if (google !== "ok") alert(google);
    }
    if (!Outils.token()) {
      box.innerHTML = `<p class="hint">Pour envoyer depuis ta boîte mail, <a href="compte.html">connecte-toi à ton compte ONIRIQUE</a> (gratuit).</p>`;
      return onChange(null);
    }
    let m;
    try { m = await Outils.api("GET", "/me/sounds/mailer"); } catch (error) { box.innerHTML = `<p class="hint">${esc(error.message)}</p>`; return onChange(null); }
    const redraw = (next) => { m = next; draw(); };
    function draw() {
      if (m.connected) {
        box.innerHTML = `<p class="hint">Part de <strong>${esc(m.fromEmail)}</strong>${m.google ? " (Gmail)" : ""}. <button type="button" class="linkish" data-off>Déconnecter</button></p>`;
        box.querySelector("[data-off]").onclick = () => Outils.api("DELETE", "/me/sounds/mailer").then(redraw, (e) => alert(e.message));
        return onChange(m);
      }
      box.innerHTML = `
        ${m.googleReady ? `<button type="button" class="go ghost" data-google>Relier mon Gmail</button>` : ""}
        <details>
          <summary>${m.googleReady ? "Ou avec un mot de passe d'application Gmail" : "Relier mon Gmail (mot de passe d'application)"}</summary>
          <p class="hint">Dans ton compte Google : Sécurité → Validation en deux étapes → Mots de passe des applications. Colle ici le code de 16 lettres, pas ton mot de passe habituel.</p>
          <label>Adresse Gmail<input type="email" data-login autocomplete="off" placeholder="ton.adresse@gmail.com"></label>
          <label>Mot de passe d'application<input type="password" data-pass autocomplete="new-password"></label>
          <label>Nom de l'expéditeur<input data-name maxlength="80"></label>
          <button type="button" class="go ghost" data-smtp>Relier</button>
        </details>`;
      const q = (k) => box.querySelector(`[data-${k}]`);
      if (q("google")) q("google").onclick = async () => {
        q("google").disabled = true;
        try { location.href = (await Outils.api("POST", "/me/sounds/mailer/google", { back })).url; } catch (e) { alert(e.message); q("google").disabled = false; }
      };
      q("smtp").onclick = async () => {
        q("smtp").disabled = true;
        try { redraw(await Outils.api("PUT", "/me/sounds/mailer", { host: "smtp.gmail.com", port: 465, login: q("login").value.trim(), password: q("pass").value.replace(/\s/g, ""), fromName: q("name").value })); }
        catch (e) { alert(e.message); q("smtp").disabled = false; }
      };
      onChange(null);
    }
    draw();
  },

  //---------------------------------------------------------------------------- PDF sans impression
  // Les règles de style de la page, polices comprises (en data:, sinon l'image du document ne les voit pas).
  async css() {
    if (Outils._css) return Outils._css;
    const toData = (url) => fetch(url).then((r) => r.blob()).then((b) => new Promise((ok) => { const f = new FileReader(); f.onload = () => ok(f.result); f.readAsDataURL(b); }));
    let out = "";
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch { continue; }
      for (const rule of rules) {
        let text = rule.cssText;
        if (rule instanceof CSSFontFaceRule) {
          const url = /url\("?([^")]+)"?\)/.exec(text)?.[1];
          if (!url || /-ext\./.test(url)) continue; // le jeu latin suffit au document
          text = text.replace(/url\([^)]*\)/, `url("${await toData(new URL(url, sheet.href || location.href))}")`);
        }
        out += text + "\n";
      }
    }
    return (Outils._css = out);
  },

  // Le document dessiné en image (largeur A4), puis mis dans un PDF d'une page à sa hauteur.
  // shortcut: une seule page, aussi haute que le document ; à découper en pages A4 si un document devient très long.
  async pdf(el) {
    const W = 794, scale = 2;
    const clone = el.cloneNode(true);
    Object.assign(clone.style, { width: W + "px", maxWidth: "none", margin: "0", boxShadow: "none", borderRadius: "0" });
    const probe = clone.cloneNode(true);
    Object.assign(probe.style, { position: "absolute", left: "-10000px", top: "0" });
    document.body.append(probe);
    const H = Math.ceil(probe.getBoundingClientRect().height);
    probe.remove();
    const css = (await Outils.css()).replace(/&/g, "&amp;").replace(/</g, "&lt;");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><foreignObject width="100%" height="100%">`
      + `<div xmlns="http://www.w3.org/1999/xhtml"><style>${css}</style>${new XMLSerializer().serializeToString(clone)}</div></foreignObject></svg>`;
    const img = new Image();
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    await img.decode();
    const canvas = Object.assign(document.createElement("canvas"), { width: W * scale, height: H * scale });
    const ctx = canvas.getContext("2d");
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, W, H);
    const jpeg = new Uint8Array(await (await new Promise((ok) => canvas.toBlob(ok, "image/jpeg", 0.88))).arrayBuffer());
    return Outils.imagePdf(jpeg, canvas.width, canvas.height);
  },
  imagePdf(jpeg, w, h) {
    const pw = 595.28, ph = +(pw * h / w).toFixed(2), draw = `q ${pw} 0 0 ${ph} 0 0 cm /I Do Q`;
    const parts = [], offsets = [];
    let length = 0; // tout est en ASCII hors l'image : une longueur de texte est une longueur en octets
    const push = (x) => { parts.push(x); length += x.length; };
    const obj = (n, dict, stream) => {
      offsets[n] = length;
      push(`${n} 0 obj\n${dict}\n`);
      if (stream) { push("stream\n"); push(stream); push("\nendstream\n"); }
      push("endobj\n");
    };
    push("%PDF-1.4\n");
    obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
    obj(2, "<< /Type /Pages /Count 1 /Kids [3 0 R] >>");
    obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /I 4 0 R >> >> /Contents 5 0 R >>`);
    obj(4, `<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>`, jpeg);
    obj(5, `<< /Length ${draw.length} >>`, draw);
    push(`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`);
    return new Blob(parts, { type: "application/pdf" });
  },
  base64(blob) {
    return new Promise((ok) => { const f = new FileReader(); f.onload = () => ok(String(f.result).split(",")[1]); f.readAsDataURL(blob); });
  },

  //---------------------------------------------------------------------------- Signature au doigt ou à la souris
  signPad(canvas) {
    const ctx = canvas.getContext("2d");
    let drawn = false, last = null;
    const at = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const reset = () => {
      const r = canvas.getBoundingClientRect();
      canvas.width = r.width * 2; canvas.height = r.height * 2;
      ctx.setTransform(2, 0, 0, 2, 0, 0);
      Object.assign(ctx, { lineWidth: 2.4, lineCap: "round", lineJoin: "round", strokeStyle: "#111", fillStyle: "#111" });
      drawn = false;
    };
    canvas.addEventListener("pointerdown", (e) => {
      canvas.setPointerCapture(e.pointerId);
      last = at(e);
      ctx.beginPath(); ctx.arc(last[0], last[1], 1.2, 0, 7); ctx.fill();
      drawn = true;
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!last) return;
      const p = at(e);
      ctx.beginPath(); ctx.moveTo(...last); ctx.lineTo(...p); ctx.stroke();
      last = p;
    });
    for (const type of ["pointerup", "pointercancel"]) canvas.addEventListener(type, () => { last = null; });
    reset();
    return { empty: () => !drawn, clear: reset, png: () => canvas.toDataURL("image/png") };
  },
};
