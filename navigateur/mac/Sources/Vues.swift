import AppKit

/// Le bandeau d'onglets, dans la barre de titre (les feux de macOS restent à gauche) : onglet actif sur la profondeur,
/// témoin de l'accent, braise qui respire pendant le chargement. Le vide sert à déplacer la fenêtre.
final class Bandeau: NSView {
    weak var fenetre: Fenetre?
    private var survol = -1
    private var surCroix = false
    private var suivi: NSTrackingArea?
    private var respiration: Timer?

    override var isFlipped: Bool { true }
    override var mouseDownCanMoveWindow: Bool { false }

    private let debut: CGFloat = 80   // la place des feux de la fenêtre
    private var largeur: CGFloat {
        guard let n = fenetre?.onglets.count, n > 0 else { return 0 }
        return min(232, max(60, (bounds.width - debut - 56) / CGFloat(n)))
    }
    private func zone(_ i: Int) -> NSRect { NSRect(x: debut + CGFloat(i) * largeur, y: 6, width: largeur, height: bounds.height - 6) }
    private func croix(_ r: NSRect) -> NSRect { NSRect(x: r.maxX - 28, y: r.midY - 9, width: 18, height: 18) }
    private var plus: NSRect { NSRect(x: debut + CGFloat(fenetre?.onglets.count ?? 0) * largeur + 6, y: 9, width: 26, height: 26) }
    private func index(_ p: NSPoint) -> Int {
        guard let n = fenetre?.onglets.count else { return -1 }
        for i in 0..<n where zone(i).contains(p) { return i }
        return -1
    }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let s = suivi { removeTrackingArea(s) }
        suivi = NSTrackingArea(rect: bounds, options: [.mouseMoved, .mouseEnteredAndExited, .activeInKeyWindow, .inVisibleRect], owner: self)
        addTrackingArea(suivi!)
    }

    override func draw(_ dirtyRect: NSRect) {
        DA.nuit.setFill()
        bounds.fill()
        DA.filet.setFill()
        NSRect(x: 0, y: bounds.height - 1, width: bounds.width, height: 1).fill()
        guard let f = fenetre else { return }
        let charge = f.onglets.contains { $0.charge }
        if charge && respiration == nil {
            respiration = Timer.scheduledTimer(withTimeInterval: 1 / 30, repeats: true) { [weak self] _ in self?.needsDisplay = true }
        } else if !charge { respiration?.invalidate(); respiration = nil }

        for (i, o) in f.onglets.enumerated() {
            let r = zone(i)
            let actif = o === f.actif
            if actif {
                let forme = NSBezierPath(roundedRect: NSRect(x: r.minX, y: r.minY, width: r.width - 2, height: r.height + 10), xRadius: 8, yRadius: 8)
                DA.fond.setFill()
                forme.fill()
                DA.filet.setStroke()
                forme.stroke()
                DA.braise.setFill()
                NSRect(x: r.minX + 12, y: r.minY, width: r.width - 26, height: 2).fill()
            } else if i == survol {
                DA.survol.setFill()
                NSBezierPath(roundedRect: r.insetBy(dx: 3, dy: 4).offsetBy(dx: 0, dy: -1), xRadius: 7, yRadius: 7).fill()
            }
            let icone = NSRect(x: r.minX + 12, y: r.midY - 7, width: 14, height: 14)
            if o.charge {
                let a = 0.35 + 0.3 * sin(Date().timeIntervalSince1970 * 4.5)
                DA.braise.withAlphaComponent(a).setFill()
                NSBezierPath(ovalIn: icone.insetBy(dx: -1, dy: -1)).fill()
                DA.braiseClaire.setFill()
                NSBezierPath(ovalIn: icone.insetBy(dx: 4, dy: 4)).fill()
            } else {
                let symbole = o.url.contains("/parametres.html") ? "gearshape" : o.url.contains("/historique.html") ? "clock.arrow.circlepath" : "globe"
                if let img = NSImage(systemSymbolName: symbole, accessibilityDescription: nil)?.withSymbolConfiguration(.init(pointSize: 11, weight: .regular)) {
                    let teinte = img.copy() as! NSImage
                    teinte.isTemplate = false
                    teinte.lockFocus()
                    DA.cendre.set()
                    NSRect(origin: .zero, size: teinte.size).fill(using: .sourceAtop)
                    teinte.unlockFocus()
                    teinte.draw(in: NSRect(x: icone.midX - teinte.size.width / 2, y: icone.midY - teinte.size.height / 2, width: teinte.size.width, height: teinte.size.height),
                                from: .zero, operation: .sourceOver, fraction: 1, respectFlipped: true, hints: nil)
                }
            }
            let croixVisible = (actif || i == survol) && r.width > 90
            let texte = NSRect(x: icone.maxX + 10, y: r.midY - 8, width: max(0, r.maxX - icone.maxX - (croixVisible ? 42 : 18)), height: 17)
            let style = NSMutableParagraphStyle()
            style.lineBreakMode = .byTruncatingTail
            (o.titre as NSString).draw(in: texte, withAttributes: [
                .font: NSFont.systemFont(ofSize: 12, weight: actif ? .medium : .regular),
                .foregroundColor: actif ? DA.brume : (o.decharge ? DA.eteint : DA.cendre), .paragraphStyle: style,
            ])
            if croixVisible {
                let c = croix(r)
                if i == survol && surCroix { DA.filet.setFill(); NSBezierPath(ovalIn: c).fill() }
                ("×" as NSString).draw(in: c.offsetBy(dx: 4.5, dy: -1), withAttributes: [.font: NSFont.systemFont(ofSize: 14), .foregroundColor: actif || surCroix ? DA.brume : DA.cendre])
            }
        }
        if survol == -2 { DA.survol.setFill(); NSBezierPath(roundedRect: plus, xRadius: 8, yRadius: 8).fill() }
        ("+" as NSString).draw(in: plus.offsetBy(dx: 7.5, dy: 2), withAttributes: [.font: NSFont.systemFont(ofSize: 17, weight: .light), .foregroundColor: DA.brume])
    }

    override func mouseMoved(with e: NSEvent) {
        let p = convert(e.locationInWindow, from: nil)
        var i = index(p)
        if i < 0 && plus.contains(p) { i = -2 }
        let c = i >= 0 && croix(zone(i)).contains(p)
        if i != survol || c != surCroix { survol = i; surCroix = c; needsDisplay = true }
    }

    override func mouseExited(with e: NSEvent) { survol = -1; surCroix = false; needsDisplay = true }

    override func mouseDown(with e: NSEvent) {
        guard let f = fenetre else { return }
        let p = convert(e.locationInWindow, from: nil)
        let i = index(p)
        if i >= 0 {
            let o = f.onglets[i]
            if croix(zone(i)).contains(p) && (o === f.actif || i == survol) { f.fermer(o) } else { f.activer(o) }
        } else if plus.contains(p) {
            f.nouvelOnglet()
        } else if e.clickCount == 2 {
            window?.performZoom(nil)
        } else {
            window?.performDrag(with: e)
        }
    }

    override func otherMouseDown(with e: NSEvent) {
        guard let f = fenetre else { return }
        let i = index(convert(e.locationInWindow, from: nil))
        if i >= 0 { f.fermer(f.onglets[i]) }
    }
}

/// La liste de suggestions sous la barre d'adresse.
final class Suggestions: NSView {
    struct Ligne { var titre: String; var detail: String; var url: String; var symbole: String }
    private var lignes: [Ligne] = []
    private var choix = -1
    var quandChoisie: ((String) -> Void)?
    override var isFlipped: Bool { true }
    private let h: CGFloat = 34

    var selection: String? { !isHidden && choix >= 0 && choix < lignes.count ? lignes[choix].url : nil }

    func montrer(_ l: [Ligne], sous r: NSRect) {
        lignes = l
        choix = -1
        frame = NSRect(x: r.minX, y: r.maxY + 4, width: r.width, height: CGFloat(l.count) * h + 10)
        isHidden = l.isEmpty
        needsDisplay = true
        if let s = superview { s.addSubview(self, positioned: .above, relativeTo: nil) }
    }

    func deplacer(_ sens: Int) { choix = max(-1, min(lignes.count - 1, choix + sens)); needsDisplay = true }

    private func rang(_ p: NSPoint) -> Int { p.y < 5 ? -1 : min(lignes.count - 1, Int((p.y - 5) / h)) }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        trackingAreas.forEach(removeTrackingArea)
        addTrackingArea(NSTrackingArea(rect: bounds, options: [.mouseMoved, .activeInKeyWindow, .inVisibleRect], owner: self))
    }
    override func mouseMoved(with e: NSEvent) { let i = rang(convert(e.locationInWindow, from: nil)); if i != choix { choix = i; needsDisplay = true } }
    override func mouseDown(with e: NSEvent) { let i = rang(convert(e.locationInWindow, from: nil)); if i >= 0 { quandChoisie?(lignes[i].url) } }

    override func draw(_ dirtyRect: NSRect) {
        let forme = NSBezierPath(roundedRect: bounds.insetBy(dx: 0.5, dy: 0.5), xRadius: 12, yRadius: 12)
        DA.fond.setFill()
        forme.fill()
        DA.filet.setStroke()
        forme.stroke()
        for (i, l) in lignes.enumerated() {
            let r = NSRect(x: 5, y: 5 + CGFloat(i) * h, width: bounds.width - 10, height: h)
            if i == choix {
                DA.survol.setFill()
                NSBezierPath(roundedRect: r, xRadius: 8, yRadius: 8).fill()
                DA.braise.setFill()
                NSRect(x: r.minX, y: r.minY + 9, width: 2, height: r.height - 18).fill()
            }
            if let img = NSImage(systemSymbolName: l.symbole, accessibilityDescription: nil) {
                img.draw(in: NSRect(x: r.minX + 14, y: r.midY - 7, width: 14, height: 14), from: .zero, operation: .sourceOver, fraction: i == 0 ? 1 : 0.6, respectFlipped: true, hints: nil)
            }
            let style = NSMutableParagraphStyle()
            style.lineBreakMode = .byTruncatingTail
            let texte = NSMutableAttributedString(string: l.titre, attributes: [.font: NSFont.systemFont(ofSize: 13), .foregroundColor: DA.brume])
            if !l.detail.isEmpty && l.detail != l.titre {
                texte.append(NSAttributedString(string: "  —  " + l.detail, attributes: [.font: NSFont.systemFont(ofSize: 12), .foregroundColor: DA.eteint]))
            }
            texte.addAttribute(.paragraphStyle, value: style, range: NSRange(location: 0, length: texte.length))
            texte.draw(in: NSRect(x: r.minX + 40, y: r.midY - 8, width: r.width - 52, height: 18))
        }
    }
}

/// Petit message qui apparaît en haut à droite de la page, avec une action éventuelle.
final class Bulle: NSView {
    private var texte = ""
    private var action = ""
    private var quandAction: (() -> Void)?
    private var cacher: DispatchWorkItem?
    override var isFlipped: Bool { true }

    private var zoneAction: NSRect {
        guard !action.isEmpty else { return .zero }
        let l = (action as NSString).size(withAttributes: [.font: NSFont.systemFont(ofSize: 13, weight: .medium)]).width + 22
        return NSRect(x: bounds.width - l - 12, y: 9, width: l, height: bounds.height - 18)
    }

    func montrer(_ message: String, action libelle: String = "", _ faire: (() -> Void)? = nil) {
        texte = message
        action = libelle
        quandAction = faire
        let l = (message as NSString).size(withAttributes: [.font: NSFont.systemFont(ofSize: 13)]).width
            + (libelle.isEmpty ? 0 : (libelle as NSString).size(withAttributes: [.font: NSFont.systemFont(ofSize: 13, weight: .medium)]).width + 40) + 64
        frame.size = NSSize(width: min(l, (superview?.bounds.width ?? 800) - 32), height: 46)
        if let s = superview { placer(dans: s.bounds); s.addSubview(self, positioned: .above, relativeTo: nil) }
        alphaValue = 0
        isHidden = false
        needsDisplay = true
        NSAnimationContext.runAnimationGroup { c in c.duration = 0.2; animator().alphaValue = 1 }
        cacher?.cancel()
        let tache = DispatchWorkItem { [weak self] in self?.fermer() }
        cacher = tache
        DispatchQueue.main.asyncAfter(deadline: .now() + (libelle.isEmpty ? 5 : 9), execute: tache)
    }

    private func fermer() {
        NSAnimationContext.runAnimationGroup({ c in c.duration = 0.25; animator().alphaValue = 0 }, completionHandler: { self.isHidden = true })
    }

    func placer(dans r: NSRect) { frame.origin = NSPoint(x: r.maxX - frame.width - 16, y: 40 + 44 + 14) }

    override func mouseDown(with e: NSEvent) {
        if zoneAction.contains(convert(e.locationInWindow, from: nil)) { quandAction?() }
        fermer()
    }

    override func draw(_ dirtyRect: NSRect) {
        let forme = NSBezierPath(roundedRect: bounds.insetBy(dx: 0.5, dy: 0.5), xRadius: 12, yRadius: 12)
        DA.fond.setFill()
        forme.fill()
        DA.filet.setStroke()
        forme.stroke()
        DA.braise.setFill()
        NSBezierPath(ovalIn: NSRect(x: 16, y: bounds.midY - 3, width: 6, height: 6)).fill()
        let style = NSMutableParagraphStyle()
        style.lineBreakMode = .byTruncatingTail
        let za = zoneAction
        (texte as NSString).draw(in: NSRect(x: 32, y: bounds.midY - 9, width: (za == .zero ? bounds.width : za.minX) - 44, height: 18),
                                 withAttributes: [.font: NSFont.systemFont(ofSize: 13), .foregroundColor: DA.brume, .paragraphStyle: style])
        if za != .zero {
            DA.braise.withAlphaComponent(0.25).setFill()
            NSBezierPath(roundedRect: za, xRadius: 8, yRadius: 8).fill()
            (action as NSString).draw(in: za.insetBy(dx: 11, dy: 6), withAttributes: [.font: NSFont.systemFont(ofSize: 13, weight: .medium), .foregroundColor: DA.braiseClaire])
        }
    }
}
