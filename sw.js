// Service Worker: Cache-first für den App-Shell, damit die installierte App
// offline startet. VERSION bei jedem Release hochzählen — alte Caches werden
// beim Aktivieren entsorgt.

const VERSION = 'v26';
const CACHE = `ergomergo-${VERSION}`;
const SHELL = [
  '.', 'index.html', 'css/app.css', 'manifest.webmanifest',
  'js/main.js', 'js/version.js', 'js/state.js', 'js/storage.js', 'js/export.js', 'js/logger.js', 'js/metrics.js',
  'js/ble/geraete.js', 'js/backup.js', 'js/zwo.js',
  'js/program.js', 'js/workouts.js', 'js/signals.js', 'js/ble/ftms.js', 'js/ble/hr.js', 'js/ble/zwift-controller.js',
  'js/ui/ride.js', 'js/ui/overlay.js', 'js/ui/toast.js', 'js/ui/chart.js', 'js/ui/list.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('message', e => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // sw.js selbst nie aus dem Cache beantworten oder hineinlegen —
  // sonst friert die Update-Erkennung des Watchdogs auf einem alten Stand ein
  if (new URL(e.request.url).pathname.endsWith('/sw.js')) return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(hit =>
      hit ?? fetch(e.request).then(resp => {
        if (resp.ok && new URL(e.request.url).origin === location.origin) {
          const copy = resp.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return resp;
      })
    )
  );
});
