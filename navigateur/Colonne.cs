using System.Drawing.Drawing2D;
using Microsoft.Web.WebView2.WinForms;

namespace Onirique;

// Disposition « onglets sur le côté » (réglage OngletsVerticaux) : une colonne à gauche avec, de haut en bas, les
// commandes de la fenêtre, la barre d'adresse, les onglets épinglés en petites icônes, les groupes avec leurs onglets,
// « Nouvel onglet » et les autres onglets ; la page dans un cadre arrondi à droite.
sealed partial class Navigateur
{
    Colonne colonne = null!;
    internal bool Verticale => Reglages.OngletsVerticaux;

    void InitColonne()
    {
        colonne = new Colonne(this) { Dock = DockStyle.Left, Visible = false };
        Controls.Add(colonne);
    }

    internal void Redessiner()
    {
        bandeau.Invalidate();
        colonne?.Invalidate();
    }

    /// <summary>Passe d'une disposition à l'autre : la barre d'adresse change de parent, la page prend ou quitte son cadre.</summary>
    void AppliquerDisposition()
    {
        SuspendLayout();
        bool v = Verticale;
        Control parent = v ? colonne : this;
        if (barre.Parent != parent) parent.Controls.Add(barre);
        // L'ordre d'empilement décide du placement : barre latérale, colonne, bandeaux du haut, panneau, page.
        var ordre = new List<Control> { contenu, panneau, favoris };
        if (!v) ordre.Add(barre);
        ordre.AddRange(new Control[] { bandeau, colonne, laterale });
        for (int i = 0; i < ordre.Count; i++) Controls.SetChildIndex(ordre[i], i);
        bandeau.Visible = !v && !pleinEcranActif;
        colonne.Visible = v && !pleinEcranActif;
        contenu.BackColor = v ? DA.Fond : DA.Nuit;
        foreach (var o in Onglets) if (!v && o.Vue is { } vue) Arrondir(vue);
        ResumeLayout();
        Echelle();
        PlacerVues();
        Redessiner();
    }

    // Avant l'affichage, les boutons se disent tous invisibles : la barre se replace une fois la fenêtre montrée.
    protected override void OnShown(EventArgs e) { base.OnShown(e); Disposer(); }

    void DisposerEnColonne(int h, int x)
    {
        // Deux rangées : l'adresse sur toute la largeur, puis les boutons (ils se resserrent s'ils sont nombreux).
        int y1 = this.S(4), y2 = this.S(42), largeur = barre.Width - 2 * x;
        champ.SetBounds(x, y1, Math.Max(0, largeur), h);
        var droite = new Control[] { reglages, historique, boutonTelechargements, boutonExtensions, boutonPip, vpn, lecteur, studio }.Where(b => b.Visible).ToList();
        int pas = Math.Min(this.S(34), largeur / Math.Max(1, 3 + droite.Count)), l = pas - this.S(2);
        int gx = x;
        foreach (var b in new Control[] { retour, avance, recharger }) { b.SetBounds(gx, y2, l, h); gx += pas; }
        int d = barre.Width - x;
        foreach (var b in droite) { d -= l; b.SetBounds(d, y2, l, h); d -= pas - l; }
        int reste = d - gx - this.S(6);
        memoire.SetBounds(gx, y2, reste >= this.S(56) ? reste : 0, h);
        bulle.Placer();
        PlacerAjouts();
    }

    void Arrondir(WebView2? v)
    {
        if (v == null) return;
        var avant = v.Region;
        if (!Verticale) { if (avant != null) { v.Region = null; avant.Dispose(); } return; }
        using var chemin = DA.Arrondi(new Rectangle(0, 0, v.Width, v.Height), this.S(10));
        v.Region = new Region(chemin);
        avant?.Dispose();
    }
}

// shortcut: onglets dessinés à la main, invisibles pour les lecteurs d'écran, et pas de glisser-déposer dans la colonne
// (le clic droit range dans un groupe ou épingle) ; à ajouter si on le demande.
sealed class Colonne : Panel   // un Panel : sa marge du haut (les commandes de la fenêtre) repousse la barre d'adresse
{
    readonly Navigateur nav;
    readonly List<(Rectangle R, object Quoi)> zones = new();   // onglets, groupes, "plus", positions à l'écran
    readonly ToolTip infobulle = new();
    object? survol;
    bool surCroix;
    int defile, defileMax, commande = -1;
    public Font Icones = SystemFonts.DefaultFont;

    public Colonne(Navigateur nav)
    {
        this.nav = nav;
        DoubleBuffered = true;
        ResizeRedraw = true;
        BackColor = DA.Fond;
        AccessibleName = "Onglets";
    }

    public void Echelle()
    {
        Width = this.S(272);
        Padding = new Padding(0, this.S(38), 0, 0);
        Font = nav.Font;
        Icones = new Font("Segoe Fluent Icons", this.S(11), GraphicsUnit.Pixel);
    }

    int Marge => this.S(8);
    Rectangle Commande(int k) => new(Width - (3 - k) * this.S(42), 0, this.S(42), this.S(34)); // réduire, agrandir, fermer
    int CommandeSous(Point p) { for (int k = 0; k < 3; k++) if (Commande(k).Contains(p)) return k; return -1; }
    int HautDeListe { get; set; }

    /// <summary>Calcule la place de chaque élément (dans l'ordre d'affichage) ; la liste sous les épinglés défile.</summary>
    void Disposer()
    {
        zones.Clear();
        int x = Marge, w = Width - 2 * Marge;
        int y = (Controls.Count > 0 ? Controls.Cast<Control>().Max(c => c.Bottom) : Padding.Top) + this.S(10);

        var epingles = nav.Onglets.Where(o => o.Epingle).ToList();
        if (epingles.Count > 0)
        {
            int ecart = this.S(6), colonnes = Math.Clamp((w + ecart) / (this.S(52) + ecart), 1, 6);
            int tw = (w - (colonnes - 1) * ecart) / colonnes, th = this.S(40);
            for (int i = 0; i < epingles.Count; i++)
                zones.Add((new Rectangle(x + i % colonnes * (tw + ecart), y + i / colonnes * (th + ecart), tw, th), epingles[i]));
            y += (epingles.Count + colonnes - 1) / colonnes * (th + ecart) + this.S(6);
        }
        HautDeListe = y;

        int ligne = this.S(34);
        y -= defile;
        var libres = nav.Onglets.Where(o => !o.Epingle).ToList();
        // Les groupes d'abord, chacun sous son nom (repliable), puis « Nouvel onglet », puis les onglets sans groupe.
        foreach (var gr in libres.Select(o => o.Groupe).OfType<Groupe>().Distinct().ToList())
        {
            zones.Add((new Rectangle(x, y, w, this.S(30)), gr));
            y += this.S(32);
            if (gr.Replie) continue;
            foreach (var o in libres.Where(o => o.Groupe == gr)) { zones.Add((new Rectangle(x + this.S(10), y, w - this.S(10), ligne), o)); y += ligne + this.S(2); }
            y += this.S(4);
        }
        zones.Add((new Rectangle(x, y, w, ligne), "plus"));
        y += ligne + this.S(2);
        foreach (var o in libres.Where(o => o.Groupe == null)) { zones.Add((new Rectangle(x, y, w, ligne), o)); y += ligne + this.S(2); }
        defileMax = Math.Max(0, y + defile + Marge - Height);
        if (defile > defileMax) { defile = defileMax; Disposer(); }
    }

    internal Rectangle Entete(Groupe gr)
    {
        Disposer();
        var r = zones.FirstOrDefault(z => z.Quoi == gr).R;
        return r.IsEmpty ? new Rectangle(Marge, HautDeListe, Width - 2 * Marge, this.S(30)) : r;
    }

    object? Sous(Point p)
    {
        foreach (var (r, quoi) in zones)
        {
            // Ce qui a défilé sous les épinglés n'est plus cliquable.
            if (quoi is not Onglet { Epingle: true } && p.Y < HautDeListe) continue;
            if (r.Contains(p)) return quoi;
        }
        return null;
    }

    Rectangle Croix(Rectangle r) => new(r.Right - this.S(28), r.Y + (r.Height - this.S(20)) / 2, this.S(20), this.S(20));
    bool CroixVisible(Onglet o) => !o.Epingle && (o == nav.Actif || survol == o);

    protected override void OnPaint(PaintEventArgs e)
    {
        Disposer();
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        var centre = TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding;
        var gauche = TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis | TextFormatFlags.SingleLine | TextFormatFlags.NoPrefix;
        using var filet = new Pen(DA.Filet);
        g.DrawLine(filet, Width - 1, 0, Width - 1, Height);

        // Réduire, agrandir, fermer : comme dans le bandeau, fermer rougit au survol.
        for (int k = 0; k < 3; k++)
        {
            var r = Commande(k);
            if (survol is int s && s == k)
            {
                using var fond = new SolidBrush(k == 2 ? Color.FromArgb(196, 43, 28) : DA.Survol);
                g.FillRectangle(fond, r);
            }
            string glyphe = k == 0 ? "" : k == 1 ? (nav.WindowState == FormWindowState.Maximized ? "" : "") : "";
            TextRenderer.DrawText(g, glyphe, Icones, r, survol is 2 && k == 2 ? Color.White : DA.Brume, centre);
        }
        // Le logo ONIRIQUE à gauche des commandes, comme une signature.
        TextRenderer.DrawText(g, "ONIRIQUE", Font, new Rectangle(this.S(14), 0, this.S(120), this.S(34)), DA.Eteint, gauche);

        foreach (var (r, quoi) in zones)
        {
            if (quoi is Onglet { Epingle: true } ep) { DessinerEpingle(g, r, ep); continue; }
            var etat = g.Save();
            g.SetClip(new Rectangle(0, HautDeListe, Width, Height - HautDeListe));
            if (r.Bottom >= HautDeListe && r.Y <= Height)
            {
                if (quoi is Groupe gr) DessinerGroupe(g, r, gr, gauche);
                else if (quoi is Onglet o) DessinerOnglet(g, r, o, gauche, centre);
                else if (quoi is "plus")
                {
                    if (zones.Any(z => z.Quoi is Groupe)) g.DrawLine(filet, r.X + this.S(4), r.Y - this.S(3), r.Right - this.S(4), r.Y - this.S(3));
                    if (survol is "plus") using (var ch = DA.Arrondi(r, this.S(8))) using (var f = new SolidBrush(DA.Survol)) g.FillPath(f, ch);
                    TextRenderer.DrawText(g, "", Icones, new Rectangle(r.X + this.S(10), r.Y, this.S(16), r.Height), DA.Cendre, centre);
                    TextRenderer.DrawText(g, "Nouvel onglet", Font, new Rectangle(r.X + this.S(36), r.Y, r.Width - this.S(40), r.Height), DA.Cendre, gauche);
                }
            }
            g.Restore(etat);
        }
        if (defile > 0) g.DrawLine(filet, Marge, HautDeListe, Width - Marge, HautDeListe);
    }

    void Icone(Graphics g, Rectangle icone, Onglet o)
    {
        if (o.Charge)
        {
            // Témoin de chargement : la braise qui respire, comme dans le bandeau.
            int alpha = (int)(55 + 45 * Math.Sin(Environment.TickCount64 / 220.0));
            using var halo = new SolidBrush(Color.FromArgb(alpha, DA.Braise));
            using var coeur = new SolidBrush(DA.BraiseClaire);
            g.FillEllipse(halo, icone.X + icone.Width / 2 - this.S(7), icone.Y + icone.Height / 2 - this.S(7), this.S(14), this.S(14));
            g.FillEllipse(coeur, icone.X + icone.Width / 2 - this.S(3), icone.Y + icone.Height / 2 - this.S(3), this.S(6), this.S(6));
        }
        else if (o.Icone != null) g.DrawImage(o.Icone, icone);
        else if (Uri.TryCreate(o.Url, UriKind.Absolute, out var u) && u.Scheme.StartsWith("http") && !u.Host.EndsWith(".onirique"))
        {
            // Un onglet endormi n'a pas encore d'icône : l'initiale du site (mail.google.com → G) la remplace.
            var parties = u.Host.Split('.');
            string nom = parties.Length >= 2 ? parties[^2] : u.Host;
            using var gras = new Font(Font.FontFamily, icone.Height * 0.72f, FontStyle.Bold, GraphicsUnit.Pixel);
            TextRenderer.DrawText(g, nom.Length > 0 ? nom[..1].ToUpperInvariant() : "·", gras, icone, DA.Etiquette, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
        }
        else TextRenderer.DrawText(g, "", Icones, icone, DA.Cendre, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
    }

    void DessinerEpingle(Graphics g, Rectangle r, Onglet o)
    {
        bool actif = nav.EstAffiche(o);
        using (var ch = DA.Arrondi(r, this.S(10)))
        {
            using var fond = new SolidBrush(actif || survol == o ? DA.Filet : DA.Survol);
            g.FillPath(fond, ch);
            if (actif) { using var braise = new Pen(DA.Braise, this.S(1)); g.DrawPath(braise, ch); }
        }
        int t = this.S(18);
        Icone(g, new Rectangle(r.X + (r.Width - t) / 2, r.Y + (r.Height - t) / 2, t, t), o);
        if (o.Son) { using var b = new SolidBrush(DA.Braise); g.FillEllipse(b, r.Right - this.S(10), r.Y + this.S(5), this.S(5), this.S(5)); }
        if (o.Decharge && !actif) { using var voile = new SolidBrush(Color.FromArgb(110, DA.Fond)); using var ch = DA.Arrondi(r, this.S(10)); g.FillPath(voile, ch); }
    }

    void DessinerGroupe(Graphics g, Rectangle r, Groupe gr, TextFormatFlags gauche)
    {
        if (survol == gr) using (var ch = DA.Arrondi(r, this.S(8))) using (var f = new SolidBrush(DA.Survol)) g.FillPath(f, ch);
        int d = this.S(8);
        using (var pastille = new SolidBrush(gr.Couleur)) g.FillEllipse(pastille, r.X + this.S(10), r.Y + (r.Height - d) / 2, d, d);
        int n = nav.Onglets.Count(o => o.Groupe == gr && !o.Epingle);
        string nom = gr.Nom.Length > 0 ? gr.Nom : "Groupe";
        using var gras = new Font(Font, FontStyle.Bold);
        TextRenderer.DrawText(g, gr.Replie ? $"{nom}  ·  {n}" : nom, gras, new Rectangle(r.X + this.S(26), r.Y, r.Width - this.S(56), r.Height), DA.Etiquette, gauche);
        TextRenderer.DrawText(g, gr.Replie ? "" : "", Icones, new Rectangle(r.Right - this.S(28), r.Y, this.S(20), r.Height), DA.Cendre,
            TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
    }

    void DessinerOnglet(Graphics g, Rectangle r, Onglet o, TextFormatFlags gauche, TextFormatFlags centre)
    {
        bool actif = o == nav.Actif, moitie = !actif && nav.EstAffiche(o);
        if (o.Groupe != null)
        {
            // Le fil de couleur du groupe court le long de ses onglets.
            using var fil = new SolidBrush(Color.FromArgb(150, o.Groupe.Couleur));
            g.FillRectangle(fil, r.X - this.S(6), r.Y - this.S(1), this.S(2), r.Height + this.S(2));
        }
        if (actif || moitie || survol == o)
        {
            using var ch = DA.Arrondi(r, this.S(8));
            using var fond = new SolidBrush(actif || moitie ? DA.Filet : DA.Survol);
            g.FillPath(fond, ch);
        }
        if (actif)
        {
            using var braise = new SolidBrush(DA.Braise);
            g.FillRectangle(braise, r.X, r.Y + this.S(9), this.S(3), r.Height - this.S(18));
        }
        Icone(g, new Rectangle(r.X + this.S(12), r.Y + (r.Height - this.S(16)) / 2, this.S(16), this.S(16)), o);
        int droite = r.Right - this.S(CroixVisible(o) ? 32 : 10);
        if (o.Son)
        {
            droite -= this.S(18);
            TextRenderer.DrawText(g, "", Icones, new Rectangle(droite, r.Y, this.S(18), r.Height), DA.BraiseClaire, centre);
        }
        var couleur = actif ? DA.Brume : moitie ? DA.Etiquette : o.Decharge ? DA.Eteint : DA.Cendre;
        TextRenderer.DrawText(g, o.Titre, Font, new Rectangle(r.X + this.S(38), r.Y, Math.Max(0, droite - r.X - this.S(40)), r.Height), couleur, gauche);
        if (CroixVisible(o))
        {
            var cr = Croix(r);
            if (survol == o && surCroix) using (var f = new SolidBrush(DA.Survol)) g.FillEllipse(f, cr);
            TextRenderer.DrawText(g, "", Icones, cr, actif || surCroix ? DA.Brume : DA.Cendre, centre);
        }
    }

    protected override void OnMouseMove(MouseEventArgs e)
    {
        base.OnMouseMove(e);
        Disposer();
        object? quoi = CommandeSous(e.Location) is var k and >= 0 ? k : Sous(e.Location);
        bool croix = quoi is Onglet o && CroixVisible(o) && Croix(zones.First(z => z.Quoi == o).R).Contains(e.Location);
        if (Equals(quoi, survol) && croix == surCroix) return;
        survol = quoi;
        surCroix = croix;
        infobulle.SetToolTip(this, quoi is Onglet { Epingle: true } ep ? ep.Titre : null);
        Cursor = quoi == null ? Cursors.Default : Cursors.Hand;
        Invalidate();
    }

    protected override void OnMouseLeave(EventArgs e)
    {
        base.OnMouseLeave(e);
        survol = null;
        surCroix = false;
        Invalidate();
    }

    protected override void OnMouseDown(MouseEventArgs e)
    {
        base.OnMouseDown(e);
        Disposer();
        commande = CommandeSous(e.Location);
        if (commande >= 0) return;
        var quoi = Sous(e.Location);
        var ecran = PointToScreen(e.Location);
        switch (quoi)
        {
            case Onglet o when e.Button == MouseButtons.Right: nav.MenuOnglet(o, ecran); break;
            case Groupe gr when e.Button == MouseButtons.Right: nav.MenuGroupe(gr, ecran); break;
            case Onglet o when e.Button == MouseButtons.Middle: nav.Fermer(o); break;
            case Onglet o when e.Button == MouseButtons.Left:
                if (CroixVisible(o) && Croix(zones.First(z => z.Quoi == o).R).Contains(e.Location)) nav.Fermer(o);
                else nav.Activer(o);
                break;
            case Groupe gr when e.Button == MouseButtons.Left: nav.BasculerGroupe(gr); break;
            case "plus" when e.Button == MouseButtons.Left: nav.NouvelOnglet(); break;
        }
        Invalidate();
    }

    protected override void OnMouseUp(MouseEventArgs e)
    {
        base.OnMouseUp(e);
        int k = commande;
        commande = -1;
        if (e.Button != MouseButtons.Left || k < 0 || CommandeSous(e.Location) != k) return;
        switch (k)
        {
            case 0: nav.WindowState = FormWindowState.Minimized; break;
            case 1: nav.WindowState = nav.WindowState == FormWindowState.Maximized ? FormWindowState.Normal : FormWindowState.Maximized; break;
            case 2: nav.Close(); break;
        }
        survol = null;
        Invalidate();
    }

    protected override void OnMouseWheel(MouseEventArgs e)
    {
        base.OnMouseWheel(e);
        defile = Math.Clamp(defile - e.Delta * this.S(34) / 120 * 2, 0, defileMax);
        Invalidate();
    }

    // Le haut vide de la colonne laisse passer la souris vers la fenêtre, qui s'en sert pour se déplacer et s'agrandir.
    protected override void WndProc(ref Message m)
    {
        base.WndProc(ref m);
        if (m.Msg != 0x0084) return; // WM_NCHITTEST
        long lp = m.LParam.ToInt64();
        var p = PointToClient(new Point((short)(lp & 0xFFFF), (short)((lp >> 16) & 0xFFFF)));
        if (p.Y < Padding.Top && CommandeSous(p) < 0) m.Result = (IntPtr)(-1); // HTTRANSPARENT
    }
}
