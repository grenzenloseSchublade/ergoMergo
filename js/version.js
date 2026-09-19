// App-Version — bei jedem Release zusammen mit VERSION in sw.js hochzählen.
export const APP_VERSION = 'v30';

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
      btn.onclick = async () => {
        btn.disabled = true;
        btn.textContent = 'aktualisiere …';
        const { logInfo, logError } = await import('./logger.js');
        try {
          const reg = await navigator.serviceWorker?.getRegistration();
          logInfo('update', `Update angestoßen (${APP_VERSION} → ${live})`,
            reg ? `scope=${reg.scope} waiting=${!!reg.waiting} installing=${!!reg.installing}` : 'keine Registration!');
          // Hängt ein fertig installierter Worker im waiting, direkt aktivieren
          reg?.waiting?.postMessage('skipWaiting');
          await reg?.update();
          reg?.waiting?.postMessage('skipWaiting');
        } catch (err) {
          logError('update', 'reg.update() fehlgeschlagen', err.message);
        }
        // Ist der neue Worker längst aktiv (häufigster Fall), gibt es keinen
        // controllerchange mehr — die Seite selbst ist alt. Reload lädt die
        // Shell aus dem neuen Cache. Bedingungslos, außer mitten in der Fahrt.
        setTimeout(() => {
          if (document.querySelector('#screen-ride')?.hidden) location.reload();
        }, 1500);
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
