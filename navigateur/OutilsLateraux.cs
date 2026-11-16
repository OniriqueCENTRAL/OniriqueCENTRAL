namespace Onirique;

// La barre latérale reçoit les outils ONIRIQUE qu'on choisit (bouton « Outils ») : chacun s'ouvre dans le panneau,
// comme CLOUD ou Discord. Même liste que le menu Outils du site (site/assets/tools-menu.js).
sealed partial class Navigateur
{
    static readonly (string Groupe, string Id, string Nom, string Glyphe)[] OutilsOnirique =
    {
        ("Abonnement", "cut", "ONIRIQUE CUT", ""),
        ("Analyser", "bpm-tonalite", "BPM et tonalité", ""),
        ("Analyser", "volume-lufs", "Volume avant sortie", ""),
        ("Analyser", "comparer-mix", "Comparer à une référence", ""),
        ("Analyser", "split", "IA SPLIT", ""),
        ("Analyser", "stems", "Stems et packs de prods", ""),
        ("Analyser", "transfert-playlist", "Transfert de playlist", ""),
        ("Analyser", "popularite", "Popularité", ""),
        ("Tempo et notes", "tap-tempo", "Tap tempo", ""),
        ("Tempo et notes", "delais", "Délais et reverb", ""),
        ("Tempo et notes", "gammes", "Gammes", ""),
        ("Voix", "accordeur", "Accordeur", ""),
        ("Voix", "tessiture", "Tessiture", ""),
        ("Fichiers", "convertisseur", "Convertisseur", ""),
        ("Fichiers", "decoupe", "Découpe et fondu", ""),
        ("Fichiers", "transposition", "Transposer", ""),
        ("Fichiers", "envoi", "ONIRIQUE ENVOI", ""),
        ("Fichiers", "downloader", "Downloader", ""),
        ("Sortie", "revenus-streaming", "Calculateur revenus streaming", ""),
        ("Sortie", "partage", "Partage des droits", ""),
        ("Sortie", "checklist-sortie", "Checklist de sortie", ""),
        ("Sortie", "presskit", "Presskit", ""),
        ("Pro", "devis", "Devis", ""),
    };

    readonly Bouton boutonOutilsLateraux = new("", "Outils ONIRIQUE : choisir ceux de la barre latérale") { BackColor = DA.Nuit };

    /// <summary>Les panneaux de la barre latérale : les services, puis les outils choisis.</summary>
    IEnumerable<(string Id, string Nom, string Url, string Glyphe)> Panneaux() =>
        Services.Concat(OutilsOnirique.Where(t => Reglages.OutilsLateraux.Contains(t.Id))
            .Select(t => ("outil:" + t.Id, t.Nom, "https://onirique.store/" + t.Id, t.Glyphe)));

    void InitOutilsLateraux()
    {
        boutonOutilsLateraux.Click += (_, _) => MenuOutilsLateraux();
        laterale.Controls.Add(boutonOutilsLateraux);
        RangerOutilsLateraux();
    }

    /// <summary>Remet les boutons des outils choisis dans la barre latérale, dans l'ordre de la liste.</summary>
    void RangerOutilsLateraux()
    {
        foreach (var b in boutonsDePanneau.Where(b => ((string?)b.Tag)?.StartsWith("outil:") == true).ToList())
        {
            boutonsDePanneau.Remove(b);
            laterale.Controls.Remove(b);
            b.Dispose();
        }
        foreach (var p in Panneaux().Where(p => p.Id.StartsWith("outil:")))
        {
            var b = new Bouton(p.Glyphe, p.Nom) { BackColor = DA.Nuit, Tag = p.Id, Font = boutonOutilsLateraux.Font, Temoin = p.Id == panneauOuvert };
            var id = p.Id;
            b.Click += (_, _) => BasculerPanneau(id);
            boutonsDePanneau.Add(b);
            laterale.Controls.Add(b);
        }
        PlacerAjouts();
    }

    void MenuOutilsLateraux()
    {
        var bord = boutonOutilsLateraux.PointToScreen(new Point(boutonOutilsLateraux.Width + this.S(8), 0));
        Volet.Ouvrir(boutonOutilsLateraux, "Outils de la barre latérale", () =>
        {
            var l = new List<Ligne>();
            foreach (var groupe in OutilsOnirique.GroupBy(t => t.Groupe))
            {
                l.Add(new Ligne { Titre = groupe.Key, Rubrique = true });
                foreach (var t in groupe)
                    l.Add(new Ligne
                    {
                        Titre = t.Nom, Glyphe = t.Glyphe, Interrupteur = Reglages.OutilsLateraux.Contains(t.Id),
                        Faire = () =>
                        {
                            if (!Reglages.OutilsLateraux.Remove(t.Id)) Reglages.OutilsLateraux.Add(t.Id);
                            Reglages.Enregistrer();
                            if (panneauOuvert == "outil:" + t.Id) BasculerPanneau(null);
                            RangerOutilsLateraux();
                        },
                    });
            }
            l.Add(new Ligne { Filet = true });
            l.Add(new Ligne { Titre = "Afficher plus", Lien = true, Faire = () => _ = Ouvrir("https://onirique.store/outils") });
            return l;
        }, coin: bord);
    }
}
