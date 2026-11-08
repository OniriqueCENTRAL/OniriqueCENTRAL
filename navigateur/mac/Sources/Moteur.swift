import AppKit
import Network
import WebKit

// Le moteur WebKit partagé par toutes les fenêtres : une seule configuration (scripts, bloqueur, pages internes).
// Les pages internes (accueil, paramètres, historique) sont les mêmes fichiers que sur Windows : elles parlent au
// navigateur par window.chrome.webview, que le pont ci-dessous fournit au-dessus de WebKit.

final class Moteur: NSObject, WKScriptMessageHandler {
    static let partage = Moteur()
    let controleur = WKUserContentController()
    let pool = WKProcessPool()
    let schema = Schema()
    private var regles: WKContentRuleList?
    private lazy var scriptGoogle: String = (try? String(contentsOf: Chemins.pages.appendingPathComponent("google.js"), encoding: .utf8)) ?? ""

    private static let pont = """
    (() => {
      if (location.protocol !== 'onirique:') return;
      const ecouteurs = [];
      window.chrome = { webview: {
        postMessage: (m) => window.webkit.messageHandlers.onirique.postMessage(JSON.stringify(m)),
        addEventListener: (type, f) => { if (type === 'message') ecouteurs.push(f); },
      } };
      window.__oniriqueRecevoir = (m) => ecouteurs.forEach((f) => f({ data: m }));
    })();
    """

    override init() {
        super.init()
        controleur.add(self, name: "onirique")
        majScripts()
        majBloqueur()
    }

    func configuration() -> WKWebViewConfiguration {
        let c = WKWebViewConfiguration()
        c.processPool = pool
        c.userContentController = controleur
        c.websiteDataStore = .default()
        c.setURLSchemeHandler(schema, forURLScheme: "onirique")
        c.preferences.isElementFullscreenEnabled = true
        c.applicationNameForUserAgent = "Version/17.0 Safari/605.1.15 ONIRIQUE"
        return c
    }

    /// Le script Google porte l'accent choisi : il est remis à chaque changement de couleur ou de réglage.
    func majScripts() {
        controleur.removeAllUserScripts()
        controleur.addUserScript(WKUserScript(source: Moteur.pont, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        if Reglages.partages.b("GoogleOnirique") && !scriptGoogle.isEmpty {
            let accent = "window.__ONIRIQUE_ACCENT={acc:\"\(DA.triplet(DA.braise))\",hi:\"\(DA.triplet(DA.braiseClaire))\",lo:\"\(DA.triplet(DA.sang))\"};\n"
            controleur.addUserScript(WKUserScript(source: accent + scriptGoogle, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
    }

    /// Le bloqueur : WebKit écarte lui-même les requêtes vers les régies listées (accueil/pubs.txt), sans rien ralentir.
    func majBloqueur() {
        controleur.removeAllContentRuleLists()
        guard Reglages.partages.b("Bloqueur") else { return }
        if let r = regles { controleur.add(r); return }
        let domaines = ((try? String(contentsOf: Chemins.pages.appendingPathComponent("pubs.txt"), encoding: .utf8)) ?? "")
            .split(separator: "\n").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty && !$0.hasPrefix("#") }
        let liste = domaines.map { d -> [String: Any] in
            let motif = "^https?://([^/]*\\.)?" + NSRegularExpression.escapedPattern(for: d) + "[:/]"
            return ["trigger": ["url-filter": motif], "action": ["type": "block"]]
        }
        guard let json = try? JSONSerialization.data(withJSONObject: liste), let texte = String(data: json, encoding: .utf8) else { return }
        WKContentRuleListStore.default().compileContentRuleList(forIdentifier: "onirique-pubs", encodedContentRuleList: texte) { [weak self] r, _ in
            guard let self, let r else { return }
            self.regles = r
            if Reglages.partages.b("Bloqueur") { self.controleur.add(r) }
        }
    }

    // Les messages des pages internes : seules les pages onirique:// sont écoutées.
    func userContentController(_ uc: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.securityOrigin.protocol == "onirique", let vue = message.webView, let texte = message.body as? String,
              let d = texte.data(using: .utf8), let valeur = try? JSONSerialization.jsonObject(with: d, options: [.fragmentsAllowed]) else { return }
        guard let fenetre = Fenetre.toutes.first(where: { $0.possede(vue) }) else { return }
        if let recherche = valeur as? String {
            if !recherche.trimmingCharacters(in: .whitespaces).isEmpty { fenetre.naviguer(vue, fenetre.resoudre(recherche)) }
        } else if let commande = valeur as? [String: Any] {
            fenetre.commande(vue, commande)
        }
    }

    static func envoyer(_ vue: WKWebView, _ message: [String: Any]) {
        guard let d = try? JSONSerialization.data(withJSONObject: message), let json = String(data: d, encoding: .utf8) else { return }
        vue.evaluateJavaScript("window.__oniriqueRecevoir && window.__oniriqueRecevoir(\(json))", completionHandler: nil)
    }
}

/// Sert les pages internes (onirique://accueil/…) depuis l'application, et le fond choisi (onirique://fichiers/…).
final class Schema: NSObject, WKURLSchemeHandler {
    func webView(_ webView: WKWebView, start tache: WKURLSchemeTask) {
        guard let url = tache.request.url else { return }
        let base: URL
        switch url.host {
        case "accueil": base = Chemins.pages
        case "fichiers": base = Chemins.fichiers
        default: tache.didFailWithError(URLError(.fileDoesNotExist)); return
        }
        var chemin = url.path
        if chemin.isEmpty || chemin == "/" { chemin = "/index.html" }
        let fichier = base.appendingPathComponent(String(chemin.dropFirst())).standardizedFileURL
        guard fichier.path.hasPrefix(base.standardizedFileURL.path), let donnees = try? Data(contentsOf: fichier) else {
            tache.didFailWithError(URLError(.fileDoesNotExist))
            return
        }
        let types = ["html": "text/html; charset=utf-8", "js": "text/javascript; charset=utf-8", "json": "application/json", "css": "text/css",
                     "png": "image/png", "jpg": "image/jpeg", "webp": "image/webp", "gif": "image/gif", "woff2": "font/woff2", "txt": "text/plain"]
        let entetes = ["Content-Type": types[fichier.pathExtension.lowercased()] ?? "application/octet-stream", "Cache-Control": "no-cache"]
        tache.didReceive(HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: entetes)!)
        tache.didReceive(donnees)
        tache.didFinish()
    }

    func webView(_ webView: WKWebView, stop tache: WKURLSchemeTask) {}
}

/// Le compte ONIRIQUE : son jeton est celui que le site garde dans le navigateur (onirique.token), lu sur une page cachée.
enum Compte {
    private static var vueCachee: WKWebView?
    private static var lecteur: LecteurDeJeton?

    static func jeton() async -> String? {
        await withCheckedContinuation { (suite: CheckedContinuation<String?, Never>) in
            DispatchQueue.main.async {
                let vue = WKWebView(frame: .zero, configuration: Moteur.partage.configuration())
                let l = LecteurDeJeton { j in
                    suite.resume(returning: j)
                    vueCachee = nil
                    lecteur = nil
                }
                vue.navigationDelegate = l
                vueCachee = vue
                lecteur = l
                vue.load(URLRequest(url: URL(string: "https://onirique.store/robots.txt")!))
                DispatchQueue.main.asyncAfter(deadline: .now() + 10) { l.finir(nil) }
            }
        }
    }

    static func appeler(_ methode: String, _ chemin: String, jeton: String, corps: [String: Any]? = nil) async -> (Int, [String: Any]?) {
        var r = URLRequest(url: URL(string: "https://onirique.store" + chemin)!)
        r.httpMethod = methode
        r.timeoutInterval = 15
        r.setValue("Bearer \(jeton)", forHTTPHeaderField: "Authorization")
        if let corps {
            r.setValue("application/json", forHTTPHeaderField: "Content-Type")
            r.httpBody = try? JSONSerialization.data(withJSONObject: corps)
        }
        guard let (d, rep) = try? await URLSession.shared.data(for: r), let http = rep as? HTTPURLResponse else { return (0, nil) }
        return (http.statusCode, try? JSONSerialization.jsonObject(with: d) as? [String: Any])
    }
}

private final class LecteurDeJeton: NSObject, WKNavigationDelegate {
    private var fini = false
    private let quandFini: (String?) -> Void
    init(_ quandFini: @escaping (String?) -> Void) { self.quandFini = quandFini }

    func finir(_ jeton: String?) {
        guard !fini else { return }
        fini = true
        quandFini(jeton)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        webView.evaluateJavaScript("localStorage.getItem('onirique.token') || sessionStorage.getItem('onirique.token')") { r, _ in
            let j = r as? String
            self.finir(j?.isEmpty == false ? j : nil)
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { finir(nil) }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { finir(nil) }
}

/// Le VPN : relais du serveur ONIRIQUE (server/src/vpn.js), annoncé avec le compte connecté. WebKit sait passer par un
/// relais depuis macOS 14 ; onirique.store reste en accès direct, pour pouvoir toujours s'annoncer.
enum Vpn {
    static func annoncer() async -> (ok: Bool, message: String, relais: String?) {
        guard let jeton = await Compte.jeton() else { return (false, "Connecte-toi à ton compte ONIRIQUE (avec « Rester connecté ») pour allumer le VPN.", nil) }
        let (code, json) = await Compte.appeler("POST", "/api/vpn", jeton: jeton, corps: [:])
        if code == 401 { return (false, "Ta connexion à ONIRIQUE a expiré : reconnecte-toi sur onirique.store pour allumer le VPN.", nil) }
        guard code == 200, let relais = json?["relais"] as? String, let u = URL(string: relais) else {
            return (false, (json?["error"] as? String) ?? "Le serveur du VPN ne répond pas. Réessaie dans un instant.", nil)
        }
        // Un relais injoignable bloquerait toutes les pages : on vérifie qu'il répond avant d'y passer.
        guard await joignable(u) else { return (false, "Le VPN est en maintenance pour l'instant. Réessaie un peu plus tard.", nil) }
        return (true, "", relais)
    }

    static func joignable(_ u: URL) async -> Bool {
        guard let h = u.host, let p = u.port, let port = NWEndpoint.Port(rawValue: UInt16(p)) else { return false }
        return await withCheckedContinuation { (suite: CheckedContinuation<Bool, Never>) in
            let c = NWConnection(host: NWEndpoint.Host(h), port: port, using: .tcp)
            var repondu = false
            let fin: (Bool) -> Void = { ok in
                guard !repondu else { return }
                repondu = true
                c.cancel()
                suite.resume(returning: ok)
            }
            c.stateUpdateHandler = { etat in
                if case .ready = etat { fin(true) }
                if case .failed = etat { fin(false) }
            }
            c.start(queue: .main)
            DispatchQueue.main.asyncAfter(deadline: .now() + 5) { fin(false) }
        }
    }

    static func poser(_ relais: String?) {
        if #available(macOS 14.0, *) {
            let magasin = WKWebsiteDataStore.default()
            guard let relais, let u = URL(string: relais), let h = u.host, let p = u.port, let port = NWEndpoint.Port(rawValue: UInt16(p)) else {
                magasin.proxyConfigurations = []
                return
            }
            var conf = ProxyConfiguration(httpCONNECTProxy: .hostPort(host: NWEndpoint.Host(h), port: port), tlsOptions: NWProtocolTLS.Options())
            conf.excludedDomains = ["onirique.store"]
            magasin.proxyConfigurations = [conf]
        }
    }

    static var disponible: Bool {
        if #available(macOS 14.0, *) { return true }
        return false
    }
}
