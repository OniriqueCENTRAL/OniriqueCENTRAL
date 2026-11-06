// Les notifications d'ONIRIQUE CLOUD : affichées à chaque envoi (iPhone retire l'autorisation sinon), un toucher ouvre la page.
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data.json(); } catch {}
  event.waitUntil(self.registration.showNotification(data.title || "ONIRIQUE CLOUD", {
    body: data.body || "",
    icon: "/assets/app-icon-192.png",
    badge: "/assets/app-icon-192.png",
    data: { url: data.url || "/mes-sons" },
    // Une invitation au HM se rejoint ou se refuse depuis la notification.
    ...(/#\/hm\//.test(data.url || "") ? { tag: data.url, actions: [{ action: "join", title: "Rejoindre" }, { action: "no", title: "Refuser" }] } : {}),
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  if (event.action === "no") return;
  const url = new URL(event.notification.data.url, self.location.origin).href;
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    const open = list.find((c) => c.url.startsWith(url));
    return open ? open.focus() : clients.openWindow(url);
  }));
});
