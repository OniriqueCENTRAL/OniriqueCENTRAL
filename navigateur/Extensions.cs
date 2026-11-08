using System.IO.Compression;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Onirique;

// Les extensions Chrome : depuis le Chrome Web Store (lien ou identifiant), ou reprises de Chrome, Edge, Brave… déjà
// installées sur ce PC. Le moteur les fait tourner ; le bouton puzzle de la barre les liste et ouvre leur fenêtre.
sealed partial class Navigateur
{
    static readonly string DossierExtensions = Path.Combine(Parametres.Dossier, "extensions");
    JsonArray extensions = new();

    CoreWebView2Profile? Profil => Onglets.Select(o => o.Vue?.CoreWebView2).FirstOrDefault(c => c != null)?.Profile;

    async Task<IReadOnlyList<CoreWebView2BrowserExtension>> ListeExtensions()
    {
        if (!extensionsActives) return Array.Empty<CoreWebView2BrowserExtension>();
        try { return Profil is { } p ? await p.GetBrowserExtensionsAsync() : Array.Empty<CoreWebView2BrowserExtension>(); }
        catch { return Array.Empty<CoreWebView2BrowserExtension>(); }
    }

    async Task MajExtensions()
    {
        var liste = await ListeExtensions();
        extensions = new JsonArray(liste.Select(e => (JsonNode)new JsonObject { ["id"] = e.Id, ["nom"] = e.Name, ["active"] = e.IsEnabled }).ToArray());
        boutonExtensions.Visible = extensionsActives && !Prive;
        Disposer();
    }

    /// <summary>Le nom lisible d'une extension (son manifeste renvoie souvent à ses traductions, « __MSG_nom__ »).</summary>
    static string NomExtension(string dossier)
    {
        try
        {
            var m = JsonNode.Parse(File.ReadAllText(Path.Combine(dossier, "manifest.json")))!;
            var nom = (string?)m["name"] ?? Path.GetFileName(dossier);
            var cle = Regex.Match(nom, "^__MSG_(.+)__$");
            if (!cle.Success) return nom;
            foreach (var langue in new[] { "fr", (string?)m["default_locale"] ?? "en", "en" })
            {
                var f = Path.Combine(dossier, "_locales", langue, "messages.json");
                if (!File.Exists(f)) continue;
                var messages = JsonNode.Parse(File.ReadAllText(f))!.AsObject();
                var trouve = messages.FirstOrDefault(x => x.Key.Equals(cle.Groups[1].Value, StringComparison.OrdinalIgnoreCase));
                if ((string?)trouve.Value?["message"] is { Length: > 0 } t) return t;
            }
            return nom;
        }
        catch { return Path.GetFileName(dossier); }
    }

    /// <summary>Copie l'extension dans le dossier du navigateur, puis la confie au moteur.</summary>
    async Task<string?> Installer(string source, string nomDossier)
    {
        if (Profil is not { } profil) return null;
        var cible = Path.Combine(DossierExtensions, nomDossier);
        if (!Path.GetFullPath(cible).StartsWith(Path.GetFullPath(DossierExtensions), StringComparison.OrdinalIgnoreCase)) return null;
        if (Directory.Exists(cible)) Directory.Delete(cible, true);
        Copier(source, cible);
        try
        {
            var e = await profil.AddBrowserExtensionAsync(cible);
            return e.Name;
        }
        catch { Directory.Delete(cible, true); return null; }
    }

    static void Copier(string de, string vers)
    {
        Directory.CreateDirectory(vers);
        foreach (var f in Directory.GetFiles(de)) File.Copy(f, Path.Combine(vers, Path.GetFileName(f)), true);
        foreach (var d in Directory.GetDirectories(de)) Copier(d, Path.Combine(vers, Path.GetFileName(d)));
    }

    /// <summary>Le Chrome Web Store : on accepte le lien de la page de l'extension ou son identifiant (32 lettres a à p).</summary>
    async Task<string> DepuisLeStore(string lien)
    {
        var id = Regex.Match(lien ?? "", "(?<![a-p])([a-p]{32})(?![a-p])").Groups[1].Value;
        if (id.Length == 0) return "Colle le lien d'une extension du Chrome Web Store (chromewebstore.google.com/detail/…).";
        var provisoire = Path.Combine(Path.GetTempPath(), "onirique-ext-" + id);
        try
        {
            using var http = new HttpClient { Timeout = TimeSpan.FromMinutes(2) };
            var crx = await http.GetByteArrayAsync($"https://clients2.google.com/service/update2/crx?response=redirect&prodversion=131.0&acceptformat=crx2,crx3&x=id%3D{id}%26uc");
            // Un .crx est un .zip précédé d'un en-tête « Cr24 » : on saute l'en-tête et on décompresse le reste.
            if (crx.Length < 16 || crx[0] != 'C' || crx[1] != 'r' || crx[2] != '2' || crx[3] != '4') return "Cette extension n'a pas pu être téléchargée.";
            int version = BitConverter.ToInt32(crx, 4);
            int debut = version == 3 ? 12 + BitConverter.ToInt32(crx, 8) : 16 + BitConverter.ToInt32(crx, 8) + BitConverter.ToInt32(crx, 12);
            if (Directory.Exists(provisoire)) Directory.Delete(provisoire, true);
            using (var zip = new ZipArchive(new MemoryStream(crx, debut, crx.Length - debut)))
                zip.ExtractToDirectory(provisoire);
            var nom = await Installer(provisoire, id);
            return nom == null ? "Le navigateur n'a pas pu charger cette extension." : $"Extension ajoutée : {nom}.";
        }
        catch { return "Cette extension n'a pas pu être téléchargée."; }
        finally { try { Directory.Delete(provisoire, true); } catch { } }
    }

    /// <summary>Les extensions installées dans Chrome, Edge, Brave… (chaque profil), qu'on n'a pas encore.</summary>
    static List<(string Id, string Nom, string Dossier)> ExtensionsAilleurs()
    {
        var vues = new HashSet<string>();
        var liste = new List<(string, string, string)>();
        foreach (var s in Sources())
        {
            var dossier = Path.Combine(Path.GetDirectoryName(s.Fichier)!, "Extensions");
            if (!Directory.Exists(dossier)) continue;
            foreach (var ext in Directory.GetDirectories(dossier))
            {
                var id = Path.GetFileName(ext);
                var version = Directory.GetDirectories(ext).OrderByDescending(d => d).FirstOrDefault(d => File.Exists(Path.Combine(d, "manifest.json")));
                if (version == null || !vues.Add(id)) continue;
                liste.Add((id, NomExtension(version), version));
            }
        }
        return liste;
    }

    async Task<string> ReprendreExtensions()
    {
        var deja = (await ListeExtensions()).Select(e => e.Name).ToHashSet();
        int n = 0;
        foreach (var (id, nom, dossier) in ExtensionsAilleurs())
        {
            if (deja.Contains(nom)) continue;
            if (await Installer(dossier, id) != null) n++;
        }
        return n == 0 ? "Aucune nouvelle extension à reprendre." : $"{n} extension{(n > 1 ? "s" : "")} reprise{(n > 1 ? "s" : "")}.";
    }

    async Task CommandeExtension(CoreWebView2 source, JsonObject m)
    {
        string message = "";
        switch ((string?)m["type"])
        {
            case "extStore": message = await DepuisLeStore((string?)m["lien"] ?? ""); break;
            case "extReprendre": message = await ReprendreExtensions(); break;
            case "extActiver":
                if ((await ListeExtensions()).FirstOrDefault(e => e.Id == (string?)m["id"]) is { } a) await a.EnableAsync(m["active"]?.GetValue<bool>() == true);
                break;
            case "extRetirer":
                if ((await ListeExtensions()).FirstOrDefault(e => e.Id == (string?)m["id"]) is { } r) await r.RemoveAsync();
                break;
        }
        await MajExtensions();
        if (message.Length > 0) bulle.Montrer(message);
        Envoyer(source, Etat());
    }

    // ——— Le bouton puzzle de la barre ———

    readonly Bouton boutonExtensions = new("", "Extensions");

    async void MenuExtensions()
    {
        await MajExtensions();
        var m = NouveauMenu();
        var liste = await ListeExtensions();
        if (liste.Count == 0) m.Items.Add(Element("Aucune extension pour l'instant", () => { }, false));
        foreach (var e in liste)
        {
            var el = Element(e.Name, () => OuvrirExtension(e.Id));
            el.Checked = e.IsEnabled;
            el.ToolTipText = e.IsEnabled ? "Ouvrir" : "Désactivée";
            m.Items.Add(el);
        }
        m.Items.Add(new ToolStripSeparator());
        m.Items.Add(Element("Ajouter et gérer les extensions…", () => OuvrirInterne(PageParametres + "#extensions")));
        m.Items.Add(Element("Chrome Web Store", () => _ = Ouvrir("https://chromewebstore.google.com/", Actif == null ? -1 : Onglets.IndexOf(Actif) + 1)));
        m.Show(boutonExtensions, new Point(0, boutonExtensions.Height));
    }

    /// <summary>La fenêtre de l'extension (son « popup »), ou sa page d'options, dans une petite fenêtre sous le bouton.</summary>
    void OuvrirExtension(string id)
    {
        string? page = null;
        var nomVoulu = (string?)extensions.OfType<JsonObject>().FirstOrDefault(x => (string?)x["id"] == id)?["nom"];
        foreach (var d in Directory.Exists(DossierExtensions) ? Directory.GetDirectories(DossierExtensions) : Array.Empty<string>())
        {
            // Le moteur donne aux extensions installées depuis un dossier son propre identifiant : on retrouve la sienne par son nom.
            try
            {
                var man = JsonNode.Parse(File.ReadAllText(Path.Combine(d, "manifest.json")))!;
                if (NomExtension(d) != nomVoulu) continue;
                page = (string?)(man["action"] ?? man["browser_action"])?["default_popup"] ?? (string?)man["options_page"] ?? (string?)man["options_ui"]?["page"];
            }
            catch { }
            if (page != null) break;
        }
        if (page == null) { bulle.Montrer("Cette extension n'a pas de fenêtre : elle agit directement sur les pages."); return; }
        var url = $"chrome-extension://{id}/{page.TrimStart('/')}";
        var f = new Form
        {
            FormBorderStyle = FormBorderStyle.FixedToolWindow, ShowInTaskbar = false, StartPosition = FormStartPosition.Manual,
            Size = new Size(this.S(400), this.S(560)), BackColor = DA.Nuit, Text = "Extension", Owner = this,
        };
        var coin = boutonExtensions.PointToScreen(new Point(boutonExtensions.Width, boutonExtensions.Height));
        f.Location = new Point(coin.X - f.Width, coin.Y + this.S(4));
        var v = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = DA.Nuit };
        f.Controls.Add(v);
        f.Deactivate += (_, _) => f.Close();
        f.Shown += async (_, _) =>
        {
            try { await v.EnsureCoreWebView2Async(env); v.CoreWebView2.Navigate(url); }
            catch { f.Close(); }
        };
        f.Show(this);
    }
}
