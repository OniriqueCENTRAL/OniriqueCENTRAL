import AppKit

let application = NSApplication.shared
let delegue = Delegue()
application.delegate = delegue
application.setActivationPolicy(.regular)
application.run()
