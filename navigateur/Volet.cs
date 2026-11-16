using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;

namespace Onirique;

/// <summary>Une ligne de volet : un élément cliquable, un interrupteur, un titre de rubrique, un lien de bas ou un filet.</summary>
sealed class Ligne
{
    public string Titre = "", Sous = "";
    public string? Badge;          // texte court dans la pastille (extension d'un fichier)
    public string? Glyphe;         // ou une icône Segoe Fluent
    public Action? Faire;
    public bool Actif = true;
    public double? Progres;        // 0 à 1 ; NaN : en cours sans taille connue
    public bool? Interrupteur;     // un interrupteur à droite, allumé ou non ; le volet reste ouvert
    public bool Lien, Rubrique, Filet;
    public string? GlypheAction;   // petit bouton à droite (afficher dans le dossier…)
    public Action? Action;
    public string? AideAction;
    internal bool Cliquable => Actif && !Rubrique && !Filet && Faire != null;
}

/// <summary>
/// Le volet qui descend sous un bouton de la barre : une carte de la nuit, coins arrondis et ombre, qui se ferme dès
/// qu'on clique ailleurs. Clavier : flèches, Entrée, Échap.
/// </summary>
sealed class Volet : Form
{
    readonly string titre;
    readonly Func<List<Ligne>> source;
    readonly Control ancre;
    readonly System.Windows.Forms.Timer anime = new() { Interval = 15 }, suivi = new() { Interval = 500 };
    List<Ligne> lignes = new();
    readonly List<Rectangle> zones = new();
    int survol = -1;
    bool surAction;
    int departY, arriveeY;
    readonly Font texte, petit, gras, entete, icones, mono;

    [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int valeur, int taille);

    /// <summary>Le dernier volet fermé et quand : recliquer sur son bouton le ferme au lieu de le rouvrir.</summary>
    static (Control? Ancre, long Quand) dernier;

    public static void Ouvrir(Control ancre, string titre, Func<List<Ligne>> lignes, bool vivant = false)
    {
        if (dernier.Ancre == ancre && Environment.TickCount64 - dernier.Quand < 250) return;
        var v = new Volet(ancre, titre, lignes);
        if (vivant) v.suivi.Start();
        v.Show(ancre.FindForm());
    }

    Volet(Control ancre, string titre, Func<List<Ligne>> source)
    {
        this.ancre = ancre;
        this.titre = titre;
        this.source = source;
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        StartPosition = FormStartPosition.Manual;
        BackColor = DA.Fond;
        DoubleBuffered = true;
        KeyPreview = true;
        AccessibleName = titre;
        Opacity = 0;
        string corps = "Segoe UI Variable Text";
        texte = new Font(corps, ancre.S(13), GraphicsUnit.Pixel);
        petit = new Font(corps, ancre.S(11), GraphicsUnit.Pixel);
        gras = new Font(corps, ancre.S(13), FontStyle.Bold, GraphicsUnit.Pixel);
        entete = new Font("Segoe UI Variable Display", ancre.S(15), FontStyle.Bold, GraphicsUnit.Pixel);
        icones = new Font("Segoe Fluent Icons", ancre.S(14), GraphicsUnit.Pixel);
        mono = new Font("Cascadia Mono", ancre.S(9), FontStyle.Bold, GraphicsUnit.Pixel);
        anime.Tick += (_, _) =>
        {
            Opacity = Math.Min(1, Opacity + 0.2);
            Top = arriveeY - (int)Math.Round((arriveeY - departY) * (1 - Opacity));
            if (Opacity >= 1) { Top = arriveeY; anime.Stop(); }
        };
        suivi.Tick += (_, _) => Recharger();
        Recharger();
    }

    protected override CreateParams CreateParams
    {
        get { var cp = base.CreateParams; cp.ClassStyle |= 0x20000; return cp; } // CS_DROPSHADOW
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        int rond = 2, bord = 0x29_22_25, sombre = 1; // coins arrondis (Windows 11), filet de la nuit
        DwmSetWindowAttribute(Handle, 33, ref rond, 4);
        DwmSetWindowAttribute(Handle, 34, ref bord, 4);
        DwmSetWindowAttribute(Handle, 20, ref sombre, 4);
    }

    int S(int v) => ancre.S(v);
    int Hauteur(Ligne l) => l.Filet ? S(9) : l.Rubrique ? S(28) : l.Lien ? S(36) : l.Sous.Length > 0 || l.Progres != null ? S(54) : S(42);

    void Recharger()
    {
        lignes = source();
        zones.Clear();
        int y = S(52), largeur = S(360);
        foreach (var l in lignes) { int h = Hauteur(l); zones.Add(new Rectangle(S(6), y, largeur - S(12), h)); y += h; }
        var taille = new Size(largeur, y + S(6));
        if (!IsHandleCreated) Placer(taille);
        else if (Size != taille) { Size = taille; Placer(taille); }
        if (survol >= lignes.Count) survol = -1;
        Invalidate();
    }

    void Placer(Size taille)
    {
        Size = taille;
        var coin = ancre.PointToScreen(new Point(ancre.Width, ancre.Height));
        var ecran = Screen.FromControl(ancre).WorkingArea;
        int x = Math.Clamp(coin.X - taille.Width + S(4), ecran.Left + S(4), Math.Max(ecran.Left, ecran.Right - taille.Width - S(4)));
        arriveeY = Math.Min(coin.Y + S(6), Math.Max(ecran.Top, ecran.Bottom - taille.Height - S(4)));
        departY = arriveeY - S(8);
        Location = new Point(x, anime.Enabled || Opacity < 1 ? departY : arriveeY);
    }

    protected override void OnShown(EventArgs e)
    {
        base.OnShown(e);
        Activate();
        anime.Start();
    }

    protected override void OnDeactivate(EventArgs e) { base.OnDeactivate(e); Fermer(); }

    void Fermer()
    {
        if (IsDisposed || Disposing) return;
        dernier = (ancre, Environment.TickCount64);
        anime.Stop();
        suivi.Stop();
        BeginInvoke(Close);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) { anime.Dispose(); suivi.Dispose(); foreach (var f in new[] { texte, petit, gras, entete, icones, mono }) f.Dispose(); }
        base.Dispose(disposing);
    }

    Rectangle ZoneAction(Rectangle r) => new(r.Right - S(40), r.Y + (r.Height - S(30)) / 2, S(30), S(30));
    Rectangle ZoneInterrupteur(Rectangle r) => new(r.Right - S(48), r.Y + (r.Height - S(20)) / 2, S(36), S(20));

    static GraphicsPath Arrondi(RectangleF r, float rayon)
    {
        var p = new GraphicsPath();
        float d = rayon * 2;
        p.AddArc(r.X, r.Y, d, d, 180, 90);
        p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
        p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
        p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
        p.CloseFigure();
        return p;
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;
        var gauche = TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis | TextFormatFlags.SingleLine | TextFormatFlags.NoPrefix;
        var centre = TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine | TextFormatFlags.NoPrefix;

        // En-tête : le titre, et un trait de braise dessous, comme l'onglet actif.
        TextRenderer.DrawText(g, titre, entete, new Rectangle(S(18), S(8), Width - S(36), S(34)), DA.Brume, gauche);
        using (var braise = new SolidBrush(DA.Braise)) g.FillRectangle(braise, S(18), S(42), S(22), S(2));
        using (var filet = new Pen(DA.Filet)) g.DrawLine(filet, S(44), S(43), Width - S(18), S(43));

        for (int i = 0; i < lignes.Count; i++)
        {
            var l = lignes[i];
            var r = zones[i];
            if (l.Filet) { using var p = new Pen(DA.Filet); g.DrawLine(p, r.X + S(12), r.Y + r.Height / 2, r.Right - S(12), r.Y + r.Height / 2); continue; }
            if (l.Rubrique)
            {
                TextRenderer.DrawText(g, l.Titre.ToUpperInvariant(), mono, new Rectangle(r.X + S(12), r.Y + S(6), r.Width - S(24), r.Height - S(6)), DA.Eteint, gauche);
                continue;
            }
            bool chaud = i == survol && (l.Cliquable || l.Action != null);
            if (chaud)
            {
                using var fond = new SolidBrush(DA.Survol);
                using var forme = Arrondi(r, S(8));
                g.FillPath(fond, forme);
            }
            int x = r.X + S(12);
            if (l.Lien)
            {
                TextRenderer.DrawText(g, l.Titre, gras, new Rectangle(x, r.Y, r.Width - S(50), r.Height), chaud ? DA.BraiseClaire : DA.Braise, gauche);
                TextRenderer.DrawText(g, "", icones, new Rectangle(r.Right - S(36), r.Y, S(24), r.Height), chaud ? DA.BraiseClaire : DA.Cendre, centre);
                continue;
            }
            // La pastille : l'extension du fichier ou une icône, sur un dégradé de braise (éteinte si la ligne l'est).
            if (l.Badge != null || l.Glyphe != null)
            {
                int t = S(34);
                var p = new Rectangle(x, r.Y + (r.Height - t) / 2, t, t);
                using var forme = Arrondi(p, S(9));
                if (l.Actif && l.Badge != null)
                {
                    using var degrade = new LinearGradientBrush(p, DA.Braise, DA.Sang, 90f);
                    g.FillPath(degrade, forme);
                }
                else
                {
                    using var fond = new SolidBrush(l.Actif ? Color.FromArgb(40, DA.Braise) : DA.Survol);
                    g.FillPath(fond, forme);
                }
                if (l.Badge != null) TextRenderer.DrawText(g, l.Badge.ToUpperInvariant(), mono, p, l.Actif ? Color.White : DA.Eteint, centre);
                else TextRenderer.DrawText(g, l.Glyphe, icones, p, l.Actif ? DA.BraiseClaire : DA.Eteint, centre);
                x += t + S(12);
            }
            int droite = r.Right - (l.Interrupteur != null ? S(58) : l.GlypheAction != null ? S(46) : S(12));
            bool deuxLignes = l.Sous.Length > 0 || l.Progres != null;
            var zoneTitre = new Rectangle(x, deuxLignes ? r.Y + S(8) : r.Y, droite - x, deuxLignes ? S(20) : r.Height);
            TextRenderer.DrawText(g, l.Titre, texte, zoneTitre, l.Actif ? DA.Brume : DA.Eteint, gauche);
            if (l.Sous.Length > 0)
                TextRenderer.DrawText(g, l.Sous, petit, new Rectangle(x, r.Y + S(27), droite - x, S(16)), l.Actif ? DA.Cendre : DA.Eteint, gauche);
            if (l.Progres is { } pr)
            {
                var piste = new RectangleF(x, r.Bottom - S(9), droite - x, S(3));
                using var fondPiste = new SolidBrush(DA.Filet);
                using (var forme = Arrondi(piste, piste.Height / 2)) g.FillPath(fondPiste, forme);
                // Sans taille connue, un segment fait des allers-retours.
                var plein = double.IsNaN(pr)
                    ? new RectangleF(piste.X + (float)((Math.Sin(Environment.TickCount64 / 300.0) + 1) / 2 * piste.Width * 0.7), piste.Y, piste.Width * 0.3f, piste.Height)
                    : new RectangleF(piste.X, piste.Y, Math.Max(piste.Height, (float)(piste.Width * Math.Clamp(pr, 0, 1))), piste.Height);
                using var braise = new SolidBrush(DA.Braise);
                using (var forme = Arrondi(plein, piste.Height / 2)) g.FillPath(braise, forme);
            }
            if (l.Interrupteur is { } allume)
            {
                var z = ZoneInterrupteur(r);
                using var forme = Arrondi(z, z.Height / 2f);
                using var fond = new SolidBrush(!l.Actif ? DA.Survol : allume ? DA.Braise : DA.Filet);
                g.FillPath(fond, forme);
                int d = z.Height - S(6);
                using var bouton = new SolidBrush(allume && l.Actif ? Color.White : DA.Cendre);
                g.FillEllipse(bouton, allume ? z.Right - d - S(3) : z.X + S(3), z.Y + S(3), d, d);
            }
            else if (l.GlypheAction != null)
            {
                var z = ZoneAction(r);
                if (i == survol && surAction)
                {
                    using var fond = new SolidBrush(DA.Filet);
                    using var forme = Arrondi(z, S(7));
                    g.FillPath(fond, forme);
                }
                TextRenderer.DrawText(g, l.GlypheAction, icones, z, i == survol && surAction ? DA.Brume : DA.Cendre, centre);
            }
        }
    }

    protected override void OnMouseMove(MouseEventArgs e)
    {
        base.OnMouseMove(e);
        int i = zones.FindIndex(z => z.Contains(e.Location));
        bool action = i >= 0 && lignes[i].Action != null && ZoneAction(zones[i]).Contains(e.Location);
        if (i == survol && action == surAction) return;
        survol = i;
        surAction = action;
        Cursor = i >= 0 && (lignes[i].Cliquable || action) ? Cursors.Hand : Cursors.Default;
        Invalidate();
    }

    protected override void OnMouseLeave(EventArgs e) { base.OnMouseLeave(e); survol = -1; Invalidate(); }

    protected override void OnMouseUp(MouseEventArgs e)
    {
        base.OnMouseUp(e);
        if (e.Button != MouseButtons.Left) return;
        int i = zones.FindIndex(z => z.Contains(e.Location));
        if (i < 0) return;
        if (lignes[i].Action != null && ZoneAction(zones[i]).Contains(e.Location)) { lignes[i].Action!(); Fermer(); return; }
        Choisir(i);
    }

    void Choisir(int i)
    {
        var l = lignes[i];
        if (!l.Cliquable) return;
        l.Faire!();
        if (l.Interrupteur != null) Recharger(); // un interrupteur se voit basculer, le volet reste
        else Fermer();
    }

    protected override bool ProcessCmdKey(ref Message msg, Keys touches)
    {
        switch (touches)
        {
            case Keys.Escape: Fermer(); return true;
            case Keys.Down:
            case Keys.Up:
                int sens = touches == Keys.Down ? 1 : -1, n = lignes.Count;
                for (int k = 1; k <= n; k++)
                {
                    int j = ((survol < 0 ? (sens > 0 ? -1 : 0) : survol) + sens * k + n * 2) % n;
                    if (lignes[j].Cliquable) { survol = j; surAction = false; Invalidate(); break; }
                }
                return true;
            case Keys.Enter:
            case Keys.Space:
                if (survol >= 0) Choisir(survol);
                return true;
        }
        return base.ProcessCmdKey(ref msg, touches);
    }
}
