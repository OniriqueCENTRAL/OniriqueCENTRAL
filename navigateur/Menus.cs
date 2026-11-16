using System.Diagnostics;
using System.Globalization;

namespace Onirique;

// Les boutons de droite de la barre (Téléchargements, VPN, bloqueur de pubs, extensions, outils) ouvrent un volet
// sous eux (Volet.cs) ; « Afficher plus » ouvre la page entière.
sealed partial class Navigateur
{
    readonly Bouton boutonBloqueur = new("", "Bloqueur de pubs");

    static readonly CultureInfo Fr = CultureInfo.GetCultureInfo("fr-FR");

    static string Taille(long n) => n <= 0 ? "" : n < 1024 * 1024 ? $"{Math.Max(1, n / 1024)} Ko"
        : n < 1024L * 1024 * 1024 ? (n / 1048576.0).ToString("0.0", Fr) + " Mo" : (n / 1073741824.0).ToString("0.00", Fr) + " Go";

    static string Extension(string nom) => Path.GetExtension(nom).TrimStart('.') is { Length: > 0 } e ? (e.Length > 4 ? e[..4] : e) : "?";

    static Ligne Lien(string titre, Action faire) => new() { Titre = titre, Lien = true, Faire = faire };
    static readonly Ligne Trait = new() { Filet = true };

    // ——— Téléchargements ———

    void MenuTelechargements()
    {
        LireTelechargements();
        Volet.Ouvrir(boutonTelechargements, "Téléchargements", () =>
        {
            var l = new List<Ligne>();
            var recents = Enumerable.Reverse(telechargements).Take(6).ToList();
            if (recents.Count == 0) l.Add(new Ligne { Titre = "Aucun téléchargement pour l'instant", Sous = "Ce que tu télécharges apparaît ici.", Glyphe = "", Actif = false });
            foreach (var t in recents)
            {
                bool fini = t.Etat == "fini", existe = fini && File.Exists(t.Chemin);
                string site = SiteDe(t.Url) ?? "";
                string sous = t.Etat switch
                {
                    "encours" => t.Total > 0 ? $"{t.Recu * 100 / t.Total} % · {Taille(t.Recu)} sur {Taille(t.Total)}" : $"{Taille(t.Recu)} reçus",
                    "pause" => $"En pause · {Taille(t.Recu)}" + (t.Total > 0 ? $" sur {Taille(t.Total)}" : ""),
                    "annule" => "Annulé",
                    "interrompu" => "Interrompu",
                    _ => string.Join(" · ", new[] { existe ? Taille(t.Total > 0 ? t.Total : t.Recu) : "Fichier supprimé ou déplacé", t.Groupe, site }.Where(x => x.Length > 0)),
                };
                l.Add(new Ligne
                {
                    Titre = t.Nom, Sous = sous, Badge = Extension(t.Nom), Actif = fini ? existe : t.Etat is "encours" or "pause",
                    Progres = t.Etat is "encours" or "pause" ? (t.Total > 0 ? (double)t.Recu / t.Total : double.NaN) : null,
                    Faire = () => { if (fini) OuvrirFichier(t.Chemin); else OuvrirInterne(PageTelechargements); },
                    GlypheAction = existe ? "" : null,
                    Action = existe ? () => { try { Process.Start("explorer.exe", $"/select,\"{t.Chemin}\""); } catch { } } : null,
                });
            }
            l.Add(Trait);
            l.Add(Lien("Ouvrir le dossier Téléchargements", () =>
            {
                try { Process.Start(new ProcessStartInfo(DossierTelechargements) { UseShellExecute = true }); } catch { }
            }));
            l.Add(Lien("Afficher plus", () => OuvrirInterne(PageTelechargements)));
            return l;
        }, vivant: true);
    }

    // ——— VPN ———

    void MenuVpn() => Volet.Ouvrir(vpn, "VPN ONIRIQUE", () => new List<Ligne>
    {
        new()
        {
            Titre = vpnEtat switch { "actif" => "Connecté", "connexion" => "Connexion…", _ => "Éteint" },
            Sous = vpnEtat switch { "actif" => "Les sites te voient en Allemagne", "connexion" => "Un instant", _ => "Tu navigues avec ta propre connexion" },
            Glyphe = "", Actif = vpnEtat != "eteint",
        },
        new() { Titre = "Activer le VPN", Glyphe = "", Interrupteur = vpnEtat != "eteint", Actif = vpnEtat != "connexion", Faire = () => _ = BasculerVpn(vpnEtat == "eteint") },
        Trait,
        Lien("Afficher plus", () => OuvrirInterne(PageParametres + "#vpn")),
    }, vivant: true);

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
        var o = Actif;
        Volet.Ouvrir(boutonBloqueur, "Bloqueur de pubs", () =>
        {
            var c = o?.Vue?.CoreWebView2;
            var site = SiteDe(o?.Url ?? "");
            var l = new List<Ligne>();
            if (site != null)
            {
                bool permis = PubsPermises(o!.Url);
                l.Add(new Ligne
                {
                    Titre = site, Sous = !Reglages.Bloqueur ? "Le bloqueur est éteint partout" : permis ? "Pubs autorisées sur ce site" : "Pubs bloquées sur ce site",
                    Glyphe = "", Interrupteur = !permis && Reglages.Bloqueur, Actif = Reglages.Bloqueur,
                    Faire = () =>
                    {
                        if (permis) Reglages.PubsPermises.RemoveAll(p => site == p || site.EndsWith("." + p));
                        else Reglages.PubsPermises.Add(site);
                        Reglages.Enregistrer();
                        MontrerBloqueur();
                        c?.Reload();
                    },
                });
            }
            else l.Add(new Ligne { Titre = "Aucun site ouvert", Sous = "Ouvre un site pour régler le bloqueur sur lui.", Glyphe = "", Actif = false });
            l.Add(new Ligne { Titre = "Partout", Sous = "Régies publicitaires et traqueurs", Glyphe = "", Interrupteur = Reglages.Bloqueur,
                Faire = () => { Reglages.Bloqueur = !Reglages.Bloqueur; Reglages.Enregistrer(); MontrerBloqueur(); c?.Reload(); } });
            l.Add(new Ligne { Titre = pubsBloquees.ToString("N0", Fr), Sous = "pubs et traqueurs bloqués depuis l'ouverture", Glyphe = "" });
            l.Add(Trait);
            l.Add(Lien("Afficher plus", () => OuvrirInterne(PageParametres + "#confidentialite")));
            return l;
        });
    }
}
