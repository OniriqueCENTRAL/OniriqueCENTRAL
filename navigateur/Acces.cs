using System.Text.Json.Nodes;
using Microsoft.Web.WebView2.Core;

namespace Onirique;

// Autorisations par site (caméra, micro, position…) : ce que le moteur a retenu pour chaque site, à changer depuis
// les paramètres. « Demander » rend la décision au site, qui reposera la question.
sealed partial class Navigateur
{
    static readonly Dictionary<string, CoreWebView2PermissionKind> GenresAcces = new()
    {
        ["camera"] = CoreWebView2PermissionKind.Camera,
        ["micro"] = CoreWebView2PermissionKind.Microphone,
        ["position"] = CoreWebView2PermissionKind.Geolocation,
        ["notifications"] = CoreWebView2PermissionKind.Notifications,
        ["midi"] = CoreWebView2PermissionKind.MidiSystemExclusiveMessages,
        ["pressepapiers"] = CoreWebView2PermissionKind.ClipboardRead,
        ["fichiers"] = CoreWebView2PermissionKind.FileReadWrite,
        ["telechargements"] = CoreWebView2PermissionKind.MultipleAutomaticDownloads,
        ["lecture"] = CoreWebView2PermissionKind.Autoplay,
        ["capteurs"] = CoreWebView2PermissionKind.OtherSensors,
        ["polices"] = CoreWebView2PermissionKind.LocalFonts,
        ["fenetres"] = CoreWebView2PermissionKind.WindowManagement,
    };

    async Task CommandeAcces(CoreWebView2 source, JsonObject m)
    {
        if ((string?)m["type"] == "accesChanger")
        {
            if (OrigineDeSite((string?)m["site"]) is not { } site || !GenresAcces.TryGetValue((string?)m["genre"] ?? "", out var genre)) return;
            var etat = (string?)m["etat"] switch { "oui" => CoreWebView2PermissionState.Allow, "non" => CoreWebView2PermissionState.Deny, _ => CoreWebView2PermissionState.Default };
            await source.Profile.SetPermissionStateAsync(genre, site, etat);
        }
        var liste = new JsonArray();
        foreach (var r in await source.Profile.GetNonDefaultPermissionSettingsAsync())
        {
            var cle = GenresAcces.FirstOrDefault(g => g.Value == r.PermissionKind).Key;
            if (cle == null || OrigineDeSite(r.PermissionOrigin) is not { } site) continue;
            liste.Add(new JsonObject { ["site"] = site, ["genre"] = cle, ["etat"] = r.PermissionState == CoreWebView2PermissionState.Allow ? "oui" : "non" });
        }
        Envoyer(source, new JsonObject { ["type"] = "acces", ["liste"] = liste });
    }

    // « youtube.com » ou « https://www.youtube.com/watch?v=… » donnent l'origine du site ; rien d'autre que http(s).
    static string? OrigineDeSite(string? s)
    {
        s = s?.Trim();
        if (string.IsNullOrEmpty(s)) return null;
        if (!s.Contains("://")) s = "https://" + s;
        return Uri.TryCreate(s, UriKind.Absolute, out var u) && u.Scheme is "http" or "https" && u.Host.Length > 0 ? u.GetLeftPart(UriPartial.Authority) : null;
    }
}
