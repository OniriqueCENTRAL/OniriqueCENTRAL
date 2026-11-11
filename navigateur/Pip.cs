using System.Text.Json;
using Microsoft.Web.WebView2.Core;

namespace Onirique;

// Image dans l'image : la fenêtre flottante de Chromium (toujours au premier plan, déplaçable, redimensionnable, avec son
// bouton de retour à l'onglet), lancée par le bouton de la barre, Alt+P ou le mini-lecteur. L'onglet ne s'endort pas tant
// qu'elle est ouverte.
sealed partial class Navigateur
{
    readonly Bouton boutonPip = new("", "Image dans l'image (Alt+P)");
    readonly HashSet<CoreWebView2> enPip = new();

    const string ScriptPip = """
        (async () => {
          if (document.pictureInPictureElement) { await document.exitPictureInPicture(); return "sorti"; }
          const vs = [...document.querySelectorAll("video")].filter(v => v.readyState > 0)
            .sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight);
          if (!vs.length) return "aucune";
          const v = vs.find(v => !v.paused) || vs[0];
          v.disablePictureInPicture = false;
          try { await v.requestPictureInPicture(); return "entre"; } catch { return "erreur"; }
        })()
        """;

    internal async Task BasculerPip(CoreWebView2? c)
    {
        if (c == null) return;
        string r;
        try
        {
            // Par le protocole de débogage, avec userGesture : Chromium n'ouvre l'image dans l'image qu'après un geste.
            var json = await c.CallDevToolsProtocolMethodAsync("Runtime.evaluate",
                JsonSerializer.Serialize(new { expression = ScriptPip, awaitPromise = true, returnByValue = true, userGesture = true }));
            r = JsonDocument.Parse(json).RootElement.GetProperty("result").GetProperty("value").GetString() ?? "";
        }
        catch { r = "erreur"; }
        if (r == "entre") enPip.Add(c); else enPip.Remove(c);
        if (r == "aucune") bulle.Montrer("Aucune vidéo dans cette page.");
        else if (r == "erreur") bulle.Montrer("Cette vidéo refuse l'image dans l'image.");
        MajPip();
    }

    void MajPip() => boutonPip.Temoin = Actif?.Vue?.CoreWebView2 is { } c && enPip.Contains(c);
    bool EnPip(Onglet o) => o.Vue?.CoreWebView2 is { } c && enPip.Contains(c);

    /// <summary>La fenêtre a pu être fermée par sa croix ou son bouton de retour : on oublie les pages qui n'y sont plus.</summary>
    async Task EntretienPip()
    {
        foreach (var c in enPip.ToList())
        {
            bool encore;
            try { encore = await c.ExecuteScriptAsync("!!document.pictureInPictureElement") == "true"; } catch { encore = false; }
            if (!encore) enPip.Remove(c);
        }
        MajPip();
    }
}
