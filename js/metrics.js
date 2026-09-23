// Trainingskennwerte aus den Rohsamples (Int16 n×6: s, watt, ziel, rpm, hf, kmh×10).
// Alles nachträglich aus sessionData ableitbar — alte Sessions lassen sich
// damit in der Detailansicht nachberechnen (inkl. Distanz aus der Trainer-Speed).

import { FIELDS } from './storage.js';

// Zonengrenzen (%FTP, Zwift-Konvention) — auch von der Chart-Färbung genutzt
export const ZONEN_GRENZEN = [0.60, 0.76, 0.90, 1.05, 1.19];

export function zoneIndex(watt, ftp) {
  if (!ftp) return -1;
  const p = watt / ftp;
  for (let z = 0; z < ZONEN_GRENZEN.length; z++) if (p < ZONEN_GRENZEN[z]) return z;
  return 5;
}

// Beste durchgehende n-Sekunden-Durchschnittsleistung (für den Rampentest: n=60)
export function besteDauerleistung(samples, count, fenster = 60) {
  if (count < fenster) return 0;
  let sum = 0, best = 0;
  for (let k = 0; k < count; k++) {
    sum += samples[k * FIELDS + 1];
    if (k >= fenster) sum -= samples[(k - fenster) * FIELDS + 1];
    if (k >= fenster - 1 && sum > best) best = sum;
  }
  return Math.round(best / fenster);
}

// Distanz als Integral der Trainer-Speed (Feld 5, kmh×10, 1 Sample = 1 s) —
// dieselbe Rechnung wie im TCX-Export; im ERG-Modus gangabhängig, also
// „Trainer-Distanz", keine Leistungsgröße
export function distanzKm(samples, count) {
  let sum = 0;
  for (let k = 0; k < count; k++) sum += samples[k * FIELDS + 5];
  return sum / 36000;
}

// NP nach dem Standardverfahren: 30-s-gleitender Mittelwert der Leistung,
// vierte Potenz, Mittel, vierte Wurzel. IF = NP/FTP, TSS = h·IF²·100.
export function kennwerte(samples, count, ftp = 0) {
  const out = { np: 0, hrAvg: 0, hrMax: 0, zonenSek: null };
  if (!count) return out;
  out.km = Math.round(distanzKm(samples, count) * 100) / 100;

  // Präfixsummen für den 30-s-Rolling-Mean
  let rollSum = 0, potSum = 0, potN = 0;
  let hrSum = 0, hrN = 0;
  const zonen = [0, 0, 0, 0, 0, 0];
  for (let k = 0; k < count; k++) {
    const w = samples[k * FIELDS + 1];
    rollSum += w;
    if (k >= 30) rollSum -= samples[(k - 30) * FIELDS + 1];
    if (k >= 29) {
      const mean = rollSum / 30;
      potSum += mean ** 4;
      potN++;
    }
    const hf = samples[k * FIELDS + 4];
    if (hf > 0) { hrSum += hf; hrN++; if (hf > out.hrMax) out.hrMax = hf; }
    if (ftp) { const z = zoneIndex(w, ftp); if (z >= 0) zonen[z]++; }
  }
  out.np = potN ? Math.round((potSum / potN) ** 0.25) : Math.round(rollSum / count);
  out.hrAvg = hrN ? Math.round(hrSum / hrN) : 0;
  if (ftp) {
    out.zonenSek = zonen;
    out.if = Math.round(out.np / ftp * 100) / 100;
    out.tss = Math.round(count / 3600 * out.if * out.if * 100);
  }
  return out;
}
