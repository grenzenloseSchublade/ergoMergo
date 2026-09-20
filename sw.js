// Service Worker: Cache-first für den App-Shell, damit die installierte App
// offline startet. VERSION bei jedem Release hochzählen — alte Caches werden
// beim Aktivieren entsorgt.

const VERSION = 'v33';
const CACHE = `ergomergo-${VERSION}`;
const SHELL = [
  '.', 'index.html', 'css/app.css', 'manifest.webmanifest',
  'js/main.js', 'js/version.js', 'js/state.js', 'js/storage.js', 'js/export.js', 'js/logger.js', 'js/metrics.js',
  'js/ble/geraete.js', 'js/backup.js', 'js/zwo.js',
  'js/program.js', 'js/workouts.js', 'js/signals.js', 'js/ble/ftms.js', 'js/ble/hr.js', 'js/ble/zwift-controller.js',
  'js/ui/ride.js', 'js/ui/overlay.js', 'js/ui/toast.js', 'js/ui/chart.js', 'js/ui/list.js',
  'js/ansagen.js', 'js/ui/pip.js', 'js/energie.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
  // Sprach-Bausteine (Piper-TTS) — hintergrundfeste Ansagen
  'audio/acht.ogg', 'audio/achtzehn.ogg', 'audio/achtzig.ogg', 'audio/drei.ogg', 'audio/dreissig.ogg', 'audio/dreizehn.ogg', 'audio/ein.ogg', 'audio/eine.ogg', 'audio/eins.ogg', 'audio/elf.ogg', 'audio/fertig.ogg', 'audio/fuenf.ogg', 'audio/fuenfzehn.ogg', 'audio/fuenfzig.ogg', 'audio/hundert.ogg', 'audio/minute.ogg', 'audio/minuten.ogg', 'audio/neun.ogg', 'audio/neunzehn.ogg', 'audio/neunzig.ogg', 'audio/sechs.ogg', 'audio/sechzehn.ogg', 'audio/sechzig.ogg', 'audio/sekunden.ogg', 'audio/sieben.ogg', 'audio/siebzehn.ogg', 'audio/siebzig.ogg', 'audio/und.ogg', 'audio/vier.ogg', 'audio/vierzehn.ogg', 'audio/vierzig.ogg', 'audio/watt.ogg', 'audio/weiter.ogg', 'audio/zehn.ogg', 'audio/zwanzig.ogg', 'audio/zwei.ogg', 'audio/zwoelf.ogg',
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
