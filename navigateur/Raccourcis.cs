using System.Diagnostics;
using Microsoft.Web.WebView2.Core;

namespace Onirique;

// Les raccourcis clavier de Chrome. Ceux que le moteur gère déjà dans la page (Ctrl+F, Ctrl+P, Ctrl+S, zoom, F12…)
// lui sont laissés.
sealed partial class Navigateur
{
    readonly Stack<(string Url, string Titre, int Rang)> fermes = new();
    internal bool Prive;            // fenêtre de navigation privée : rien n'est gardé
    internal bool Secondaire;       // autre fenêtre : elle n'écrase pas la session de la fenêtre principale

    void NoterFermeture(Onglet o, int rang)
    {
        if (o.Url.Length > 0 && !EstInterne(o.Url) && !Prive) fermes.Push((o.Url, o.Titre, rang));
    }

    async void RouvrirOnglet()
    {
        if (fermes.Count == 0) return;
        var (url, _, rang) = fermes.Pop();
        await Ouvrir(url, rang);
    }

    /// <summary>Une nouvelle fenêtre (ou une fenêtre privée) : un second lancement du navigateur, qui partage son moteur.</summary>
    static void NouvelleFenetre(bool prive, string? adresse = null, Point? position = null)
    {
        var info = new ProcessStartInfo(Environment.ProcessPath!) { UseShellExecute = false };
        info.ArgumentList.Add(prive ? "--prive" : "--nouvelle-fenetre");
        if (!Installation.EstInstallee) info.ArgumentList.Add("--portable");
        if (position is { } p) info.ArgumentList.Add($"--position={p.X},{p.Y}");
        if (adresse != null) info.ArgumentList.Add(adresse);
        Process.Start(info);
    }

    [System.Runtime.InteropServices.DllImport("user32.dll")] static extern IntPtr WindowFromPoint(Point p);
    [System.Runtime.InteropServices.DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint quoi);
    [System.Runtime.InteropServices.DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out int processus);

    /// <summary>
    /// Un onglet lâché hors de la barre d'onglets : sur une autre fenêtre ONIRIQUE, il la rejoint ; ailleurs, il ouvre
    /// sa propre fenêtre à cet endroit. Il voyage par son adresse : la page se recharge à l'arrivée.
    /// </summary>
    internal void Detacher(Onglet o, Point ecran)
    {
        if (Prive || o.Url.Length == 0) return;
        var adresse = EstInterne(o.Url) ? Accueil : o.Url;
        GetWindowThreadProcessId(GetAncestor(WindowFromPoint(ecran), 2 /* GA_ROOT */), out int pid);
        if (pid != 0 && pid != Environment.ProcessId)
        {
            try
            {
                using var p = Process.GetProcessById(pid);
                if (p.ProcessName == Process.GetCurrentProcess().ProcessName && Instance.Envoyer(pid, adresse)) { Fermer(o); return; }
            }
            catch { }
        }
        if (Onglets.Count < 2) return; // le seul onglet d'une fenêtre : c'est la fenêtre qu'on déplace
        NouvelleFenetre(false, adresse, new Point(ecran.X - this.S(120), ecran.Y - this.S(16)));
        Fermer(o);
    }

    void AllerAuRang(int n)
    {
        var visibles = Onglets.ToList();
        if (visibles.Count == 0) return;
        Activer(n == 9 ? visibles[^1] : visibles[Math.Min(n - 1, visibles.Count - 1)]);
    }

    void DeplacerActif(int sens)
    {
        if (Actif == null) return;
        int i = Onglets.IndexOf(Actif);
        Deplacer(Actif, Math.Clamp(i + sens, 0, Onglets.Count - 1));
    }

    bool PleinEcranFenetre;
    FormWindowState etatAvantF11;
    void BasculerPleinEcranFenetre()
    {
        PleinEcranFenetre = !PleinEcranFenetre;
        bandeau.Visible = barre.Visible = !PleinEcranFenetre;
        favoris.Visible = !PleinEcranFenetre && Reglages.BarreFavoris;
        if (PleinEcranFenetre)
        {
            etatAvantF11 = WindowState;
            FormBorderStyle = FormBorderStyle.None;
            WindowState = FormWindowState.Normal;
            WindowState = FormWindowState.Maximized;
        }
        else
        {
            FormBorderStyle = FormBorderStyle.Sizable;
            WindowState = etatAvantF11;
        }
    }

    /// <summary>Les raccourcis de Chrome ; vrai si la touche a été prise ici.</summary>
    bool RaccourciChrome(Keys touches)
    {
        var c = Actif?.Vue?.CoreWebView2;
        var chiffre = touches & ~Keys.Control;
        if ((touches & Keys.Control) == Keys.Control && (touches & (Keys.Shift | Keys.Alt)) == 0)
        {
            if (chiffre is >= Keys.D1 and <= Keys.D9) { AllerAuRang(chiffre - Keys.D0); return true; }
            if (chiffre is >= Keys.NumPad1 and <= Keys.NumPad9) { AllerAuRang(chiffre - Keys.NumPad0); return true; }
        }
        switch (touches)
        {
            case Keys.Control | Keys.Shift | Keys.T: RouvrirOnglet(); return true;
            case Keys.Control | Keys.N: NouvelleFenetre(false); return true;
            case Keys.Control | Keys.Shift | Keys.N: NouvelleFenetre(true); return true;
            case Keys.Control | Keys.Shift | Keys.W: Close(); return true;
            case Keys.Control | Keys.K:
            case Keys.Control | Keys.E: champ.Saisie.Focus(); champ.Saisie.SelectAll(); return true;
            case Keys.Control | Keys.D: BasculerFavori(); return true;
            case Keys.Control | Keys.Shift | Keys.B:
                Reglages.BarreFavoris = favoris.Visible = !favoris.Visible;
                Reglages.Enregistrer();
                return true;
            case Keys.Control | Keys.Shift | Keys.O: OuvrirInterne(Accueil); return true;
            case Keys.Control | Keys.J: c?.OpenDefaultDownloadDialog(); return true;
            case Keys.Control | Keys.Shift | Keys.Delete: OuvrirInterne(PageParametres + "#confidentialite"); return true;
            case Keys.Control | Keys.F5:
            case Keys.Shift | Keys.F5:
            case Keys.Control | Keys.Shift | Keys.R:
                // Recharger sans le cache : la page est redemandée au site.
                if (c != null) { _ = c.CallDevToolsProtocolMethodAsync("Network.clearBrowserCache", "{}"); c.Reload(); }
                return true;
            case Keys.Alt | Keys.Home: c?.Navigate(Accueil); return true;
            case Keys.F11: BasculerPleinEcranFenetre(); return true;
            case Keys.Escape when Actif?.Charge == true && !champ.Saisie.Focused: c?.Stop(); return true;
            case Keys.Control | Keys.U: if (c != null && !EstInterne(c.Source)) _ = Ouvrir("view-source:" + c.Source, Onglets.IndexOf(Actif!) + 1); return true;
            case Keys.Control | Keys.Shift | Keys.PageUp: DeplacerActif(-1); return true;
            case Keys.Control | Keys.Shift | Keys.PageDown: DeplacerActif(1); return true;
        }
        return false;
    }
}
