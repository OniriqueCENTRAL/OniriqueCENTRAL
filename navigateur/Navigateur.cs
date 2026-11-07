using System.Diagnostics;
using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;
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
    public static readonly Color Braise = Color.FromArgb(229, 56, 74);
    public static readonly Color BraiseClaire = Color.FromArgb(255, 142, 154); // Rose
    public static readonly Color Brume = Color.FromArgb(244, 236, 236);   // Os
    public static readonly Color Cendre = Color.FromArgb(168, 147, 154);  // Voile
    public static readonly Color Eteint = Color.FromArgb(125, 106, 110);  // Graduation

    public static int S(this Control c, int v) => (int)Math.Round(v * c.DeviceDpi / 96.0);

    public static GraphicsPath Arrondi(Rectangle r, int rayon, bool basCarre = false)
    {
        int d = rayon * 2;
        var p = new GraphicsPath();
        p.AddArc(r.X, r.Y, d, d, 180, 90);
        p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
        if (basCarre) { p.AddLine(r.Right, r.Bottom, r.X, r.Bottom); }
        else
        {
            p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
            p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
        }
        p.CloseFigure();
        return p;
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
}

sealed class Navigateur : Form
{
    const string Hote = "accueil.onirique";
    const string Accueil = "https://" + Hote + "/index.html";
    // Un onglet caché cesse de tourner après 30 s ; après 10 min, son moteur est fermé et il se recharge quand on y revient.
    static readonly TimeSpan Veille = TimeSpan.FromSeconds(30), Dechargement = TimeSpan.FromMinutes(10);

    internal readonly List<Onglet> Onglets = new();
    internal Onglet? Actif;

    readonly Panel contenu = new() { Dock = DockStyle.Fill, BackColor = DA.Nuit };
    readonly Panel barre = new() { Dock = DockStyle.Top, BackColor = DA.Fond };
    readonly Bandeau bandeau;
    readonly Bouton retour = new("", "Page précédente (Alt+Gauche)");
    readonly Bouton avance = new("", "Page suivante (Alt+Droite)");
    readonly Bouton recharger = new("", "Actualiser (F5)");
    readonly Champ champ = new();
    readonly Label memoire = new() { ForeColor = DA.Cendre, BackColor = DA.Fond, TextAlign = ContentAlignment.MiddleRight, AccessibleName = "Mémoire utilisée" };
    readonly System.Windows.Forms.Timer minuteur = new() { Interval = 5000 };
    readonly string[] adressesDeDepart;
    CoreWebView2Environment? env;
    FormWindowState etatAvantPleinEcran;

    public Navigateur(string[] adresses)
    {
        adressesDeDepart = adresses;
        Text = "ONIRIQUE";
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        BackColor = DA.Nuit;
        MinimumSize = new Size(520, 360);
        Size = new Size(1280, 820);
        StartPosition = FormStartPosition.CenterScreen;

        bandeau = new Bandeau(this) { Dock = DockStyle.Top };
        barre.Controls.AddRange(new Control[] { retour, avance, recharger, champ, memoire });
        barre.Paint += (_, e) => { using var p = new Pen(DA.Filet); e.Graphics.DrawLine(p, 0, barre.Height - 1, barre.Width, barre.Height - 1); };
        barre.Resize += (_, _) => Disposer();
        Controls.Add(contenu);
        Controls.Add(barre);
        Controls.Add(bandeau);
        new ToolTip().SetToolTip(memoire, "Mémoire utilisée par le navigateur et ses onglets");

        retour.Click += (_, _) => Actif?.Vue?.CoreWebView2?.GoBack();
        avance.Click += (_, _) => Actif?.Vue?.CoreWebView2?.GoForward();
        recharger.Click += (_, _) =>
        {
            if (Actif?.Vue?.CoreWebView2 is not { } c) return;
            if (Actif.Charge) c.Stop(); else c.Reload();
        };
        champ.Saisie.KeyDown += (_, e) =>
        {
            if (e.KeyCode == Keys.Enter) { e.SuppressKeyPress = true; Aller(champ.Saisie.Text); }
            else if (e.KeyCode == Keys.Escape) { e.SuppressKeyPress = true; Actif?.Vue?.Focus(); Afficher(); }
        };
        champ.Saisie.LostFocus += (_, _) => Afficher();
        minuteur.Tick += (_, _) => Entretien();
        Echelle();
    }

    [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int valeur, int taille);

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        // Barre de titre Windows aux couleurs de la nuit (couleurs en 0x00BBGGRR).
        int oui = 1, legende = 0x0A0809, texte = 0xECECF4, bord = 0x252229;
        DwmSetWindowAttribute(Handle, 20, ref oui, 4);
        DwmSetWindowAttribute(Handle, 35, ref legende, 4);
        DwmSetWindowAttribute(Handle, 36, ref texte, 4);
        DwmSetWindowAttribute(Handle, 34, ref bord, 4);
    }

    protected override async void OnLoad(EventArgs e)
    {
        base.OnLoad(e);
        var dossier = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ONIRIQUE", "Navigateur");
        try
        {
            env = await CoreWebView2Environment.CreateAsync(null, dossier, new CoreWebView2EnvironmentOptions { Language = "fr-FR" });
        }
        catch (WebView2RuntimeNotFoundException)
        {
            MessageBox.Show(this, "Le moteur Microsoft Edge WebView2 n'est pas installé sur ce PC.\nInstallez-le depuis https://go.microsoft.com/fwlink/p/?LinkId=2124703 puis relancez ONIRIQUE.",
                "ONIRIQUE", MessageBoxButtons.OK, MessageBoxIcon.Error);
            Close();
            return;
        }
        minuteur.Start();
        if (adressesDeDepart.Length == 0) await Ouvrir(Accueil);
        foreach (var a in adressesDeDepart) await Ouvrir(Resoudre(a));
    }

    protected override void OnDpiChanged(DpiChangedEventArgs e)
    {
        base.OnDpiChanged(e);
        Echelle();
    }

    void Echelle()
    {
        bandeau.Height = this.S(40);
        barre.Height = this.S(46);
        Font = new Font("Segoe UI Variable Text", this.S(12), GraphicsUnit.Pixel);
        champ.Saisie.Font = new Font("Segoe UI Variable Text", this.S(14), GraphicsUnit.Pixel);
        bandeau.Icones = new Font("Segoe Fluent Icons", this.S(10), GraphicsUnit.Pixel);
        var icones = new Font("Segoe Fluent Icons", this.S(14), GraphicsUnit.Pixel);
        foreach (var b in new[] { retour, avance, recharger }) b.Font = icones;
        memoire.Font = new Font("Cascadia Mono", this.S(11), GraphicsUnit.Pixel);
        Disposer();
    }

    void Disposer()
    {
        int h = this.S(32), y = (barre.Height - h) / 2, x = this.S(8);
        foreach (var b in new Control[] { retour, avance, recharger }) { b.SetBounds(x, y, this.S(36), h); x += this.S(38); }
        int m = this.S(84);
        memoire.SetBounds(barre.Width - m - this.S(10), y, m, h);
        champ.SetBounds(x + this.S(6), y, Math.Max(0, memoire.Left - x - this.S(16)), h);
    }

    internal void NouvelOnglet() => _ = Ouvrir(Accueil);

    async Task<Onglet> Ouvrir(string? url, int position = -1)
    {
        var o = new Onglet { Url = url ?? "" };
        Onglets.Insert(position < 0 || position > Onglets.Count ? Onglets.Count : position, o);
        bandeau.Invalidate();
        await Creer(o);
        if (url != null && o.Vue?.CoreWebView2 is { } c) c.Navigate(url);
        Activer(o);
        return o;
    }

    async Task Creer(Onglet o)
    {
        var v = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = DA.Nuit, Visible = false };
        o.Vue = v;
        contenu.Controls.Add(v);
        _ = v.Handle;
        try { await v.EnsureCoreWebView2Async(env); }
        catch when (o.Vue != v) { return; }
        if (o.Vue != v) return;

        var c = v.CoreWebView2;
        c.Profile.PreferredTrackingPreventionLevel = CoreWebView2TrackingPreventionLevel.Strict;
        c.SetVirtualHostNameToFolderMapping(Hote, Path.Combine(AppContext.BaseDirectory, "accueil"), CoreWebView2HostResourceAccessKind.Deny);
        c.DocumentTitleChanged += (_, _) => { o.Titre = c.DocumentTitle; bandeau.Invalidate(); if (o == Actif) Afficher(); };
        c.SourceChanged += (_, _) => { o.Url = c.Source; if (o == Actif) Afficher(); };
        c.HistoryChanged += (_, _) => { if (o == Actif) Afficher(); };
        c.NavigationStarting += (_, _) => { o.Charge = true; bandeau.Invalidate(); if (o == Actif) Afficher(); };
        c.NavigationCompleted += (_, _) => { o.Charge = false; bandeau.Invalidate(); if (o == Actif) Afficher(); };
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
                if (n.Vue?.CoreWebView2 is { } nc) e.NewWindow = nc;
                e.Handled = true;
            }
            finally { report.Complete(); }
        };
        // La page d'accueil envoie ce qu'on tape dans son champ ; seule elle est écoutée.
        c.WebMessageReceived += (_, e) =>
        {
            if (Uri.TryCreate(e.Source, UriKind.Absolute, out var u) && u.Host == Hote && e.TryGetWebMessageAsString() is { Length: > 0 } s)
                c.Navigate(Resoudre(s));
        };
    }

    internal async void Activer(Onglet o)
    {
        if (Actif == o && o.Vue?.Visible == true) return;
        var ancien = Actif;
        Actif = o;
        if (ancien != null && ancien != o)
        {
            ancien.CacheDepuis = DateTime.Now;
            if (ancien.Vue?.CoreWebView2 is { } ac)
            {
                ancien.Vue.Visible = false;
                ac.MemoryUsageTargetLevel = CoreWebView2MemoryUsageTargetLevel.Low;
            }
        }
        o.CacheDepuis = DateTime.MaxValue;
        Afficher();
        bandeau.Invalidate();

        if (o.Vue == null)
        {
            o.Decharge = false;
            await Creer(o);
            if (o.Vue?.CoreWebView2 is { } nc) nc.Navigate(o.Url);
        }
        if (Actif != o || o.Vue?.CoreWebView2 is not { } c) return;
        c.MemoryUsageTargetLevel = CoreWebView2MemoryUsageTargetLevel.Normal;
        o.Vue.Visible = true;
        o.Vue.BringToFront();
        if (!champ.Saisie.Focused) o.Vue.Focus();
    }

    internal void Fermer(Onglet o)
    {
        int i = Onglets.IndexOf(o);
        if (i < 0) return;
        Onglets.RemoveAt(i);
        var vue = o.Vue;
        o.Vue = null;
        vue?.Dispose();
        if (Onglets.Count == 0) { Close(); return; }
        if (Actif == o) { Actif = null; Activer(Onglets[Math.Min(i, Onglets.Count - 1)]); }
        bandeau.Invalidate();
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
        bool accueil = o == null || o.Url.Length == 0 || o.Url.StartsWith("https://" + Hote + "/");
        if (!champ.Saisie.Focused) champ.Saisie.Text = accueil ? "" : o!.Url;
        Text = accueil ? "ONIRIQUE" : o!.Titre + " — ONIRIQUE";
    }

    void Aller(string saisie)
    {
        if (saisie.Trim().Length == 0 || Actif?.Vue?.CoreWebView2 is not { } c) return;
        c.Navigate(Resoudre(saisie));
        Actif.Vue.Focus();
    }

    internal static string Resoudre(string s)
    {
        s = s.Trim();
        if (Uri.TryCreate(s, UriKind.Absolute, out var u) && u.Scheme is "http" or "https" or "file") return u.AbsoluteUri;
        if (!s.Contains(' ') && Uri.TryCreate("http://" + s, UriKind.Absolute, out u) && (u.Host == "localhost" || u.Host.Contains('.')))
            return (u.Host == "localhost" ? "http://" : "https://") + s;
        return "https://www.google.com/search?q=" + Uri.EscapeDataString(s);
    }

    void Entretien()
    {
        var maintenant = DateTime.Now;
        foreach (var o in Onglets.ToArray())
        {
            if (o == Actif || o.Son || o.Vue?.CoreWebView2 is not { } c) continue;
            var cache = maintenant - o.CacheDepuis;
            if (cache > Dechargement)
            {
                var vue = o.Vue;
                o.Vue = null;
                o.Decharge = true;
                vue.Dispose();
                bandeau.Invalidate();
            }
            else if (cache > Veille && !c.IsSuspended) _ = Suspendre(c);
        }
        MesurerMemoire();
    }

    static async Task Suspendre(CoreWebView2 c)
    {
        try { await c.TrySuspendAsync(); } catch { }
    }

    void MesurerMemoire()
    {
        if (env == null) return;
        using var moi = Process.GetCurrentProcess();
        long total = moi.PrivateMemorySize64;
        foreach (var info in env.GetProcessInfos())
        {
            try { using var p = Process.GetProcessById(info.ProcessId); total += p.PrivateMemorySize64; } catch { }
        }
        memoire.Text = $"{total / 1048576} Mo";
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
        }
        return base.ProcessCmdKey(ref msg, touches);
    }
}

sealed class Bouton : Control
{
    static readonly ToolTip Aide = new();
    string glyphe;
    bool actif = true, survol;

    public Bouton(string glyphe, string aide)
    {
        this.glyphe = glyphe;
        DoubleBuffered = true;
        BackColor = DA.Fond;
        Cursor = Cursors.Hand;
        AccessibleName = aide;
        AccessibleRole = AccessibleRole.PushButton;
        Aide.SetToolTip(this, aide);
    }

    [System.ComponentModel.DesignerSerializationVisibility(System.ComponentModel.DesignerSerializationVisibility.Hidden)]
    public string Glyphe { get => glyphe; set { if (glyphe != value) { glyphe = value; Invalidate(); } } }
    [System.ComponentModel.DesignerSerializationVisibility(System.ComponentModel.DesignerSerializationVisibility.Hidden)]
    public bool Actif { get => actif; set { if (actif != value) { actif = value; Invalidate(); } } }

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
        TextRenderer.DrawText(g, glyphe, Font, ClientRectangle, actif ? DA.Brume : DA.Eteint,
            TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
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

    public Champ()
    {
        DoubleBuffered = true;
        BackColor = DA.Fond;
        Cursor = Cursors.IBeam;
        Controls.Add(Saisie);
        Saisie.GotFocus += (_, _) => { Invalidate(); BeginInvoke(Saisie.SelectAll); };
        Saisie.LostFocus += (_, _) => Invalidate();
    }

    protected override void OnLayout(LayoutEventArgs e)
    {
        base.OnLayout(e);
        int marge = this.S(14);
        Saisie.SetBounds(marge, (Height - Saisie.Height) / 2, Math.Max(0, Width - 2 * marge), Saisie.Height);
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

// shortcut: onglets dessinés à la main, invisibles pour les lecteurs d'écran (clavier : Ctrl+Tab, Ctrl+T, Ctrl+W) ; leur donner des objets d'accessibilité si un utilisateur en a besoin.
sealed class Bandeau : Control
{
    readonly Navigateur nav;
    int survol = -1;
    bool surCroix;
    public Font Icones = SystemFonts.DefaultFont;

    public Bandeau(Navigateur nav)
    {
        this.nav = nav;
        DoubleBuffered = true;
        ResizeRedraw = true;
        BackColor = DA.Nuit;
        AccessibleName = "Onglets";
    }

    int Largeur => nav.Onglets.Count == 0 ? 0 : Math.Clamp((Width - this.S(56)) / nav.Onglets.Count, this.S(44), this.S(232));
    Rectangle Zone(int i) => new(this.S(8) + i * Largeur, this.S(6), Largeur, Height - this.S(6));
    Rectangle Croix(Rectangle r) => new(r.Right - this.S(28), r.Y + (r.Height - this.S(20)) / 2, this.S(20), this.S(20));
    Rectangle Plus => new(this.S(8) + nav.Onglets.Count * Largeur + this.S(6), this.S(9), this.S(28), this.S(28));
    bool CroixVisible(int i) => (nav.Onglets[i] == nav.Actif || i == survol) && Largeur > this.S(80);

    int Index(Point p)
    {
        for (int i = 0; i < nav.Onglets.Count; i++) if (Zone(i).Contains(p)) return i;
        return -1;
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        using var filet = new Pen(DA.Filet);
        g.DrawLine(filet, 0, Height - 1, Width, Height - 1);
        var liste = nav.Onglets;

        for (int i = 0; i < liste.Count; i++)
        {
            var o = liste[i];
            var r = Zone(i);
            bool actif = o == nav.Actif;
            if (actif)
            {
                using var chemin = DA.Arrondi(new Rectangle(r.X, r.Y, r.Width - this.S(2), r.Height), this.S(8), basCarre: true);
                using var fond = new SolidBrush(DA.Fond);
                g.FillPath(fond, chemin);
                g.DrawPath(filet, chemin);
                using var temoin = new SolidBrush(DA.Braise);
                g.FillRectangle(temoin, r.X + this.S(12), r.Y, r.Width - this.S(26), this.S(2));
            }
            else
            {
                if (i == survol)
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
            }

            int milieu = r.Y + r.Height / 2;
            int x = r.X + this.S(12);
            var icone = new Rectangle(x, milieu - this.S(8), this.S(16), this.S(16));
            if (o.Charge)
            {
                // Témoin de chargement : une braise allumée.
                using var halo = new SolidBrush(Color.FromArgb(70, DA.Braise));
                using var coeur = new SolidBrush(DA.BraiseClaire);
                g.FillEllipse(halo, icone.X + this.S(2), icone.Y + this.S(2), this.S(12), this.S(12));
                g.FillEllipse(coeur, icone.X + this.S(5), icone.Y + this.S(5), this.S(6), this.S(6));
            }
            else if (o.Icone != null) g.DrawImage(o.Icone, icone);
            else TextRenderer.DrawText(g, "", Icones, icone, DA.Cendre, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);

            int droite = r.Right - this.S(CroixVisible(i) ? 32 : 10);
            if (o.Son)
            {
                droite -= this.S(18);
                TextRenderer.DrawText(g, "", Icones, new Rectangle(droite, r.Y, this.S(18), r.Height), DA.BraiseClaire, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
            }
            var texte = new Rectangle(x + this.S(24), r.Y, Math.Max(0, droite - x - this.S(26)), r.Height);
            var couleur = actif ? DA.Brume : o.Decharge ? DA.Eteint : DA.Cendre;
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
                TextRenderer.DrawText(g, "", Icones, cr, actif || surCroix ? DA.Brume : DA.Cendre, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
            }
        }

        if (survol == -2)
        {
            using var fond = new SolidBrush(DA.Survol);
            using var chemin = DA.Arrondi(Plus, this.S(8));
            g.FillPath(fond, chemin);
        }
        TextRenderer.DrawText(g, "", Icones, Plus, DA.Brume, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
    }

    protected override void OnMouseMove(MouseEventArgs e)
    {
        int i = Index(e.Location);
        if (i < 0 && Plus.Contains(e.Location)) i = -2;
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
        if (e.Button == MouseButtons.Middle && i >= 0) nav.Fermer(nav.Onglets[i]);
        else if (e.Button != MouseButtons.Left) return;
        else if (i >= 0 && CroixVisible(i) && Croix(Zone(i)).Contains(e.Location)) nav.Fermer(nav.Onglets[i]);
        else if (i >= 0) nav.Activer(nav.Onglets[i]);
        else if (Plus.Contains(e.Location)) nav.NouvelOnglet();
    }

    protected override void OnMouseDoubleClick(MouseEventArgs e)
    {
        base.OnMouseDoubleClick(e);
        if (e.Button == MouseButtons.Left && Index(e.Location) < 0 && !Plus.Contains(e.Location)) nav.NouvelOnglet();
    }
}
