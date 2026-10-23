// Le contrat de licence d'une prod en PDF, mis en page avec pdf-kit.js (à charger avant) : titre, parties, introduction,
// détail de la commande, clauses de la licence puis clauses générales, conclusion et signatures. Le contenu vient du
// serveur, rempli d'après le modèle du beatmaker (contractOf dans server/src/beatstore.js).
//
//   OniriqueLicencePdf(contract).download("Licence.pdf")
window.OniriqueLicencePdf = (c) => {
  const doc = OniriquePdf.create({ footer: c.footer || "" });
  doc.heading(c.title, 20);
  doc.table([{ label: "Les parties", width: 0.34 }, { label: "", width: 0.66 }], c.parties);
  if (c.intro) doc.text(c.intro, { gap: 10 });
  doc.table([{ label: "La commande", width: 0.34 }, { label: "", width: 0.66 }], c.details);
  const clauses = (title, list, from) => {
    if (!list.length) return;
    doc.keep(60).text(title, { size: 13, bold: true, gap: 4 });
    list.forEach((clause, i) => doc.text((from + i) + ". " + clause, { gap: 4 }));
    doc.space(8);
  };
  clauses("Conditions de la licence", c.licenseClauses, 1);
  clauses("Clauses générales", c.generalClauses, c.licenseClauses.length + 1);
  if (c.closing) doc.text(c.closing, { gap: 14 });
  if (c.signatures) doc.keep(110).table([{ label: "Le concédant", width: 0.5 }, { label: "Le licencié", width: 0.5 }], [[c.seller, c.buyer]], { minHeight: 70 });
  return doc;
};
