namespace Onirique;

static class Program
{
    [STAThread]
    static void Main(string[] args)
    {
        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        if (args.Contains("--desinstaller")) { Installation.Desinstaller(); return; }
        // Lancé depuis le fichier téléchargé : c'est l'installateur (sauf --portable, pour l'essayer sans l'installer).
        if (!Installation.EstInstallee && !args.Contains("--portable")) { Application.Run(new FenetreInstallation()); return; }
        if (Installation.EstInstallee) Installation.Nettoyer();
        Application.Run(new Navigateur(args.Where(a => !a.StartsWith("--")).ToArray()));
    }
}
