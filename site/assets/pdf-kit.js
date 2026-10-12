// Écrire un document PDF dans le navigateur : du texte, des tableaux, des cases à cocher, sur des pages A4.
// Rien n'est envoyé : le fichier est fabriqué sur l'appareil, puis proposé au téléchargement.
//
//   const doc = OniriquePdf.create({ footer: "onirique.store" });
//   doc.heading("Titre");  doc.text("Un paragraphe, coupé à la largeur de la page.", { size: 11, bold: false, grey: false });
//   doc.table([{ label: "Nom", width: 0.4 }, { label: "Part", width: 0.2, align: "right" }], [["Tom", "50 %"]], { minHeight: 34 });
//   doc.check(true, "Une étape faite", "Une note en dessous");  doc.space(12);
//   doc.download("Mon document.pdf");        // ou doc.blob()
//
// Le texte est en Helvetica, la police que tout lecteur de PDF possède : le fichier n'embarque aucune police.
window.OniriquePdf = (() => {
  const W = 595.28, H = 841.89, MARGIN = 54; // A4, en points

  // Ce que Helvetica sait écrire (codage WinAnsi) en plus du Latin-1 : guillemets courbes, tirets, œ, €.
  const EXTRA = { "€": 0x80, "‚": 0x82, "„": 0x84, "…": 0x85, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97, "œ": 0x9C, "Œ": 0x8C, "−": 0x2D, " ": 0x20, " ": 0x20, "✓": 0x2D };
  const hex = (text) => {
    let out = "";
    for (const char of String(text)) {
      const code = char.codePointAt(0);
      const byte = EXTRA[char] ?? ((code >= 0x20 && code < 0x7F) || (code >= 0xA0 && code <= 0xFF) ? code : 0x3F);
      out += byte.toString(16).padStart(2, "0");
    }
    return "<" + out + ">";
  };

  // La largeur d'un texte : Arial a les mêmes mesures qu'Helvetica, et le navigateur sait la mesurer.
  const ruler = document.createElement("canvas").getContext("2d");
  const width = (text, size, bold) => {
    ruler.font = (bold ? "bold " : "") + '100px Arial, Helvetica, "Liberation Sans", sans-serif';
    return ruler.measureText(String(text).replace(/[  ]/g, " ")).width / 100 * size;
  };

  /** Le texte coupé en lignes qui tiennent dans une largeur ; un mot trop long pour une ligne est coupé lui aussi. */
  function wrap(text, size, bold, max) {
    const lines = [];
    for (const paragraph of String(text).split("\n")) {
      let line = "";
      for (let word of paragraph.split(/\s+/).filter(Boolean)) {
        while (width(word, size, bold) > max && word.length > 1) {
          let cut = word.length - 1;
          while (cut > 1 && width(word.slice(0, cut), size, bold) > max) cut--;
          if (line) { lines.push(line); line = ""; }
          lines.push(word.slice(0, cut));
          word = word.slice(cut);
        }
        const tried = line ? line + " " + word : word;
        if (line && width(tried, size, bold) > max) { lines.push(line); line = word; } else line = tried;
      }
      lines.push(line);
    }
    return lines;
  }

  function create({ footer = "" } = {}) {
    const pages = [[]];
    let y = MARGIN;
    const page = () => pages[pages.length - 1];
    const n = (v) => (Math.round(v * 100) / 100).toString();
    const content = W - 2 * MARGIN;

    /** Passe à la page suivante s'il ne reste pas cette hauteur. */
    function room(height) {
      if (y + height > H - MARGIN - 18 && y > MARGIN) { pages.push([]); y = MARGIN; }
    }
    function put(text, x, top, size, { bold = false, grey = false, align = "left", span = 0 } = {}) {
      const offset = align === "right" ? span - width(text, size, bold) : align === "center" ? (span - width(text, size, bold)) / 2 : 0;
      page().push(`BT /${bold ? "F2" : "F1"} ${n(size)} Tf ${grey ? "0.42" : "0.08"} g ${n(x + offset)} ${n(H - top - size * 0.78)} Td ${hex(text)} Tj ET`);
    }
    function rule(x1, top1, x2, top2, weight = 0.6, grey = 0.55) {
      page().push(`${n(weight)} w ${n(grey)} G ${n(x1)} ${n(H - top1)} m ${n(x2)} ${n(H - top2)} l S`);
    }

    const doc = {
      space(points) { y += points; return doc; },

      heading(text, size = 22) {
        room(size * 1.6);
        for (const line of wrap(text, size, true, content)) { put(line, MARGIN, y, size, { bold: true }); y += size * 1.25; }
        y += size * 0.35;
        return doc;
      },

      text(text, { size = 11, bold = false, grey = false, gap = 6, indent = 0 } = {}) {
        for (const line of wrap(text, size, bold, content - indent)) {
          room(size * 1.4);
          put(line, MARGIN + indent, y, size, { bold, grey });
          y += size * 1.4;
        }
        y += gap;
        return doc;
      },

      /** columns = [{ label, width (part de la largeur), align }] ; rows = tableaux de textes ; un rang « bold » est en gras. */
      table(columns, rows, { size = 10.5, minHeight = 0, pad = 7 } = {}) {
        const widths = columns.map((c) => c.width * content);
        const draw = (cells, bold, floor) => {
          const wrapped = cells.map((cell, i) => wrap(cell ?? "", size, bold, widths[i] - 2 * pad));
          const height = Math.max(floor, Math.max(...wrapped.map((lines) => lines.length)) * size * 1.35 + 2 * pad);
          room(height);
          let x = MARGIN;
          wrapped.forEach((lines, i) => {
            lines.forEach((line, k) => put(line, x + pad, y + pad + k * size * 1.35, size, { bold, align: columns[i].align || "left", span: widths[i] - 2 * pad }));
            x += widths[i];
          });
          // Le cadre du rang, et un trait entre les colonnes.
          rule(MARGIN, y, MARGIN + content, y);
          rule(MARGIN, y + height, MARGIN + content, y + height);
          for (let i = 0, edge = MARGIN; i <= widths.length; edge += widths[i] || 0, i++) rule(edge, y, edge, y + height);
          y += height;
        };
        draw(columns.map((c) => c.label), true, 0);
        rows.forEach((row) => draw(row.cells || row, !!row.bold, row.bold ? 0 : minHeight));
        y += 12;
        return doc;
      },

      /** Une case, cochée ou non, son texte, et une note en plus petit dessous. */
      check(checked, text, note = "", { size = 11 } = {}) {
        const box = 10, indent = box + 9;
        const lines = wrap(text, size, false, content - indent), notes = note ? wrap(note, size - 2, false, content - indent) : [];
        room(lines.length * size * 1.4 + notes.length * (size - 2) * 1.4 + 6);
        page().push(`0.8 w 0.25 G ${n(MARGIN)} ${n(H - y - box - 1)} ${n(box)} ${n(box)} re S`);
        if (checked) page().push(`1.5 w 0.08 G ${n(MARGIN + 2)} ${n(H - y - 6)} m ${n(MARGIN + 4.2)} ${n(H - y - 9)} l ${n(MARGIN + 8.4)} ${n(H - y - 2.6)} l S`);
        for (const line of lines) { put(line, MARGIN + indent, y, size); y += size * 1.4; }
        for (const line of notes) { put(line, MARGIN + indent, y, size - 2, { grey: true }); y += (size - 2) * 1.4; }
        y += 6;
        return doc;
      },

      /** Un trait sur toute la largeur. */
      line() { room(10); rule(MARGIN, y, MARGIN + content, y, 0.6, 0.7); y += 12; return doc; },

      /** Garde ensemble ce qui suit : passe à la page suivante s'il ne reste pas cette hauteur. */
      keep(points) { room(points); return doc; },

      blob() {
        // Le pied de page, une fois le nombre de pages connu.
        pages.forEach((stream, index) => {
          const saved = pages.length;
          pages.push(stream); // put() écrit dans la dernière page
          if (footer) put(footer, MARGIN, H - MARGIN + 8, 8.5, { grey: true });
          put((index + 1) + " / " + saved, MARGIN, H - MARGIN + 8, 8.5, { grey: true, align: "right", span: content });
          pages.length = saved;
        });

        const objects = [];
        const add = (body) => { objects.push(body); return objects.length; };
        const catalog = add(""), tree = add("");
        const regular = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
        const bold = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
        const kids = pages.map((stream) => {
          const text = stream.join("\n");
          const body = add(`<< /Length ${text.length} >>\nstream\n${text}\nendstream`);
          return add(`<< /Type /Page /Parent ${tree} 0 R /MediaBox [0 0 ${n(W)} ${n(H)}] /Resources << /Font << /F1 ${regular} 0 R /F2 ${bold} 0 R >> >> /Contents ${body} 0 R >>`);
        });
        objects[catalog - 1] = `<< /Type /Catalog /Pages ${tree} 0 R >>`;
        objects[tree - 1] = `<< /Type /Pages /Count ${kids.length} /Kids [${kids.map((k) => k + " 0 R").join(" ")}] >>`;

        // Tout le fichier est en ASCII (le texte est écrit en hexadécimal) : une position en caractères est une position en octets.
        let file = "%PDF-1.4\n";
        const offsets = objects.map((body, i) => { const at = file.length; file += `${i + 1} 0 obj\n${body}\nendobj\n`; return at; });
        const xref = file.length;
        file += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.map((at) => String(at).padStart(10, "0") + " 00000 n \n").join("");
        file += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
        return new Blob([file], { type: "application/pdf" });
      },

      download(name) {
        const url = URL.createObjectURL(doc.blob());
        Object.assign(document.createElement("a"), { href: url, download: String(name).replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim() }).click();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      },
    };
    return doc;
  }

  return { create };
})();
