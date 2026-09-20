// App-Version — bei jedem Release zusammen mit VERSION in sw.js hochzählen.
export const APP_VERSION = 'v34';

// Update-Watchdog: prüft das deployte sw.js auf GitHub Pages gegen die
// laufende Version. Bei Abweichung wird die Service-Worker-Registrierung
// angestoßen — das vorhandene Auto-Update (controllerchange → reload)
// übernimmt den Rest. Läuft beim Start, beim Sichtbarwerden und alle 10 min.
// Selbstheilung: Läuft der Service Worker bereits auf einer neueren Version
// (Cache-Name) als die geladene Seite, wurde nur der Reload verpasst —
// einmalig still neu laden (Schleifen-Guard über sessionStorage).
export async function heileVersionsDrift() {
  try {
    if (!('caches' in window) || location.hostname === 'localhost') return;
    const keys = await caches.keys();
    const cacheVersion = keys.map(k => k.match(/^ergomergo-(v\d+)$/)?.[1]).find(Boolean);
    if (!cacheVersion || cacheVersion === APP_VERSION) return;
    if (sessionStorage.getItem('driftReload') === cacheVersion) return;   // schon versucht
    sessionStorage.setItem('driftReload', cacheVersion);
    location.reload();
  } catch { /* nie kritisch */ }
}

export function starteUpdateWatchdog(statusEl) {
  if (location.hostname === 'localhost') { statusEl.textContent = `${APP_VERSION} · dev (localhost)`; return; }

  const pruefe = async () => {
    try {
      const text = await (await fetch(`sw.js?_=${Date.now()}`, { cache: 'no-store' })).text();
      const live = text.match(/VERSION = '([^']+)'/)?.[1];
      if (!live) return;
      if (live === APP_VERSION) {
        statusEl.textContent = `${APP_VERSION} · aktuell`;
        return;
      }
      // Neue Version deployt: anbieten, nicht erzwingen — ein Tap lädt neu
      statusEl.replaceChildren();
      const btn = document.createElement('button');
      btn.className = 'chip update';
      btn.textContent = `${live} verfügbar — jetzt aktualisieren`;
      // Ereignisgesteuert statt Timer: reg.update() stößt die Installation
      // nur AN — caches.addAll (60+ Dateien) braucht mobil Sekunden. Ein
      // fester Kurz-Reload lädt die alte Shell aus dem alten Cache und das
      // echte Update kommt erst beim nächsten Besuch. Deshalb: auf den
      // Lebenszyklus des neuen Workers hören und erst bei activated /
      // controllerchange genau einmal neu laden.
      btn.onclick = async () => {
        btn.disabled = true;
        btn.textContent = 'aktualisiere …';
        const { logInfo, logError } = await import('./logger.js');
        let fertig = false;
        const neuLaden = quelle => {
          if (fertig) return;
          fertig = true;
          // Nie mitten in der Fahrt — der controllerchange-Handler in
          // main.js hat reloadAusstehend gesetzt, goHome holt den Reload nach
          if (!document.querySelector('#screen-ride')?.hidden) return;
          logInfo('update', `Update fertig — lade neu (${quelle})`);
          location.reload();
        };
        try {
          const reg = await navigator.serviceWorker?.getRegistration();
          if (!reg) { location.reload(); return; }
          logInfo('update', `Update angestoßen (${APP_VERSION} → ${live})`,
            `waiting=${!!reg.waiting} installing=${!!reg.installing}`);
          navigator.serviceWorker.addEventListener('controllerchange',
            () => neuLaden('controllerchange'), { once: true });
          const beobachte = w => {
            if (!w) return;
            w.addEventListener('statechange', () => {
              logInfo('update', `Worker-Zustand: ${w.state}`);
              if (w.state === 'installed') reg.waiting?.postMessage('skipWaiting');
              if (w.state === 'activated') neuLaden('activated');
            });
          };
          reg.addEventListener('updatefound', () => beobachte(reg.installing));
          beobachte(reg.installing);
          if (reg.waiting) { beobachte(reg.waiting); reg.waiting.postMessage('skipWaiting'); }
          await reg.update();
          if (reg.waiting) { beobachte(reg.waiting); reg.waiting.postMessage('skipWaiting'); }
          // Drift-Fall: der neue Worker ist LÄNGST aktiv, nur die Seite ist
          // alt — dann kommt kein Ereignis mehr. Am Cache-Namen erkennbar.
          if (!reg.installing && !reg.waiting) {
            const keys = await caches.keys();
            if (keys.includes(`ergomergo-${live}`)) neuLaden('drift');
          }
        } catch (err) {
          logError('update', 'Update fehlgeschlagen', err.message);
        }
        // Ehrlicher Fallback: nach 25 s nicht still hängen, sondern
        // erneut anbieten (langsames Netz, abgebrochene Installation)
        setTimeout(() => {
          if (fertig) return;
          logError('update', 'Update nicht abgeschlossen (Timeout 25 s)');
          btn.disabled = false;
          btn.textContent = `${live} verfügbar — erneut versuchen`;
        }, 25000);
      };
      statusEl.append(btn);
    } catch {
      statusEl.textContent = `${APP_VERSION} · offline`;
    }
  };

  pruefe();
  setInterval(pruefe, 10 * 60 * 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') pruefe();
  });
}
