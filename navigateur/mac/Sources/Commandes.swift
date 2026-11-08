import AppKit
import WebKit

// Les pages internes (accueil, paramètres, historique) parlent au navigateur avec les mêmes messages que sur Windows.
extension Fenetre {
    func commande(_ source: WKWebView, _ m: [String: Any]) {
        switch m["type"] as? String {
        case "changer":
            changer(m["cle"] as? String ?? "", m["valeur"])
        case "historique":
            Moteur.envoyer(source, ["type": "historique", "entrees": Historique.chercher(m["q"] as? String ?? "")])
            return
        case "oublier":
            Historique.oublier((m["t"] as? NSNumber)?.int64Value ?? 0, m["u"] as? String ?? "")
            return
        case "oublierTout":
            Historique.effacer()
            return
        case "raccourcis":
            if let l = m["liste"] as? [Any] { enregistrerRaccourcis(l); majEtoile() }
            return
        case "effacer":
            let quoi = Set((m["quoi"] as? [String]) ?? [])
            var genres = Set<String>()
            if quoi.contains("historique") { Historique.effacer() }
            if quoi.contains("cookies") { genres.formUnion([WKWebsiteDataTypeCookies, WKWebsiteDataTypeLocalStorage, WKWebsiteDataTypeSessionStorage, WKWebsiteDataTypeIndexedDBDatabases]) }
            if quoi.contains("cache") { genres.formUnion([WKWebsiteDataTypeDiskCache, WKWebsiteDataTypeMemoryCache]) }
            WKWebsiteDataStore.default().removeData(ofTypes: genres, modifiedSince: .distantPast) {
                Moteur.envoyer(source, ["type": "efface"])
            }
            return
        case "majs":
            Moteur.envoyer(source, ["type": "maj", "etat": "recherche"])
            Task { @MainActor in
                let r = await MiseAJour.chercher(silencieux: false)
                Moteur.envoyer(source, ["type": "maj", "etat": r])
                self.envoyerEtatAuxPagesInternes()
            }
            return
        case "defaut":
            // Le Mac demande lui-même à l'utilisateur de confirmer le navigateur par défaut.
            NSWorkspace.shared.setDefaultApplication(at: Bundle.main.bundleURL, toOpenURLsWithScheme: "http") { _ in }
            return
        case "fond":
            recevoirFond(m["image"] as? String ?? "")
        default:
            break
        }
        Moteur.envoyer(source, etat())
    }

    func etat() -> [String: Any] {
        var r = reglages.v
        r.removeValue(forKey: "Session")
        r.removeValue(forKey: "Raccourcis")
        let fond: Any = reglages.s("Fond") == "image" && reglages.s("FondFichier") != nil
            ? "onirique://fichiers/\(reglages.s("FondFichier")!)?v=\(reglages.n("FondVersion"))" : NSNull()
        return [
            "type": "etat",
            "plateforme": "mac",
            "reglages": r,
            "vpn": vpnEtat,
            "version": versionDuNavigateur,
            "installe": MiseAJour.installable,
            "majPrete": MiseAJour.prete ?? NSNull(),
            "raccourcis": reglages.raccourcis(),
            "couleurs": ["acc": DA.triplet(DA.braise), "hi": DA.triplet(DA.braiseClaire), "lo": DA.triplet(DA.sang)],
            "accents": DA.accents.map { ["hex": $0.hex, "nom": $0.nom] },
            "moteurs": Reglages.moteurs.map { ["id": $0.id, "nom": $0.nom] },
            "ajouts": ["studio": studioActif ? (dawOuvert ?? "") : NSNull(), "fond": fond, "synchro": synchroEtat] as [String: Any],
        ]
    }

    func envoyerEtatAuxPagesInternes() {
        let e = etat()
        for o in onglets where Fenetre.estInterne(o.url) { if let v = o.vue { Moteur.envoyer(v, e) } }
    }

    private func changer(_ cle: String, _ valeur: Any?) {
        let b = (valeur as? NSNumber)?.boolValue ?? (valeur as? Bool) ?? false
        switch cle {
        case "Moteur":
            if let x = valeur as? String, Reglages.moteurs.contains(where: { $0.id == x }) { reglages.poser(cle, x) }
        case "ReprendreSession", "Animations", "MisesAJour", "ModeStudio":
            reglages.poser(cle, b)
        case "DechargementMinutes", "VeilleSecondes":
            reglages.poser(cle, max(0, min(1440, (valeur as? NSNumber)?.intValue ?? 0)))
        case "SitesSombres":
            reglages.poser(cle, b)
            for f in Fenetre.toutes { for o in f.onglets { o.vue?.appearance = NSAppearance(named: b ? .darkAqua : .aqua) } }
        case "GoogleOnirique":
            reglages.poser(cle, b)
            Moteur.partage.majScripts()
        case "Bloqueur":
            reglages.poser(cle, b)
            Moteur.partage.majBloqueur()
        case "Synchro":
            reglages.poser(cle, b)
            if b { Task { await synchroniser() } }
        case "Vpn":
            Task { if b { await allumerVpn() } else { eteindreVpn() } }
            return
        case "Accent":
            if let hex = valeur as? String, hex.count == 7, hex.hasPrefix("#"), Int(hex.dropFirst(), radix: 16) != nil {
                reglages.poser(cle, hex.lowercased())
                DA.accent(hex)
                Moteur.partage.majScripts()
                Fenetre.toutes.forEach { $0.toutRedessiner(); $0.envoyerEtatAuxPagesInternes() }
            }
        case "Fond":
            if let x = valeur as? String, ["nuit", "anime"].contains(x) || (x == "image" && reglages.s("FondFichier") != nil) { reglages.poser(cle, x) }
            reglages.enregistrer()
            Fenetre.toutes.forEach { $0.envoyerEtatAuxPagesInternes() }
            return
        default:
            return
        }
        reglages.enregistrer()
        profilChange()
    }

    private func recevoirFond(_ donnees: String) {
        let motif = try! NSRegularExpression(pattern: "^data:image/(png|jpeg|webp|gif);base64,(.+)$", options: [.dotMatchesLineSeparators])
        guard let m = motif.firstMatch(in: donnees, range: NSRange(donnees.startIndex..., in: donnees)),
              let r1 = Range(m.range(at: 1), in: donnees), let r2 = Range(m.range(at: 2), in: donnees),
              let octets = Data(base64Encoded: String(donnees[r2])), octets.count <= 15 * 1_048_576 else {
            bulle.montrer("Cette image n'est pas lisible : choisis un fichier JPG, PNG, WebP ou GIF de 15 Mo au plus.")
            return
        }
        let ext = donnees[r1] == "jpeg" ? "jpg" : String(donnees[r1])
        try? FileManager.default.createDirectory(at: Chemins.fichiers, withIntermediateDirectories: true)
        for f in (try? FileManager.default.contentsOfDirectory(atPath: Chemins.fichiers.path)) ?? [] where f.hasPrefix("fond.") {
            try? FileManager.default.removeItem(at: Chemins.fichiers.appendingPathComponent(f))
        }
        try? octets.write(to: Chemins.fichiers.appendingPathComponent("fond.\(ext)"))
        reglages.poser("Fond", "image")
        reglages.poser("FondFichier", "fond.\(ext)")
        reglages.poser("FondVersion", Int64(Date().timeIntervalSince1970 * 1000))
        reglages.enregistrer()
        Fenetre.toutes.forEach { $0.envoyerEtatAuxPagesInternes() }
    }

    // ——— VPN ———

    func majVpn() {
        let b = boutons["vpn"]
        b?.image = NSImage(systemSymbolName: vpnEtat == "actif" ? "shield.fill" : "shield", accessibilityDescription: "VPN")
        b?.contentTintColor = vpnEtat == "actif" ? DA.braiseClaire : vpnEtat == "connexion" ? DA.braise : DA.brume
        b?.toolTip = vpnEtat == "actif" ? "VPN ONIRIQUE : actif — les sites te voient en Allemagne" : vpnEtat == "connexion" ? "VPN ONIRIQUE : connexion…" : "VPN ONIRIQUE : éteint"
        envoyerEtatAuxPagesInternes()
    }

    @objc func basculerVpn() { Task { if vpnEtat == "eteint" { await allumerVpn() } else { eteindreVpn() } } }

    func allumerVpn() async {
        guard Vpn.disponible else {
            bulle.montrer("Le VPN demande macOS 14 Sonoma ou plus récent.")
            reglages.poser("Vpn", false)
            reglages.enregistrer()
            return
        }
        vpnEtat = "connexion"
        majVpn()
        let r = await Vpn.annoncer()
        guard r.ok, let relais = r.relais else {
            vpnEtat = "eteint"
            Vpn.poser(nil)
            reglages.poser("Vpn", false)
            reglages.enregistrer()
            majVpn()
            bulle.montrer(r.message, action: "Me connecter") { [weak self] in self?.ouvrir("https://onirique.store/compte") }
            return
        }
        Vpn.poser(relais)
        reglages.poser("Vpn", true)
        reglages.poser("VpnRelais", relais)
        reglages.enregistrer()
        Fenetre.toutes.forEach { $0.vpnEtat = "actif"; $0.majVpn() }
        bulle.montrer("VPN actif : les sites te voient en Allemagne, par le serveur ONIRIQUE.")
        // Le serveur oublie une adresse au bout de 12 heures : le navigateur se réannonce toutes les 10 minutes.
        DispatchQueue.main.asyncAfter(deadline: .now() + 600) { [weak self] in
            guard let self, self.vpnEtat == "actif" else { return }
            Task { await self.allumerVpn() }
        }
    }

    func eteindreVpn() {
        Vpn.poser(nil)
        reglages.poser("Vpn", false)
        reglages.enregistrer()
        Fenetre.toutes.forEach { $0.vpnEtat = "eteint"; $0.majVpn() }
        bulle.montrer("VPN éteint : tu navigues avec ta propre connexion.")
    }

    // ——— Synchronisation avec le compte ONIRIQUE (raccourcis, couleur, moteur de recherche) ———

    func profilSynchro() -> [String: Any] {
        ["Raccourcis": reglages.raccourcis(), "Accent": reglages.s("Accent") ?? "#e5384a", "Moteur": reglages.s("Moteur") ?? "google"]
    }

    func empreinteProfil() -> String {
        guard let d = try? JSONSerialization.data(withJSONObject: profilSynchro(), options: [.sortedKeys]) else { return "" }
        return String(data: d, encoding: .utf8) ?? ""
    }

    func profilChange() {
        let e = empreinteProfil()
        guard e != derniereEmpreinte else { return }
        derniereEmpreinte = e
        reglages.poser("SynchroDate", Int64(Date().timeIntervalSince1970 * 1000))
        reglages.enregistrer()
        if reglages.b("Synchro") { synchroAEnvoyer = Date().addingTimeInterval(4) }
    }

    @MainActor
    func synchroniser() async {
        synchroVue = Date()
        guard reglages.b("Synchro") else { return }
        guard let jeton = await Compte.jeton() else {
            synchroEtat = "Connecte-toi à ton compte ONIRIQUE (avec « Rester connecté ») pour synchroniser."
            envoyerEtatAuxPagesInternes()
            return
        }
        let (code, json) = await Compte.appeler("GET", "/api/navigateur/profil", jeton: jeton)
        guard code == 200, let json else { synchroEtat = "Synchronisation impossible pour l'instant."; envoyerEtatAuxPagesInternes(); return }
        let date = (json["date"] as? NSNumber)?.int64Value ?? 0
        if date > reglages.n("SynchroDate"), let d = json["donnees"] as? [String: Any] {
            if let r = d["Raccourcis"] as? [Any], let data = try? JSONSerialization.data(withJSONObject: r), let t = String(data: data, encoding: .utf8) { reglages.poser("Raccourcis", t) }
            if let m = d["Moteur"] as? String, Reglages.moteurs.contains(where: { $0.id == m }) { reglages.poser("Moteur", m) }
            if let a = d["Accent"] as? String, a != reglages.s("Accent") {
                reglages.poser("Accent", a)
                DA.accent(a)
                Moteur.partage.majScripts()
                Fenetre.toutes.forEach { $0.toutRedessiner() }
            }
            reglages.poser("SynchroDate", date)
            reglages.enregistrer()
            derniereEmpreinte = empreinteProfil()
        } else if reglages.n("SynchroDate") > date {
            await envoyerProfil()
        }
        synchroEtat = "Synchronisé à " + DateFormatter.localizedString(from: Date(), dateStyle: .none, timeStyle: .short) + "."
        Fenetre.toutes.forEach { $0.envoyerEtatAuxPagesInternes() }
    }

    @MainActor
    func envoyerProfil() async {
        guard reglages.b("Synchro"), let jeton = await Compte.jeton() else { return }
        let (code, _) = await Compte.appeler("PUT", "/api/navigateur/profil", jeton: jeton, corps: ["donnees": profilSynchro(), "date": reglages.n("SynchroDate")])
        if code == 409 { await synchroniser(); return }
        if code == 200 { synchroEtat = "Synchronisé à " + DateFormatter.localizedString(from: Date(), dateStyle: .none, timeStyle: .short) + "." }
        envoyerEtatAuxPagesInternes()
    }
}
