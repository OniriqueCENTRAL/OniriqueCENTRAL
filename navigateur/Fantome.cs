using System.Diagnostics;
using Microsoft.Web.WebView2.Core;

namespace Onirique;

/// <summary>
/// L'aperçu qui suit la souris quand on tire un onglet hors de la barre : la page en petit et ce qui se passera au
/// lâcher (nouvelle fenêtre, ou l'autre fenêtre ONIRIQUE sous la souris). Il laisse passer les clics.
/// </summary>
sealed class Fantome : Form
{
    public Onglet? Onglet;
    public Image? Apercu;
    public string Titre = "", Consigne = "";
    readonly System.Windows.Forms.Timer fondu = new() { Interval = 15 };

    public Fantome()
    {
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        StartPosition = FormStartPosition.Manual;
        TopMost = true;
        BackColor = DA.Fond;
        DoubleBuffered = true;
        Opacity = 0;
        fondu.Tick += (_, _) => { Opacity = Math.Min(0.94, Opacity + 0.12); if (Opacity >= 0.94) fondu.Stop(); };
    }

    protected override bool ShowWithoutActivation => true;
    protected override CreateParams CreateParams
    {
        get
        {
            var cp = base.CreateParams;
            cp.ExStyle |= 0x08000000 | 0x80 | 0x20 | 0x80000; // pas d'activation, hors barre des tâches, transparent aux clics, superposé
            return cp;
        }
    }

    public void Placer(Point souris)
    {
        Size = new Size(this.S(300), this.S(28 + 168 + 30));
        Location = new Point(souris.X + this.S(14), souris.Y + this.S(14));
        if (!Visible) { Opacity = 0; Show(); fondu.Start(); }
        Invalidate();
    }

    public void Cacher() { fondu.Stop(); Hide(); Opacity = 0; }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
        int haut = this.S(28), bas = this.S(30);
        var flags = TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis | TextFormatFlags.SingleLine | TextFormatFlags.NoPrefix;
        using (var b = new SolidBrush(DA.Nuit)) g.FillRectangle(b, 0, haut, Width, Height - haut - bas);
        TextRenderer.DrawText(g, Titre, Font, new Rectangle(this.S(10), 0, Width - this.S(20), haut), DA.Brume, flags);
        if (Apercu != null)
        {
            var zone = new Rectangle(0, haut, Width, Height - haut - bas);
            float k = Math.Max((float)zone.Width / Apercu.Width, (float)zone.Height / Apercu.Height);
            var src = new RectangleF(0, 0, zone.Width / k, zone.Height / k);
            g.DrawImage(Apercu, zone, src, GraphicsUnit.Pixel);
        }
        TextRenderer.DrawText(g, Consigne, Font, new Rectangle(this.S(10), Height - bas, Width - this.S(20), bas), DA.BraiseClaire, flags);
        using var p = new Pen(DA.Braise, this.S(2));
        g.DrawRectangle(p, this.S(1), this.S(1), Width - this.S(2), Height - this.S(2));
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) { fondu.Dispose(); Apercu?.Dispose(); }
        base.Dispose(disposing);
    }
}

sealed partial class Navigateur
{
    Fantome? fantome;

    /// <summary>L'autre fenêtre ONIRIQUE sous ce point de l'écran (son processus), ou 0.</summary>
    static int FenetreOniriqueSous(Point ecran)
    {
        GetWindowThreadProcessId(GetAncestor(WindowFromPoint(ecran), 2 /* GA_ROOT */), out int pid);
        if (pid == 0 || pid == Environment.ProcessId) return 0;
        try
        {
            using var p = Process.GetProcessById(pid);
            return p.ProcessName == Process.GetCurrentProcess().ProcessName ? pid : 0;
        }
        catch { return 0; }
    }

    /// <summary>Montre (ou cache, sans point) l'aperçu de l'onglet tiré hors de la barre.</summary>
    internal async void MontrerFantome(Onglet o, Point? ecran)
    {
        if (ecran is not { } p) { fantome?.Cacher(); return; }
        fantome ??= new Fantome { Font = Font };
        fantome.Consigne = Prive ? "Pas de fenêtre détachée en navigation privée"
            : FenetreOniriqueSous(p) != 0 ? "Lâcher pour l'ajouter à cette fenêtre"
            : Onglets.Count < 2 ? "Seul onglet de la fenêtre"
            : "Lâcher pour l'ouvrir dans une nouvelle fenêtre";
        fantome.Placer(p);
        if (fantome.Onglet == o) return;
        fantome.Onglet = o;
        fantome.Titre = o.Titre.Length > 0 ? o.Titre : o.Url;
        fantome.Apercu?.Dispose();
        fantome.Apercu = null;
        if (o.Vue?.CoreWebView2 is not { } c) return;
        try
        {
            using var flux = new MemoryStream();
            await c.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Jpeg, flux);
            flux.Position = 0;
            using var image = Image.FromStream(flux);
            if (fantome?.Onglet != o) return;
            fantome.Apercu = new Bitmap(image, new Size(this.S(300), Math.Max(1, this.S(300) * image.Height / Math.Max(1, image.Width))));
            fantome.Invalidate();
        }
        catch { }
    }
}
