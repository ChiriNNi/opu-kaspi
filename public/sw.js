// Chrome требует fetch handler для разрешения установки PWA
self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request).catch(() => new Response('', { status: 503 })));
});

// ВАЖНО: браузер обязывает вызывать showNotification() на КАЖДЫЙ push-event.
// Если этого не сделать (например, .json() бросил исключение до waitUntil) —
// после нескольких таких "тихих" пушей Chrome сам отзывает разрешение на
// уведомления у сайта. Поэтому здесь всё в try/catch с гарантированным фолбэком.
self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let data = {};
    try {
      if (event.data) data = event.data.json();
    } catch {
      try { data = { title: 'IC Group', body: event.data?.text() || '' }; } catch {}
    }
    try {
      await self.registration.showNotification(data.title || 'IC Group', {
        body: data.body || '',
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        tag: data.tag || 'ic-group',
        data: { url: data.url || '/' },
        requireInteraction: true,
        vibrate: [200, 100, 200]
      });
    } catch (err) {
      // Последний фолбэк — пустое уведомление лучше, чем полное молчание
      await self.registration.showNotification('IC Group', { body: 'Новое уведомление' });
    }
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
