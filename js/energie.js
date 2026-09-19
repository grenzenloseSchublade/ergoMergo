// Batterieverbrauch pro Fahrt: Level-Delta über navigator.getBattery()
// (Chrome liefert 1-%-Schritte). Erst messen, dann ggf. optimieren —
// der dominante Verbraucher ist ohnehin das Display via Wake Lock.
// Gemessen wird nur ungeladen und ab 30 min Fahrt; sonst null.

let messung = null;
let beobachtet = null;   // BatteryManager ist ein Singleton — Listener nur einmal

export async function starteMessung() {
  try {
    const akku = await navigator.getBattery();
    messung = { akku, level: akku.level, t: Date.now(), geladen: akku.charging };
    // Zwischenzeitliches Anstecken macht das Delta wertlos → merken
    if (beobachtet !== akku) {
      beobachtet = akku;
      akku.addEventListener('chargingchange', () => {
        if (messung && akku.charging) messung.geladen = true;
      });
    }
  } catch { messung = null; }                  // API fehlt (Firefox/Safari) — egal
}

// %/h oder null (zu kurz, geladen, kein messbares Delta)
export function beendeMessung() {
  if (!messung) return null;
  const { akku, level, t, geladen } = messung;
  messung = null;
  const stunden = (Date.now() - t) / 3600000;
  const delta = (level - akku.level) * 100;
  if (geladen || akku.charging || stunden < 0.5 || delta <= 0) return null;
  return Math.round(delta / stunden * 10) / 10;
}
