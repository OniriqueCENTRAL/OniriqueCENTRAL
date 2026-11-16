using System.Diagnostics;

namespace Onirique;

// Les boutons de droite de la barre (Téléchargements, VPN, bloqueur de pubs) ouvrent un menu sous eux, comme les
// extensions ; « Afficher plus » ouvre la page entière.
sealed partial class Navigateur
{
    readonly Bouton boutonBloqueur = new("", "Bloqueur de pubs");

    void Montrer(ContextMenuStrip m, Control sous) => m.Show(sous, new Point(sous.Width - m.GetPreferredSize(Size.Empty).Width, sous.Height));

    // ——— Téléchargements ———

    void MenuTelechargements()
    {
        LireTelechargements();
        var m = NouveauMenu();
        var recents = Enumerable.Reverse(telechargements).Take(6).ToList();
        if (recents.Count == 0) m.Items.Add(Element("Aucun téléchargement pour l'instant", () => { }, false));
        foreach (var t in recents)
        {
            var etat = t.Etat switch
            {
                "encours" => t.Total > 0 ? $" — {t.Recu * 100 / t.Total} %" : " — en cours",
                "pause" => " — en pause",
                "annule" => " — annulé",
                "interrompu" => " — interrompu",
                _ => t.Groupe is { Length: > 0 } g ? $" — {g}" : "",
            };
            var nom = t.Nom.Length > 48 ? t.Nom[..45] + "…" : t.Nom;
            bool fini = t.Etat == "fini";
            m.Items.Add(Element(nom + etat, () => { if (fini) OuvrirFichier(t.Chemin); else OuvrirInterne(PageTelechargements); }, !fini || File.Exists(t.Chemin)));
        }
        m.Items.Add(new ToolStripSeparator());
        m.Items.Add(Element("Ouvrir le dossier Téléchargements", () =>
        {
            var dossier = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads");
            try { Process.Start(new ProcessStartInfo(dossier) { UseShellExecute = true }); } catch { }
        }));
        m.Items.Add(Element("Afficher plus", () => OuvrirInterne(PageTelechargements)));
        Montrer(m, boutonTelechargements);
    }

    // ——— VPN ———

    void MenuVpn()
    {
        var m = NouveauMenu();
        m.Items.Add(Element(vpn.Aide, () => { }, false));
        m.Items.Add(new ToolStripSeparator());
        bool eteint = vpnEtat == "eteint";
        m.Items.Add(Element(eteint ? "Activer le VPN" : "Désactiver le VPN", () => _ = BasculerVpn(eteint), vpnEtat != "connexion"));
        m.Items.Add(Element("Afficher plus", () => OuvrirInterne(PageParametres + "#vpn")));
        Montrer(m, vpn);
    }

    // ——— Bloqueur de pubs, coupé site par site ———

    static string? SiteDe(string url) =>
        !EstInterne(url) && Uri.TryCreate(url, UriKind.Absolute, out var u) && u.Scheme is "http" or "https" ? (u.Host.StartsWith("www.") ? u.Host[4..] : u.Host) : null;

    bool PubsPermises(string url) =>
        SiteDe(url) is { } h && Reglages.PubsPermises.Any(p => h == p || h.EndsWith("." + p));

    bool BloqueurSur(string url) => Reglages.Bloqueur && !PubsPermises(url);

    void MontrerBloqueur()
    {
        var url = Actif?.Url ?? "";
        boutonBloqueur.Temoin = BloqueurSur(url) && SiteDe(url) != null;
        boutonBloqueur.Aide = !Reglages.Bloqueur ? "Bloqueur de pubs : éteint"
            : PubsPermises(url) ? "Bloqueur de pubs : coupé sur ce site"
            : "Bloqueur de pubs : actif";
    }

    void MenuBloqueur()
    {
        var m = NouveauMenu();
        var c = Actif?.Vue?.CoreWebView2;
        var site = SiteDe(Actif?.Url ?? "");
        if (site != null)
        {
            bool permis = PubsPermises(Actif!.Url);
            var bloquer = new ToolStripMenuItem($"Bloquer les pubs sur {site}") { Checked = !permis, Enabled = Reglages.Bloqueur };
            bloquer.Click += (_, _) =>
            {
                if (permis) Reglages.PubsPermises.RemoveAll(p => site == p || site.EndsWith("." + p));
                else Reglages.PubsPermises.Add(site);
                Reglages.Enregistrer();
                MontrerBloqueur();
                c?.Reload();
                bulle.Montrer(permis ? $"Pubs de nouveau bloquées sur {site}." : $"Pubs autorisées sur {site}. La page se recharge.");
            };
            m.Items.Add(bloquer);
        }
        else m.Items.Add(Element("Ouvre un site pour régler le bloqueur sur ce site", () => { }, false));
        m.Items.Add(Element($"{pubsBloquees.ToString("N0", System.Globalization.CultureInfo.GetCultureInfo("fr-FR"))} pubs et traqueurs bloqués depuis l'ouverture", () => { }, false));
        m.Items.Add(new ToolStripSeparator());
        var partout = new ToolStripMenuItem("Bloqueur activé") { Checked = Reglages.Bloqueur };
        partout.Click += (_, _) => { Reglages.Bloqueur = !Reglages.Bloqueur; Reglages.Enregistrer(); MontrerBloqueur(); c?.Reload(); };
        m.Items.Add(partout);
        m.Items.Add(Element("Afficher plus", () => OuvrirInterne(PageParametres + "#confidentialite")));
        Montrer(m, boutonBloqueur);
    }
}
