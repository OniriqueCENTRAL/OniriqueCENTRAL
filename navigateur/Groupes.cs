using System.Drawing.Drawing2D;
using Microsoft.Web.WebView2.Core;

namespace Onirique;

sealed class Groupe
{
    public string Nom = "";
    public Color Couleur;
    public bool Replie;
    public float X = -1, W;  // position affichée de sa pastille (animée)
}

// Groupes d'onglets (une pastille de couleur devant ses onglets, repliable) et écran divisé (deux onglets côte à côte),
// comme sur Opera et Brave.
sealed partial class Navigateur
{
    internal bool EstAffiche(Onglet o) => o == Actif || o == Actif?.Partenaire;
    IEnumerable<Groupe> Groupes => Onglets.Select(o => o.Groupe).OfType<Groupe>().Distinct();

    // ——— Groupes ———

    Color CouleurLibre()
    {
        var couleurs = DA.Accents.Select(a => ColorTranslator.FromHtml(a.Hex)).ToList();
        return couleurs.FirstOrDefault(c => !Groupes.Any(g => g.Couleur.ToArgb() == c.ToArgb()), couleurs[0]);
    }

    /// <summary>Un onglet qui entre dans un groupe vient se ranger après ses derniers onglets : un groupe reste d'un seul tenant.</summary>
    void Ranger(Onglet o, Groupe? gr)
    {
        if (o.Groupe == gr) return;
        int i = Onglets.IndexOf(o);
        Onglets.RemoveAt(i);
        // Sorti d'un groupe, il se place juste après celui-ci ; un groupe tout neuf le laisse où il est.
        int apres = Onglets.FindLastIndex(x => x.Groupe == (gr ?? o.Groupe));
        Onglets.Insert(apres >= 0 ? apres + 1 : i, o);
        o.Groupe = gr;
    }

    void MettreDansGroupe(Onglet o, Groupe? gr)
    {
        var p = o.Partenaire;
        Ranger(o, gr);
        // Les deux moitiés d'un écran divisé vont ensemble.
        if (p != null && p.Groupe != gr) { Onglets.Remove(p); Onglets.Insert(Onglets.IndexOf(o) + 1, p); p.Groupe = gr; }
        Animer();
    }

    void NouveauGroupe(Onglet o)
    {
        var gr = new Groupe { Couleur = CouleurLibre() };
        if (o.Groupe != null) Ranger(o, null);
        MettreDansGroupe(o, gr);
        Renommer(gr);
    }

    internal void BasculerGroupe(Groupe gr)
    {
        if (!gr.Replie && Actif?.Groupe == gr)
        {
            // L'onglet qu'on regarde ne disparaît pas dans un groupe replié : on passe au plus proche hors du groupe.
            int i = Onglets.IndexOf(Actif);
            var autre = Onglets.Skip(i).FirstOrDefault(x => x.Groupe != gr) ?? Onglets.Take(i).LastOrDefault(x => x.Groupe != gr);
            gr.Replie = true;
            if (autre != null) Activer(autre); else NouvelOnglet();
        }
        else gr.Replie = !gr.Replie;
        Animer();
    }

    async void Renommer(Groupe gr)
    {
        await Task.Delay(Reglages.Animations ? 280 : 0);
        var r = bandeau.Pastille(gr);
        var t = new TextBox
        {
            Text = gr.Nom, BorderStyle = BorderStyle.FixedSingle, BackColor = DA.Fond, ForeColor = DA.Brume,
            Font = bandeau.Font, MaxLength = 40, AccessibleName = "Nom du groupe", PlaceholderText = "Nom du groupe",
        };
        t.SetBounds(r.X, r.Y, Math.Max(r.Width, this.S(160)), r.Height);
        bool fini = false;
        void Finir(bool garder)
        {
            if (fini) return;
            fini = true;
            if (garder) gr.Nom = t.Text.Trim();
            bandeau.Controls.Remove(t);
            BeginInvoke(t.Dispose);
            Animer();
        }
        t.KeyDown += (_, e) =>
        {
            if (e.KeyCode == Keys.Enter) { e.SuppressKeyPress = true; Finir(true); }
            else if (e.KeyCode == Keys.Escape) { e.SuppressKeyPress = true; Finir(false); }
        };
        t.LostFocus += (_, _) => Finir(true);
        bandeau.Controls.Add(t);
        t.Focus();
        t.SelectAll();
    }

    // ——— Écran divisé ———

    async void Diviser(Onglet o, Onglet autre)
    {
        if (o.Partenaire != null) QuitterDivision(o);
        if (autre.Partenaire != null) QuitterDivision(autre);
        o.Partenaire = autre;
        autre.Partenaire = o;
        Onglets.Remove(autre);
        Onglets.Insert(Onglets.IndexOf(o) + 1, autre);
        autre.Groupe = o.Groupe;
        if (Actif == o || Actif == autre)
        {
            await Montrer(Actif.Partenaire!);
            PlacerVues();
        }
        else Activer(o);
        Animer();
    }

    async void DiviserAvecNouvelOnglet(Onglet o)
    {
        var n = await Ouvrir(Accueil, Onglets.IndexOf(o) + 1);
        Diviser(o, n);
    }

    void QuitterDivision(Onglet o)
    {
        if (o.Partenaire is not { } p) return;
        o.Partenaire = null;
        p.Partenaire = null;
        if (Actif == o) Cacher(p);
        else if (Actif == p) Cacher(o);
        PlacerVues();
        Animer();
    }

    /// <summary>Un onglet seul occupe toute la place ; deux onglets divisés se la partagent, chacun dans son cadre.</summary>
    void PlacerVues()
    {
        var a = Actif;
        if (a == null) return;
        var r = contenu.ClientRectangle;
        if (a.Partenaire is not { } p) { a.Vue?.SetBounds(0, 0, r.Width, r.Height); contenu.Invalidate(); return; }
        var (gauche, droite) = Onglets.IndexOf(a) < Onglets.IndexOf(p) ? (a, p) : (p, a);
        int m = this.S(6), demi = (r.Width - 3 * m) / 2;
        gauche.Vue?.SetBounds(m, m, demi, r.Height - 2 * m);
        droite.Vue?.SetBounds(2 * m + demi, m, r.Width - 3 * m - demi, r.Height - 2 * m);
        contenu.Invalidate();
    }

    void DessinerDivision(PaintEventArgs e)
    {
        if (Actif?.Partenaire is not { } p) return;
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        foreach (var x in new[] { Actif, p })
        {
            if (x.Vue is not { Visible: true } v) continue;
            using var chemin = DA.Arrondi(Rectangle.Inflate(v.Bounds, this.S(2), this.S(2)), this.S(8));
            using var trait = new Pen(x == Actif ? DA.Braise : DA.Filet, this.S(2));
            e.Graphics.DrawPath(trait, chemin);
        }
    }

    // ——— Menus du clic droit ———

    ContextMenuStrip NouveauMenu()
    {
        var m = new ContextMenuStrip { Renderer = new RenduMenu(), Font = Font, ShowImageMargin = true };
        m.Closed += (_, _) => BeginInvoke(m.Dispose);
        return m;
    }

    static ToolStripMenuItem Element(string texte, Action faire, bool actif = true, Image? image = null)
    {
        var i = new ToolStripMenuItem(texte) { Enabled = actif, Image = image };
        i.Click += (_, _) => faire();
        return i;
    }

    Bitmap Pastille(Color c)
    {
        int t = this.S(14);
        var b = new Bitmap(t, t);
        using var g = Graphics.FromImage(b);
        g.SmoothingMode = SmoothingMode.AntiAlias;
        using var pinceau = new SolidBrush(c);
        g.FillEllipse(pinceau, 1, 1, t - 2, t - 2);
        return b;
    }

    static string NomDe(Groupe gr) => gr.Nom.Length > 0 ? gr.Nom : "Groupe sans nom";

    internal void MenuOnglet(Onglet o, Point ecran)
    {
        var m = NouveauMenu();
        int i = Onglets.IndexOf(o);
        m.Items.Add(Element("Nouvel onglet à droite", async () => { var n = await Ouvrir(Accueil, i + 1); if (o.Groupe != null) { n.Groupe = o.Groupe; Animer(); } }));
        m.Items.Add(new ToolStripSeparator());
        m.Items.Add(Element("Ajouter à un nouveau groupe", () => NouveauGroupe(o)));
        var autres = Groupes.Where(g => g != o.Groupe).ToList();
        if (autres.Count > 0)
        {
            var sous = new ToolStripMenuItem("Ajouter au groupe");
            foreach (var g in autres) sous.DropDownItems.Add(Element(NomDe(g), () => MettreDansGroupe(o, g), image: Pastille(g.Couleur)));
            m.Items.Add(sous);
        }
        if (o.Groupe != null) m.Items.Add(Element("Retirer du groupe", () => { Ranger(o, null); Animer(); }));
        m.Items.Add(new ToolStripSeparator());
        if (o.Partenaire != null) m.Items.Add(Element("Quitter l'écran divisé", () => QuitterDivision(o)));
        else
        {
            m.Items.Add(Element("Diviser l'écran avec un nouvel onglet", () => DiviserAvecNouvelOnglet(o)));
            var voisin = i + 1 < Onglets.Count ? Onglets[i + 1] : null;
            m.Items.Add(Element("Diviser l'écran avec l'onglet de droite", () => Diviser(o, voisin!), voisin != null && voisin.Partenaire == null));
        }
        m.Items.Add(new ToolStripSeparator());
        m.Items.Add(Element("Fermer l'onglet", () => Fermer(o)));
        m.Items.Add(Element("Fermer les autres onglets", () => { foreach (var x in Onglets.Where(x => x != o).ToList()) Fermer(x); }, Onglets.Count > 1));
        m.Show(ecran);
    }

    internal void MenuGroupe(Groupe gr, Point ecran)
    {
        var m = NouveauMenu();
        m.Items.Add(Element("Renommer le groupe", () => Renommer(gr)));
        var couleurs = new ToolStripMenuItem("Couleur");
        foreach (var (hex, nom) in DA.Accents)
        {
            var c = ColorTranslator.FromHtml(hex);
            var el = Element(nom, () => { gr.Couleur = c; bandeau.Invalidate(); }, image: Pastille(c));
            el.Checked = c.ToArgb() == gr.Couleur.ToArgb();
            couleurs.DropDownItems.Add(el);
        }
        m.Items.Add(couleurs);
        m.Items.Add(Element(gr.Replie ? "Déplier" : "Replier", () => BasculerGroupe(gr)));
        m.Items.Add(Element("Nouvel onglet dans le groupe", async () =>
        {
            gr.Replie = false;
            var n = await Ouvrir(Accueil, Onglets.FindLastIndex(x => x.Groupe == gr) + 1);
            n.Groupe = gr;
            Animer();
        }));
        m.Items.Add(new ToolStripSeparator());
        m.Items.Add(Element("Dégrouper", () => { foreach (var x in Onglets.Where(x => x.Groupe == gr)) x.Groupe = null; Animer(); }));
        m.Items.Add(Element("Fermer le groupe", () => { foreach (var x in Onglets.Where(x => x.Groupe == gr).ToList()) Fermer(x); }));
        m.Show(ecran);
    }

    // ——— Session : les groupes et les écrans divisés reviennent avec les onglets ———

    void SauverGroupes(List<Onglet> web)
    {
        var groupes = web.Select(o => o.Groupe).OfType<Groupe>().Distinct().ToList();
        Reglages.Groupes = groupes.Select(g => new GroupeSauve { Nom = g.Nom, Couleur = ColorTranslator.ToHtml(g.Couleur), Replie = g.Replie }).ToList();
        Reglages.Session = web.Select((o, i) => new OngletSauve
        {
            Url = o.Url,
            Titre = o.Titre,
            Groupe = o.Groupe == null ? -1 : groupes.IndexOf(o.Groupe),
            Divise = o.Partenaire != null && i + 1 < web.Count && web[i + 1] == o.Partenaire,
        }).ToList();
    }

    void RestaurerGroupes()
    {
        var groupes = Reglages.Groupes.Select(g =>
        {
            Color c;
            try { c = ColorTranslator.FromHtml(g.Couleur); } catch { c = CouleurLibre(); }
            return new Groupe { Nom = g.Nom, Couleur = c, Replie = g.Replie };
        }).ToList();
        for (int i = 0; i < Reglages.Session.Count && i < Onglets.Count; i++)
        {
            var s = Reglages.Session[i];
            if (s.Groupe >= 0 && s.Groupe < groupes.Count) Onglets[i].Groupe = groupes[s.Groupe];
            if (s.Divise && i + 1 < Onglets.Count && Onglets[i].Partenaire == null)
            {
                Onglets[i].Partenaire = Onglets[i + 1];
                Onglets[i + 1].Partenaire = Onglets[i];
            }
        }
    }
}

/// <summary>Les menus du clic droit aux couleurs de la nuit.</summary>
sealed class RenduMenu : ToolStripProfessionalRenderer
{
    public RenduMenu() : base(new Couleurs()) { RoundedEdges = false; }

    protected override void OnRenderItemText(ToolStripItemTextRenderEventArgs e)
    {
        e.TextColor = e.Item.Enabled ? DA.Brume : DA.Eteint;
        base.OnRenderItemText(e);
    }

    protected override void OnRenderArrow(ToolStripArrowRenderEventArgs e)
    {
        e.ArrowColor = DA.Cendre;
        base.OnRenderArrow(e);
    }

    protected override void OnRenderItemCheck(ToolStripItemImageRenderEventArgs e)
    {
        // La couleur choisie : un anneau autour de sa pastille.
        using var trait = new Pen(DA.Brume, 1.5f);
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        e.Graphics.DrawEllipse(trait, Rectangle.Inflate(e.ImageRectangle, 2, 2));
        if (e.Image != null) e.Graphics.DrawImage(e.Image, e.ImageRectangle);
    }

    sealed class Couleurs : ProfessionalColorTable
    {
        public override Color ToolStripDropDownBackground => DA.Fond;
        public override Color ImageMarginGradientBegin => DA.Fond;
        public override Color ImageMarginGradientMiddle => DA.Fond;
        public override Color ImageMarginGradientEnd => DA.Fond;
        public override Color MenuBorder => DA.Filet;
        public override Color MenuItemBorder => DA.Survol;
        public override Color MenuItemSelected => DA.Survol;
        public override Color MenuItemSelectedGradientBegin => DA.Survol;
        public override Color MenuItemSelectedGradientEnd => DA.Survol;
        public override Color MenuItemPressedGradientBegin => DA.Survol;
        public override Color MenuItemPressedGradientEnd => DA.Survol;
        public override Color SeparatorDark => DA.Filet;
        public override Color SeparatorLight => DA.Fond;
        public override Color CheckBackground => DA.Fond;
        public override Color CheckSelectedBackground => DA.Survol;
        public override Color CheckPressedBackground => DA.Survol;
    }
}
