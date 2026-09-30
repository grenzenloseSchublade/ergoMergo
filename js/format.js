// Gemeinsame Formatierung: Sekunden → "m:ss" bzw. "h:mm:ss", km mit Komma,
// HTML-Escaping für fremde Texte.

export function fmtTime(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
           : `${m}:${String(s).padStart(2, '0')}`;
}

// Fremde Texte (.zwo-Namen, Bluetooth-Gerätenamen, daraus abgeleitete
// Fahrtnamen) vor dem Einsetzen in innerHTML entschärfen
export function esc(text) {
  return String(text ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// Grobe Dauer für Summen: "46 min" bzw. "1:52 h" (m:ss wäre mit h:mm verwechselbar)
export function fmtDauer(sec) {
  const m = Math.round(sec / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')} h`;
}

// Datei-Stempel in Ortszeit: „2026-09-30_18-45" (toISOString wäre UTC)
export function dateiStempel(d = new Date()) {
  const z = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}_${z(d.getHours())}-${z(d.getMinutes())}`;
}

export function fmtKm(km) {
  return (km ?? 0).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}
