using System.Text.RegularExpressions;
using Microsoft.Web.WebView2.Core;

namespace Onirique;

// Outils ONIRIQUE sur la page ouverte : la prod d'une vidéo YouTube ou TikTok, téléchargée par le Downloader du site avec
// le BPM et la tonalité dans le nom, et l'accélération matérielle coupée pour un onglet.
//
// Le moteur règle l'accélération matérielle par processus de navigateur, pas par page : un onglet « sans accélération »
// tourne donc dans un second moteur lancé avec --disable-gpu, dans son propre dossier de profil (deux moteurs aux options
// différentes ne peuvent pas partager un profil). Les cookies du site passent d'un moteur à l'autre au basculement, pour
// garder la connexion.
sealed partial class Navigateur
{
    readonly Bouton boutonOutils = new("", "Outils ONIRIQUE");
    CoreWebView2Environment? envSansGpu;

    static readonly Regex Video = new(@"^https://((www|m|music)\.)?youtube\.com/(watch\?|shorts/)|^https://youtu\.be/|^https://((www|m|vm|vt)\.)?tiktok\.com/.+",
        RegexOptions.IgnoreCase);

    void MenuOutils()
    {
        if (Actif is not { } o) return;
        var m = NouveauMenu();
        bool video = Video.IsMatch(o.Url);
        m.Items.Add(Element("Télécharger la prod en MP3 (BPM et tonalité dans le nom)", () => _ = TelechargerProd(o, "mp3:320", true), video));
        m.Items.Add(Element("Télécharger la prod en WAV (BPM et tonalité dans le nom)", () => _ = TelechargerProd(o, "wav:0", true), video));
        m.Items.Add(Element("Télécharger la vidéo en MP4", () => _ = TelechargerProd(o, "mp4:0", false), video));
        if (!video) m.Items.Add(Element("Ouvre une vidéo YouTube ou TikTok pour la télécharger", () => { }, false));
        m.Items.Add(new ToolStripSeparator());
        m.Items.Add(Element("BPM et tonalité d'un fichier…", () => _ = Ouvrir("https://onirique.store/bpm-tonalite", Onglets.IndexOf(o) + 1)));
        m.Items.Add(new ToolStripSeparator());
        m.Items.Add(new ToolStripMenuItem("Accélération matérielle pour cet onglet", null, (_, _) => _ = BasculerGpu(o)) { Checked = !o.SansGpu });
        m.Show(boutonOutils, new Point(0, boutonOutils.Height));
    }

    /// <summary>Le Downloader du site, ouvert à côté sur le lien de la page : il lance seul le téléchargement.</summary>
    Task<Onglet> TelechargerProd(Onglet o, string format, bool prod) =>
        Ouvrir("https://onirique.store/downloader?url=" + Uri.EscapeDataString(o.Url) + "&format=" + Uri.EscapeDataString(format) + (prod ? "&prod=1" : ""),
            Onglets.IndexOf(o) + 1);

    async Task BasculerGpu(Onglet o)
    {
        if (o.Vue?.CoreWebView2 is { } c && Uri.TryCreate(o.Url, UriKind.Absolute, out var u) && u.Scheme == "https")
            try { o.CookiesAPorter = await c.CookieManager.GetCookiesAsync(u.GetLeftPart(UriPartial.Authority)); } catch { }
        o.SansGpu = !o.SansGpu;
        var vue = o.Vue;
        o.Vue = null;
        o.ScriptGoogle = null;
        vue?.Dispose();
        o.Decharge = true;
        if (Actif == o) { Actif = null; Activer(o); }
        bulle.Montrer(o.SansGpu
            ? "Cet onglet tourne sans accélération matérielle (utile pour partager Netflix en stream). Il a son propre moteur : seuls les cookies de ce site ont suivi."
            : "Accélération matérielle rétablie pour cet onglet.");
    }

    async Task<CoreWebView2Environment> MoteurDe(Onglet o) => o.SansGpu ? envSansGpu ??= await Moteur(relaisMoteur, sansGpu: true) : env!;

    /// <summary>Les cookies emportés au basculement, posés avant la première page du nouveau moteur.</summary>
    static void PoserCookies(Onglet o, CoreWebView2 c)
    {
        if (o.CookiesAPorter is not { } liste) return;
        o.CookiesAPorter = null;
        foreach (var k in liste)
            try { c.CookieManager.AddOrUpdateCookie(c.CookieManager.CopyCookie(k)); } catch { }
    }

    IEnumerable<int> Processus() =>
        new[] { env, envSansGpu }.OfType<CoreWebView2Environment>().SelectMany(e => e.GetProcessInfos()).Select(p => p.ProcessId);
}
