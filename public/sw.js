// Service worker: modtager påmindelser og åbner appen, når man trykker på dem.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data && e.data.text() }; }
  e.waitUntil(
    self.registration.showNotification(d.title || "Tipsligaen", {
      body: d.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-96.png",
      tag: d.tag || "tipsligaen",
      data: { url: d.url || "/" },
    })
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) if ("focus" in w) return w.focus();
      return self.clients.openWindow(url);
    })
  );
});
