using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Web.WebView2.Core;

namespace Onirique;

// Les téléchargements dans une page à nous (telechargements.html, Ctrl+J), au lieu de la fenêtre d'Edge : la
// progression en direct, mettre en pause, reprendre, annuler, ouvrir le fichier ou son dossier. La liste des
// téléchargements terminés est gardée (telechargements.json), sauf en navigation privée.
sealed partial class Navigateur
{
    sealed class Telechargement
    {
        public int Id;
        public string Nom = "", Chemin = "", Url = "", Etat = "encours";
        public long Recu, Total, Debut;
        public CoreWebView2DownloadOperation? Operation;
    }

    static readonly List<Telechargement> telechargements = new();
    static int prochainTelechargement = 1;
    static bool telechargementsLus;
    static string FichierTelechargements => Path.Combine(Parametres.Dossier, "telechargements.json");
    DateTime derniereProgression;

    void LireTelechargements()
    {
        if (telechargementsLus) return;
        telechargementsLus = true;
        if (Prive) return;
        try
        {
            foreach (var n in JsonNode.Parse(File.ReadAllText(FichierTelechargements))!.AsArray())
                telechargements.Add(new Telechargement
                {
                    Id = prochainTelechargement++, Nom = (string?)n!["nom"] ?? "", Chemin = (string?)n["chemin"] ?? "", Url = (string?)n["url"] ?? "",
                    Etat = (string?)n["etat"] ?? "fini", Recu = (long?)n["recu"] ?? 0, Total = (long?)n["total"] ?? 0, Debut = (long?)n["debut"] ?? 0,
                });
        }
        catch { }
    }

    void SauverTelechargements()
    {
        if (Prive) return;
        try
        {
            var liste = new JsonArray();
            foreach (var t in telechargements.Where(t => t.Etat != "encours" && t.Etat != "pause").TakeLast(300))
                liste.Add(new JsonObject { ["nom"] = t.Nom, ["chemin"] = t.Chemin, ["url"] = t.Url, ["etat"] = t.Etat, ["recu"] = t.Recu, ["total"] = t.Total, ["debut"] = t.Debut });
            Directory.CreateDirectory(Parametres.Dossier);
            File.WriteAllText(FichierTelechargements, liste.ToJsonString());
        }
        catch { }
    }

    void SuivreTelechargement(CoreWebView2DownloadStartingEventArgs e)
    {
        LireTelechargements();
        e.Handled = true; // pas de fenêtre d'Edge : le téléchargement continue, suivi ici
        var op = e.DownloadOperation;
        var t = new Telechargement
        {
            Id = prochainTelechargement++, Operation = op, Chemin = e.ResultFilePath, Nom = Path.GetFileName(e.ResultFilePath), Url = op.Uri,
            Total = (long)(op.TotalBytesToReceive ?? 0), Debut = DateTimeOffset.Now.ToUnixTimeMilliseconds(),
        };
        telechargements.Add(t);
        op.BytesReceivedChanged += (_, _) =>
        {
            t.Recu = op.BytesReceived;
            t.Total = (long)(op.TotalBytesToReceive ?? 0);
            if ((DateTime.Now - derniereProgression).TotalMilliseconds < 250) return; // les pages se redessinent 4 fois par seconde
            derniereProgression = DateTime.Now;
            EnvoyerTelechargements();
        };
        op.StateChanged += (_, _) =>
        {
            t.Recu = op.BytesReceived;
            t.Chemin = op.ResultFilePath;
            t.Nom = Path.GetFileName(op.ResultFilePath);
            t.Etat = op.State switch
            {
                CoreWebView2DownloadState.Completed => "fini",
                CoreWebView2DownloadState.Interrupted => op.InterruptReason == CoreWebView2DownloadInterruptReason.UserCanceled ? "annule" : "interrompu",
                _ => t.Etat == "pause" ? "pause" : "encours",
            };
            if (t.Etat == "fini") bulle.Montrer($"Téléchargé : {t.Nom}", "Ouvrir", () => OuvrirFichier(t.Chemin));
            if (t.Etat is "fini" or "annule" or "interrompu") { t.Operation = null; SauverTelechargements(); }
            EnvoyerTelechargements();
        };
        bulle.Montrer($"Téléchargement de {t.Nom}…", "Voir", () => OuvrirInterne(PageTelechargements));
        EnvoyerTelechargements();
    }

    JsonObject ListeTelechargements()
    {
        var liste = new JsonArray();
        foreach (var t in Enumerable.Reverse(telechargements))
            liste.Add(new JsonObject
            {
                ["id"] = t.Id, ["nom"] = t.Nom, ["url"] = t.Url, ["etat"] = t.Etat, ["recu"] = t.Recu, ["total"] = t.Total, ["debut"] = t.Debut,
                ["existe"] = t.Etat == "fini" && File.Exists(t.Chemin),
            });
        return new JsonObject { ["type"] = "telechargements", ["liste"] = liste };
    }

    void EnvoyerTelechargements()
    {
        var message = ListeTelechargements();
        foreach (var o in Onglets)
            if (o.Vue?.CoreWebView2 is { } c && o.Url.StartsWith(PageTelechargements, StringComparison.OrdinalIgnoreCase)) Envoyer(c, message.DeepClone().AsObject());
    }

    static void OuvrirFichier(string chemin)
    {
        try { if (File.Exists(chemin)) Process.Start(new ProcessStartInfo(chemin) { UseShellExecute = true }); } catch { }
    }

    void CommandeTelechargement(CoreWebView2 source, JsonObject m)
    {
        LireTelechargements();
        var t = telechargements.FirstOrDefault(x => x.Id == ((int?)m["id"] ?? 0));
        switch ((string?)m["type"])
        {
            case "dlOuvrir": if (t != null) OuvrirFichier(t.Chemin); return;
            case "dlDossier":
                // Le fichier sélectionné dans l'Explorateur (ou le dossier Téléchargements s'il a été déplacé).
                try
                {
                    if (t != null && File.Exists(t.Chemin)) Process.Start("explorer.exe", $"/select,\"{t.Chemin}\"");
                    else Process.Start(new ProcessStartInfo(t != null ? Path.GetDirectoryName(t.Chemin) ?? "" : Environment.GetFolderPath(Environment.SpecialFolder.UserProfile) + "\\Downloads") { UseShellExecute = true });
                }
                catch { }
                return;
            case "dlAnnuler": t?.Operation?.Cancel(); return;
            case "dlPause": t?.Operation?.Pause(); if (t?.Operation != null) { t.Etat = "pause"; EnvoyerTelechargements(); } return;
            case "dlReprendre": if (t?.Operation?.CanResume == true) { t.Operation.Resume(); t.Etat = "encours"; EnvoyerTelechargements(); } return;
            case "dlRetirer":
                if (t != null && t.Operation == null) { telechargements.Remove(t); SauverTelechargements(); }
                EnvoyerTelechargements();
                return;
            case "dlVider":
                telechargements.RemoveAll(x => x.Operation == null);
                SauverTelechargements();
                EnvoyerTelechargements();
                return;
            default: Envoyer(source, ListeTelechargements()); return;
        }
    }
}
