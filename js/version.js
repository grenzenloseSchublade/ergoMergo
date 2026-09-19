// App-Version — bei jedem Release zusammen mit VERSION in sw.js hochzählen.
export const APP_VERSION = 'v19';

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
      } else {
        statusEl.textContent = `${APP_VERSION} → ${live} verfügbar, aktualisiere …`;
        (await navigator.serviceWorker?.getRegistration())?.update();
      }
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
