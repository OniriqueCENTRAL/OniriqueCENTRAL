using System.Diagnostics;
using System.Drawing.Drawing2D;
using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Onirique;

// Favoris, suggestions, Mode Studio, limiteurs, bloqueur de pubs, mini-lecteur, barre latérale, fond d'accueil et
// synchronisation avec le compte ONIRIQUE.
sealed partial class Navigateur
{
    const string HoteFichiers = "fichiers.onirique";
    static readonly string DossierFichiers = Path.Combine(Parametres.Dossier, "fichiers");

    readonly Suggestions suggestions = new();
    BarreFavoris favoris = null!;
    readonly Bouton lecteur = new("", "Ce qui joue") { Visible = false };
    readonly Bouton studio = new("", "Mode Studio") { Visible = false, Temoin = true };
    Lecteur panneauLecteur = null!;
    readonly Panel laterale = new() { Dock = DockStyle.Left, BackColor = DA.Nuit };
    readonly Panel panneau = new() { Dock = DockStyle.Left, BackColor = DA.Fond, Width = 0 };
    readonly Panel teteDePanneau = new() { Dock = DockStyle.Top, BackColor = DA.Fond };
    readonly Label titreDePanneau = new() { ForeColor = DA.Brume, BackColor = DA.Fond, TextAlign = ContentAlignment.MiddleLeft, AutoEllipsis = true };
    readonly Bouton ouvrirEnOnglet = new("", "Ouvrir dans un onglet");
    readonly Bouton fermerPanneau = new("", "Fermer le panneau");
    readonly Dictionary<string, WebView2> vuesDePanneau = new();
    readonly List<Bouton> boutonsDePanneau = new();
    string? panneauOuvert;
    float panneauLargeur;

    static readonly (string Id, string Nom, string Url, string Glyphe)[] Services =
    {
        ("cloud", "ONIRIQUE CLOUD", "https://onirique.store/mes-sons", ""),
        ("messages", "Messages ONIRIQUE", "https://onirique.store/messages", ""),
        ("discord", "Discord", "https://discord.com/app", ""),
    };

    void InitAjouts()
    {
        Controls.Add(suggestions);
        favoris = new BarreFavoris(this) { Dock = DockStyle.Top };
        panneauLecteur = new Lecteur(this);
        Controls.Add(panneauLecteur);
        barre.Controls.Add(lecteur);
        barre.Controls.Add(studio);
        lecteur.Click += (_, _) => { if (panneauLecteur.Visible) panneauLecteur.Visible = false; else MontrerLecteur(); };
        studio.Click += (_, _) => bulle.Montrer($"Mode Studio : {dawOuvert} est ouvert, les onglets cachés s'endorment tout de suite pour lui laisser la machine.");
        champ.Etoile.Click += (_, _) => BasculerFavori();

        champ.Saisie.TextChanged += (_, _) => { if (champ.Saisie.Focused) ProposerSuggestions(); };
        champ.Saisie.KeyDown += (_, e) =>
        {
            if (!suggestions.Visible) return;
            if (e.KeyCode is Keys.Down or Keys.Up) { suggestions.Deplacer(e.KeyCode == Keys.Down ? 1 : -1); e.Handled = e.SuppressKeyPress = true; }
            else if (e.KeyCode == Keys.Escape) suggestions.Visible = false;
        };
        champ.Saisie.LostFocus += (_, _) => suggestions.Visible = false;
        suggestions.Choisie += (url) =>
        {
            suggestions.Visible = false;
            if (Actif?.Vue?.CoreWebView2 is { } c) { c.Navigate(url); Actif.Vue.Focus(); }
        };

        // Barre latérale (toute la hauteur, à gauche) et son panneau (sous la barre d'outils). L'ordre d'empilement
        // décide de l'ordre de placement : la barre latérale d'abord, puis les bandeaux du haut, puis le panneau.
        teteDePanneau.Controls.AddRange(new Control[] { titreDePanneau, ouvrirEnOnglet, fermerPanneau });
        teteDePanneau.Paint += (_, e) => { using var p = new Pen(DA.Filet); e.Graphics.DrawLine(p, 0, teteDePanneau.Height - 1, teteDePanneau.Width, teteDePanneau.Height - 1); };
        panneau.Controls.Add(teteDePanneau);
        // Le bord droit du panneau se tire pour l'élargir ou le rétrécir ; la largeur choisie est retenue.
        var bord = new Panel { Dock = DockStyle.Right, Width = this.S(6), Cursor = Cursors.SizeWE, BackColor = DA.Filet };
        int tirage = -1;
        bord.MouseDown += (_, e) => { if (e.Button == MouseButtons.Left) tirage = e.X; };
        bord.MouseMove += (_, e) =>
        {
            if (tirage < 0 || e.Button != MouseButtons.Left) return;
            int largeur = Math.Clamp(panneau.Width + e.X - tirage, this.S(320), Math.Max(this.S(320), ClientSize.Width - this.S(420)));
            panneau.Width = largeur;
            panneauLargeur = largeur;
        };
        bord.MouseUp += (_, _) =>
        {
            if (tirage < 0) return;
            tirage = -1;
            Reglages.PanneauLargeur = (int)Math.Round(panneau.Width * 96.0 / DeviceDpi);
            Reglages.Enregistrer();
        };
        panneau.Controls.Add(bord);
        teteDePanneau.Resize += (_, _) => PlacerAjouts();
        panneau.Paint += (_, e) => { using var p = new Pen(DA.Filet); e.Graphics.DrawLine(p, panneau.Width - 1, 0, panneau.Width - 1, panneau.Height); };
        laterale.Paint += (_, e) => { using var p = new Pen(DA.Filet); e.Graphics.DrawLine(p, laterale.Width - 1, 0, laterale.Width - 1, laterale.Height); };
        fermerPanneau.Click += (_, _) => BasculerPanneau(null);
        ouvrirEnOnglet.Click += (_, _) =>
        {
            if (panneauOuvert != null && vuesDePanneau.TryGetValue(panneauOuvert, out var v)) _ = Ouvrir(v.CoreWebView2?.Source ?? Services.First(s => s.Id == panneauOuvert).Url);
            BasculerPanneau(null);
        };
        foreach (var s in Services)
        {
            var b = new Bouton(s.Glyphe, s.Nom) { BackColor = DA.Nuit, Tag = s.Id };
            b.Click += (_, _) => BasculerPanneau(s.Id);
            boutonsDePanneau.Add(b);
            laterale.Controls.Add(b);
        }
        Controls.Add(panneau);
        Controls.Add(laterale);
        Controls.Add(favoris);
        Controls.SetChildIndex(contenu, 0);
        Controls.SetChildIndex(panneau, 1);
        Controls.SetChildIndex(favoris, 2);
        Controls.SetChildIndex(barre, 3);
        Controls.SetChildIndex(bandeau, 4);
        Controls.SetChildIndex(laterale, 5);
        laterale.Visible = Reglages.BarreLaterale;
        favoris.Visible = Reglages.BarreFavoris;
        // L'ancienne liste par défaut, jamais modifiée : elle laisse place à la nouvelle (le dossier ONIRIQUE).
        if (Reglages.Raccourcis == AncienneListe) { Reglages.Raccourcis = null; Reglages.Enregistrer(); }
        derniereEmpreinte = ProfilSynchro().ToJsonString();
    }

    const string AncienneListe = "[{\"type\":\"site\",\"nom\":\"ONIRIQUE\",\"url\":\"https://onirique.store/\"},{\"type\":\"site\",\"nom\":\"CLOUD\",\"url\":\"https://onirique.store/cloud\"},{\"type\":\"site\",\"nom\":\"Boutique\",\"url\":\"https://onirique.store/boutique\"},{\"type\":\"dossier\",\"nom\":\"Musique\",\"elements\":[{\"type\":\"site\",\"nom\":\"YouTube\",\"url\":\"https://www.youtube.com/\"},{\"type\":\"site\",\"nom\":\"Spotify\",\"url\":\"https://open.spotify.com/\"},{\"type\":\"site\",\"nom\":\"SoundCloud\",\"url\":\"https://soundcloud.com/\"}]},{\"type\":\"site\",\"nom\":\"Outils\",\"url\":\"https://onirique.store/outils\"}]";

    void EchelleAjouts()
    {
        favoris.Height = this.S(32);
        favoris.Font = Font;
        favoris.Glyphes = new Font("Segoe Fluent Icons", this.S(13), GraphicsUnit.Pixel);
        laterale.Width = this.S(48);
        teteDePanneau.Height = this.S(38);
        titreDePanneau.Font = new Font("Segoe UI Variable Text", this.S(13), FontStyle.Bold, GraphicsUnit.Pixel);
        var icones = new Font("Segoe Fluent Icons", this.S(14), GraphicsUnit.Pixel);
        foreach (var b in boutonsDePanneau.Append(ouvrirEnOnglet).Append(fermerPanneau)) b.Font = icones;
        champ.Etoile.Font = new Font("Segoe Fluent Icons", this.S(13), GraphicsUnit.Pixel);
        suggestions.Font = Font;
        panneauLecteur.Font = new Font("Segoe UI Variable Text", this.S(13), GraphicsUnit.Pixel);
    }

    void PlacerAjouts()
    {
        int y = this.S(10);
        foreach (var b in boutonsDePanneau) { b.SetBounds(this.S(6), y, this.S(36), this.S(36)); y += this.S(42); }
        int h = this.S(30), haut = (teteDePanneau.Height - h) / 2;
        fermerPanneau.SetBounds(teteDePanneau.Width - this.S(40), haut, this.S(32), h);
        ouvrirEnOnglet.SetBounds(teteDePanneau.Width - this.S(74), haut, this.S(32), h);
        titreDePanneau.SetBounds(this.S(14), 0, Math.Max(0, teteDePanneau.Width - this.S(92)), teteDePanneau.Height);
        if (panneauLecteur is { Visible: true }) MontrerLecteur();
    }

    async Task DemarrerAjouts()
    {
        await Task.Delay(3000);
        await Synchroniser();
    }

    void BrancherAjouts(Onglet? o, CoreWebView2 c)
    {
        // Bloqueur : seules les requêtes vers les régies listées passent par ici ; le reste n'est jamais ralenti.
        foreach (var d in Pubs.Value)
        {
            c.AddWebResourceRequestedFilter($"*://{d}/*", CoreWebView2WebResourceContext.All);
            c.AddWebResourceRequestedFilter($"*://*.{d}/*", CoreWebView2WebResourceContext.All);
        }
        c.WebResourceRequested += (_, e) =>
        {
            if (!Reglages.Bloqueur) return;
            e.Response = c.Environment.CreateWebResourceResponse(null, 403, "Blocked", "");
            pubsBloquees++;
        };
        try
        {
            Directory.CreateDirectory(DossierFichiers);
            c.SetVirtualHostNameToFolderMapping(HoteFichiers, DossierFichiers, CoreWebView2HostResourceAccessKind.DenyCors);
        }
        catch { }
        c.IsDocumentPlayingAudioChanged += (_, _) =>
        {
            if (c.IsDocumentPlayingAudio) source = new SourceAudio(c, () => o?.Titre ?? c.DocumentTitle, () => { if (o != null) Activer(o); else if (panneauOuvert == null) BasculerPanneau(PanneauDe(c)); });
            MajLecteur();
        };
    }

    bool AnimerAjouts()
    {
        float cible = panneauOuvert == null ? 0 : this.S(Reglages.PanneauLargeur > 0 ? Reglages.PanneauLargeur : 460);
        if (Math.Abs(panneauLargeur - cible) < 0.5f) return false;
        panneauLargeur = Reglages.Animations ? panneauLargeur + (cible - panneauLargeur) * 0.3f : cible;
        if (Math.Abs(panneauLargeur - cible) < 1f) panneauLargeur = cible;
        panneau.Width = (int)panneauLargeur;
        return panneauLargeur != cible;
    }

    void EntretienAjouts()
    {
        if (++tour % 2 == 0) SurveillerStudio();
        Limiter();
        // Une page fermée (onglet, fenêtre de connexion…) ne peut plus être interrogée : on vérifie qu'elle vit encore avant tout.
        if (source != null && (!Vues().Concat(vuesDePanneau.Values.Select(v => v.CoreWebView2).OfType<CoreWebView2>()).Contains(source.Vue) || source.Vue.IsSuspended)) { source = null; MajLecteur(); }
        // Les panneaux fermés s'endorment comme des onglets cachés, sauf s'ils jouent de la musique.
        foreach (var (id, v) in vuesDePanneau)
            if (id != panneauOuvert && v.CoreWebView2 is { } c && !c.IsDocumentPlayingAudio && !enPip.Contains(c) && !c.IsSuspended) _ = Suspendre(c);
        if (synchroAEnvoyer is { } quand && DateTime.Now > quand) { synchroAEnvoyer = null; _ = EnvoyerProfil(); }
        if (DateTime.Now - synchroVue > TimeSpan.FromMinutes(10)) _ = Synchroniser();
    }
    int tour;

    internal void Decharger(Onglet o)
    {
        var vue = o.Vue;
        if (vue == null) return;
        o.Vue = null;
        o.ScriptGoogle = null;
        o.Decharge = true;
        vue.Dispose();
        Redessiner();
    }

    async Task<bool> ChangerAjout(string cle, JsonNode? valeur)
    {
        bool B() => valeur?.GetValue<bool>() == true;
        int N() => valeur?.GetValue<int>() ?? 0;
        switch (cle)
        {
            case "ModeStudio": Reglages.ModeStudio = B(); MajStudio(); break;
            case "Bloqueur": Reglages.Bloqueur = B(); break;
            case "PlafondMemoire": Reglages.PlafondMemoire = Math.Clamp(N(), 0, 65536); break;
            case "PlafondCpu": Reglages.PlafondCpu = Math.Clamp(N(), 0, 100); break;
            case "Extensions":
                // Le moteur ne prend les extensions qu'au démarrage : il est relancé, les onglets se rechargent.
                Reglages.Extensions = extensionsActives = B();
                Reglages.Enregistrer();
                await Relancer(relaisMoteur);
                await MajExtensions();
                EnvoyerEtatAuxPagesInternes();
                return false;
            case "BarreFavoris": Reglages.BarreFavoris = favoris.Visible = B(); break;
            case "OngletsVerticaux": Reglages.OngletsVerticaux = B(); AppliquerDisposition(); break;
            case "BarreLaterale":
                Reglages.BarreLaterale = laterale.Visible = B();
                if (!B()) BasculerPanneau(null);
                break;
            case "Fond":
                if ((string?)valeur is "nuit" or "anime" || ((string?)valeur == "image" && Reglages.FondFichier != null)) Reglages.Fond = (string)valeur!;
                Reglages.Enregistrer();
                EnvoyerEtatAuxPagesInternes();
                return true;
            case "Synchro":
                Reglages.Synchro = B();
                if (B()) { Reglages.Enregistrer(); await Synchroniser(); EnvoyerEtatAuxPagesInternes(); return false; }
                break;
            default: return false;
        }
        await Task.CompletedTask;
        return true;
    }

    JsonObject EtatAjouts() => new()
    {
        ["pubs"] = pubsBloquees,
        ["memoire"] = memoireMo,
        ["cpu"] = Math.Round(cpuPct),
        ["studio"] = StudioActif ? dawOuvert : null,
        ["fond"] = Reglages.Fond == "image" && Reglages.FondFichier != null ? $"https://{HoteFichiers}/{Reglages.FondFichier}?v={Reglages.FondVersion}" : null,
        ["synchro"] = synchroEtat,
    };

    // ——— Favoris : l'étoile ajoute la page à l'accueil (ou l'en retire) ———

    internal JsonArray Raccourcis()
    {
        try { if (Reglages.Raccourcis != null && JsonNode.Parse(Reglages.Raccourcis) is JsonArray a) return a; } catch { }
        try { if (JsonNode.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "accueil", "raccourcis.json"))) is JsonArray d) return d; } catch { }
        return new JsonArray();
    }

    static string Cle(string url) => url.Trim().TrimEnd('/').ToLowerInvariant();

    static IEnumerable<JsonObject> Sites(JsonArray liste) => liste.OfType<JsonObject>()
        .SelectMany(x => (string?)x["type"] == "dossier" ? (x["elements"] as JsonArray ?? new JsonArray()).OfType<JsonObject>() : new[] { x });

    void MajEtoile()
    {
        var o = Actif;
        bool web = o != null && !EstInterne(o.Url) && o.Url.StartsWith("http", StringComparison.OrdinalIgnoreCase);
        bool favori = web && Sites(Raccourcis()).Any(s => Cle((string?)s["url"] ?? "") == Cle(o!.Url));
        champ.Etoile.Visible = web;
        champ.Etoile.Glyphe = favori ? "" : "";
        champ.Etoile.Teinte = favori ? DA.BraiseClaire : DA.Cendre;
        champ.Etoile.Aide = favori ? "Retirer de l'accueil" : "Ajouter à l'accueil";
        champ.PerformLayout();
        favoris.Invalidate();
    }

    void BasculerFavori() { if (Actif is { } o) BasculerFavori(o.Url, o.Titre); }

    void BasculerFavori(string url, string titre)
    {
        var liste = Raccourcis();
        var cle = Cle(url);
        bool retire = false;
        for (int i = liste.Count - 1; i >= 0; i--)
        {
            if (liste[i] is not JsonObject x) continue;
            if ((string?)x["type"] == "dossier" && x["elements"] is JsonArray el)
            {
                for (int j = el.Count - 1; j >= 0; j--) if (Cle((string?)el[j]?["url"] ?? "") == cle) { el.RemoveAt(j); retire = true; }
                // Un dossier qui n'a plus qu'un site redevient ce site ; vide, il disparaît (comme sur l'accueil).
                if (el.Count == 1) { var seul = el[0]; el.RemoveAt(0); liste[i] = seul; }
                else if (el.Count == 0) liste.RemoveAt(i);
            }
            else if (Cle((string?)x["url"] ?? "") == cle) { liste.RemoveAt(i); retire = true; }
        }
        if (!retire)
        {
            var nom = titre.Trim();
            if (nom.Length == 0 || nom.Length > 28) nom = Uri.TryCreate(url, UriKind.Absolute, out var u) ? u.Host.Replace("www.", "") : url;
            liste.Add(new JsonObject { ["type"] = "site", ["nom"] = nom, ["url"] = url });
        }
        Reglages.Raccourcis = liste.ToJsonString();
        Reglages.Enregistrer();
        MajEtoile();
        EnvoyerEtatAuxPagesInternes();
        ProfilChange();
        bulle.Montrer(retire ? "Retiré de ton accueil." : "Ajouté à ton accueil.");
    }

    // ——— Suggestions de la barre d'adresse ———

    void ProposerSuggestions()
    {
        var texte = champ.Saisie.Text.Trim();
        if (texte.Length == 0) { suggestions.Visible = false; return; }
        var mots = texte.ToLowerInvariant().Split(' ', StringSplitOptions.RemoveEmptyEntries);
        var lignes = new List<Suggestions.Ligne>();
        var direct = Resoudre(texte);
        bool recherche = direct == Reglages.Recherche(texte);
        lignes.Add(new(recherche ? $"Rechercher « {texte} »" : $"Aller à {texte}", recherche ? "" : direct, direct, recherche ? "" : ""));
        foreach (var s in Sites(Raccourcis()))
        {
            string u = (string?)s["url"] ?? "", n = (string?)s["nom"] ?? "";
            if (lignes.Count < 4 && mots.All((n + " " + u).ToLowerInvariant().Contains)) lignes.Add(new(n, u, u, ""));
        }
        foreach (var h in Historique.Suggerer(texte, 8))
        {
            if (lignes.Count >= 7) break;
            if (!lignes.Any(l => Cle(l.Url) == Cle(h.u))) lignes.Add(new(h.ti.Length > 0 ? h.ti : h.u, h.u, h.u, ""));
        }
        var zone = RectangleToClient(champ.RectangleToScreen(champ.ClientRectangle));
        suggestions.Montrer(lignes, zone);
    }

    // ——— Mode Studio : un logiciel de musique ouvert, et les onglets cachés lui laissent la machine ———

    static readonly (string Processus, string Nom, bool Exact)[] Daws =
    {
        ("FL64", "FL Studio", true), ("FL", "FL Studio", true), ("Ableton Live", "Ableton Live", false), ("reaper", "REAPER", true),
        ("Cubase", "Cubase", false), ("Studio One", "Studio One", false), ("Bitwig Studio", "Bitwig Studio", false), ("ProTools", "Pro Tools", false),
        ("Reason", "Reason", false), ("Cakewalk", "Cakewalk", false), ("Ardour", "Ardour", false), ("LMMS", "LMMS", true), ("Renoise", "Renoise", false),
    };
    string? dawOuvert;
    bool StudioActif => Reglages.ModeStudio && dawOuvert != null;
    int VeilleEffective => StudioActif ? 1 : Reglages.VeilleSecondes;
    int DechargementEffectif => StudioActif ? 2 : Reglages.DechargementMinutes;

    void SurveillerStudio()
    {
        string? trouve = null;
        if (Reglages.ModeStudio)
            foreach (var p in Process.GetProcesses())
            {
                using (p)
                {
                    if (trouve != null) continue;
                    var n = p.ProcessName;
                    foreach (var d in Daws)
                        if (d.Exact ? n.Equals(d.Processus, StringComparison.OrdinalIgnoreCase) : n.StartsWith(d.Processus, StringComparison.OrdinalIgnoreCase)) { trouve = d.Nom; break; }
                }
            }
        if (trouve == dawOuvert) return;
        dawOuvert = trouve;
        MajStudio();
        if (trouve != null) bulle.Montrer($"Mode Studio : {trouve} est ouvert, les onglets cachés s'endorment tout de suite pour lui laisser la machine.");
    }

    void MajStudio()
    {
        studio.Visible = StudioActif;
        studio.Aide = StudioActif ? $"Mode Studio actif : {dawOuvert}" : "Mode Studio";
        Disposer();
        if (StudioActif)
            foreach (var o in Onglets)
                if (!EstAffiche(o) && !o.Son && !EnPip(o) && o.Vue?.CoreWebView2 is { } c) { c.MemoryUsageTargetLevel = CoreWebView2MemoryUsageTargetLevel.Low; if (!c.IsSuspended) _ = Suspendre(c); }
        EnvoyerEtatAuxPagesInternes();
    }

    // ——— Limiteurs de mémoire et de processeur ———

    int memoireMo;
    double cpuPct;
    TimeSpan cpuAvant;
    DateTime cpuMesure;
    int pubsBloquees;

    void CompterRessources(long octets, TimeSpan cpu)
    {
        memoireMo = (int)(octets / 1048576);
        var maintenant = DateTime.Now;
        if (cpuMesure != default)
            cpuPct = Math.Max(0, (cpu - cpuAvant).TotalMilliseconds / (maintenant - cpuMesure).TotalMilliseconds / Environment.ProcessorCount * 100);
        cpuAvant = cpu;
        cpuMesure = maintenant;
    }

    void Limiter()
    {
        var caches = Onglets.Where(o => !EstAffiche(o) && !o.Son && !EnPip(o) && o.Vue?.CoreWebView2 != null).OrderBy(o => o.CacheDepuis).ToList();
        // Au-dessus du plafond de mémoire : le plus ancien onglet caché est libéré, un par passage, jusqu'à repasser dessous.
        if (Reglages.PlafondMemoire > 0 && memoireMo > Reglages.PlafondMemoire && caches.Count > 0) Decharger(caches[0]);
        // Au-dessus du plafond de processeur : tous les onglets cachés s'endorment.
        if (Reglages.PlafondCpu > 0 && cpuPct > Reglages.PlafondCpu)
            foreach (var o in caches) if (o.Vue?.CoreWebView2 is { IsSuspended: false } c) _ = Suspendre(c);
    }

    static readonly Lazy<string[]> Pubs = new(() =>
    {
        try
        {
            return File.ReadAllLines(Path.Combine(AppContext.BaseDirectory, "accueil", "pubs.txt"))
                .Select(l => l.Trim()).Where(l => l.Length > 0 && !l.StartsWith('#')).ToArray();
        }
        catch { return Array.Empty<string>(); }
    });

    // ——— Mini-lecteur : ce qui joue, dans n'importe quel onglet ou panneau ———

    internal sealed record SourceAudio(CoreWebView2 Vue, Func<string> Titre, Action Aller);
    internal SourceAudio? source;

    void MajLecteur()
    {
        lecteur.Visible = source != null;
        try { lecteur.Temoin = source?.Vue.IsDocumentPlayingAudio == true; } catch { source = null; lecteur.Temoin = false; }
        if (source == null) panneauLecteur.Visible = false;
        Disposer();
        panneauLecteur.Invalidate();
    }

    void MontrerLecteur()
    {
        if (source == null) return;
        var zone = RectangleToClient(lecteur.RectangleToScreen(lecteur.ClientRectangle));
        int largeur = this.S(320);
        panneauLecteur.SetBounds(Math.Max(this.S(8), zone.Right - largeur), zone.Bottom + this.S(6), largeur, this.S(112));
        panneauLecteur.Visible = true;
        panneauLecteur.BringToFront();
    }

    internal async Task LectureOuPause()
    {
        if (source == null) return;
        try
        {
            await source.Vue.ExecuteScriptAsync(
                "(()=>{const m=[...document.querySelectorAll('video,audio')];const joue=m.some(x=>!x.paused);m.forEach(x=>joue?x.pause():x.play());})()");
        }
        catch { }
        await Task.Delay(300);
        MajLecteur();
    }

    // ——— Barre latérale ———

    string? PanneauDe(CoreWebView2 c) => vuesDePanneau.FirstOrDefault(p => p.Value.CoreWebView2 == c).Key;

    internal async void BasculerPanneau(string? id)
    {
        if (id == panneauOuvert) id = null;
        if (panneauOuvert != null && vuesDePanneau.TryGetValue(panneauOuvert, out var ancienne)) ancienne.Visible = false;
        panneauOuvert = id;
        foreach (var b in boutonsDePanneau) b.Temoin = (string?)b.Tag == id;
        Animer();
        if (id == null) return;
        var service = Services.First(s => s.Id == id);
        titreDePanneau.Text = service.Nom;
        if (!vuesDePanneau.TryGetValue(id, out var vue))
        {
            vue = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = DA.Nuit };
            vuesDePanneau[id] = vue;
            panneau.Controls.Add(vue);
            vue.BringToFront();
            _ = vue.Handle;
            try { await vue.EnsureCoreWebView2Async(env); } catch { vuesDePanneau.Remove(id); return; }
            var c = vue.CoreWebView2;
            AppliquerProfil(c);
            BrancherAjouts(null, c);
            c.NewWindowRequested += (_, e) => { e.Handled = true; _ = Ouvrir(e.Uri); };
            c.Navigate(service.Url);
        }
        if (panneauOuvert != id) return;
        vue.Visible = true;
        vue.BringToFront();
        if (vue.CoreWebView2 is { } cv) { cv.MemoryUsageTargetLevel = CoreWebView2MemoryUsageTargetLevel.Normal; cv.Resume(); }
    }

    void FermerPanneaux()
    {
        foreach (var v in vuesDePanneau.Values) v.Dispose();
        vuesDePanneau.Clear();
        panneauOuvert = null;
        foreach (var b in boutonsDePanneau) b.Temoin = false;
        panneau.Width = 0;
        panneauLargeur = 0;
        source = null;
        MajLecteur();
    }

    // ——— Fond de l'accueil : une image choisie ———

    async Task RecevoirFond(JsonObject m)
    {
        var donnees = (string?)m["image"] ?? "";
        var morceaux = System.Text.RegularExpressions.Regex.Match(donnees, @"^data:image/(png|jpeg|webp|gif);base64,(.+)$", System.Text.RegularExpressions.RegexOptions.Singleline);
        if (!morceaux.Success) { bulle.Montrer("Cette image n'est pas lisible : choisis un fichier JPG, PNG, WebP ou GIF."); return; }
        byte[] octets;
        try { octets = Convert.FromBase64String(morceaux.Groups[2].Value); } catch { return; }
        if (octets.Length > 15 * 1048576) { bulle.Montrer("Image trop lourde : 15 Mo au plus."); return; }
        Directory.CreateDirectory(DossierFichiers);
        foreach (var ancien in Directory.GetFiles(DossierFichiers, "fond.*")) try { File.Delete(ancien); } catch { }
        var nom = "fond." + (morceaux.Groups[1].Value == "jpeg" ? "jpg" : morceaux.Groups[1].Value);
        await File.WriteAllBytesAsync(Path.Combine(DossierFichiers, nom), octets);
        Reglages.Fond = "image";
        Reglages.FondFichier = nom;
        Reglages.FondVersion = DateTime.Now.Ticks;
        Reglages.Enregistrer();
        EnvoyerEtatAuxPagesInternes();
    }

    // ——— Synchronisation avec le compte ONIRIQUE (raccourcis, couleur, moteur de recherche) ———

    string? jetonCompte;
    string derniereEmpreinte = "";
    DateTime synchroVue;
    DateTime? synchroAEnvoyer;
    string synchroEtat = "";
    const string ApiProfil = "https://onirique.store/api/navigateur/profil";

    JsonObject ProfilSynchro() => new()
    {
        ["Raccourcis"] = Raccourcis(),
        ["Accent"] = Reglages.Accent,
        ["Moteur"] = Reglages.Moteur,
    };

    void ProfilChange()
    {
        var empreinte = ProfilSynchro().ToJsonString();
        if (empreinte == derniereEmpreinte) return;
        derniereEmpreinte = empreinte;
        Reglages.SynchroDate = DateTimeOffset.Now.ToUnixTimeMilliseconds();
        Reglages.Enregistrer();
        if (Reglages.Synchro) synchroAEnvoyer = DateTime.Now.AddSeconds(4);
    }

    async Task<HttpResponseMessage?> Appeler(HttpMethod methode, JsonObject? corps = null)
    {
        if (env == null) return null;
        jetonCompte ??= await Vpn.LireJeton(env, contenu);
        if (string.IsNullOrEmpty(jetonCompte)) { jetonCompte = null; synchroEtat = "Connecte-toi à ton compte ONIRIQUE (avec « Rester connecté ») pour synchroniser."; return null; }
        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
        var requete = new HttpRequestMessage(methode, ApiProfil);
        requete.Headers.Authorization = new AuthenticationHeaderValue("Bearer", jetonCompte);
        if (corps != null) requete.Content = new StringContent(corps.ToJsonString(), Encoding.UTF8, "application/json");
        var reponse = await http.SendAsync(requete);
        if (reponse.StatusCode == HttpStatusCode.Unauthorized) { jetonCompte = null; synchroEtat = "Ta connexion à ONIRIQUE a expiré : reconnecte-toi sur onirique.store."; }
        return reponse;
    }

    async Task Synchroniser()
    {
        synchroVue = DateTime.Now;
        if (!Reglages.Synchro) return;
        try
        {
            using var reponse = await Appeler(HttpMethod.Get);
            if (reponse is not { IsSuccessStatusCode: true }) return;
            var distant = JsonNode.Parse(await reponse.Content.ReadAsStringAsync());
            long date = (long?)distant?["date"] ?? 0;
            if (date > Reglages.SynchroDate && distant?["donnees"] is JsonObject d)
            {
                if (d["Raccourcis"] is JsonArray r) Reglages.Raccourcis = r.ToJsonString();
                if ((string?)d["Moteur"] is { } moteur && Parametres.Moteurs.Any(x => x.Id == moteur)) Reglages.Moteur = moteur;
                if ((string?)d["Accent"] is { } accent && System.Text.RegularExpressions.Regex.IsMatch(accent, "^#[0-9a-fA-F]{6}$") && accent != Reglages.Accent)
                {
                    Reglages.Accent = accent;
                    DA.Accent(accent);
                    Invalidate(true);
                    await RemettreScriptsGoogle();
                }
                Reglages.SynchroDate = date;
                Reglages.Enregistrer();
                derniereEmpreinte = ProfilSynchro().ToJsonString();
                MajEtoile();
            }
            else if (Reglages.SynchroDate > date) await EnvoyerProfil();
            synchroEtat = $"Synchronisé à {DateTime.Now:HH:mm}.";
        }
        catch { synchroEtat = "Synchronisation impossible pour l'instant."; }
        EnvoyerEtatAuxPagesInternes();
    }

    async Task EnvoyerProfil()
    {
        if (!Reglages.Synchro) return;
        try
        {
            using var reponse = await Appeler(HttpMethod.Put, new JsonObject { ["donnees"] = ProfilSynchro(), ["date"] = Reglages.SynchroDate });
            if (reponse == null) return;
            if (reponse.StatusCode == HttpStatusCode.Conflict) { await Synchroniser(); return; }
            if (reponse.IsSuccessStatusCode) synchroEtat = $"Synchronisé à {DateTime.Now:HH:mm}.";
        }
        catch { synchroEtat = "Synchronisation impossible pour l'instant."; }
        EnvoyerEtatAuxPagesInternes();
    }
}

/// <summary>La liste de suggestions sous la barre d'adresse ; elle ne prend jamais le focus.</summary>
sealed class Suggestions : Control
{
    public sealed record Ligne(string Titre, string Detail, string Url, string Glyphe);
    List<Ligne> lignes = new();
    int choix = -1;
    public event Action<string>? Choisie;

    public Suggestions()
    {
        DoubleBuffered = true;
        SetStyle(ControlStyles.Selectable, false);
        Visible = false;
        BackColor = DA.Nuit;
    }

    int H => this.S(36);
    public string? Selection => Visible && choix >= 0 && choix < lignes.Count ? lignes[choix].Url : null;

    public void Montrer(List<Ligne> l, Rectangle sous)
    {
        lignes = l;
        choix = -1;
        Bounds = new Rectangle(sous.X, sous.Bottom + this.S(4), sous.Width, l.Count * H + this.S(10));
        Visible = l.Count > 0;
        BringToFront();
        Invalidate();
    }

    public void Deplacer(int sens)
    {
        choix = Math.Clamp(choix + sens, -1, lignes.Count - 1);
        Invalidate();
    }

    int Rang(Point p) => p.Y < this.S(5) ? -1 : Math.Min(lignes.Count - 1, (p.Y - this.S(5)) / H);

    protected override void OnMouseMove(MouseEventArgs e) { base.OnMouseMove(e); int i = Rang(e.Location); if (i != choix) { choix = i; Invalidate(); } }
    protected override void OnMouseDown(MouseEventArgs e) { base.OnMouseDown(e); int i = Rang(e.Location); if (i >= 0) Choisie?.Invoke(lignes[i].Url); }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.Clear(DA.Nuit);
        using var chemin = DA.Arrondi(new Rectangle(0, 0, Width - 1, Height - 1), this.S(12));
        using var fond = new SolidBrush(DA.Fond);
        g.FillPath(fond, chemin);
        using var filet = new Pen(DA.Filet);
        g.DrawPath(filet, chemin);
        using var icones = new Font("Segoe Fluent Icons", this.S(12), GraphicsUnit.Pixel);
        for (int i = 0; i < lignes.Count; i++)
        {
            var r = new Rectangle(this.S(5), this.S(5) + i * H, Width - this.S(10), H);
            if (i == choix)
            {
                using var sel = DA.Arrondi(r, this.S(8));
                using var b = new SolidBrush(DA.Survol);
                g.FillPath(b, sel);
                using var temoin = new SolidBrush(DA.Braise);
                g.FillRectangle(temoin, r.X, r.Y + this.S(9), this.S(2), r.Height - this.S(18));
            }
            var l = lignes[i];
            TextRenderer.DrawText(g, l.Glyphe, icones, new Rectangle(r.X + this.S(12), r.Y, this.S(20), r.Height), i == 0 ? DA.BraiseClaire : DA.Cendre,
                TextFormatFlags.VerticalCenter | TextFormatFlags.HorizontalCenter | TextFormatFlags.NoPadding);
            var texte = new Rectangle(r.X + this.S(42), r.Y, r.Width - this.S(52), r.Height);
            var largeurTitre = Math.Min(TextRenderer.MeasureText(l.Titre, Font).Width, (int)(texte.Width * 0.62));
            TextRenderer.DrawText(g, l.Titre, Font, new Rectangle(texte.X, texte.Y, largeurTitre, texte.Height), DA.Brume,
                TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis | TextFormatFlags.SingleLine | TextFormatFlags.NoPrefix);
            if (l.Detail.Length > 0 && l.Detail != l.Titre)
                TextRenderer.DrawText(g, "— " + l.Detail, Font, new Rectangle(texte.X + largeurTitre + this.S(8), texte.Y, Math.Max(0, texte.Width - largeurTitre - this.S(8)), texte.Height), DA.Eteint,
                    TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis | TextFormatFlags.SingleLine | TextFormatFlags.NoPrefix);
        }
    }
}

/// <summary>Le mini-lecteur : titre de ce qui joue, lecture ou pause, son coupé, aller à l'onglet.</summary>
sealed class Lecteur : Control
{
    readonly Navigateur nav;
    int survol = -1;

    public Lecteur(Navigateur nav)
    {
        this.nav = nav;
        DoubleBuffered = true;
        Visible = false;
        BackColor = DA.Nuit;
    }

    Rectangle Bouton(int i) => new(this.S(16) + i * this.S(48), Height - this.S(52), this.S(40), this.S(40));

    protected override void OnMouseMove(MouseEventArgs e)
    {
        base.OnMouseMove(e);
        int s = Enumerable.Range(0, 4).FirstOrDefault(i => Bouton(i).Contains(e.Location), -1);
        if (s != survol) { survol = s; Cursor = s >= 0 ? Cursors.Hand : Cursors.Default; Invalidate(); }
    }

    protected override async void OnMouseClick(MouseEventArgs e)
    {
        base.OnMouseClick(e);
        var src = nav.source;
        if (src == null) return;
        if (Bouton(0).Contains(e.Location)) await nav.LectureOuPause();
        else if (Bouton(1).Contains(e.Location)) src.Vue.IsMuted = !src.Vue.IsMuted;
        else if (Bouton(2).Contains(e.Location)) { src.Aller(); Visible = false; }
        else if (Bouton(3).Contains(e.Location)) await nav.BasculerPip(src.Vue);
        Invalidate();
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.Clear(DA.Nuit);
        using var chemin = DA.Arrondi(new Rectangle(0, 0, Width - 1, Height - 1), this.S(14));
        using var fond = new SolidBrush(DA.Fond);
        g.FillPath(fond, chemin);
        using var filet = new Pen(DA.Filet);
        g.DrawPath(filet, chemin);
        var src = nav.source;
        if (src == null) return;
        bool joue;
        try { joue = src.Vue.IsDocumentPlayingAudio; } catch { return; }
        string titre;
        try { titre = src.Titre(); } catch { titre = ""; }
        TextRenderer.DrawText(g, joue ? "EN LECTURE" : "EN PAUSE", new Font("Cascadia Mono", this.S(10), GraphicsUnit.Pixel), new Point(this.S(18), this.S(14)), joue ? DA.BraiseClaire : DA.Eteint, TextFormatFlags.NoPadding);
        TextRenderer.DrawText(g, titre, Font, new Rectangle(this.S(18), this.S(30), Width - this.S(36), this.S(22)), DA.Brume,
            TextFormatFlags.EndEllipsis | TextFormatFlags.SingleLine | TextFormatFlags.NoPrefix);
        using var icones = new Font("Segoe Fluent Icons", this.S(16), GraphicsUnit.Pixel);
        string[] glyphes = { joue ? "" : "", src.Vue.IsMuted ? "" : "", "" , "" };
        for (int i = 0; i < 4; i++)
        {
            var r = Bouton(i);
            using var forme = DA.Arrondi(r, this.S(10));
            using var b = new SolidBrush(i == 0 ? DA.Braise : i == survol ? DA.Survol : DA.Nuit);
            g.FillPath(b, forme);
            TextRenderer.DrawText(g, glyphes[i], icones, r, i == 0 ? Color.White : DA.Brume, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
        }
    }
}
