using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Onirique;

// Les fenêtres qu'une page ouvre avec une taille (connexion Google, paiement, partage…) restent de petites fenêtres,
// comme dans Chrome. Ouvertes en onglet, elles cachaient la page d'origine, qui se mettait en veille et attendait
// pour rien la fin de la connexion : le navigateur paraissait figé.
sealed partial class Navigateur
{
    /// <summary>Vrai si la demande est une fenêtre surgissante, ouverte ici dans sa propre fenêtre.</summary>
    async Task<bool> OuvrirSurgissante(Onglet o, CoreWebView2NewWindowRequestedEventArgs e)
    {
        var f = e.WindowFeatures;
        if (!f.HasSize) return false;
        var fenetre = new Form
        {
            Text = "ONIRIQUE", Icon = Icon, BackColor = DA.Nuit, ShowInTaskbar = false, Owner = this,
            StartPosition = FormStartPosition.Manual, MinimumSize = new Size(this.S(260), this.S(200)),
        };
        DA.BarreSombre(fenetre.Handle);
        var zone = Screen.FromControl(this).WorkingArea;
        var taille = new Size(Math.Min(fenetre.S((int)Math.Max(f.Width, 300)), zone.Width), Math.Min(fenetre.S((int)Math.Max(f.Height, 200)), zone.Height));
        fenetre.ClientSize = taille;
        // Au milieu du navigateur, sans sortir de l'écran.
        var x = Math.Clamp(Left + (Width - fenetre.Width) / 2, zone.Left, Math.Max(zone.Left, zone.Right - fenetre.Width));
        var y = Math.Clamp(Top + (Height - fenetre.Height) / 2, zone.Top, Math.Max(zone.Top, zone.Bottom - fenetre.Height));
        fenetre.Location = new Point(x, y);
        var v = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = DA.Nuit };
        fenetre.Controls.Add(v);
        fenetre.Show();
        try
        {
            var moteur = await MoteurDe(o);
            if (Prive)
            {
                var options = moteur.CreateCoreWebView2ControllerOptions();
                options.IsInPrivateModeEnabled = true;
                await v.EnsureCoreWebView2Async(moteur, options);
            }
            else await v.EnsureCoreWebView2Async(moteur);
        }
        catch (Exception x2) { Program.Noter(x2); fenetre.Close(); return false; }
        var c = v.CoreWebView2;
        AppliquerProfil(c);
        c.DocumentTitleChanged += (_, _) => fenetre.Text = c.DocumentTitle.Length > 0 ? c.DocumentTitle : "ONIRIQUE";
        c.WindowCloseRequested += (_, _) => fenetre.Close();
        e.NewWindow = c;
        e.Handled = true;
        return true;
    }
}
