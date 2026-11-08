using System.Text.Json;
using System.Text.Json.Nodes;

namespace Onirique;

/// <summary>L'historique de navigation, gardé sur ce PC (une ligne JSON par page dans historique.jsonl).</summary>
static class Historique
{
    public sealed record Entree(long t, string u, string ti);

    static readonly string Fichier = Path.Combine(Parametres.Dossier, "historique.jsonl");
    const int Maximum = 20000;
    static List<Entree>? entrees;

    static List<Entree> Tout()
    {
        if (entrees != null) return entrees;
        entrees = new();
        try
        {
            foreach (var ligne in File.ReadLines(Fichier))
                try { if (JsonSerializer.Deserialize<Entree>(ligne) is { } e) entrees.Add(e); } catch { }
        }
        catch { }
        return entrees;
    }

    public static void Ajouter(string url, string titre)
    {
        if (!url.StartsWith("http://", StringComparison.OrdinalIgnoreCase) && !url.StartsWith("https://", StringComparison.OrdinalIgnoreCase)) return;
        var liste = Tout();
        if (liste.Count > 0 && liste[^1].u == url) return; // un simple rechargement
        var e = new Entree(DateTimeOffset.Now.ToUnixTimeMilliseconds(), url, titre.Length > 300 ? titre[..300] : titre);
        liste.Add(e);
        try
        {
            Directory.CreateDirectory(Parametres.Dossier);
            if (liste.Count > Maximum) { liste.RemoveRange(0, liste.Count - Maximum / 2); Reecrire(); }
            else File.AppendAllText(Fichier, JsonSerializer.Serialize(e) + "\n");
        }
        catch { }
    }

    public static JsonArray Chercher(string? recherche, int limite = 600)
    {
        var mots = (recherche ?? "").Trim().ToLowerInvariant().Split(' ', StringSplitOptions.RemoveEmptyEntries);
        var resultat = new JsonArray();
        var liste = Tout();
        for (int i = liste.Count - 1; i >= 0 && resultat.Count < limite; i--)
        {
            var e = liste[i];
            var texte = (e.ti + " " + e.u).ToLowerInvariant();
            if (mots.All(texte.Contains)) resultat.Add(new JsonObject { ["t"] = e.t, ["u"] = e.u, ["ti"] = e.ti });
        }
        return resultat;
    }

    public static void Oublier(long t, string url)
    {
        if (Tout().RemoveAll(e => e.t == t && e.u == url) > 0) Reecrire();
    }

    public static void Effacer()
    {
        Tout().Clear();
        try { File.Delete(Fichier); } catch { }
    }

    static void Reecrire()
    {
        try
        {
            var provisoire = Fichier + ".tmp";
            File.WriteAllLines(provisoire, Tout().Select(e => JsonSerializer.Serialize(e)));
            File.Move(provisoire, Fichier, true);
        }
        catch { }
    }
}
