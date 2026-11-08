using System.Diagnostics;
using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Onirique;

static class DA
{
    // Palette « interface » de la charte ONIRIQUE (applications et plugins).
    public static readonly Color Nuit = Color.FromArgb(9, 8, 10);
    public static readonly Color Fond = Color.FromArgb(18, 16, 18);       // Profondeur
    public static readonly Color Survol = Color.FromArgb(30, 24, 27);
    public static readonly Color Filet = Color.FromArgb(41, 34, 37);
    // L'accent (la braise par défaut) suit la couleur choisie dans les Paramètres, comme dans l'application CENTRAL.
    public static Color Braise { get; private set; } = Color.FromArgb(229, 56, 74);
    public static Color BraiseClaire { get; private set; } = Color.FromArgb(255, 142, 154); // Rose
    public static Color Sang { get; private set; } = Color.FromArgb(122, 13, 28);
    public const string AccentParDefaut = "#e5384a";
    public static readonly (string Hex, string Nom)[] Accents =
    {
        ("#e5384a", "Braise"), ("#ff6a3d", "Corail"), ("#e8b33a", "Or"), ("#22c28a", "Émeraude"), ("#2bb8d6", "Lagon"),
        ("#3d7bff", "Océan"), ("#8b5cf6", "Améthyste"), ("#e64aa8", "Fuchsia"), ("#a3a3a3", "Acier"),
    };

    /// <summary>Les trois teintes de l'accent ; même calcul que le site et l'application (accent.js, accentPalette).</summary>
    public static (Color Acc, Color Hi, Color Lo) Palette(string hex)
    {
        if (!System.Text.RegularExpressions.Regex.IsMatch(hex ?? "", "^#[0-9a-fA-F]{6}$") || hex!.Equals(AccentParDefaut, StringComparison.OrdinalIgnoreCase))
            return (Color.FromArgb(229, 56, 74), Color.FromArgb(255, 142, 154), Color.FromArgb(122, 13, 28));
        int n = Convert.ToInt32(hex[1..], 16);
        double r = (n >> 16) / 255.0, g = ((n >> 8) & 255) / 255.0, b = (n & 255) / 255.0;
        double max = Math.Max(r, Math.Max(g, b)), min = Math.Min(r, Math.Min(g, b)), l = (max + min) / 2, d = max - min, teinte = 0, sat = 0;
        if (d > 0)
        {
            sat = d / (1 - Math.Abs(2 * l - 1));
            teinte = max == r ? ((g - b) / d) % 6 : max == g ? (b - r) / d + 2 : (r - g) / d + 4;
            teinte = (teinte * 60 + 360) % 360;
        }
        static Color Rgb(double H, double S, double L)
        {
            double c = (1 - Math.Abs(2 * L - 1)) * S, x = c * (1 - Math.Abs((H / 60) % 2 - 1)), m = L - c / 2;
            var (a, bb, cc) = H < 60 ? (c, x, 0.0) : H < 120 ? (x, c, 0.0) : H < 180 ? (0.0, c, x) : H < 240 ? (0.0, x, c) : H < 300 ? (x, 0.0, c) : (c, 0.0, x);
            int V(double v) => (int)Math.Round((v + m) * 255);
            return Color.FromArgb(V(a), V(bb), V(cc));
        }
        double s = sat < 0.08 ? 0 : Math.Max(0.55, Math.Min(0.9, sat));
        return (Rgb(teinte, s, Math.Max(0.5, Math.Min(0.62, l))), Rgb(teinte, s > 0 ? Math.Min(1, s + 0.1) : 0, 0.76), Rgb(teinte, s, 0.26));
    }

    public static void Accent(string hex) => (Braise, BraiseClaire, Sang) = Palette(hex);
    public static string Triplet(Color c) => $"{c.R}, {c.G}, {c.B}";

    public static readonly Color Brume = Color.FromArgb(244, 236, 236);   // Os
    public static readonly Color Etiquette = Color.FromArgb(217, 198, 201);
    public static readonly Color Cendre = Color.FromArgb(168, 147, 154);  // Voile
    public static readonly Color Eteint = Color.FromArgb(125, 106, 110);  // Graduation

    public static int S(this Control c, int v) => (int)Math.Round(v * c.DeviceDpi / 96.0);

    public static GraphicsPath Arrondi(Rectangle r, int rayon, bool basCarre = false)
    {
        int d = Math.Max(1, Math.Min(rayon * 2, Math.Min(r.Width, r.Height)));
        var p = new GraphicsPath();
        p.AddArc(r.X, r.Y, d, d, 180, 90);
        p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
        if (basCarre) p.AddLine(r.Right, r.Bottom, r.X, r.Bottom);
        else
        {
            p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
            p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
        }
        p.CloseFigure();
        return p;
    }

    [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int valeur, int taille);

    /// <summary>Barre de titre Windows aux couleurs de la nuit (couleurs en 0x00BBGGRR).</summary>
    public static void BarreSombre(IntPtr fenetre)
    {
        int oui = 1, legende = 0x0A0809, texte = 0xECECF4, bord = 0x252229;
        DwmSetWindowAttribute(fenetre, 20, ref oui, 4);
        DwmSetWindowAttribute(fenetre, 35, ref legende, 4);
        DwmSetWindowAttribute(fenetre, 36, ref texte, 4);
        DwmSetWindowAttribute(fenetre, 34, ref bord, 4);
    }
}

sealed class Onglet
{
    public WebView2? Vue;
    public string Url = "";
    public string Titre = "Nouvel onglet";
    public Image? Icone;
    public bool Charge, Son, Decharge;
    public DateTime CacheDepuis = DateTime.MaxValue;
    public string? ScriptGoogle;
    public float X = -1, W;  // position affichée dans le bandeau (animée)
    public Groupe? Groupe;
    public Onglet? Partenaire;  // l'autre moitié d'un écran divisé
}

sealed partial class Navigateur : Form
{
    const string Hote = "accueil.onirique";
    const string Accueil = "https://" + Hote + "/index.html";
    const string PageParametres = "https://" + Hote + "/parametres.html";
    const string PageHistorique = "https://" + Hote + "/historique.html";

    internal readonly List<Onglet> Onglets = new();
    internal Onglet? Actif;
    internal readonly Parametres Reglages = Parametres.Lire();

    readonly Panel contenu = new() { Dock = DockStyle.Fill, BackColor = DA.Nuit };
    readonly Panel barre = new() { Dock = DockStyle.Top, BackColor = DA.Fond };
    readonly Bandeau bandeau;
    readonly Bouton retour = new("", "Page précédente (Alt+Gauche)");
    readonly Bouton avance = new("", "Page suivante (Alt+Droite)");
    readonly Bouton recharger = new("", "Actualiser (F5)");
    readonly Bouton vpn = new("", "VPN ONIRIQUE : éteint");
    readonly Bouton historique = new("\uE81C", "Historique (Ctrl+H)");
    readonly Bouton reglages = new("", "Paramètres");
    readonly Champ champ = new();
    readonly Label memoire = new() { ForeColor = DA.Cendre, BackColor = DA.Fond, TextAlign = ContentAlignment.MiddleRight, AccessibleName = "Mémoire utilisée" };
    readonly Bulle bulle;
    readonly System.Windows.Forms.Timer minuteur = new() { Interval = 5000 };
    readonly System.Windows.Forms.Timer animation = new() { Interval = 15 };
    readonly string[] adressesDeDepart;
    readonly string scriptGoogle;
    CoreWebView2Environment? env;
    FormWindowState etatAvantPleinEcran;
    string vpnEtat = "eteint";   // eteint, connexion, actif
    string? vpnRelais;
    DateTime vpnAnnonce, misesAJourVues;
    string? majPrete;

    public Navigateur(string[] adresses)
    {
        adressesDeDepart = adresses;
        DA.Accent(Reglages.Accent);
        Text = "ONIRIQUE";
        Icon = Installation.Icone();
        BackColor = DA.Nuit;
        MinimumSize = new Size(560, 360);
        Size = new Size(1280, 820);
        StartPosition = FormStartPosition.CenterScreen;
        try { scriptGoogle = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "accueil", "google.js")); } catch { scriptGoogle = ""; }

        bandeau = new Bandeau(this) { Dock = DockStyle.Top };
        bulle = new Bulle(this);
        barre.Controls.AddRange(new Control[] { retour, avance, recharger, champ, vpn, historique, reglages, memoire });
        barre.Paint += (_, e) => { using var p = new Pen(DA.Filet); e.Graphics.DrawLine(p, 0, barre.Height - 1, barre.Width, barre.Height - 1); };
        barre.Resize += (_, _) => Disposer();
        contenu.Controls.Add(bulle);
        contenu.Resize += (_, _) => PlacerVues();
        contenu.Paint += (_, e) => DessinerDivision(e);
        Controls.Add(contenu);
        Controls.Add(barre);
        Controls.Add(bandeau);
        new ToolTip().SetToolTip(memoire, "Mémoire utilisée par le navigateur et ses onglets");
        memoire.Visible = Reglages.Memoire;

        retour.Click += (_, _) => Actif?.Vue?.CoreWebView2?.GoBack();
        avance.Click += (_, _) => Actif?.Vue?.CoreWebView2?.GoForward();
        recharger.Click += (_, _) =>
        {
            if (Actif?.Vue?.CoreWebView2 is not { } c) return;
            if (Actif.Charge) c.Stop(); else c.Reload();
        };
        vpn.Click += async (_, _) => await BasculerVpn(vpnEtat == "eteint");
        reglages.Click += (_, _) => OuvrirInterne(PageParametres);
        historique.Click += (_, _) => OuvrirInterne(PageHistorique);
        champ.Saisie.KeyDown += (_, e) =>
        {
            if (e.KeyCode == Keys.Enter) { e.SuppressKeyPress = true; Aller(suggestions.Selection ?? champ.Saisie.Text); }
            else if (e.KeyCode == Keys.Escape) { e.SuppressKeyPress = true; Actif?.Vue?.Focus(); Afficher(); }
        };
        champ.Saisie.LostFocus += (_, _) => Afficher();
        minuteur.Tick += (_, _) => Entretien();
        animation.Tick += (_, _) =>
        {
            bool encore = bandeau.Animer(Reglages.Animations) | bulle.Animer(Reglages.Animations);
            if (vpn.Clignote) { vpn.Invalidate(); encore = true; }
            encore |= AnimerAjouts();
            if (!encore) animation.Stop();
        };
        InitAjouts();
        Echelle();
    }

    internal void Animer() { if (!animation.Enabled) animation.Start(); }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        DA.BarreSombre(Handle);
        Installation.IconeDeBarreDesTaches(Handle);
        SetWindowPos(Handle, IntPtr.Zero, 0, 0, 0, 0, 0x0037); // SWP_FRAMECHANGED : Windows recalcule le cadre sans barre de titre
    }

    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr apres, int x, int y, int l, int ht, uint options);
    [DllImport("user32.dll")] static extern int GetSystemMetricsForDpi(int indice, uint dpi);
    [StructLayout(LayoutKind.Sequential)] struct Cadre { public int G, H, D, B; }

    // Comme Chrome : pas de barre de titre. Le cadre de Windows reste (bords, ombre, ancrage), seule la légende part ;
    // la fenêtre se déplace par l'espace vide de la barre d'onglets et s'agrandit d'un double-clic dessus.
    protected override void WndProc(ref Message m)
    {
        if (m.Msg == 0x0083 && m.WParam != IntPtr.Zero && FormBorderStyle != FormBorderStyle.None) // WM_NCCALCSIZE
        {
            var avant = Marshal.PtrToStructure<Cadre>(m.LParam);
            base.WndProc(ref m);
            var apres = Marshal.PtrToStructure<Cadre>(m.LParam);
            // Agrandie, la fenêtre déborde de l'écran de l'épaisseur de son cadre : le haut est rentré d'autant.
            apres.H = avant.H + (WindowState == FormWindowState.Maximized
                ? GetSystemMetricsForDpi(33, (uint)DeviceDpi) + GetSystemMetricsForDpi(92, (uint)DeviceDpi) : 0);
            Marshal.StructureToPtr(apres, m.LParam, false);
            m.Result = IntPtr.Zero;
            return;
        }
        if (m.Msg == 0x0084) // WM_NCHITTEST
        {
            base.WndProc(ref m);
            if ((int)m.Result != 1) return; // pas dans la zone cliente
            long lp = m.LParam.ToInt64();
            var p = PointToClient(new Point((short)(lp & 0xFFFF), (short)((lp >> 16) & 0xFFFF)));
            if (WindowState == FormWindowState.Normal && p.Y < this.S(5))
                m.Result = p.X < this.S(10) ? 13 : p.X > ClientSize.Width - this.S(10) ? 14 : 12; // HTTOPLEFT, HTTOPRIGHT, HTTOP
            else if (p.Y < bandeau.Bottom && bandeau.Visible) m.Result = 2; // HTCAPTION
            return;
        }
        base.WndProc(ref m);
    }

    protected override async void OnLoad(EventArgs e)
    {
        base.OnLoad(e);
        try { env = await Moteur(Reglages.Vpn ? Reglages.VpnRelais : null); }
        catch (WebView2RuntimeNotFoundException)
        {
            MessageBox.Show(this, "Le moteur Microsoft Edge WebView2 n'est pas installé sur ce PC.\nInstallez-le depuis https://go.microsoft.com/fwlink/p/?LinkId=2124703 puis relancez ONIRIQUE.",
                "ONIRIQUE", MessageBoxButtons.OK, MessageBoxIcon.Error);
            Close();
            return;
        }
        minuteur.Start();
        // Le VPN se rallume avant d'ouvrir la moindre page : rien ne part en direct par erreur.
        if (Reglages.Vpn) await AllumerVpn(relancer: false);

        if (adressesDeDepart.Length > 0) foreach (var a in adressesDeDepart) await Ouvrir(Resoudre(a));
        else if (Reglages.ReprendreSession && Reglages.Session.Count > 0)
        {
            // Les onglets de la dernière fois reviennent endormis : seul celui qu'on regarde se charge.
            foreach (var s in Reglages.Session) Onglets.Add(new Onglet { Url = s.Url, Titre = s.Titre, Decharge = true });
            RestaurerGroupes();
            Activer(Onglets[Math.Clamp(Reglages.SessionActif, 0, Onglets.Count - 1)]);
        }
        else await Ouvrir(Accueil);

        if (Installation.EstInstallee && Reglages.MisesAJour) _ = ChercherMiseAJour(silencieux: true);
        _ = DemarrerAjouts();
        ProposerImport();
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        var web = Onglets.Where(o => !EstInterne(o.Url) && o.Url.Length > 0).ToList();
        SauverGroupes(web);
        Reglages.SessionActif = Actif == null ? 0 : Math.Max(0, web.IndexOf(Actif));
        Reglages.Enregistrer();
        base.OnFormClosing(e);
    }

    async Task<CoreWebView2Environment> Moteur(string? relais)
    {
        var options = new CoreWebView2EnvironmentOptions { Language = "fr-FR" };
        if (relais != null) options.AdditionalBrowserArguments = Vpn.Arguments(relais);
        return await CoreWebView2Environment.CreateAsync(null, Parametres.Dossier, options);
    }

    protected override void OnDpiChanged(DpiChangedEventArgs e)
    {
        base.OnDpiChanged(e);
        Echelle();
    }

    void Echelle()
    {
        bandeau.Height = this.S(44);
        barre.Height = this.S(46);
        Font = new Font("Segoe UI Variable Text", this.S(12), GraphicsUnit.Pixel);
        champ.Saisie.Font = new Font("Segoe UI Variable Text", this.S(14), GraphicsUnit.Pixel);
        bandeau.Icones = new Font("Segoe Fluent Icons", this.S(10), GraphicsUnit.Pixel);
        var icones = new Font("Segoe Fluent Icons", this.S(14), GraphicsUnit.Pixel);
        foreach (var b in new[] { retour, avance, recharger, vpn, historique, reglages, lecteur, studio }) b.Font = icones;
        EchelleAjouts();
        memoire.Font = new Font("Cascadia Mono", this.S(11), GraphicsUnit.Pixel);
        bulle.Font = new Font("Segoe UI Variable Text", this.S(13), GraphicsUnit.Pixel);
        Disposer();
    }

    void Disposer()
    {
        int h = this.S(32), y = (barre.Height - h) / 2, x = this.S(8), pas = this.S(38);
        foreach (var b in new Control[] { retour, avance, recharger }) { b.SetBounds(x, y, this.S(36), h); x += pas; }
        int droite = barre.Width - this.S(10);
        if (memoire.Visible) { int m = this.S(76); droite -= m; memoire.SetBounds(droite, y, m, h); droite -= this.S(4); }
        foreach (var b in new Control[] { reglages, historique, vpn, lecteur, studio }) { if (!b.Visible) continue; droite -= this.S(36); b.SetBounds(droite, y, this.S(36), h); droite -= this.S(2); }
        champ.SetBounds(x + this.S(6), y, Math.Max(0, droite - x - this.S(14)), h);
        bulle.Placer();
        PlacerAjouts();
    }

    static bool EstInterne(string url) => url.StartsWith("https://" + Hote + "/", StringComparison.OrdinalIgnoreCase);

    internal void NouvelOnglet() => _ = Ouvrir(Accueil);

    void OuvrirInterne(string page)
    {
        var existant = Onglets.FirstOrDefault(o => o.Url.StartsWith(page, StringComparison.OrdinalIgnoreCase));
        if (existant != null) Activer(existant);
        else _ = Ouvrir(page, Actif == null ? -1 : Onglets.IndexOf(Actif) + 1);
    }

    async Task<Onglet> Ouvrir(string? url, int position = -1)
    {
        var o = new Onglet { Url = url ?? "" };
        Onglets.Insert(position < 0 || position > Onglets.Count ? Onglets.Count : position, o);
        bandeau.Invalidate();
        Animer();
        await Creer(o);
        if (url != null && o.Vue?.CoreWebView2 is { } c) c.Navigate(url);
        Activer(o);
        return o;
    }

    void AppliquerProfil(CoreWebView2 c)
    {
        // Comme un navigateur ordinaire : les mots de passe et les formulaires sont retenus (et proposés à la saisie).
        c.Settings.IsPasswordAutosaveEnabled = true;
        c.Settings.IsGeneralAutofillEnabled = true;
        c.Profile.PreferredTrackingPreventionLevel = Reglages.Traqueurs switch
        {
            "aucun" => CoreWebView2TrackingPreventionLevel.None,
            "equilibre" => CoreWebView2TrackingPreventionLevel.Balanced,
            _ => CoreWebView2TrackingPreventionLevel.Strict,
        };
        c.Profile.PreferredColorScheme = Reglages.SitesSombres ? CoreWebView2PreferredColorScheme.Dark : CoreWebView2PreferredColorScheme.Auto;
    }

    async Task Creer(Onglet o)
    {
        var v = new WebView2 { Bounds = contenu.ClientRectangle, DefaultBackgroundColor = DA.Nuit, Visible = false };
        o.Vue = v;
        contenu.Controls.Add(v);
        _ = v.Handle;
        try { await v.EnsureCoreWebView2Async(env); }
        catch when (o.Vue != v) { return; }
        if (o.Vue != v) return;

        var c = v.CoreWebView2;
        // En écran divisé, cliquer dans une moitié en fait l'onglet actif (barre d'adresse, témoin).
        v.GotFocus += (_, _) => { if (o != Actif && o == Actif?.Partenaire) { Actif = o; Afficher(); Animer(); contenu.Invalidate(); } };
        AppliquerProfil(c);
        BrancherAjouts(o, c);
        c.SetVirtualHostNameToFolderMapping(Hote, Path.Combine(AppContext.BaseDirectory, "accueil"), CoreWebView2HostResourceAccessKind.Deny);
        if (Reglages.GoogleOnirique && scriptGoogle.Length > 0) o.ScriptGoogle = await c.AddScriptToExecuteOnDocumentCreatedAsync(ScriptGoogle());
        c.DocumentTitleChanged += (_, _) => { o.Titre = c.DocumentTitle; bandeau.Invalidate(); if (o == Actif) Afficher(); };
        c.SourceChanged += (_, _) => { o.Url = c.Source; if (o == Actif) Afficher(); };
        c.HistoryChanged += (_, _) => { if (o == Actif) Afficher(); };
        c.NavigationStarting += (_, _) => { o.Charge = true; Animer(); if (o == Actif) Afficher(); };
        c.NavigationCompleted += async (_, e) =>
        {
            o.Charge = false;
            bandeau.Invalidate();
            if (o == Actif) Afficher();
            if (!e.IsSuccess) return;
            // Le titre arrive souvent juste après la page : l'historique attend un instant avant de l'écrire.
            var url = c.Source;
            await Task.Delay(1500);
            if (o.Vue?.CoreWebView2 == c && c.Source == url && !EstInterne(url)) Historique.Ajouter(url, c.DocumentTitle);
        };
        c.IsDocumentPlayingAudioChanged += (_, _) => { o.Son = c.IsDocumentPlayingAudio; bandeau.Invalidate(); };
        c.WindowCloseRequested += (_, _) => Fermer(o);
        c.ContainsFullScreenElementChanged += (_, _) => PleinEcran(c.ContainsFullScreenElement);
        c.FaviconChanged += async (_, _) =>
        {
            Image? icone = null;
            try
            {
                using var flux = await c.GetFaviconAsync(CoreWebView2FaviconImageFormat.Png);
                using var image = Image.FromStream(flux);
                icone = new Bitmap(image);
            }
            catch { }
            o.Icone?.Dispose();
            o.Icone = icone;
            bandeau.Invalidate();
        };
        c.NewWindowRequested += async (_, e) =>
        {
            var report = e.GetDeferral();
            try
            {
                var n = await Ouvrir(null, Onglets.IndexOf(o) + 1);
                if (o.Groupe != null) { n.Groupe = o.Groupe; Animer(); }
                if (n.Vue?.CoreWebView2 is { } nc) e.NewWindow = nc;
                e.Handled = true;
            }
            finally { report.Complete(); }
        };
        // Les pages internes (accueil, paramètres) parlent au navigateur ; aucune autre n'est écoutée.
        c.WebMessageReceived += (_, e) =>
        {
            if (!Uri.TryCreate(e.Source, UriKind.Absolute, out var u) || u.Host != Hote) return;
            try
            {
                var message = JsonNode.Parse(e.WebMessageAsJson);
                if (message is JsonValue texte && texte.TryGetValue<string>(out var recherche)) { if (recherche.Trim().Length > 0) c.Navigate(Resoudre(recherche)); }
                else if (message is JsonObject commande) _ = Commande(c, commande);
            }
            catch { }
        };
    }

    internal async void Activer(Onglet o)
    {
        if (Actif == o && o.Vue?.Visible == true) return;
        var ancien = Actif;
        Actif = o;
        foreach (var x in new[] { ancien, ancien?.Partenaire })
            if (x != null && x != o && x != o.Partenaire) Cacher(x);
        if (o.Groupe is { Replie: true } gr) gr.Replie = false; // l'onglet qu'on regarde ne reste pas dans un groupe replié
        Afficher();
        Animer();

        await Montrer(o);
        if (Actif == o && o.Partenaire is { } p) await Montrer(p);
        if (Actif != o || o.Vue == null) return;
        PlacerVues();
        bulle.BringToFront();
        if (!champ.Saisie.Focused) o.Vue.Focus();
    }

    void Cacher(Onglet x)
    {
        x.CacheDepuis = DateTime.Now;
        if (x.Vue?.CoreWebView2 is not { } c) return;
        x.Vue.Visible = false;
        c.MemoryUsageTargetLevel = CoreWebView2MemoryUsageTargetLevel.Low;
    }

    async Task Montrer(Onglet x)
    {
        x.CacheDepuis = DateTime.MaxValue;
        if (x.Vue == null)
        {
            x.Decharge = false;
            await Creer(x);
            if (x.Vue?.CoreWebView2 is { } nc) nc.Navigate(x.Url.Length > 0 ? x.Url : Accueil);
        }
        if (!EstAffiche(x) || x.Vue?.CoreWebView2 is not { } c) return;
        c.MemoryUsageTargetLevel = CoreWebView2MemoryUsageTargetLevel.Normal;
        x.Vue.Visible = true;
        x.Vue.BringToFront();
    }

    internal void Fermer(Onglet o)
    {
        int i = Onglets.IndexOf(o);
        if (i < 0) return;
        Onglets.RemoveAt(i);
        var p = o.Partenaire;
        if (p != null) { p.Partenaire = null; o.Partenaire = null; }
        var vue = o.Vue;
        o.Vue = null;
        vue?.Dispose();
        if (Onglets.Count == 0) { Close(); return; }
        if (Actif == o) { Actif = null; Activer(p ?? Onglets[Math.Min(i, Onglets.Count - 1)]); }
        else PlacerVues();
        Animer();
    }

    void Decaler(int sens)
    {
        if (Onglets.Count == 0) return;
        int i = Actif == null ? 0 : Onglets.IndexOf(Actif);
        Activer(Onglets[(i + sens + Onglets.Count) % Onglets.Count]);
    }

    void Afficher()
    {
        var o = Actif;
        var c = o?.Vue?.CoreWebView2;
        retour.Actif = c?.CanGoBack == true;
        avance.Actif = c?.CanGoForward == true;
        recharger.Glyphe = o?.Charge == true ? "" : "";
        bool interne = o == null || o.Url.Length == 0 || EstInterne(o.Url);
        if (!champ.Saisie.Focused) champ.Saisie.Text = interne ? "" : o!.Url;
        Text = interne ? "ONIRIQUE" : o!.Titre + " — ONIRIQUE";
        bandeau.Invalidate();
        MajEtoile();
    }

    void Aller(string saisie)
    {
        if (saisie.Trim().Length == 0 || Actif?.Vue?.CoreWebView2 is not { } c) return;
        c.Navigate(Resoudre(saisie));
        Actif.Vue.Focus();
    }

    internal string Resoudre(string s)
    {
        s = s.Trim();
        if (Uri.TryCreate(s, UriKind.Absolute, out var u) && u.Scheme is "http" or "https" or "file") return u.AbsoluteUri;
        if (!s.Contains(' ') && Uri.TryCreate("http://" + s, UriKind.Absolute, out u) && (u.Host == "localhost" || u.Host.Contains('.')))
            return (u.Host == "localhost" ? "http://" : "https://") + s;
        return Reglages.Recherche(s);
    }

    // ——— Réglages (page parametres.html) ———

    async Task Commande(CoreWebView2 source, JsonObject m)
    {
        switch ((string?)m["type"])
        {
            case "changer":
                await Changer((string?)m["cle"] ?? "", m["valeur"]);
                break;
            case "effacer":
                var quoi = m["quoi"]?.AsArray().Select(x => (string?)x).ToHashSet() ?? new HashSet<string?>();
                CoreWebView2BrowsingDataKinds genres = 0;
                if (quoi.Contains("historique")) Historique.Effacer();
                if (quoi.Contains("historique")) genres |= CoreWebView2BrowsingDataKinds.BrowsingHistory | CoreWebView2BrowsingDataKinds.DownloadHistory;
                if (quoi.Contains("cookies")) genres |= CoreWebView2BrowsingDataKinds.Cookies | CoreWebView2BrowsingDataKinds.AllDomStorage;
                if (quoi.Contains("cache")) genres |= CoreWebView2BrowsingDataKinds.DiskCache | CoreWebView2BrowsingDataKinds.CacheStorage;
                if (quoi.Contains("motsdepasse")) genres |= CoreWebView2BrowsingDataKinds.PasswordAutosave | CoreWebView2BrowsingDataKinds.GeneralAutofill;
                if (genres != 0) await source.Profile.ClearBrowsingDataAsync(genres);
                Envoyer(source, new JsonObject { ["type"] = "efface" });
                return;
            case "majs":
                Envoyer(source, new JsonObject { ["type"] = "maj", ["etat"] = "recherche" });
                var resultat = await ChercherMiseAJour(silencieux: false);
                Envoyer(source, new JsonObject { ["type"] = "maj", ["etat"] = resultat });
                return;
            case "historique":
                Envoyer(source, new JsonObject { ["type"] = "historique", ["entrees"] = Historique.Chercher((string?)m["q"]) });
                return;
            case "oublier":
                Historique.Oublier(m["t"]?.GetValue<long>() ?? 0, (string?)m["u"] ?? "");
                return;
            case "oublierTout":
                Historique.Effacer();
                return;
            case "raccourcis":
                // L'écran d'accueil envoie toute sa liste (sites et dossiers) ; elle est gardée si c'est une liste raisonnable.
                if (m["liste"] is JsonArray liste && liste.ToJsonString().Length < 200_000) { Reglages.Raccourcis = liste.ToJsonString(); Reglages.Enregistrer(); MajEtoile(); ProfilChange(); }
                return;
            case "fond":
                await RecevoirFond(m);
                break;
            case "importer":
                if (Sources().FirstOrDefault(x => x.Id == (string?)m["id"]) is { } src)
                {
                    int n = ImporterFavoris(src);
                    bulle.Montrer(n == 0 ? $"Rien de nouveau dans les favoris de {src.Nom}." : $"{n} favoris de {src.Nom} ajoutés à ton accueil.");
                }
                EnvoyerEtatAuxPagesInternes();
                return;
            case "google":
                _ = Ouvrir((string?)m["page"] == "motsdepasse" ? "https://passwords.google.com/" : "https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fmyaccount.google.com%2F");
                return;
            case "lire":
                await VerifierGoogle(source);
                break;
            case "defaut":
                Process.Start(new ProcessStartInfo("ms-settings:defaultapps?registeredAppUser=" + Uri.EscapeDataString(Installation.Nom)) { UseShellExecute = true });
                return;
        }
        Envoyer(source, Etat());
    }

    JsonObject Etat()
    {
        var valeurs = JsonSerializer.SerializeToNode(Reglages)!.AsObject();
        valeurs.Remove("Session");
        valeurs.Remove("Groupes");
        valeurs.Remove("Raccourcis");
        JsonNode? raccourcis = null;
        raccourcis = Raccourcis();
        return new JsonObject
        {
            ["type"] = "etat",
            ["reglages"] = valeurs,
            ["vpn"] = vpnEtat,
            ["version"] = Installation.Version,
            ["installe"] = Installation.EstInstallee,
            ["majPrete"] = majPrete,
            ["raccourcis"] = raccourcis,
            ["couleurs"] = new JsonObject { ["acc"] = DA.Triplet(DA.Braise), ["hi"] = DA.Triplet(DA.BraiseClaire), ["lo"] = DA.Triplet(DA.Sang) },
            ["accents"] = new JsonArray(DA.Accents.Select(x => (JsonNode)new JsonObject { ["hex"] = x.Hex, ["nom"] = x.Nom }).ToArray()),
            ["ajouts"] = EtatAjouts(),
            ["imports"] = EtatImports(),
            ["google"] = googleConnecte,
            ["moteurs"] = new JsonArray(Parametres.Moteurs.Select(x => (JsonNode)new JsonObject { ["id"] = x.Id, ["nom"] = x.Nom }).ToArray()),
        };
    }

    void Envoyer(CoreWebView2 c, JsonObject message)
    {
        try { c.PostWebMessageAsJson(message.ToJsonString()); } catch { }
    }

    void EnvoyerEtatAuxPagesInternes()
    {
        foreach (var o in Onglets)
            if (o.Vue?.CoreWebView2 is { } c && EstInterne(o.Url)) Envoyer(c, Etat());
    }

    async Task Changer(string cle, JsonNode? valeur)
    {
        bool B() => valeur?.GetValue<bool>() == true;
        switch (cle)
        {
            case "Moteur": if (Parametres.Moteurs.Any(x => x.Id == (string?)valeur)) Reglages.Moteur = (string)valeur!; break;
            case "ReprendreSession": Reglages.ReprendreSession = B(); break;
            case "VeilleSecondes": Reglages.VeilleSecondes = Math.Clamp(valeur?.GetValue<int>() ?? 30, 0, 86400); break;
            case "DechargementMinutes": Reglages.DechargementMinutes = Math.Clamp(valeur?.GetValue<int>() ?? 10, 0, 1440); break;
            case "Traqueurs":
                if ((string?)valeur is "strict" or "equilibre" or "aucun") Reglages.Traqueurs = (string)valeur!;
                foreach (var c in Vues()) AppliquerProfil(c);
                break;
            case "SitesSombres":
                Reglages.SitesSombres = B();
                foreach (var c in Vues()) AppliquerProfil(c);
                break;
            case "GoogleOnirique":
                Reglages.GoogleOnirique = B();
                await RemettreScriptsGoogle();
                break;
            case "Vpn": await BasculerVpn(B()); return;
            case "Memoire": Reglages.Memoire = memoire.Visible = B(); Disposer(); break;
            case "Animations": Reglages.Animations = B(); break;
            case "MisesAJour": Reglages.MisesAJour = B(); break;
            default:
                if (!await ChangerAjout(cle, valeur)) return;
                break;
            case "Accent":
                if (valeur is JsonValue v && v.TryGetValue<string>(out var hex) && System.Text.RegularExpressions.Regex.IsMatch(hex, "^#[0-9a-fA-F]{6}$"))
                {
                    Reglages.Accent = hex.ToLowerInvariant();
                    DA.Accent(Reglages.Accent);
                    Invalidate(true);
                    await RemettreScriptsGoogle();
                    Reglages.Enregistrer();
                    EnvoyerEtatAuxPagesInternes();
                    ProfilChange();
                    return;
                }
                break;
        }
        Reglages.Enregistrer();
        ProfilChange();
    }

    // Le script Google porte l'accent choisi : il est remis dans chaque onglet quand l'un ou l'autre change.
    string ScriptGoogle() =>
        $"window.__ONIRIQUE_ACCENT={{acc:\"{DA.Triplet(DA.Braise)}\",hi:\"{DA.Triplet(DA.BraiseClaire)}\",lo:\"{DA.Triplet(DA.Sang)}\"}};\n" + scriptGoogle;

    async Task RemettreScriptsGoogle()
    {
        foreach (var o in Onglets)
        {
            if (o.Vue?.CoreWebView2 is not { } c) continue;
            if (o.ScriptGoogle != null) { c.RemoveScriptToExecuteOnDocumentCreated(o.ScriptGoogle); o.ScriptGoogle = null; }
            if (Reglages.GoogleOnirique && scriptGoogle.Length > 0) o.ScriptGoogle = await c.AddScriptToExecuteOnDocumentCreatedAsync(ScriptGoogle());
        }
    }

    IEnumerable<CoreWebView2> Vues() => Onglets.Select(o => o.Vue?.CoreWebView2).OfType<CoreWebView2>();

    // ——— VPN ———

    void MontrerVpn()
    {
        vpn.Temoin = vpnEtat == "actif";
        vpn.Clignote = vpnEtat == "connexion";
        vpn.Aide = vpnEtat switch
        {
            "actif" => "VPN ONIRIQUE : actif — les sites te voient en Allemagne",
            "connexion" => "VPN ONIRIQUE : connexion…",
            _ => "VPN ONIRIQUE : éteint",
        };
        if (vpn.Clignote) Animer();
        EnvoyerEtatAuxPagesInternes();
    }

    async Task BasculerVpn(bool allumer)
    {
        if (vpnEtat == "connexion") return;
        if (allumer) { await AllumerVpn(relancer: true); return; }
        vpnRelais = null;
        vpnEtat = "eteint";
        Reglages.Vpn = false;
        Reglages.Enregistrer();
        MontrerVpn();
        await Relancer(null);
        bulle.Montrer("VPN éteint : tu navigues avec ta propre connexion.");
    }

    async Task AllumerVpn(bool relancer)
    {
        if (env == null) return;
        vpnEtat = "connexion";
        MontrerVpn();
        var r = await Vpn.Annoncer(env, contenu);
        if (!r.Ok)
        {
            vpnEtat = "eteint";
            bool relancerSansVpn = vpnRelais != null || (!relancer && Reglages.Vpn);
            vpnRelais = null;
            Reglages.Vpn = false;
            Reglages.Enregistrer();
            MontrerVpn();
            if (relancerSansVpn) await Relancer(null);
            bulle.Montrer(r.Message, "Me connecter", () => _ = Ouvrir("https://onirique.store/compte"));
            return;
        }
        vpnRelais = r.Relais ?? Reglages.VpnRelais;
        vpnAnnonce = DateTime.Now;
        Reglages.Vpn = true;
        Reglages.VpnRelais = vpnRelais;
        Reglages.Enregistrer();
        if (relancer) await Relancer(vpnRelais);
        vpnEtat = "actif";
        MontrerVpn();
        bulle.Montrer("VPN actif : les sites te voient en Allemagne, par le serveur ONIRIQUE.");
    }

    /// <summary>Le moteur ne change de connexion qu'en redémarrant : les onglets se rechargent, celui qu'on regarde d'abord.</summary>
    async Task Relancer(string? relais)
    {
        var ancien = env;
        env = null;
        if (ancien != null)
        {
            var ferme = new TaskCompletionSource();
            ancien.BrowserProcessExited += (_, _) => ferme.TrySetResult();
            foreach (var o in Onglets)
            {
                var vue = o.Vue;
                o.Vue = null;
                o.ScriptGoogle = null;
                o.Decharge = true;
                vue?.Dispose();
            }
            FermerPanneaux();
            await Task.WhenAny(ferme.Task, Task.Delay(5000));
        }
        env = await Moteur(relais);
        var actif = Actif;
        Actif = null;
        if (actif != null) Activer(actif);
    }

    // ——— Entretien : veille, déchargement, mémoire, VPN, mises à jour ———

    void Entretien()
    {
        var maintenant = DateTime.Now;
        foreach (var o in Onglets.ToArray())
        {
            if (EstAffiche(o) || o.Son || o.Vue?.CoreWebView2 is not { } c) continue;
            var cache = maintenant - o.CacheDepuis;
            if (DechargementEffectif > 0 && cache > TimeSpan.FromMinutes(DechargementEffectif)) Decharger(o);
            else if (VeilleEffective > 0 && cache > TimeSpan.FromSeconds(VeilleEffective) && !c.IsSuspended) _ = Suspendre(c);
        }
        MesurerMemoire();
        EntretienAjouts();
        // Le serveur oublie une adresse au bout de 12 heures, ou à son redémarrage : le navigateur se réannonce.
        if (vpnEtat == "actif" && maintenant - vpnAnnonce > TimeSpan.FromMinutes(10) && env != null)
        {
            vpnAnnonce = maintenant;
            _ = Reannoncer();
        }
        if (Installation.EstInstallee && Reglages.MisesAJour && majPrete == null && maintenant - misesAJourVues > TimeSpan.FromHours(6))
            _ = ChercherMiseAJour(silencieux: true);
    }

    async Task Reannoncer()
    {
        var r = await Vpn.Annoncer(env!, contenu);
        if (!r.Ok && vpnEtat == "actif") { await BasculerVpn(false); bulle.Montrer(r.Message, "Me connecter", () => _ = Ouvrir("https://onirique.store/compte")); }
    }

    static async Task Suspendre(CoreWebView2 c)
    {
        try { await c.TrySuspendAsync(); } catch { }
    }

    void MesurerMemoire()
    {
        if (env == null) return;
        long total;
        TimeSpan cpu;
        using (var moi = Process.GetCurrentProcess()) { total = moi.PrivateMemorySize64; cpu = moi.TotalProcessorTime; }
        foreach (var info in env.GetProcessInfos())
        {
            try { using var p = Process.GetProcessById(info.ProcessId); total += p.PrivateMemorySize64; cpu += p.TotalProcessorTime; } catch { }
        }
        CompterRessources(total, cpu);
        if (memoire.Visible) memoire.Text = $"{total / 1048576} Mo";
    }

    async Task<string> ChercherMiseAJour(bool silencieux)
    {
        misesAJourVues = DateTime.Now;
        if (majPrete != null) return "prete";
        if (!Installation.EstInstallee) return "portable";
        try
        {
            majPrete = await Installation.MettreAJour();
            if (majPrete == null) return "a-jour";
            bulle.Montrer($"La version {majPrete} est prête : elle s'ouvrira au prochain lancement.", "Redémarrer", Redemarrer);
            EnvoyerEtatAuxPagesInternes();
            return "prete";
        }
        catch
        {
            if (!silencieux) bulle.Montrer("Impossible de vérifier les mises à jour pour l'instant.");
            return "erreur";
        }
    }

    void Redemarrer()
    {
        OnFormClosing(new FormClosingEventArgs(CloseReason.UserClosing, false));
        Process.Start(new ProcessStartInfo(Installation.Exe) { UseShellExecute = true, WorkingDirectory = Installation.Dossier });
        Environment.Exit(0);
    }

    void PleinEcran(bool oui)
    {
        bandeau.Visible = barre.Visible = !oui;
        if (oui)
        {
            etatAvantPleinEcran = WindowState;
            FormBorderStyle = FormBorderStyle.None;
            WindowState = FormWindowState.Normal;
            WindowState = FormWindowState.Maximized;
        }
        else
        {
            FormBorderStyle = FormBorderStyle.Sizable;
            WindowState = etatAvantPleinEcran;
        }
    }

    protected override bool ProcessCmdKey(ref Message msg, Keys touches)
    {
        var c = Actif?.Vue?.CoreWebView2;
        switch (touches)
        {
            case Keys.Control | Keys.T: NouvelOnglet(); return true;
            case Keys.Control | Keys.W:
            case Keys.Control | Keys.F4: if (Actif != null) Fermer(Actif); return true;
            case Keys.Control | Keys.L:
            case Keys.Alt | Keys.D:
            case Keys.F6: champ.Saisie.Focus(); champ.Saisie.SelectAll(); return true;
            case Keys.Control | Keys.Tab:
            case Keys.Control | Keys.PageDown: Decaler(1); return true;
            case Keys.Control | Keys.Shift | Keys.Tab:
            case Keys.Control | Keys.PageUp: Decaler(-1); return true;
            case Keys.F5:
            case Keys.Control | Keys.R: c?.Reload(); return true;
            case Keys.Alt | Keys.Left: if (c?.CanGoBack == true) c.GoBack(); return true;
            case Keys.Alt | Keys.Right: if (c?.CanGoForward == true) c.GoForward(); return true;
            case Keys.Control | Keys.Oemcomma: OuvrirInterne(PageParametres); return true;
            case Keys.Control | Keys.H: OuvrirInterne(PageHistorique); return true;
        }
        return base.ProcessCmdKey(ref msg, touches);
    }
}

sealed class Bouton : Control
{
    static readonly ToolTip Infobulle = new();
    string glyphe, aide;
    bool actif = true, survol, temoin;

    public Bouton(string glyphe, string aide)
    {
        this.glyphe = glyphe;
        this.aide = aide;
        DoubleBuffered = true;
        BackColor = DA.Fond;
        Cursor = Cursors.Hand;
        AccessibleName = aide;
        AccessibleRole = AccessibleRole.PushButton;
        Infobulle.SetToolTip(this, aide);
    }

    [System.ComponentModel.DesignerSerializationVisibility(System.ComponentModel.DesignerSerializationVisibility.Hidden)]
    public string Glyphe { get => glyphe; set { if (glyphe != value) { glyphe = value; Invalidate(); } } }
    [System.ComponentModel.DesignerSerializationVisibility(System.ComponentModel.DesignerSerializationVisibility.Hidden)]
    public bool Actif { get => actif; set { if (actif != value) { actif = value; Invalidate(); } } }
    [System.ComponentModel.DesignerSerializationVisibility(System.ComponentModel.DesignerSerializationVisibility.Hidden)]
    public bool Temoin { get => temoin; set { if (temoin != value) { temoin = value; Invalidate(); } } }
    [System.ComponentModel.DesignerSerializationVisibility(System.ComponentModel.DesignerSerializationVisibility.Hidden)]
    public bool Clignote { get; set; }
    [System.ComponentModel.DesignerSerializationVisibility(System.ComponentModel.DesignerSerializationVisibility.Hidden)]
    public Color? Teinte { get => teinte; set { teinte = value; Invalidate(); } }
    Color? teinte;
    [System.ComponentModel.DesignerSerializationVisibility(System.ComponentModel.DesignerSerializationVisibility.Hidden)]
    public string Aide { get => aide; set { aide = value; AccessibleName = value; Infobulle.SetToolTip(this, value); } }

    protected override void OnMouseEnter(EventArgs e) { survol = true; Invalidate(); base.OnMouseEnter(e); }
    protected override void OnMouseLeave(EventArgs e) { survol = false; Invalidate(); base.OnMouseLeave(e); }
    protected override void OnClick(EventArgs e) { if (actif) base.OnClick(e); }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        if (survol && actif)
        {
            using var chemin = DA.Arrondi(new Rectangle(0, 0, Width - 1, Height - 1), this.S(8));
            using var b = new SolidBrush(DA.Survol);
            g.FillPath(b, chemin);
        }
        var couleur = !actif ? DA.Eteint : teinte ?? (temoin ? DA.BraiseClaire : DA.Brume);
        TextRenderer.DrawText(g, glyphe, Font, ClientRectangle, couleur,
            TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
        if (temoin || Clignote)
        {
            // Témoin allumé : une petite braise, qui respire pendant la connexion.
            int alpha = Clignote ? (int)(130 + 120 * Math.Sin(Environment.TickCount64 / 160.0)) : 255;
            int d = this.S(5), x = Width - this.S(9), y = this.S(6);
            using var halo = new SolidBrush(Color.FromArgb(alpha / 3, DA.Braise));
            using var coeur = new SolidBrush(Color.FromArgb(Math.Clamp(alpha, 0, 255), DA.Braise));
            g.FillEllipse(halo, x - d / 2, y - d / 2, d * 2, d * 2);
            g.FillEllipse(coeur, x, y, d, d);
        }
    }
}

sealed class Champ : Panel
{
    public readonly TextBox Saisie = new()
    {
        BorderStyle = BorderStyle.None,
        BackColor = DA.Nuit,
        ForeColor = DA.Brume,
        PlaceholderText = "Rechercher sur le web ou saisir une adresse",
        AccessibleName = "Barre d'adresse",
    };

    public readonly Bouton Etoile = new("", "Ajouter à l'accueil") { BackColor = DA.Nuit, Visible = false };

    public Champ()
    {
        DoubleBuffered = true;
        BackColor = DA.Fond;
        Cursor = Cursors.IBeam;
        Controls.Add(Saisie);
        Controls.Add(Etoile);
        Saisie.GotFocus += (_, _) => { Invalidate(); BeginInvoke(Saisie.SelectAll); };
        Saisie.LostFocus += (_, _) => Invalidate();
    }

    protected override void OnLayout(LayoutEventArgs e)
    {
        base.OnLayout(e);
        int marge = this.S(14), etoile = Etoile.Visible ? this.S(30) : 0;
        Etoile.SetBounds(Width - this.S(34), (Height - this.S(28)) / 2, this.S(28), this.S(28));
        Saisie.SetBounds(marge, (Height - Saisie.Height) / 2, Math.Max(0, Width - 2 * marge - etoile), Saisie.Height);
    }

    protected override void OnMouseDown(MouseEventArgs e) { Saisie.Focus(); base.OnMouseDown(e); }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        using var chemin = DA.Arrondi(new Rectangle(0, 0, Width - 1, Height - 1), this.S(10));
        using var fond = new SolidBrush(DA.Nuit);
        g.FillPath(fond, chemin);
        using var trait = new Pen(Saisie.Focused ? Color.FromArgb(180, DA.BraiseClaire) : DA.Filet);
        g.DrawPath(trait, chemin);
    }
}

/// <summary>Petit message qui glisse depuis le haut de la page, avec une action éventuelle.</summary>
sealed class Bulle : Control
{
    readonly Navigateur nav;
    string texte = "", action = "";
    Action? surAction;
    float y, cible;
    DateTime cacherA = DateTime.MaxValue;

    public Bulle(Navigateur nav)
    {
        this.nav = nav;
        DoubleBuffered = true;
        Visible = false;
        BackColor = DA.Nuit;
        Cursor = Cursors.Default;
    }

    Rectangle ZoneAction => action.Length == 0 ? Rectangle.Empty : new(Width - this.S(14) - Mesure(action).Width - this.S(20), this.S(10), Mesure(action).Width + this.S(20), Height - this.S(20));
    Size Mesure(string t) => TextRenderer.MeasureText(t, Font, Size.Empty, TextFormatFlags.NoPadding);

    public void Montrer(string message, string libelleAction = "", Action? quandAction = null)
    {
        texte = message;
        action = libelleAction;
        surAction = quandAction;
        int largeur = Math.Min(Parent!.Width - this.S(32), Mesure(texte).Width + (action.Length > 0 ? Mesure(action).Width + this.S(44) : 0) + this.S(76));
        Size = new Size(largeur, this.S(48));
        y = -Height;
        cible = this.S(14);
        cacherA = DateTime.Now.AddSeconds(action.Length > 0 ? 9 : 5);
        Placer();
        Visible = true;
        BringToFront();
        Invalidate();
        nav.Animer();
    }

    public void Placer()
    {
        if (Parent == null) return;
        Location = new Point(Parent.Width - Width - this.S(16), (int)y);
    }

    public bool Animer(bool fluide)
    {
        if (!Visible) return false;
        if (DateTime.Now > cacherA) cible = -Height - this.S(4);
        float avant = y;
        y = fluide ? y + (cible - y) * 0.2f : cible;
        if (Math.Abs(cible - y) < 0.6f) y = cible;
        Placer();
        if (y <= -Height && cible < 0) { Visible = false; return false; }
        return y != avant || cacherA != DateTime.MaxValue;
    }

    protected override void OnMouseMove(MouseEventArgs e)
    {
        base.OnMouseMove(e);
        Cursor = ZoneAction.Contains(e.Location) ? Cursors.Hand : Cursors.Default;
    }

    protected override void OnMouseClick(MouseEventArgs e)
    {
        base.OnMouseClick(e);
        if (ZoneAction.Contains(e.Location)) surAction?.Invoke();
        cacherA = DateTime.Now;
        nav.Animer();
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.Clear(DA.Nuit);
        var r = new Rectangle(0, 0, Width - 1, Height - 1);
        using var chemin = DA.Arrondi(r, this.S(12));
        using var fond = new SolidBrush(DA.Fond);
        g.FillPath(fond, chemin);
        using var trait = new Pen(DA.Filet);
        g.DrawPath(trait, chemin);
        using var temoin = new SolidBrush(DA.Braise);
        g.FillEllipse(temoin, this.S(16), Height / 2 - this.S(3), this.S(6), this.S(6));
        var zone = ZoneAction;
        TextRenderer.DrawText(g, texte, Font, new Rectangle(this.S(32), 0, (zone.IsEmpty ? Width : zone.X) - this.S(40), Height), DA.Brume,
            TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix);
        if (!zone.IsEmpty)
        {
            using var bouton = DA.Arrondi(zone, this.S(8));
            using var braise = new SolidBrush(Color.FromArgb(60, DA.Braise));
            g.FillPath(braise, bouton);
            TextRenderer.DrawText(g, action, Font, zone, DA.BraiseClaire, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter);
        }
    }
}

// shortcut: onglets dessinés à la main, invisibles pour les lecteurs d'écran (clavier : Ctrl+Tab, Ctrl+T, Ctrl+W) ; leur donner des objets d'accessibilité si un utilisateur en a besoin.
sealed class Bandeau : Control
{
    readonly Navigateur nav;
    int survol = -1;
    bool surCroix;
    float temoinX = -1, temoinW, plusX = -1;
    public Font Icones = SystemFonts.DefaultFont;

    public Bandeau(Navigateur nav)
    {
        this.nav = nav;
        DoubleBuffered = true;
        ResizeRedraw = true;
        BackColor = DA.Nuit;
        AccessibleName = "Onglets";
    }

    IEnumerable<Groupe> Groupes => nav.Onglets.Select(o => o.Groupe).OfType<Groupe>().Distinct();
    static bool Montre(Onglet o) => o.Groupe is not { Replie: true };
    string Libelle(Groupe gr) => gr.Replie ? $"{gr.Nom} {nav.Onglets.Count(o => o.Groupe == gr)}".Trim() : gr.Nom;
    int LargeurPastille(Groupe gr)
    {
        var texte = Libelle(gr);
        if (texte.Length == 0) return this.S(20);
        using var gras = new Font(Font, FontStyle.Bold);
        return Math.Min(this.S(150), TextRenderer.MeasureText(texte, gras).Width + this.S(18));
    }
    internal Rectangle Pastille(Groupe gr) => new((int)gr.X, this.S(14), Math.Max(1, (int)gr.W), this.S(22));
    Groupe? GroupeSous(Point p) => Groupes.FirstOrDefault(gr => gr.X >= 0 && Pastille(gr).Contains(p));

    /// <summary>Les places cibles : la pastille de chaque groupe devant ses onglets ; ceux d'un groupe replié n'ont plus de largeur.</summary>
    float Placer(Action<Onglet, float, float> onglet, Action<Groupe, float, float> pastille)
    {
        var liste = nav.Onglets;
        int n = liste.Count(Montre), pastilles = Groupes.Sum(gr => LargeurPastille(gr) + this.S(6));
        int largeur = n == 0 ? 0 : Math.Clamp((Width - this.S(56) - 3 * this.S(46) - this.S(16) - pastilles) / n, this.S(44), this.S(232));
        float x = this.S(8);
        Groupe? avant = null;
        foreach (var o in liste)
        {
            if (o.Groupe != null && o.Groupe != avant)
            {
                int w = LargeurPastille(o.Groupe);
                pastille(o.Groupe, x + this.S(2), w);
                x += w + this.S(6);
            }
            avant = o.Groupe;
            onglet(o, x, Montre(o) ? largeur : 0);
            if (Montre(o)) x += largeur;
        }
        return x;
    }
    Rectangle Commande(int k) => new(Width - (3 - k) * this.S(46), 0, this.S(46), this.S(34)); // 0 réduire, 1 agrandir, 2 fermer
    int CommandeSous(Point p) { for (int k = 0; k < 3; k++) if (Commande(k).Contains(p)) return k; return -1; }
    Rectangle Zone(int i)
    {
        var o = nav.Onglets[i];
        return new Rectangle((int)o.X, this.S(8), Math.Max(1, (int)o.W), Height - this.S(8));
    }
    Rectangle Croix(Rectangle r) => new(r.Right - this.S(28), r.Y + (r.Height - this.S(20)) / 2, this.S(20), this.S(20));
    Rectangle Plus => new((int)plusX + this.S(6), this.S(11), this.S(28), this.S(28));
    bool CroixVisible(int i) => (nav.Onglets[i] == nav.Actif || i == survol) && Zone(i).Width > this.S(80);

    /// <summary>Fait glisser les onglets vers leur place ; renvoie vrai tant qu'il reste du mouvement.</summary>
    public bool Animer(bool fluide)
    {
        bool bouge = false;
        float Vers(float v, float c)
        {
            if (!fluide || v < 0) return c;
            float n = v + (c - v) * 0.28f;
            if (Math.Abs(c - n) < 0.5f) return c;
            bouge = true;
            return n;
        }
        var liste = nav.Onglets;
        float fin = Placer((o, x, w) =>
        {
            if (o.X < 0) { o.X = x; o.W = fluide ? 0 : w; }
            o.X = Vers(o.X, x);
            o.W = Vers(o.W, w);
        }, (gr, x, w) =>
        {
            if (gr.X < 0) { gr.X = x; gr.W = fluide ? 0 : w; }
            gr.X = Vers(gr.X, x);
            gr.W = Vers(gr.W, w);
        });
        plusX = Vers(plusX, fin);
        int a = nav.Actif == null ? -1 : liste.IndexOf(nav.Actif);
        if (a >= 0)
        {
            temoinX = Vers(temoinX, liste[a].X + this.S(12));
            temoinW = Vers(temoinW, Math.Max(0, liste[a].W - this.S(26)));
        }
        bool charge = liste.Any(o => o.Charge);
        Invalidate();
        return bouge || charge;
    }

    int Index(Point p)
    {
        for (int i = 0; i < nav.Onglets.Count; i++) if (nav.Onglets[i].W > this.S(12) && Zone(i).Contains(p)) return i;
        return -1;
    }

    protected override void OnResize(EventArgs e)
    {
        base.OnResize(e);
        Animer(false);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        using var filet = new Pen(DA.Filet);
        g.DrawLine(filet, 0, Height - 1, Width, Height - 1);
        var liste = nav.Onglets;
        var flags = TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding;

        for (int i = 0; i < liste.Count; i++)
        {
            var o = liste[i];
            if (o.X < 0 || o.W < 2) continue;
            var r = Zone(i);
            bool actif = o == nav.Actif, moitie = !actif && nav.EstAffiche(o);
            var etat = g.Save();
            g.SetClip(r);
            if (actif || moitie)
            {
                using var chemin = DA.Arrondi(new Rectangle(r.X, r.Y, r.Width - this.S(2), r.Height), this.S(8), basCarre: true);
                using var fond = new SolidBrush(DA.Fond);
                g.FillPath(fond, chemin);
                g.DrawPath(filet, chemin);
            }
            else if (i == survol)
            {
                using var chemin = DA.Arrondi(new Rectangle(r.X + this.S(2), r.Y + this.S(3), r.Width - this.S(6), r.Height - this.S(8)), this.S(7));
                using var fond = new SolidBrush(DA.Survol);
                g.FillPath(fond, chemin);
            }
            else if (i + 1 < liste.Count && liste[i + 1] != nav.Actif && i + 1 != survol)
            {
                int m = r.Y + r.Height / 2;
                g.DrawLine(filet, r.Right - 1, m - this.S(8), r.Right - 1, m + this.S(8));
            }

            int milieu = r.Y + r.Height / 2;
            int x = r.X + this.S(12);
            var icone = new Rectangle(x, milieu - this.S(8), this.S(16), this.S(16));
            if (o.Charge)
            {
                // Témoin de chargement : une braise qui respire.
                double t = Environment.TickCount64 / 220.0;
                int alpha = (int)(55 + 45 * Math.Sin(t));
                using var halo = new SolidBrush(Color.FromArgb(alpha, DA.Braise));
                using var coeur = new SolidBrush(DA.BraiseClaire);
                g.FillEllipse(halo, icone.X + this.S(1), icone.Y + this.S(1), this.S(14), this.S(14));
                g.FillEllipse(coeur, icone.X + this.S(5), icone.Y + this.S(5), this.S(6), this.S(6));
            }
            else if (o.Icone != null) g.DrawImage(o.Icone, icone);
            else TextRenderer.DrawText(g, o.Url.Contains("/parametres.html") ? "" : o.Url.Contains("/historique.html") ? "" : "", Icones, icone, DA.Cendre, flags);

            int droite = r.Right - this.S(CroixVisible(i) ? 32 : 10);
            if (o.Son)
            {
                droite -= this.S(18);
                TextRenderer.DrawText(g, "", Icones, new Rectangle(droite, r.Y, this.S(18), r.Height), DA.BraiseClaire, flags);
            }
            var texte = new Rectangle(x + this.S(24), r.Y, Math.Max(0, droite - x - this.S(26)), r.Height);
            var couleur = actif ? DA.Brume : moitie ? DA.Etiquette : o.Decharge ? DA.Eteint : DA.Cendre;
            TextRenderer.DrawText(g, o.Titre, Font, texte, couleur,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis | TextFormatFlags.SingleLine | TextFormatFlags.NoPrefix);

            if (CroixVisible(i))
            {
                var cr = Croix(r);
                if (i == survol && surCroix)
                {
                    using var fond = new SolidBrush(DA.Filet);
                    g.FillEllipse(fond, cr);
                }
                TextRenderer.DrawText(g, "", Icones, cr, actif || surCroix ? DA.Brume : DA.Cendre, flags);
            }
            g.Restore(etat);
        }

        // Les groupes : leur pastille de couleur, et un trait de la même couleur sous leurs onglets.
        using (var gras = new Font(Font, FontStyle.Bold))
            foreach (var gr in Groupes)
            {
                if (gr.X < 0 || gr.W < 2) continue;
                var p = Pastille(gr);
                using (var chemin = DA.Arrondi(p, this.S(8)))
                using (var pinceau = new SolidBrush(gr.Couleur))
                    g.FillPath(pinceau, chemin);
                TextRenderer.DrawText(g, Libelle(gr), gras, p, DA.Nuit, flags | TextFormatFlags.EndEllipsis | TextFormatFlags.SingleLine);
                var membres = liste.Where(o => o.Groupe == gr && o.W >= 2).ToList();
                if (membres.Count == 0) continue;
                using var trait = new SolidBrush(gr.Couleur);
                float debut = gr.X, finTrait = membres.Max(o => o.X + o.W) - this.S(2);
                g.FillRectangle(trait, debut, Height - this.S(3), finTrait - debut, this.S(2));
            }

        // Le témoin braise de l'onglet actif glisse d'un onglet à l'autre.
        if (nav.Actif != null && temoinX >= 0 && temoinW > 0)
        {
            using var temoin = new SolidBrush(DA.Braise);
            g.FillRectangle(temoin, temoinX, this.S(8), temoinW, this.S(2));
        }

        if (survol == -2)
        {
            using var fond = new SolidBrush(DA.Survol);
            using var chemin = DA.Arrondi(Plus, this.S(8));
            g.FillPath(fond, chemin);
        }
        // Réduire, agrandir (ou restaurer), fermer : dessinés comme ceux de Windows 11, fermer rougit au survol.
        for (int k = 0; k < 3; k++)
        {
            var r = Commande(k);
            if (survol == -3 - k)
            {
                using var fondCommande = new SolidBrush(k == 2 ? Color.FromArgb(196, 43, 28) : DA.Survol);
                g.FillRectangle(fondCommande, r);
            }
            string glyphe = k == 0 ? "\uE921" : k == 1 ? (nav.WindowState == FormWindowState.Maximized ? "\uE923" : "\uE922") : "\uE8BB";
            TextRenderer.DrawText(g, glyphe, Icones, r, survol == -5 && k == 2 ? Color.White : DA.Brume, flags);
        }
        if (plusX >= 0) TextRenderer.DrawText(g, "", Icones, Plus, DA.Brume, flags);
    }

    protected override void OnMouseMove(MouseEventArgs e)
    {
        int i = Index(e.Location);
        if (i < 0 && Plus.Contains(e.Location)) i = -2;
        if (i < 0 && CommandeSous(e.Location) is var k and >= 0) i = -3 - k;
        bool croix = i >= 0 && Croix(Zone(i)).Contains(e.Location);
        if (i != survol || croix != surCroix) { survol = i; surCroix = croix; Invalidate(); }
        base.OnMouseMove(e);
    }

    protected override void OnMouseLeave(EventArgs e)
    {
        survol = -1;
        surCroix = false;
        Invalidate();
        base.OnMouseLeave(e);
    }

    protected override void OnMouseDown(MouseEventArgs e)
    {
        base.OnMouseDown(e);
        int i = Index(e.Location);
        var gr = i < 0 ? GroupeSous(e.Location) : null;
        if (e.Button == MouseButtons.Right)
        {
            if (i >= 0) nav.MenuOnglet(nav.Onglets[i], PointToScreen(e.Location));
            else if (gr != null) nav.MenuGroupe(gr, PointToScreen(e.Location));
            return;
        }
        if (e.Button == MouseButtons.Left && gr != null) { nav.BasculerGroupe(gr); return; }
        if (e.Button == MouseButtons.Middle && i >= 0) nav.Fermer(nav.Onglets[i]);
        else if (e.Button != MouseButtons.Left) return;
        else if (i >= 0 && CroixVisible(i) && Croix(Zone(i)).Contains(e.Location)) nav.Fermer(nav.Onglets[i]);
        else if (i >= 0) nav.Activer(nav.Onglets[i]);
        else if (Plus.Contains(e.Location)) nav.NouvelOnglet();
    }

    protected override void OnMouseUp(MouseEventArgs e)
    {
        base.OnMouseUp(e);
        if (e.Button != MouseButtons.Left) return;
        switch (CommandeSous(e.Location))
        {
            case 0: nav.WindowState = FormWindowState.Minimized; break;
            case 1: nav.WindowState = nav.WindowState == FormWindowState.Maximized ? FormWindowState.Normal : FormWindowState.Maximized; break;
            case 2: nav.Close(); break;
        }
        survol = -1;
        Invalidate();
    }

    // Le vide de la barre d'onglets laisse passer la souris vers la fenêtre, qui s'en sert pour se déplacer et s'agrandir.
    protected override void WndProc(ref Message m)
    {
        base.WndProc(ref m);
        if (m.Msg != 0x0084) return; // WM_NCHITTEST
        long lp = m.LParam.ToInt64();
        var p = PointToClient(new Point((short)(lp & 0xFFFF), (short)((lp >> 16) & 0xFFFF)));
        bool bordDuHaut = nav.WindowState == FormWindowState.Normal && p.Y < this.S(5);
        if (bordDuHaut || (Index(p) < 0 && GroupeSous(p) == null && !Plus.Contains(p) && CommandeSous(p) < 0)) m.Result = (IntPtr)(-1); // HTTRANSPARENT
    }
}
