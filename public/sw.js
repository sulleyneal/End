/**
 * Service worker: receives push messages and opens the table.
 *
 * Deliberately minimal — it does not cache anything. An offline cache for a
 * live multiplayer game is a liability: a stale character sheet or a stale
 * initiative order is worse than a spinner, and the whole app is built on the
 * premise that the server is the only authority on state.
 */

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "Your table", body: event.data.text(), url: "/" };
  }

  event.waitUntil(
    self.registration.showNotification(payload.title ?? "Your table", {
      body: payload.body ?? "",
      // Same tag replaces rather than stacks, so a player returning after ten
      // turns finds one current notification instead of a wall of them.
      tag: payload.tag ?? "table",
      renotify: true,
      data: { url: payload.url ?? "/" },
      icon: "/icon-192.png",
      badge: "/icon-192.png",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url ?? "/";

  // Focus an already-open table rather than opening a second copy of the game.
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if (client.url.includes(new URL(target, self.location.origin).pathname)) {
          return client.focus();
        }
      }
      return clients.openWindow(target);
    }),
  );
});
