using System.Text.Json.Nodes;
using Microsoft.Web.WebView2.Core;

namespace Onirique;

// Venir d'un autre navigateur : ses favoris arrivent sur l'accueil, et le compte Google se connecte en un clic.
sealed partial class Navigateur
{
    internal sealed record Source(string Id, string Nom, string Fichier);

    static readonly (string Nom, string Dossier, bool Profils)[] Navigateurs =
    {
        ("Chrome", @"%LOCALAPPDATA%\Google\Chrome\User Data", true),
        ("Edge", @"%LOCALAPPDATA%\Microsoft\Edge\User Data", true),
        ("Brave", @"%LOCALAPPDATA%\BraveSoftware\Brave-Browser\User Data", true),
        ("Vivaldi", @"%LOCALAPPDATA%\Vivaldi\User Data", true),
        ("Opera", @"%APPDATA%\Opera Software\Opera Stable", false),
        ("Opera GX", @"%APPDATA%\Opera Software\Opera GX Stable", false),
    };

    /// <summary>Les navigateurs installés sur ce PC qui ont des favoris, un par profil (« Chrome », « Chrome — Travail »…).</summary>
    internal static List<Source> Sources()
    {
        var liste = new List<Source>();
        foreach (var (nom, modele, profils) in Navigateurs)
        {
            var dossier = Environment.ExpandEnvironmentVariables(modele);
            if (!Directory.Exists(dossier)) continue;
            if (!profils)
            {
                var f = Path.Combine(dossier, "Bookmarks");
                if (File.Exists(f)) liste.Add(new(nom, nom, f));
                continue;
            }
            JsonNode? noms = null;
            try { noms = JsonNode.Parse(File.ReadAllText(Path.Combine(dossier, "Local State")))?["profile"]?["info_cache"]; } catch { }
            var trouves = Directory.GetDirectories(dossier).Where(d => File.Exists(Path.Combine(d, "Bookmarks")))
                .OrderBy(d => Path.GetFileName(d) == "Default" ? "" : Path.GetFileName(d)).ToList();
            foreach (var d in trouves)
            {
                var profil = Path.GetFileName(d);
                var libelle = trouves.Count == 1 ? nom : $"{nom} — {(string?)noms?[profil]?["name"] ?? profil}";
                liste.Add(new($"{nom}/{profil}", libelle, Path.Combine(d, "Bookmarks")));
            }
        }
        return liste;
    }

    /// <summary>Les adresses des favoris d'un navigateur, barre de favoris d'abord, sans doublon.</summary>
    internal static List<(string Nom, string Url)> LireFavoris(string fichier)
    {
        var resultat = new List<(string, string)>();
        var vues = new HashSet<string>();
        void Parcourir(JsonNode? n)
        {
            if (n == null || resultat.Count >= 300) return;
            if ((string?)n["type"] == "url")
            {
                var url = (string?)n["url"] ?? "";
                if ((url.StartsWith("http://") || url.StartsWith("https://")) && vues.Add(url.TrimEnd('/')))
                    resultat.Add(((string?)n["name"] is { Length: > 0 } t ? t : new Uri(url).Host, url));
                return;
            }
            foreach (var enfant in n["children"]?.AsArray() ?? new JsonArray()) Parcourir(enfant);
        }
        try
        {
            var racines = JsonNode.Parse(File.ReadAllText(fichier))?["roots"];
            foreach (var r in new[] { "bookmark_bar", "other", "synced" }) Parcourir(racines?[r]);
        }
        catch { }
        return resultat;
    }

    /// <summary>Les favoris arrivent sur l'accueil dans un dossier à leur nom ; ceux qui y sont déjà ne sont pas doublés.</summary>
    int ImporterFavoris(Source s)
    {
        var liste = Raccourcis();
        var deja = Sites(liste).Select(x => Cle((string?)x["url"] ?? "")).ToHashSet();
        var nouveaux = LireFavoris(s.Fichier).Where(f => !deja.Contains(Cle(f.Url))).ToList();
        if (nouveaux.Count == 0) return 0;
        var elements = new JsonArray(nouveaux.Select(f => (JsonNode)new JsonObject { ["type"] = "site", ["nom"] = f.Nom.Length > 40 ? f.Nom[..40] : f.Nom, ["url"] = f.Url }).ToArray());
        var nom = "Favoris " + s.Nom;
        if (liste.OfType<JsonObject>().FirstOrDefault(x => (string?)x["type"] == "dossier" && (string?)x["nom"] == nom)?["elements"] is JsonArray existant)
            foreach (var e in elements.ToList()) { elements.Remove(e); existant.Add(e); }
        else liste.Add(nouveaux.Count == 1 ? elements[0]!.DeepClone() : new JsonObject { ["type"] = "dossier", ["nom"] = nom, ["elements"] = elements });
        Reglages.Raccourcis = liste.ToJsonString();
        Reglages.Enregistrer();
        MajEtoile();
        ProfilChange();
        return nouveaux.Count;
    }

    JsonArray EtatImports() => new(Sources().Select(s => (JsonNode)new JsonObject { ["id"] = s.Id, ["nom"] = s.Nom }).ToArray());

    bool googleConnecte;

    /// <summary>Connecté à Google si le navigateur garde le cookie de session de Google.</summary>
    async Task VerifierGoogle(CoreWebView2 c)
    {
        try
        {
            var cookies = await c.CookieManager.GetCookiesAsync("https://www.google.com");
            googleConnecte = cookies.Any(k => k.Name is "SID" or "__Secure-1PSID" or "__Secure-3PSID");
        }
        catch { googleConnecte = false; }
    }

    bool avatarEnCours;

    /// <summary>La photo du compte Google, lue une fois sur google.com dans une page cachée, puis gardée.</summary>
    async Task LireAvatar()
    {
        if (!googleConnecte) { if (Reglages.GoogleAvatar != null) { Reglages.GoogleAvatar = null; Reglages.Enregistrer(); } return; }
        if (Reglages.GoogleAvatar != null || avatarEnCours || env == null) return;
        avatarEnCours = true;
        var vue = new Microsoft.Web.WebView2.WinForms.WebView2 { Visible = false, Size = new Size(1, 1) };
        contenu.Controls.Add(vue);
        _ = vue.Handle;
        try
        {
            await vue.EnsureCoreWebView2Async(env);
            var charge = new TaskCompletionSource<bool>();
            vue.CoreWebView2.NavigationCompleted += (_, e) => charge.TrySetResult(e.IsSuccess);
            vue.CoreWebView2.Navigate("https://www.google.com/?hl=fr");
            if (await Task.WhenAny(charge.Task, Task.Delay(10000)) == charge.Task && charge.Task.Result)
            {
                await Task.Delay(800);
                var brut = await vue.CoreWebView2.ExecuteScriptAsync(
                    "(document.querySelector('a[href*=\"SignOutOptions\"] img') || document.querySelector('img.gbii'))?.src || ''");
                var src = System.Text.Json.JsonSerializer.Deserialize<string>(brut) ?? "";
                if (src.StartsWith("https://", StringComparison.Ordinal)) { Reglages.GoogleAvatar = src; Reglages.Enregistrer(); EnvoyerEtatAuxPagesInternes(); }
            }
        }
        catch { }
        finally { vue.Dispose(); avatarEnCours = false; }
    }

    /// <summary>Premier lancement : si un autre navigateur est là, on propose d'en reprendre les favoris.</summary>
    void ProposerImport()
    {
        if (Reglages.ImportPropose) return;
        Reglages.ImportPropose = true;
        Reglages.Enregistrer();
        var s = Sources().FirstOrDefault();
        if (s != null) bulle.Montrer($"Tu viens de {s.Nom.Split(" — ")[0]} ? Reprends tes favoris et connecte ton compte Google.", "Voir", () => OuvrirInterne(PageParametres + "#general"));
    }
}
