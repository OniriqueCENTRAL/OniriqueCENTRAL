import AppKit
import WebKit

final class Onglet {
    var vue: WKWebView?
    var url = ""
    var titre = "Nouvel onglet"
    var charge = false
    var decharge = false
    var cacheDepuis = Date.distantFuture
    var observations: [NSKeyValueObservation] = []
}

/// Une fenêtre du navigateur : bandeau d'onglets (dans la barre de titre), barre d'outils, pages.
final class Fenetre: NSWindowController, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, NSTextFieldDelegate, WKDownloadDelegate {
    static var toutes: [Fenetre] = []
    static let accueil = "onirique://accueil/index.html"
    static let pageParametres = "onirique://accueil/parametres.html"
    static let pageHistorique = "onirique://accueil/historique.html"

    let reglages = Reglages.partages
    var onglets: [Onglet] = []
    var actif: Onglet?
    let racine = Racine()
    let bandeau = Bandeau()
    let barre = NSView()
    let zone = NSView()
    let champ = Champ()
    let suggestions = Suggestions()
    let bulle = Bulle()
    var boutons: [String: NSButton] = [:]
    private var minuteur: Timer?
    private var tour = 0
    var vpnEtat = "eteint"
    var dawOuvert: String?
    var synchroEtat = ""
    var derniereEmpreinte = ""
    var synchroAEnvoyer: Date?
    var synchroVue = Date.distantPast

    init(adresses: [String]) {
        let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 820),
                         styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView], backing: .buffered, defer: false)
        w.titlebarAppearsTransparent = true
        w.titleVisibility = .hidden
        w.backgroundColor = DA.nuit
        w.minSize = NSSize(width: 640, height: 400)
        w.isReleasedWhenClosed = false
        w.tabbingMode = .disallowed
        w.center()
        super.init(window: w)
        w.delegate = self
        w.contentView = racine
        racine.fenetre = self
        bandeau.fenetre = self
        construire()
        Fenetre.toutes.append(self)
        derniereEmpreinte = empreinteProfil()

        if !adresses.isEmpty { adresses.forEach { ouvrir(resoudre($0)) } }
        else if reglages.b("ReprendreSession"), let session = reglages.v["Session"] as? [[String: Any]], !session.isEmpty {
            // Les onglets de la dernière fois reviennent endormis : seul celui qu'on regarde se charge.
            for s in session {
                let o = Onglet()
                o.url = s["Url"] as? String ?? ""
                o.titre = s["Titre"] as? String ?? o.url
                o.decharge = true
                onglets.append(o)
            }
            activer(onglets[min(max(0, Int(reglages.n("SessionActif"))), onglets.count - 1)])
        } else { ouvrir(Fenetre.accueil) }

        minuteur = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in self?.entretien() }
        if reglages.b("Vpn") { Task { await self.allumerVpn() } }
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { Task { await self.synchroniser() } }
    }

    required init?(coder: NSCoder) { nil }

    // ——— Construction ———

    private func construire() {
        barre.wantsLayer = true
        barre.layer?.backgroundColor = DA.fond.cgColor
        zone.wantsLayer = true
        zone.layer?.backgroundColor = DA.nuit.cgColor
        for v in [zone, bandeau, barre, suggestions, bulle] as [NSView] { racine.addSubview(v) }
        suggestions.isHidden = true
        bulle.isHidden = true
        suggestions.quandChoisie = { [weak self] url in
            guard let self else { return }
            self.suggestions.isHidden = true
            if let v = self.actif?.vue { self.naviguer(v, url); self.window?.makeFirstResponder(v) }
        }

        func bouton(_ id: String, _ symbole: String, _ aide: String, _ action: Selector) {
            let b = NSButton(image: NSImage(systemSymbolName: symbole, accessibilityDescription: aide) ?? NSImage(), target: self, action: action)
            b.isBordered = false
            b.bezelStyle = .regularSquare
            b.imageScaling = .scaleProportionallyDown
            b.toolTip = aide
            b.contentTintColor = DA.brume
            boutons[id] = b
            barre.addSubview(b)
        }
        bouton("retour", "chevron.left", "Page précédente (⌘[)", #selector(retour))
        bouton("avance", "chevron.right", "Page suivante (⌘])", #selector(avance))
        bouton("recharger", "arrow.clockwise", "Actualiser (⌘R)", #selector(recharger))
        bouton("etoile", "star", "Ajouter à l'accueil", #selector(basculerFavori))
        bouton("vpn", "shield", "VPN ONIRIQUE : éteint", #selector(basculerVpn))
        bouton("historique", "clock.arrow.circlepath", "Historique (⌘Y)", #selector(ouvrirHistorique))
        bouton("reglages", "gearshape", "Paramètres (⌘,)", #selector(ouvrirParametres))
        bouton("studio", "waveform", "Mode Studio", #selector(montrerStudio))
        boutons["studio"]?.isHidden = true
        champ.delegate = self
        barre.addSubview(champ)
    }

    func disposer() {
        let l = racine.bounds.width, h = racine.bounds.height
        let hb: CGFloat = 40, ho: CGFloat = 44
        bandeau.frame = NSRect(x: 0, y: 0, width: l, height: hb)
        barre.frame = NSRect(x: 0, y: hb, width: l, height: ho)
        zone.frame = NSRect(x: 0, y: hb + ho, width: l, height: max(0, h - hb - ho))
        for o in onglets { o.vue?.frame = zone.bounds }
        var x: CGFloat = 10
        for id in ["retour", "avance", "recharger"] { boutons[id]?.frame = NSRect(x: x, y: 8, width: 30, height: 28); x += 32 }
        var droite = l - 10
        for id in ["reglages", "historique", "vpn", "studio"] where boutons[id]?.isHidden == false {
            droite -= 30
            boutons[id]?.frame = NSRect(x: droite, y: 8, width: 30, height: 28)
            droite -= 4
        }
        let etoileVisible = boutons["etoile"]?.isHidden == false
        champ.frame = NSRect(x: x + 6, y: 7, width: max(0, droite - x - 12 - (etoileVisible ? 34 : 0)), height: 30)
        boutons["etoile"]?.frame = NSRect(x: champ.frame.maxX + 4, y: 8, width: 30, height: 28)
        bulle.placer(dans: racine.bounds)
        bandeau.needsDisplay = true
    }

    // ——— Onglets ———

    static func estInterne(_ url: String) -> Bool { url.hasPrefix("onirique://") }

    func possede(_ vue: WKWebView) -> Bool { onglets.contains { $0.vue === vue } }

    @discardableResult
    func ouvrir(_ url: String?, position: Int? = nil, configuration: WKWebViewConfiguration? = nil) -> Onglet {
        let o = Onglet()
        o.url = url ?? ""
        onglets.insert(o, at: min(position ?? onglets.count, onglets.count))
        creer(o, configuration: configuration)
        if let url, let u = URL(string: url) { o.vue?.load(URLRequest(url: u)) }
        activer(o)
        return o
    }

    private func creer(_ o: Onglet, configuration: WKWebViewConfiguration? = nil) {
        let v = WKWebView(frame: zone.bounds, configuration: configuration ?? Moteur.partage.configuration())
        v.navigationDelegate = self
        v.uiDelegate = self
        v.allowsBackForwardNavigationGestures = true
        v.allowsMagnification = true
        v.isHidden = true
        v.underPageBackgroundColor = DA.nuit
        v.appearance = NSAppearance(named: reglages.b("SitesSombres") ? .darkAqua : .aqua)
        if #available(macOS 13.3, *) { v.isInspectable = true }
        zone.addSubview(v)
        o.vue = v
        o.observations = [
            v.observe(\.title) { [weak self, weak o] v, _ in
                guard let self, let o else { return }
                if let t = v.title, !t.isEmpty { o.titre = t }
                self.bandeau.needsDisplay = true
                if o === self.actif { self.afficher() }
            },
            v.observe(\.url) { [weak self, weak o] v, _ in
                guard let self, let o else { return }
                o.url = v.url?.absoluteString ?? o.url
                if o === self.actif { self.afficher() }
            },
            v.observe(\.isLoading) { [weak self, weak o] v, _ in
                guard let self, let o else { return }
                o.charge = v.isLoading
                self.bandeau.needsDisplay = true
                if o === self.actif { self.afficher() }
            },
            v.observe(\.canGoBack) { [weak self] _, _ in self?.afficher() },
        ]
    }

    func activer(_ o: Onglet) {
        if let a = actif, a !== o { a.cacheDepuis = Date(); a.vue?.isHidden = true }
        actif = o
        o.cacheDepuis = .distantFuture
        if o.vue == nil {
            o.decharge = false
            creer(o)
            if let u = URL(string: o.url.isEmpty ? Fenetre.accueil : o.url) { o.vue?.load(URLRequest(url: u)) }
        }
        o.vue?.isHidden = false
        o.vue?.frame = zone.bounds
        if let v = o.vue { window?.makeFirstResponder(v) }
        afficher()
    }

    func fermer(_ o: Onglet) {
        guard let i = onglets.firstIndex(where: { $0 === o }) else { return }
        onglets.remove(at: i)
        o.observations = []
        o.vue?.removeFromSuperview()
        o.vue = nil
        if onglets.isEmpty { window?.close(); return }
        if actif === o { actif = nil; activer(onglets[min(i, onglets.count - 1)]) }
        bandeau.needsDisplay = true
    }

    func decharger(_ o: Onglet) {
        o.observations = []
        o.vue?.removeFromSuperview()
        o.vue = nil
        o.decharge = true
        bandeau.needsDisplay = true
    }

    func decaler(_ sens: Int) {
        guard !onglets.isEmpty else { return }
        let i = actif.flatMap { a in onglets.firstIndex { $0 === a } } ?? 0
        activer(onglets[(i + sens + onglets.count) % onglets.count])
    }

    func afficher() {
        let v = actif?.vue
        boutons["retour"]?.isEnabled = v?.canGoBack == true
        boutons["avance"]?.isEnabled = v?.canGoForward == true
        boutons["retour"]?.contentTintColor = v?.canGoBack == true ? DA.brume : DA.eteint
        boutons["avance"]?.contentTintColor = v?.canGoForward == true ? DA.brume : DA.eteint
        boutons["recharger"]?.image = NSImage(systemSymbolName: actif?.charge == true ? "xmark" : "arrow.clockwise", accessibilityDescription: "Actualiser")
        let interne = actif.map { Fenetre.estInterne($0.url) || $0.url.isEmpty } ?? true
        if window?.firstResponder !== champ.currentEditor() { champ.stringValue = interne ? "" : (actif?.url ?? "") }
        window?.title = interne ? "ONIRIQUE" : (actif?.titre ?? "ONIRIQUE")
        majEtoile()
        bandeau.needsDisplay = true
    }

    func naviguer(_ vue: WKWebView, _ url: String) {
        if let u = URL(string: url) { vue.load(URLRequest(url: u)) }
    }

    func resoudre(_ texte: String) -> String {
        let s = texte.trimmingCharacters(in: .whitespaces)
        if let u = URL(string: s), let sch = u.scheme?.lowercased(), ["http", "https", "file"].contains(sch), u.host != nil || sch == "file" { return s }
        if !s.contains(" "), let u = URL(string: "http://" + s), let h = u.host, h == "localhost" || h.contains(".") {
            return (h == "localhost" ? "http://" : "https://") + s
        }
        return reglages.recherche(s)
    }

    // ——— Actions ———

    @objc func retour() { actif?.vue?.goBack() }
    @objc func avance() { actif?.vue?.goForward() }
    @objc func recharger() { if actif?.charge == true { actif?.vue?.stopLoading() } else { actif?.vue?.reload() } }
    @objc func nouvelOnglet() { ouvrir(Fenetre.accueil) }
    @objc func fermerOnglet() { if let a = actif { fermer(a) } }
    @objc func ongletSuivant() { decaler(1) }
    @objc func ongletPrecedent() { decaler(-1) }
    @objc func allerBarreAdresse() { window?.makeFirstResponder(champ); champ.currentEditor()?.selectAll(nil) }
    @objc func ouvrirParametres() { ouvrirInterne(Fenetre.pageParametres) }
    @objc func ouvrirHistorique() { ouvrirInterne(Fenetre.pageHistorique) }
    @objc func montrerStudio() { if let d = dawOuvert { bulle.montrer("Mode Studio : \(d) est ouvert, les onglets cachés se libèrent vite pour lui laisser la machine.") } }

    func ouvrirInterne(_ page: String) {
        if let o = onglets.first(where: { $0.url.hasPrefix(page) }) { activer(o) }
        else { ouvrir(page, position: actif.flatMap { a in onglets.firstIndex { $0 === a } }.map { $0 + 1 }) }
    }

    // ——— Barre d'adresse et suggestions ———

    func controlTextDidChange(_ obj: Notification) { proposerSuggestions() }

    func control(_ control: NSControl, textView: NSTextView, doCommandBy commande: Selector) -> Bool {
        switch commande {
        case #selector(NSResponder.insertNewline(_:)):
            let cible = suggestions.selection ?? resoudre(champ.stringValue)
            suggestions.isHidden = true
            if !champ.stringValue.trimmingCharacters(in: .whitespaces).isEmpty, let v = actif?.vue { naviguer(v, cible); window?.makeFirstResponder(v) }
            return true
        case #selector(NSResponder.moveDown(_:)) where !suggestions.isHidden: suggestions.deplacer(1); return true
        case #selector(NSResponder.moveUp(_:)) where !suggestions.isHidden: suggestions.deplacer(-1); return true
        case #selector(NSResponder.cancelOperation(_:)):
            suggestions.isHidden = true
            if let v = actif?.vue { window?.makeFirstResponder(v) }
            afficher()
            return true
        default: return false
        }
    }

    func controlTextDidEndEditing(_ obj: Notification) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { self.suggestions.isHidden = true }
    }

    private func proposerSuggestions() {
        let texte = champ.stringValue.trimmingCharacters(in: .whitespaces)
        guard !texte.isEmpty else { suggestions.isHidden = true; return }
        let mots = texte.lowercased().split(separator: " ").map(String.init)
        let direct = resoudre(texte)
        let recherche = direct == reglages.recherche(texte)
        var lignes: [Suggestions.Ligne] = [.init(titre: recherche ? "Rechercher « \(texte) »" : "Aller à \(texte)", detail: "", url: direct, symbole: recherche ? "magnifyingglass" : "globe")]
        for s in sites(reglages.raccourcis()) where lignes.count < 4 {
            let n = s["nom"] as? String ?? "", u = s["url"] as? String ?? ""
            if mots.allSatisfy({ (n + " " + u).lowercased().contains($0) }) { lignes.append(.init(titre: n, detail: u, url: u, symbole: "star")) }
        }
        for h in Historique.suggerer(texte, nombre: 8) where lignes.count < 7 && !lignes.contains(where: { cle($0.url) == cle(h.u) }) {
            lignes.append(.init(titre: h.ti.isEmpty ? h.u : h.ti, detail: h.u, url: h.u, symbole: "clock"))
        }
        suggestions.montrer(lignes, sous: champ.frame.offsetBy(dx: 0, dy: barre.frame.minY))
    }

    // ——— Favoris : l'étoile met la page sur l'accueil (ou l'en retire) ———

    func cle(_ url: String) -> String { url.trimmingCharacters(in: .whitespaces).trimmingCharacters(in: CharacterSet(charactersIn: "/")).lowercased() }

    func sites(_ liste: [Any]) -> [[String: Any]] {
        liste.compactMap { $0 as? [String: Any] }.flatMap { x -> [[String: Any]] in
            (x["type"] as? String) == "dossier" ? ((x["elements"] as? [Any]) ?? []).compactMap { $0 as? [String: Any] } : [x]
        }
    }

    func majEtoile() {
        let url = actif?.url ?? ""
        let web = url.hasPrefix("http")
        let favori = web && sites(reglages.raccourcis()).contains { cle($0["url"] as? String ?? "") == cle(url) }
        boutons["etoile"]?.isHidden = !web
        boutons["etoile"]?.image = NSImage(systemSymbolName: favori ? "star.fill" : "star", accessibilityDescription: "Favori")
        boutons["etoile"]?.contentTintColor = favori ? DA.braiseClaire : DA.cendre
        boutons["etoile"]?.toolTip = favori ? "Retirer de l'accueil" : "Ajouter à l'accueil"
    }

    @objc func basculerFavori() {
        guard let o = actif else { return }
        var liste = reglages.raccourcis()
        let c = cle(o.url)
        var retire = false
        for i in stride(from: liste.count - 1, through: 0, by: -1) {
            guard var x = liste[i] as? [String: Any] else { continue }
            if (x["type"] as? String) == "dossier", var el = x["elements"] as? [Any] {
                let avant = el.count
                el.removeAll { cle(($0 as? [String: Any])?["url"] as? String ?? "") == c }
                if el.count != avant { retire = true }
                // Un dossier qui n'a plus qu'un site redevient ce site ; vide, il disparaît (comme sur l'accueil).
                if el.count == 1 { liste[i] = el[0] } else if el.isEmpty { liste.remove(at: i) } else { x["elements"] = el; liste[i] = x }
            } else if cle(x["url"] as? String ?? "") == c { liste.remove(at: i); retire = true }
        }
        if !retire {
            var nom = o.titre.trimmingCharacters(in: .whitespaces)
            if nom.isEmpty || nom.count > 28 { nom = (URL(string: o.url)?.host ?? o.url).replacingOccurrences(of: "www.", with: "") }
            liste.append(["type": "site", "nom": nom, "url": o.url])
        }
        enregistrerRaccourcis(liste)
        majEtoile()
        bulle.montrer(retire ? "Retiré de ton accueil." : "Ajouté à ton accueil.")
    }

    func enregistrerRaccourcis(_ liste: [Any]) {
        if let d = try? JSONSerialization.data(withJSONObject: liste), let t = String(data: d, encoding: .utf8) { reglages.poser("Raccourcis", t) }
        reglages.enregistrer()
        Fenetre.toutes.forEach { $0.envoyerEtatAuxPagesInternes() }
        profilChange()
    }

    // ——— Navigation (WebKit) ———

    func onglet(de vue: WKWebView) -> Onglet? { onglets.first { $0.vue === vue } }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard let url = webView.url?.absoluteString, !Fenetre.estInterne(url) else { return }
        // Le titre arrive souvent juste après la page : l'historique attend un instant avant de l'écrire.
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak webView] in
            guard let webView, webView.url?.absoluteString == url else { return }
            Historique.ajouter(url, webView.title ?? "")
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor reponse: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        decisionHandler(reponse.canShowMIMEType ? .allow : .download)
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        decisionHandler(action.shouldPerformDownload ? .download : .allow)
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }
    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        let dossier = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask)[0]
        var cible = dossier.appendingPathComponent(suggestedFilename)
        var n = 1
        while FileManager.default.fileExists(atPath: cible.path) {
            let base = (suggestedFilename as NSString).deletingPathExtension, ext = (suggestedFilename as NSString).pathExtension
            cible = dossier.appendingPathComponent("\(base) (\(n))" + (ext.isEmpty ? "" : ".\(ext)"))
            n += 1
        }
        completionHandler(cible)
        bulle.montrer("Téléchargement : \(cible.lastPathComponent)")
    }

    func downloadDidFinish(_ download: WKDownload) { bulle.montrer("Téléchargement terminé, dans Téléchargements.") }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        let position = onglet(de: webView).flatMap { o in onglets.firstIndex { $0 === o } }.map { $0 + 1 }
        return ouvrir(nil, position: position, configuration: configuration).vue
    }

    func webViewDidClose(_ webView: WKWebView) { if let o = onglet(de: webView) { fermer(o) } }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let a = NSAlert()
        a.messageText = message
        a.beginSheetModal(for: window!) { _ in completionHandler() }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let a = NSAlert()
        a.messageText = message
        a.addButton(withTitle: "OK")
        a.addButton(withTitle: "Annuler")
        a.beginSheetModal(for: window!) { r in completionHandler(r == .alertFirstButtonReturn) }
    }

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let p = NSOpenPanel()
        p.allowsMultipleSelection = parameters.allowsMultipleSelection
        p.canChooseDirectories = parameters.allowsDirectories
        p.beginSheetModal(for: window!) { r in completionHandler(r == .OK ? p.urls : nil) }
    }

    // ——— Entretien : libération des onglets cachés, Mode Studio, synchronisation ———

    static let daws = ["Logic Pro", "Ableton Live", "FL Studio", "REAPER", "Cubase", "Studio One", "Bitwig Studio", "Pro Tools", "GarageBand", "Reason", "Live"]
    var studioActif: Bool { reglages.b("ModeStudio") && dawOuvert != nil }

    private func entretien() {
        tour += 1
        if tour % 2 == 0 { surveillerStudio() }
        // WebKit endort lui-même les pages cachées ; au bout du délai, elles sont libérées (2 min en Mode Studio).
        let minutes = studioActif ? 2 : Int(reglages.n("DechargementMinutes"))
        if minutes > 0 {
            for o in onglets where o !== actif && o.vue != nil && Date().timeIntervalSince(o.cacheDepuis) > Double(minutes * 60) { decharger(o) }
        }
        if let quand = synchroAEnvoyer, Date() > quand { synchroAEnvoyer = nil; Task { await envoyerProfil() } }
        if Date().timeIntervalSince(synchroVue) > 600 { Task { await synchroniser() } }
    }

    private func surveillerStudio() {
        var trouve: String?
        if reglages.b("ModeStudio") {
            for app in NSWorkspace.shared.runningApplications {
                guard let nom = app.localizedName else { continue }
                if let d = Fenetre.daws.first(where: { nom.hasPrefix($0) && ($0 != "Live" || nom == "Live") }) { trouve = d == "Live" ? "Ableton Live" : d; break }
            }
        }
        guard trouve != dawOuvert else { return }
        dawOuvert = trouve
        boutons["studio"]?.isHidden = !studioActif
        boutons["studio"]?.contentTintColor = DA.braiseClaire
        disposer()
        if let trouve { bulle.montrer("Mode Studio : \(trouve) est ouvert, les onglets cachés se libèrent vite pour lui laisser la machine.") }
        envoyerEtatAuxPagesInternes()
    }

    // ——— Fenêtre ———

    func windowDidResize(_ notification: Notification) { disposer() }
    func windowDidBecomeKey(_ notification: Notification) { bandeau.needsDisplay = true }

    func windowWillClose(_ notification: Notification) {
        sauverSession()
        minuteur?.invalidate()
        for o in onglets { o.observations = []; o.vue?.removeFromSuperview(); o.vue = nil }
        Fenetre.toutes.removeAll { $0 === self }
    }

    func sauverSession() {
        let web = onglets.filter { !Fenetre.estInterne($0.url) && !$0.url.isEmpty }
        reglages.poser("Session", web.map { ["Url": $0.url, "Titre": $0.titre] })
        reglages.poser("SessionActif", actif.flatMap { a in web.firstIndex { $0 === a } } ?? 0)
        reglages.enregistrer()
    }

    func toutRedessiner() {
        bandeau.needsDisplay = true
        champ.needsDisplay = true
        bulle.needsDisplay = true
        suggestions.needsDisplay = true
        afficher()
        Fenetre.toutes.forEach { $0.majVpn() }
    }
}

/// La vue racine : en coordonnées retournées (le haut en premier), elle redispose tout quand la fenêtre change.
final class Racine: NSView {
    weak var fenetre: Fenetre?
    override var isFlipped: Bool { true }
    override func layout() { super.layout(); fenetre?.disposer() }
    override func draw(_ dirtyRect: NSRect) { DA.nuit.setFill(); dirtyRect.fill() }
}

/// La barre d'adresse : la nuit, un filet, et l'accent quand on y écrit.
/// Le texte de la barre d'adresse, avec sa marge et centré en hauteur.
final class CelluleChamp: NSTextFieldCell {
    private func interieur(_ r: NSRect) -> NSRect {
        let h = ceil((font ?? .systemFont(ofSize: 13.5)).boundingRectForFont.height)
        return NSRect(x: r.minX + 12, y: r.minY + (r.height - h) / 2, width: max(0, r.width - 24), height: h)
    }
    override func drawingRect(forBounds r: NSRect) -> NSRect { interieur(r) }
    override func edit(withFrame r: NSRect, in v: NSView, editor t: NSText, delegate d: Any?, event e: NSEvent?) {
        super.edit(withFrame: interieur(r), in: v, editor: t, delegate: d, event: e)
    }
    override func select(withFrame r: NSRect, in v: NSView, editor t: NSText, delegate d: Any?, start s: Int, length l: Int) {
        super.select(withFrame: interieur(r), in: v, editor: t, delegate: d, start: s, length: l)
    }
}

final class Champ: NSTextField {
    override class var cellClass: AnyClass? { get { CelluleChamp.self } set {} }

    override init(frame: NSRect) {
        super.init(frame: frame)
        isBordered = false
        drawsBackground = false
        focusRingType = .none
        textColor = DA.brume
        font = .systemFont(ofSize: 13.5)
        placeholderAttributedString = NSAttributedString(string: "Rechercher sur le web ou saisir une adresse",
                                                         attributes: [.foregroundColor: DA.eteint, .font: NSFont.systemFont(ofSize: 13.5)])
        cell?.usesSingleLineMode = true
        cell?.isScrollable = true
        cell?.lineBreakMode = .byTruncatingTail
        wantsLayer = true
    }
    required init?(coder: NSCoder) { nil }
    convenience init() { self.init(frame: .zero) }

    override func draw(_ dirtyRect: NSRect) {
        let forme = NSBezierPath(roundedRect: bounds.insetBy(dx: 0.5, dy: 0.5), xRadius: 10, yRadius: 10)
        DA.nuit.setFill()
        forme.fill()
        (currentEditor() != nil ? DA.braiseClaire.withAlphaComponent(0.7) : DA.filet).setStroke()
        forme.stroke()
        super.draw(dirtyRect.insetBy(dx: 0, dy: 0))
    }

    override func becomeFirstResponder() -> Bool {
        let ok = super.becomeFirstResponder()
        needsDisplay = true
        DispatchQueue.main.async { self.currentEditor()?.selectAll(nil) }
        return ok
    }

    override func textDidEndEditing(_ notification: Notification) { super.textDidEndEditing(notification); needsDisplay = true }
}
