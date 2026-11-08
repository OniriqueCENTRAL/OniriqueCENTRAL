import AppKit

final class Delegue: NSObject, NSApplicationDelegate {
    private var liensEnAttente: [String] = []
    private var pret = false

    func applicationDidFinishLaunching(_ n: Notification) {
        NSApp.appearance = NSAppearance(named: .darkAqua)
        DA.accent(Reglages.partages.s("Accent") ?? "#e5384a")
        _ = Moteur.partage
        construireMenu()
        MiseAJour.nettoyer()
        if Reglages.partages.b("Vpn") { Vpn.poser(Reglages.partages.s("VpnRelais")) }
        pret = true
        nouvelleFenetre(liensEnAttente)
        liensEnAttente = []
        if Reglages.partages.b("MisesAJour") { Task { _ = await MiseAJour.chercher(silencieux: true) } }
        Timer.scheduledTimer(withTimeInterval: 6 * 3600, repeats: true) { _ in
            if Reglages.partages.b("MisesAJour") { Task { _ = await MiseAJour.chercher(silencieux: true) } }
        }
    }

    // Les liens ouverts depuis les autres applications, quand ONIRIQUE est le navigateur par défaut.
    func application(_ application: NSApplication, open urls: [URL]) {
        let liens = urls.map(\.absoluteString)
        guard pret else { liensEnAttente += liens; return }
        if let f = Fenetre.toutes.first { liens.forEach { f.ouvrir(f.resoudre($0)) }; f.window?.makeKeyAndOrderFront(nil) }
        else { nouvelleFenetre(liens) }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    func applicationWillTerminate(_ n: Notification) {
        Fenetre.toutes.forEach { $0.sauverSession() }
        MiseAJour.remplacerEnPartant(rouvrir: false)
    }

    @objc func nouvelleFenetre(_ liens: [String] = []) {
        let f = Fenetre(adresses: liens)
        f.showWindow(nil)
        f.window?.makeKeyAndOrderFront(nil)
    }

    @objc func menuNouvelleFenetre() { nouvelleFenetre([]) }
    @objc func aPropos() { NSApp.orderFrontStandardAboutPanel(nil) }

    private var active: Fenetre? { (NSApp.keyWindow?.windowController as? Fenetre) ?? Fenetre.toutes.first }
    @objc func nouvelOnglet() { if let f = active { f.nouvelOnglet() } else { nouvelleFenetre([]) } }
    @objc func fermerOnglet() { active?.fermerOnglet() }
    @objc func recharger() { active?.recharger() }
    @objc func barreAdresse() { active?.allerBarreAdresse() }
    @objc func parametres() { active?.ouvrirParametres() }
    @objc func historique() { active?.ouvrirHistorique() }
    @objc func retour() { active?.retour() }
    @objc func avance() { active?.avance() }
    @objc func suivant() { active?.ongletSuivant() }
    @objc func precedent() { active?.ongletPrecedent() }

    private func construireMenu() {
        let principal = NSMenu()
        func menu(_ titre: String, _ elements: [NSMenuItem]) {
            let item = NSMenuItem(title: titre, action: nil, keyEquivalent: "")
            let m = NSMenu(title: titre)
            elements.forEach { m.addItem($0) }
            item.submenu = m
            principal.addItem(item)
        }
        func el(_ titre: String, _ action: Selector?, _ touche: String, _ mods: NSEvent.ModifierFlags = .command, cible: AnyObject? = nil) -> NSMenuItem {
            let i = NSMenuItem(title: titre, action: action, keyEquivalent: touche)
            i.keyEquivalentModifierMask = mods
            i.target = cible
            return i
        }
        menu("ONIRIQUE", [
            el("À propos d'ONIRIQUE Navigateur", #selector(aPropos), "", cible: self),
            .separator(),
            el("Paramètres…", #selector(parametres), ",", cible: self),
            .separator(),
            el("Masquer ONIRIQUE", #selector(NSApplication.hide(_:)), "h"),
            el("Masquer les autres", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option]),
            .separator(),
            el("Quitter ONIRIQUE", #selector(NSApplication.terminate(_:)), "q"),
        ])
        menu("Fichier", [
            el("Nouvel onglet", #selector(nouvelOnglet), "t", cible: self),
            el("Nouvelle fenêtre", #selector(menuNouvelleFenetre), "n", cible: self),
            el("Ouvrir l'adresse", #selector(barreAdresse), "l", cible: self),
            .separator(),
            el("Fermer l'onglet", #selector(fermerOnglet), "w", cible: self),
        ])
        menu("Édition", [
            el("Annuler", Selector(("undo:")), "z"),
            el("Rétablir", Selector(("redo:")), "z", [.command, .shift]),
            .separator(),
            el("Couper", #selector(NSText.cut(_:)), "x"),
            el("Copier", #selector(NSText.copy(_:)), "c"),
            el("Coller", #selector(NSText.paste(_:)), "v"),
            el("Tout sélectionner", #selector(NSText.selectAll(_:)), "a"),
        ])
        menu("Présentation", [
            el("Actualiser", #selector(recharger), "r", cible: self),
            .separator(),
            el("Onglet suivant", #selector(suivant), "}", cible: self),
            el("Onglet précédent", #selector(precedent), "{", cible: self),
            .separator(),
            el("Plein écran", #selector(NSWindow.toggleFullScreen(_:)), "f", [.command, .control]),
        ])
        menu("Historique", [
            el("Page précédente", #selector(retour), "[", cible: self),
            el("Page suivante", #selector(avance), "]", cible: self),
            .separator(),
            el("Afficher l'historique", #selector(historique), "y", cible: self),
        ])
        let fenetres = NSMenu(title: "Fenêtre")
        fenetres.addItem(el("Réduire", #selector(NSWindow.performMiniaturize(_:)), "m"))
        fenetres.addItem(el("Agrandir", #selector(NSWindow.performZoom(_:)), ""))
        let itemFenetres = NSMenuItem(title: "Fenêtre", action: nil, keyEquivalent: "")
        itemFenetres.submenu = fenetres
        principal.addItem(itemFenetres)
        NSApp.windowsMenu = fenetres
        NSApp.mainMenu = principal
    }
}

/// La mise à jour automatique : la nouvelle version est téléchargée et vérifiée pendant qu'on navigue, puis
/// remplace l'application quand on la quitte (même script que l'application CENTRAL, éprouvé à la compilation).
enum MiseAJour {
    static let manifeste = URL(string: "https://onirique.store/telechargement/navigateur-mac.json")!
    static var prete: String?
    private static var nouvelleApp: URL?
    private static let etape = Chemins.dossier.appendingPathComponent("mise-a-jour", isDirectory: true)

    /// Seule une application rangée dans un dossier où l'on peut écrire (Applications, en général) se remplace elle-même.
    static var installable: Bool {
        let app = Bundle.main.bundleURL
        return app.pathExtension == "app" && FileManager.default.isWritableFile(atPath: app.deletingLastPathComponent().path)
    }

    static func nettoyer() { if prete == nil { try? FileManager.default.removeItem(at: etape) } }

    static func chercher(silencieux: Bool) async -> String {
        if prete != nil { return "prete" }
        guard installable else { return "portable" }
        guard let (d, _) = try? await URLSession.shared.data(from: manifeste),
              let json = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
              let version = json["version"] as? String, let lien = json["url"] as? String, let attendu = json["sha256"] as? String,
              lien.hasPrefix("https://onirique.store/telechargement/"), let url = URL(string: lien) else { return silencieux ? "a-jour" : "erreur" }
        guard version.compare(versionDuNavigateur, options: .numeric) == .orderedDescending else { return "a-jour" }
        guard let (fichier, _) = try? await URLSession.shared.download(from: url) else { return "erreur" }
        guard empreinteSHA256(fichier)?.lowercased() == attendu.lowercased() else { try? FileManager.default.removeItem(at: fichier); return "erreur" }
        try? FileManager.default.removeItem(at: etape)
        try? FileManager.default.createDirectory(at: etape, withIntermediateDirectories: true)
        let ditto = Process()
        ditto.executableURL = URL(fileURLWithPath: "/usr/bin/ditto")
        ditto.arguments = ["-x", "-k", fichier.path, etape.path]
        do { try ditto.run() } catch { return "erreur" }
        ditto.waitUntilExit()
        try? FileManager.default.removeItem(at: fichier)
        let app = etape.appendingPathComponent(Bundle.main.bundleURL.lastPathComponent)
        guard ditto.terminationStatus == 0, FileManager.default.fileExists(atPath: app.path) else { return "erreur" }
        nouvelleApp = app
        prete = version
        await MainActor.run {
            Fenetre.toutes.first?.bulle.montrer("La version \(version) est prête : elle s'ouvrira au prochain lancement.", action: "Redémarrer") {
                remplacerEnPartant(rouvrir: true)
                NSApp.terminate(nil)
            }
        }
        return "prete"
    }

    private static var lance = false
    static func remplacerEnPartant(rouvrir: Bool) {
        guard let nouvelle = nouvelleApp, !lance else { return }
        lance = true
        let script = """
        APP=$2
        NEW="$2.new"
        OLD="$2.old"
        STAGE=$4
        REOPEN=$5
        finish() { if [ "$REOPEN" = 1 ]; then open "$APP"; fi; exit "$1"; }
        while kill -0 "$1" 2>/dev/null; do sleep 0.2; done
        rm -rf "$NEW" "$OLD"
        ditto "$3" "$NEW" || { rm -rf "$NEW"; finish 1; }
        mv "$APP" "$OLD" || { rm -rf "$NEW"; finish 1; }
        if mv "$NEW" "$APP"; then rm -rf "$OLD" "$STAGE"; else mv "$OLD" "$APP"; finish 1; fi
        finish 0
        """
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/sh")
        p.arguments = ["-c", script, "sh", String(ProcessInfo.processInfo.processIdentifier), Bundle.main.bundlePath, nouvelle.path, etape.path, rouvrir ? "1" : "0"]
        try? p.run()
    }
}

