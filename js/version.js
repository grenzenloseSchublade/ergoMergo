// App-Version — bei jedem Release zusammen mit VERSION in sw.js hochzählen.
export const APP_VERSION = 'v26';

// Update-Watchdog: prüft das deployte sw.js auf GitHub Pages gegen die
// laufende Version. Bei Abweichung wird die Service-Worker-Registrierung
// angestoßen — das vorhandene Auto-Update (controllerchange → reload)
// übernimmt den Rest. Läuft beim Start, beim Sichtbarwerden und alle 10 min.
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
        // Normalfall: neuer Worker übernimmt → controllerchange lädt neu.
        // Rückfall nach 8 s — aber NIE mitten in einer Fahrt:
        setTimeout(() => {
          if (document.querySelector('#screen-ride')?.hidden) {
            logInfo('update', 'controllerchange blieb aus — erzwinge Reload');
            location.reload();
          }
        }, 8000);
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
