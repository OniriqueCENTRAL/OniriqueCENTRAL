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
        Application.Run(new Navigateur(args.Where(a => !a.StartsWith("--")).ToArray())
        {
            Prive = args.Contains("--prive"),
            Secondaire = args.Contains("--prive") || args.Contains("--nouvelle-fenetre"),
        });
    }
}
