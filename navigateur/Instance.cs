using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Text;

namespace Onirique;

/// <summary>
/// Un seul navigateur à la fois : un lien ouvert depuis une autre application (navigateur par défaut) relance le
/// programme ; ce second lancement passe le lien à la fenêtre déjà ouverte, qui l'ouvre dans un onglet, puis s'arrête.
/// </summary>
static class Instance
{
    // Un canal par utilisateur et par dossier de profil : une fenêtre ne parle qu'aux fenêtres du même profil.
    static readonly string Tube = $"ONIRIQUE-Navigateur-{Environment.UserName}-" +
        Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(Encoding.UTF8.GetBytes(Parametres.Dossier.ToLowerInvariant())))[..12];

    [DllImport("user32.dll")] static extern bool AllowSetForegroundWindow(int processus);

    /// <summary>Vrai si une fenêtre était déjà ouverte et a reçu les adresses.</summary>
    public static bool Transmettre(string[] adresses)
    {
        try
        {
            using var client = new NamedPipeClientStream(".", Tube, PipeDirection.Out);
            client.Connect(400);
            AllowSetForegroundWindow(-1); // la fenêtre ouverte a le droit de passer au premier plan
            var texte = Encoding.UTF8.GetBytes(string.Join("\n", adresses) + "\n");
            client.Write(texte, 0, texte.Length);
            return true;
        }
        catch { return false; }
    }

    static string TubeDe(int processus) => $"{Tube}-fenetre-{processus}";

    /// <summary>Un onglet lâché sur une autre fenêtre ONIRIQUE : son adresse lui est confiée.</summary>
    public static bool Envoyer(int processus, string adresse)
    {
        try
        {
            using var client = new NamedPipeClientStream(".", TubeDe(processus), PipeDirection.Out);
            client.Connect(400);
            AllowSetForegroundWindow(processus);
            var texte = Encoding.UTF8.GetBytes(adresse + "\n");
            client.Write(texte, 0, texte.Length);
            return true;
        }
        catch { return false; }
    }

    /// <summary>Chaque fenêtre écoute les onglets qu'on lui lâche ; la principale, aussi les lancements suivants.</summary>
    public static void Ecouter(Navigateur nav, bool principale)
    {
        Ecouter(nav, TubeDe(Environment.ProcessId));
        if (principale) Ecouter(nav, Tube);
    }

    static void Ecouter(Navigateur nav, string tube)
    {
        var fil = new Thread(() =>
        {
            while (!nav.IsDisposed)
            {
                try
                {
                    using var serveur = new NamedPipeServerStream(tube, PipeDirection.In, 1, PipeTransmissionMode.Byte);
                    serveur.WaitForConnection();
                    using var lecteur = new StreamReader(serveur, Encoding.UTF8);
                    var adresses = lecteur.ReadToEnd().Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
                    if (nav.IsHandleCreated) nav.BeginInvoke(() => nav.Recevoir(adresses));
                }
                catch { Thread.Sleep(500); }
            }
        }) { IsBackground = true, Name = "Instance" };
        fil.Start();
    }
}

sealed partial class Navigateur
{
    /// <summary>Un autre lancement nous confie ses adresses : chacune dans un nouvel onglet ; sans adresse, un onglet d'accueil.</summary>
    internal async void Recevoir(string[] adresses)
    {
        if (WindowState == FormWindowState.Minimized) WindowState = Reglages.Agrandie ? FormWindowState.Maximized : FormWindowState.Normal;
        Activate();
        if (adresses.Length == 0) { NouvelOnglet(); return; }
        foreach (var a in adresses) await Ouvrir(Resoudre(a));
    }
}
