using System.Net;
using System.Net.Http.Headers;
using System.Net.Sockets;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Onirique;

// Le VPN : le navigateur s'annonce au serveur ONIRIQUE avec le compte connecté sur onirique.store, puis passe par le
// relais du serveur (server/src/vpn.js). onirique.store reste en accès direct, pour pouvoir toujours s'annoncer.
static class Vpn
{
    const string Api = "https://onirique.store/api/vpn";

    public static string Arguments(string relais) =>
        $"--proxy-server={relais} --proxy-bypass-list=onirique.store;*.onirique.store;<local> --force-webrtc-ip-handling-policy=disable_non_proxied_udp";

    public sealed record Resultat(bool Ok, string Message, string? Relais = null);

    public static async Task<Resultat> Annoncer(CoreWebView2Environment env, Control hote)
    {
        var jeton = await LireJeton(env, hote);
        if (string.IsNullOrEmpty(jeton))
            return new(false, "Connecte-toi à ton compte ONIRIQUE (avec « Rester connecté ») pour allumer le VPN.");
        try
        {
            using var http = new HttpClient(new SocketsHttpHandler { ConnectCallback = Ipv4 }) { Timeout = TimeSpan.FromSeconds(15) };
            using var requete = new HttpRequestMessage(HttpMethod.Post, Api) { Content = new StringContent("{}", null, "application/json") };
            requete.Headers.Authorization = new AuthenticationHeaderValue("Bearer", jeton);
            using var reponse = await http.SendAsync(requete);
            using var json = JsonDocument.Parse(await reponse.Content.ReadAsStringAsync());
            if (reponse.StatusCode == HttpStatusCode.Unauthorized)
                return new(false, "Ta connexion à ONIRIQUE a expiré : reconnecte-toi sur onirique.store pour allumer le VPN.");
            if (!reponse.IsSuccessStatusCode)
                return new(false, json.RootElement.TryGetProperty("error", out var e) ? e.GetString() ?? "VPN indisponible." : "VPN indisponible.");
            var relais = json.RootElement.GetProperty("relais").GetString();
            // Un relais injoignable bloquerait toutes les pages : on vérifie qu'il répond avant d'y passer.
            if (relais is null || !Uri.TryCreate(relais, UriKind.Absolute, out var adresse) || !await Joignable(adresse))
                return new(false, "Le VPN est en maintenance pour l'instant. Réessaie un peu plus tard.");
            return new(true, "", relais);
        }
        catch (Exception)
        {
            return new(false, "Le serveur du VPN ne répond pas. Réessaie dans un instant.");
        }
    }

    static async Task<bool> Joignable(Uri relais)
    {
        using var socket = new Socket(AddressFamily.InterNetwork, SocketType.Stream, ProtocolType.Tcp);
        using var delai = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        try { await socket.ConnectAsync(relais.Host, relais.Port, delai.Token); return true; }
        catch { return false; }
    }

    // L'annonce et le relais doivent venir de la même adresse : le relais est joint en IPv4, l'annonce aussi.
    static async ValueTask<Stream> Ipv4(SocketsHttpConnectionContext contexte, CancellationToken annulation)
    {
        var socket = new Socket(AddressFamily.InterNetwork, SocketType.Stream, ProtocolType.Tcp) { NoDelay = true };
        try
        {
            await socket.ConnectAsync(contexte.DnsEndPoint.Host, contexte.DnsEndPoint.Port, annulation);
            return new NetworkStream(socket, true);
        }
        catch { socket.Dispose(); throw; }
    }

    // Le jeton du compte est celui que le site garde dans le navigateur (onirique.token) : on le lit sur une page cachée.
    internal static async Task<string?> LireJeton(CoreWebView2Environment env, Control hote)
    {
        var vue = new WebView2 { Visible = false, Size = new Size(1, 1) };
        hote.Controls.Add(vue);
        _ = vue.Handle;
        try
        {
            await vue.EnsureCoreWebView2Async(env);
            var charge = new TaskCompletionSource<bool>();
            vue.CoreWebView2.NavigationCompleted += (_, e) => charge.TrySetResult(e.IsSuccess);
            vue.CoreWebView2.Navigate("https://onirique.store/robots.txt");
            if (await Task.WhenAny(charge.Task, Task.Delay(10000)) != charge.Task || !charge.Task.Result) return null;
            var brut = await vue.CoreWebView2.ExecuteScriptAsync("localStorage.getItem('onirique.token') || sessionStorage.getItem('onirique.token')");
            return JsonSerializer.Deserialize<string?>(brut);
        }
        catch { return null; }
        finally { vue.Dispose(); }
    }
}
