using System.Drawing.Drawing2D;
using System.Text.Json.Nodes;

namespace Onirique;

/// <summary>
/// La barre de favoris, sous la barre d'adresse : les raccourcis de l'accueil (sites et dossiers), dans le même ordre.
/// Un dossier ouvre la liste de ses sites ; ce qui ne tient pas passe dans le menu « » » au bout de la barre.
/// </summary>
sealed class BarreFavoris : Control
{
    readonly Navigateur nav;
    readonly List<(JsonObject Element, Rectangle Zone)> places = new();
    Rectangle suite;
    List<JsonObject> debordes = new();
    int survol = -1;
    string? lu;
    List<JsonObject> elements = new();
    static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(8) };
    static readonly Dictionary<string, Image?> Icones = new();
    public Font Glyphes = SystemFonts.DefaultFont;

    public BarreFavoris(Navigateur nav)
    {
        this.nav = nav;
        DoubleBuffered = true;
        ResizeRedraw = true;
        BackColor = DA.Fond;
        AccessibleName = "Barre de favoris";
        Http.DefaultRequestHeaders.UserAgent.ParseAdd("Mozilla/5.0 ONIRIQUE-Navigateur");
    }

    void Relire()
    {
        var liste = nav.Raccourcis();
        var texte = liste.ToJsonString();
        if (texte == lu) return;
        lu = texte;
        elements = liste.OfType<JsonObject>().ToList();
    }

    static bool EstDossier(JsonObject x) => (string?)x["type"] == "dossier";
    static string Nom(JsonObject x) => (string?)x["nom"] ?? "";
    static string Url(JsonObject x) => (string?)x["url"] ?? "";

    /// <summary>L'icône du site (son favicon), chargée une fois en arrière-plan ; en attendant, un globe.</summary>
    Image? Icone(string url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var u)) return null;
        var hote = u.Host;
        lock (Icones) { if (Icones.TryGetValue(hote, out var i)) return i; Icones[hote] = null; }
        _ = Task.Run(async () =>
        {
            Image? image = null;
            try
            {
                var octets = await Http.GetByteArrayAsync($"{u.Scheme}://{hote}/favicon.ico");
                using var flux = new MemoryStream(octets);
                try { using var ico = new Icon(flux, 16, 16); image = ico.ToBitmap(); }
                catch { flux.Position = 0; using var img = Image.FromStream(flux); image = new Bitmap(img, 16, 16); }
            }
            catch { }
            if (image == null) return;
            lock (Icones) Icones[hote] = image;
            if (IsHandleCreated) BeginInvoke(Invalidate);
        });
        return null;
    }

    Size Mesure(JsonObject x) => new(Math.Min(TextRenderer.MeasureText(Nom(x), Font).Width, this.S(150)) + this.S(48), Height - this.S(8));

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        using (var filet = new Pen(DA.Filet)) g.DrawLine(filet, 0, Height - 1, Width, Height - 1);
        Relire();
        places.Clear();
        debordes = new();
        int x = this.S(10), limite = Width - this.S(40);
        foreach (var el in elements)
        {
            var t = Mesure(el);
            if (x + t.Width > limite) { debordes.Add(el); continue; }
            places.Add((el, new Rectangle(x, this.S(4), t.Width, t.Height)));
            x += t.Width + this.S(2);
        }
        suite = debordes.Count > 0 ? new Rectangle(Width - this.S(36), this.S(4), this.S(28), Height - this.S(8)) : Rectangle.Empty;

        var flags = TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis | TextFormatFlags.SingleLine | TextFormatFlags.NoPrefix;
        for (int i = 0; i < places.Count; i++)
        {
            var (el, r) = places[i];
            if (i == survol)
            {
                using var chemin = DA.Arrondi(r, this.S(7));
                using var fond = new SolidBrush(DA.Survol);
                g.FillPath(fond, chemin);
            }
            var icone = new Rectangle(r.X + this.S(9), r.Y + (r.Height - this.S(16)) / 2, this.S(16), this.S(16));
            if (EstDossier(el)) TextRenderer.DrawText(g, "", Glyphes, icone, DA.BraiseClaire, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
            else if (Icone(Url(el)) is { } img) g.DrawImage(img, icone);
            else TextRenderer.DrawText(g, "", Glyphes, icone, DA.Cendre, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
            TextRenderer.DrawText(g, Nom(el), Font, new Rectangle(icone.Right + this.S(7), r.Y, r.Right - icone.Right - this.S(14), r.Height), DA.Etiquette, flags);
        }
        if (!suite.IsEmpty)
        {
            if (survol == -2)
            {
                using var chemin = DA.Arrondi(suite, this.S(7));
                using var fond = new SolidBrush(DA.Survol);
                g.FillPath(fond, chemin);
            }
            TextRenderer.DrawText(g, "»", Font, suite, DA.Brume, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter);
        }
        if (elements.Count == 0)
            TextRenderer.DrawText(g, "Clique sur l'étoile de la barre d'adresse pour ajouter une page ici.", Font, new Rectangle(this.S(14), 0, Width, Height), DA.Eteint, flags);
    }

    int Index(Point p) => places.FindIndex(x => x.Zone.Contains(p));

    protected override void OnMouseMove(MouseEventArgs e)
    {
        base.OnMouseMove(e);
        int i = Index(e.Location);
        if (i < 0 && suite.Contains(e.Location)) i = -2;
        if (i == survol) return;
        survol = i;
        Cursor = i == -1 ? Cursors.Default : Cursors.Hand;
        if (i >= 0) new ToolTip().SetToolTip(this, EstDossier(places[i].Element) ? Nom(places[i].Element) : Url(places[i].Element));
        Invalidate();
    }

    protected override void OnMouseLeave(EventArgs e) { survol = -1; Invalidate(); base.OnMouseLeave(e); }

    protected override void OnMouseUp(MouseEventArgs e)
    {
        base.OnMouseUp(e);
        int i = Index(e.Location);
        var dessous = PointToScreen(new Point(i >= 0 ? places[i].Zone.X : suite.X, Height));
        if (i < 0)
        {
            if (!suite.IsEmpty && suite.Contains(e.Location) && e.Button == MouseButtons.Left) nav.MenuFavoris(debordes, dessous);
            return;
        }
        var el = places[i].Element;
        if (e.Button == MouseButtons.Right) { nav.MenuFavori(el, PointToScreen(e.Location)); return; }
        if (EstDossier(el)) { nav.MenuFavoris((el["elements"] as JsonArray ?? new JsonArray()).OfType<JsonObject>().ToList(), dessous); return; }
        nav.OuvrirFavori(Url(el), nouvelOnglet: e.Button == MouseButtons.Middle || ModifierKeys.HasFlag(Keys.Control));
    }
}

sealed partial class Navigateur
{
    internal void OuvrirFavori(string url, bool nouvelOnglet)
    {
        if (nouvelOnglet || Actif?.Vue?.CoreWebView2 is not { } c) { _ = Ouvrir(url, Actif == null ? -1 : Onglets.IndexOf(Actif) + 1); return; }
        c.Navigate(url);
        Actif.Vue.Focus();
    }

    /// <summary>La liste d'un dossier (ou de ce qui déborde de la barre) ; un dossier y ouvre sa propre liste.</summary>
    internal void MenuFavoris(List<JsonObject> liste, Point ecran)
    {
        var m = NouveauMenu();
        void Remplir(ToolStripItemCollection items, IEnumerable<JsonObject> elements)
        {
            foreach (var el in elements)
            {
                var nom = (string?)el["nom"] ?? "";
                if ((string?)el["type"] == "dossier")
                {
                    var sous = new ToolStripMenuItem(nom);
                    Remplir(sous.DropDownItems, (el["elements"] as JsonArray ?? new JsonArray()).OfType<JsonObject>());
                    items.Add(sous);
                }
                else
                {
                    var url = (string?)el["url"] ?? "";
                    var item = Element(nom.Length > 0 ? nom : url, () => OuvrirFavori(url, ModifierKeys.HasFlag(Keys.Control)));
                    item.ToolTipText = url;
                    items.Add(item);
                }
            }
        }
        Remplir(m.Items, liste);
        m.Show(ecran);
    }

    internal void MenuFavori(JsonObject el, Point ecran)
    {
        var m = NouveauMenu();
        var url = (string?)el["url"] ?? "";
        if ((string?)el["type"] == "dossier")
            m.Items.Add(Element("Tout ouvrir dans de nouveaux onglets", () =>
            {
                foreach (var s in (el["elements"] as JsonArray ?? new JsonArray()).OfType<JsonObject>()) _ = Ouvrir((string?)s["url"] ?? Accueil);
            }));
        else
        {
            m.Items.Add(Element("Ouvrir dans un nouvel onglet", () => OuvrirFavori(url, true)));
            m.Items.Add(Element("Retirer des favoris", () => BasculerFavori(url, "")));
        }
        m.Items.Add(new ToolStripSeparator());
        m.Items.Add(Element("Modifier sur l'accueil", () => OuvrirInterne(Accueil)));
        m.Show(ecran);
    }
}
