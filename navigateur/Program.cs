namespace Onirique;

static class Program
{
    internal static void Noter(Exception e)
    {
        try { Directory.CreateDirectory(Parametres.Dossier); File.AppendAllText(Path.Combine(Parametres.Dossier, "erreurs.log"), $"{DateTime.Now:s} {e}{Environment.NewLine}"); } catch { }
    }

    [STAThread]
    static void Main(string[] args)
    {
        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        // Une erreur inattendue ne ferme pas le navigateur : elle est notée dans erreurs.log, pour la retrouver.
        Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
        Application.ThreadException += (_, e) => Noter(e.Exception);

        DA.Accent(Parametres.Lire().Accent);
        if (args.Contains("--desinstaller")) { Installation.Desinstaller(); return; }
        // Lancé depuis le fichier téléchargé : c'est l'installateur (sauf --portable, pour l'essayer sans l'installer).
        if (!Installation.EstInstallee && !args.Contains("--portable")) { Application.Run(new FenetreInstallation()); return; }
        if (Installation.EstInstallee)
        {
            Installation.Nettoyer();
            // Premier lancement d'une nouvelle version : icônes et raccourcis remis à neuf.
            var reglages = Parametres.Lire();
            if (reglages.DerniereVersion != Installation.Version)
            {
                Installation.RafraichirIcones();
                reglages.DerniereVersion = Installation.Version;
                reglages.Enregistrer();
            }
        }
        var adresses = args.Where(a => !a.StartsWith("--")).ToArray();
        bool secondaire = args.Contains("--prive") || args.Contains("--nouvelle-fenetre");
        // Déjà ouvert : le lien part dans la fenêtre existante, rien d'autre ne se lance.
        if (!secondaire && Instance.Transmettre(adresses)) return;
        var nav = new Navigateur(adresses) { Prive = args.Contains("--prive"), Secondaire = secondaire };
        Instance.Ecouter(nav, principale: !secondaire);
        // Un onglet détaché ouvre sa fenêtre là où on l'a lâché.
        if (args.FirstOrDefault(a => a.StartsWith("--position=")) is { } pos && pos[11..].Split(',') is [var px, var py]
            && int.TryParse(px, out var x) && int.TryParse(py, out var y))
        {
            nav.StartPosition = FormStartPosition.Manual;
            nav.WindowState = FormWindowState.Normal;
            nav.Location = new Point(x, y);
        }
        Application.Run(nav);
    }
}
