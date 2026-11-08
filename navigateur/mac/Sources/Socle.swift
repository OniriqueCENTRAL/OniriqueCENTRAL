import AppKit
import CryptoKit

// Réglages, couleurs et historique d'ONIRIQUE Navigateur pour Mac. Les réglages ont les mêmes noms que sur Windows
// (parametres.json) : les pages internes (accueil, paramètres, historique) sont les mêmes fichiers.

enum Chemins {
    static let dossier: URL = {
        let u = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("ONIRIQUE Navigateur", isDirectory: true)
        try? FileManager.default.createDirectory(at: u, withIntermediateDirectories: true)
        return u
    }()
    static let fichiers = dossier.appendingPathComponent("fichiers", isDirectory: true)
    static let pages: URL = Bundle.main.resourceURL!.appendingPathComponent("accueil", isDirectory: true)
}

final class Reglages {
    static let partages = Reglages()
    static let defauts: [String: Any] = [
        "Moteur": "google", "ReprendreSession": true, "VeilleSecondes": 30, "DechargementMinutes": 10, "Traqueurs": "strict",
        "SitesSombres": true, "GoogleOnirique": true, "Vpn": false, "VpnRelais": "https://onirique.store:3129", "Memoire": false,
        "Animations": true, "MisesAJour": true, "Accent": "#e5384a", "ModeStudio": true, "Bloqueur": true, "PlafondMemoire": 0,
        "PlafondCpu": 0, "BarreLaterale": false, "Fond": "nuit", "FondVersion": 0, "Synchro": true, "SynchroDate": 0,
    ]
    static let moteurs: [(id: String, nom: String, url: String)] = [
        ("google", "Google", "https://www.google.com/search?q="), ("duckduckgo", "DuckDuckGo", "https://duckduckgo.com/?q="),
        ("bing", "Bing", "https://www.bing.com/search?q="), ("qwant", "Qwant", "https://www.qwant.com/?q="),
        ("ecosia", "Ecosia", "https://www.ecosia.org/search?q="),
    ]
    private let fichier = Chemins.dossier.appendingPathComponent("parametres.json")
    var v: [String: Any]

    init() {
        v = Reglages.defauts
        if let d = try? Data(contentsOf: fichier), let lu = try? JSONSerialization.jsonObject(with: d) as? [String: Any] {
            for (k, x) in lu where !(x is NSNull) { v[k] = x }
        }
    }

    func b(_ k: String) -> Bool { (v[k] as? NSNumber)?.boolValue ?? (v[k] as? Bool) ?? false }
    func s(_ k: String) -> String? { v[k] as? String }
    func n(_ k: String) -> Int64 { (v[k] as? NSNumber)?.int64Value ?? 0 }
    func poser(_ k: String, _ x: Any?) { v[k] = x ?? NSNull() }

    func enregistrer() {
        var propre = v
        for (k, x) in propre where x is NSNull { propre.removeValue(forKey: k) }
        guard let d = try? JSONSerialization.data(withJSONObject: propre, options: [.prettyPrinted]) else { return }
        let provisoire = fichier.appendingPathExtension("tmp")
        do {
            try d.write(to: provisoire)
            _ = try FileManager.default.replaceItemAt(fichier, withItemAt: provisoire)
        } catch {
            try? d.write(to: fichier)
        }
    }

    func recherche(_ texte: String) -> String {
        let moteur = Reglages.moteurs.first { $0.id == s("Moteur") } ?? Reglages.moteurs[0]
        return moteur.url + (texte.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed.subtracting(CharacterSet(charactersIn: "&+=?#"))) ?? texte)
    }

    /// Les raccourcis de l'accueil : ceux du compte, sinon la liste par défaut (accueil/raccourcis.json).
    func raccourcis() -> [Any] {
        if let t = s("Raccourcis"), let d = t.data(using: .utf8), let l = try? JSONSerialization.jsonObject(with: d) as? [Any] { return l }
        if let d = try? Data(contentsOf: Chemins.pages.appendingPathComponent("raccourcis.json")), let l = try? JSONSerialization.jsonObject(with: d) as? [Any] { return l }
        return []
    }
}

enum DA {
    static let nuit = NSColor(srgbRed: 9 / 255, green: 8 / 255, blue: 10 / 255, alpha: 1)
    static let fond = NSColor(srgbRed: 18 / 255, green: 16 / 255, blue: 18 / 255, alpha: 1)
    static let survol = NSColor(srgbRed: 30 / 255, green: 24 / 255, blue: 27 / 255, alpha: 1)
    static let filet = NSColor(srgbRed: 41 / 255, green: 34 / 255, blue: 37 / 255, alpha: 1)
    static let brume = NSColor(srgbRed: 244 / 255, green: 236 / 255, blue: 236 / 255, alpha: 1)
    static let cendre = NSColor(srgbRed: 168 / 255, green: 147 / 255, blue: 154 / 255, alpha: 1)
    static let eteint = NSColor(srgbRed: 125 / 255, green: 106 / 255, blue: 110 / 255, alpha: 1)
    static var braise = NSColor(srgbRed: 229 / 255, green: 56 / 255, blue: 74 / 255, alpha: 1)
    static var braiseClaire = NSColor(srgbRed: 1, green: 142 / 255, blue: 154 / 255, alpha: 1)
    static var sang = NSColor(srgbRed: 122 / 255, green: 13 / 255, blue: 28 / 255, alpha: 1)
    static let accents: [(hex: String, nom: String)] = [
        ("#e5384a", "Braise"), ("#ff6a3d", "Corail"), ("#e8b33a", "Or"), ("#22c28a", "Émeraude"), ("#2bb8d6", "Lagon"),
        ("#3d7bff", "Océan"), ("#8b5cf6", "Améthyste"), ("#e64aa8", "Fuchsia"), ("#a3a3a3", "Acier"),
    ]

    /// Même calcul que le site, l'application et le navigateur Windows : la teinte choisie, gardée lisible sur la nuit.
    static func accent(_ hex: String) {
        let defaut = hex.lowercased() == "#e5384a"
        guard !defaut, hex.count == 7, hex.hasPrefix("#"), let n = Int(hex.dropFirst(), radix: 16) else {
            braise = NSColor(srgbRed: 229 / 255, green: 56 / 255, blue: 74 / 255, alpha: 1)
            braiseClaire = NSColor(srgbRed: 1, green: 142 / 255, blue: 154 / 255, alpha: 1)
            sang = NSColor(srgbRed: 122 / 255, green: 13 / 255, blue: 28 / 255, alpha: 1)
            return
        }
        let r = Double(n >> 16) / 255, g = Double((n >> 8) & 255) / 255, b = Double(n & 255) / 255
        let mx = max(r, g, b), mn = min(r, g, b), l = (mx + mn) / 2, d = mx - mn
        var teinte = 0.0, sat = 0.0
        if d > 0 {
            sat = d / (1 - abs(2 * l - 1))
            if mx == r { teinte = ((g - b) / d).truncatingRemainder(dividingBy: 6) } else if mx == g { teinte = (b - r) / d + 2 } else { teinte = (r - g) / d + 4 }
            teinte = (teinte * 60 + 360).truncatingRemainder(dividingBy: 360)
        }
        func rgb(_ H: Double, _ S: Double, _ L: Double) -> NSColor {
            let c = (1 - abs(2 * L - 1)) * S, x = c * (1 - abs((H / 60).truncatingRemainder(dividingBy: 2) - 1)), m = L - c / 2
            let (a, bb, cc): (Double, Double, Double) = H < 60 ? (c, x, 0) : H < 120 ? (x, c, 0) : H < 180 ? (0, c, x) : H < 240 ? (0, x, c) : H < 300 ? (x, 0, c) : (c, 0, x)
            func arrondi(_ v: Double) -> CGFloat { CGFloat((v + m) * 255).rounded() / 255 }
            return NSColor(srgbRed: arrondi(a), green: arrondi(bb), blue: arrondi(cc), alpha: 1)
        }
        let s = sat < 0.08 ? 0 : max(0.55, min(0.9, sat))
        braise = rgb(teinte, s, max(0.5, min(0.62, l)))
        braiseClaire = rgb(teinte, s > 0 ? min(1, s + 0.1) : 0, 0.76)
        sang = rgb(teinte, s, 0.26)
    }

    static func triplet(_ c: NSColor) -> String {
        let x = c.usingColorSpace(.sRGB) ?? c
        return "\(Int((x.redComponent * 255).rounded())), \(Int((x.greenComponent * 255).rounded())), \(Int((x.blueComponent * 255).rounded()))"
    }
}

/// L'historique, gardé sur ce Mac (une ligne JSON par page, comme sur Windows).
enum Historique {
    struct Entree: Codable { var t: Int64; var u: String; var ti: String }
    private static let fichier = Chemins.dossier.appendingPathComponent("historique.jsonl")
    private static var entrees: [Entree]?

    private static func tout() -> [Entree] {
        if let e = entrees { return e }
        var lues: [Entree] = []
        if let texte = try? String(contentsOf: fichier, encoding: .utf8) {
            for ligne in texte.split(separator: "\n") {
                if let d = ligne.data(using: .utf8), let e = try? JSONDecoder().decode(Entree.self, from: d) { lues.append(e) }
            }
        }
        entrees = lues
        return lues
    }

    static func ajouter(_ url: String, _ titre: String) {
        guard url.hasPrefix("http://") || url.hasPrefix("https://") else { return }
        var liste = tout()
        if liste.last?.u == url { return }
        let e = Entree(t: Int64(Date().timeIntervalSince1970 * 1000), u: url, ti: String(titre.prefix(300)))
        liste.append(e)
        if liste.count > 20000 { liste.removeFirst(liste.count - 10000); entrees = liste; reecrire(); return }
        entrees = liste
        guard let d = try? JSONEncoder().encode(e), var ligne = String(data: d, encoding: .utf8) else { return }
        ligne += "\n"
        if let poignee = try? FileHandle(forWritingTo: fichier) {
            poignee.seekToEndOfFile()
            poignee.write(ligne.data(using: .utf8)!)
            try? poignee.close()
        } else {
            try? ligne.write(to: fichier, atomically: true, encoding: .utf8)
        }
    }

    static func chercher(_ texte: String, limite: Int = 600) -> [[String: Any]] {
        let mots = texte.lowercased().split(separator: " ").map(String.init)
        var resultat: [[String: Any]] = []
        for e in tout().reversed() where resultat.count < limite {
            let t = (e.ti + " " + e.u).lowercased()
            if mots.allSatisfy({ t.contains($0) }) { resultat.append(["t": e.t, "u": e.u, "ti": e.ti]) }
        }
        return resultat
    }

    static func suggerer(_ texte: String, nombre: Int) -> [Entree] {
        let mots = texte.lowercased().split(separator: " ").map(String.init)
        guard let premier = mots.first else { return [] }
        var vues: [String: (Entree, Int)] = [:]
        for e in tout() {
            let t = (e.ti + " " + e.u).lowercased()
            if mots.allSatisfy({ t.contains($0) }) { vues[e.u] = (e, (vues[e.u]?.1 ?? 0) + 1) }
        }
        func hote(_ u: String) -> String { (URL(string: u)?.host ?? u).replacingOccurrences(of: "www.", with: "") }
        return vues.values.sorted { a, b in
            func score(_ x: (Entree, Int)) -> Double { (hote(x.0.u).hasPrefix(premier) ? 1000 : 0) + Double(min(x.1, 50) * 10) + Double(x.0.t) / 1e11 }
            return score(a) > score(b)
        }.prefix(nombre).map { $0.0 }
    }

    static func oublier(_ t: Int64, _ u: String) {
        var liste = tout()
        let avant = liste.count
        liste.removeAll { $0.t == t && $0.u == u }
        entrees = liste
        if liste.count != avant { reecrire() }
    }

    static func effacer() { entrees = []; try? FileManager.default.removeItem(at: fichier) }

    private static func reecrire() {
        let lignes = tout().compactMap { e -> String? in
            guard let d = try? JSONEncoder().encode(e) else { return nil }
            return String(data: d, encoding: .utf8)
        }
        try? (lignes.joined(separator: "\n") + "\n").write(to: fichier, atomically: true, encoding: .utf8)
    }
}

func empreinteSHA256(_ fichier: URL) -> String? {
    guard let d = try? Data(contentsOf: fichier) else { return nil }
    return SHA256.hash(data: d).map { String(format: "%02x", $0) }.joined()
}

let versionDuNavigateur = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"
