using System.Text.Json;

namespace Onirique;

sealed class OngletSauve
{
    public string Url { get; set; } = "";
    public string Titre { get; set; } = "";
    public int Groupe { get; set; } = -1;
    public bool Divise { get; set; }   // partage l'écran avec l'onglet suivant
}

sealed class GroupeSauve
{
    public string Nom { get; set; } = "";
    public string Couleur { get; set; } = "#e5384a";
    public bool Replie { get; set; }
}

sealed class Parametres
{
    public string Moteur { get; set; } = "google";
    public bool ReprendreSession { get; set; } = true;
    public int VeilleSecondes { get; set; } = 30;       // 0 : jamais
    public int DechargementMinutes { get; set; } = 10;  // 0 : jamais
    public string Traqueurs { get; set; } = "strict";   // strict, equilibre, aucun
    public bool SitesSombres { get; set; } = true;
    public bool GoogleOnirique { get; set; } = true;
    public bool Vpn { get; set; }
    public string VpnRelais { get; set; } = "https://onirique.store:3129";
    public bool Memoire { get; set; } = true;
    public bool Animations { get; set; } = true;
    public bool MisesAJour { get; set; } = true;
    public string Accent { get; set; } = DA.AccentParDefaut;
    public string? DerniereVersion { get; set; }
    public bool ImportPropose { get; set; }
    public bool ModeStudio { get; set; } = true;
    public bool Bloqueur { get; set; } = true;
    public int PlafondMemoire { get; set; }      // Mo, 0 : aucun
    public int PlafondCpu { get; set; }          // %, 0 : aucun
    public bool BarreLaterale { get; set; } = true;
    public string Fond { get; set; } = "nuit";   // nuit, anime, image
    public string? FondFichier { get; set; }
    public long FondVersion { get; set; }
    public bool Synchro { get; set; } = true;
    public long SynchroDate { get; set; }
    public string? Raccourcis { get; set; }   // l'écran d'accueil (sites et dossiers), en JSON, géré par accueil/index.html
    public List<OngletSauve> Session { get; set; } = new();
    public List<GroupeSauve> Groupes { get; set; } = new();
    public int SessionActif { get; set; }

    public static readonly string Dossier = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ONIRIQUE", "Navigateur");
    static string Fichier => Path.Combine(Dossier, "parametres.json");

    public static readonly (string Id, string Nom, string Url)[] Moteurs =
    {
        ("google", "Google", "https://www.google.com/search?q="),
        ("duckduckgo", "DuckDuckGo", "https://duckduckgo.com/?q="),
        ("bing", "Bing", "https://www.bing.com/search?q="),
        ("qwant", "Qwant", "https://www.qwant.com/?q="),
        ("ecosia", "Ecosia", "https://www.ecosia.org/search?q="),
    };

    public string Recherche(string texte)
    {
        var moteur = Moteurs.FirstOrDefault(m => m.Id == Moteur);
        return (moteur.Url ?? Moteurs[0].Url) + Uri.EscapeDataString(texte);
    }

    public static Parametres Lire()
    {
        try { return JsonSerializer.Deserialize<Parametres>(File.ReadAllText(Fichier)) ?? new(); }
        catch { return new(); }
    }

    public void Enregistrer()
    {
        try
        {
            Directory.CreateDirectory(Dossier);
            var provisoire = Fichier + ".tmp";
            File.WriteAllText(provisoire, JsonSerializer.Serialize(this, new JsonSerializerOptions { WriteIndented = true }));
            File.Move(provisoire, Fichier, true);
        }
        catch { }
    }
}
