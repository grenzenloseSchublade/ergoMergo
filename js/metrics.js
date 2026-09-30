// Trainingskennwerte aus den Rohsamples (Int16 n×6: s, watt, ziel, rpm, hf, kmh×10).
// Alles nachträglich aus sessionData ableitbar — alte Sessions lassen sich
// damit in der Detailansicht nachberechnen (inkl. Distanz aus der Trainer-Speed).

import { FIELDS } from './storage.js';

// FTP-Annahme für Freizeitfahrer ohne hinterlegten Wert (~2 W/kg): Workouts
// in %FTP brauchen eine Basis, und Zonenfarben sollen auch ohne FTP überall
// gleich aussehen (Vorschau, Fahrt, Detail). Kennwerte (IF/TSS/Zonenzeit)
// rechnen bewusst NUR mit dem echten FTP.
export const FTP_ANNAHME = 170;
export const effektiveFtp = ftp => ftp || FTP_ANNAHME;

// Kadenz-Vorgabe aus der Zielintensität (Konsens TrainerRoad/Rouvy:
// Z2–Schwelle 85–95, VO2max 100–110, Sprint 110+; Recovery frei → null)
export function kadenzBereich(zielWatt, ftp) {
  if (!ftp) return null;
  const pct = zielWatt / ftp;
  if (pct < 0.6) return null;
  if (pct <= 1.05) return { low: 85, high: 95 };
  if (pct <= 1.3) return { low: 100, high: 110 };
  return { low: 110, high: 140 };
}

// Zonengrenzen (%FTP, Zwift-Konvention) — auch von der Chart-Färbung genutzt
const ZONEN_GRENZEN = [0.60, 0.76, 0.90, 1.05, 1.19];

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

// Kennwerte einer Fahrt wie gespeichert (Session.stats() und Demo-Fahrten).
// Intensitätswerte (Ø/max W, Kadenz, NP/IF/TSS, HF, Zonen) bewusst aufs
// Programmfenster begrenzt: das Ausfahren danach verzerrt sie nicht.
// Mengen (Dauer, Arbeit, Distanz) zählen die ganze Fahrt — wie Livewerte
// und TCX-Export, sonst passen kJ und km nicht zur angezeigten Fahrt.
export function fahrtStats(samples, count, programmEndeBei, ftp) {
  const n = Math.min(count, programmEndeBei ?? count);
  let sumW = 0, maxW = 0, sumRpm = 0, rpmN = 0, sumAlle = 0;
  for (let k = 0; k < count; k++) {
    const w = samples[k * FIELDS + 1];
    sumAlle += w;
    if (k >= n) continue;
    sumW += w; if (w > maxW) maxW = w;
    const r = samples[k * FIELDS + 3];
    if (r > 0) { sumRpm += r; rpmN++; }
  }
  return {
    dauer: count,
    ausgefahrenSek: Math.max(0, count - n),
    avgW: n ? Math.round(sumW / n) : 0,
    maxW,
    kJ: Math.round(sumAlle / 1000),  // 1 Sample = 1 s → Watt·s/1000
    avgRpm: rpmN ? Math.round(sumRpm / rpmN) : 0,
    ...kennwerte(samples, n, ftp),
    // Distanz über die ganze Fahrt inkl. Ausfahren — konsistent zum
    // TCX-Export; überschreibt bewusst das aufs Programmfenster begrenzte
    // km aus kennwerte()
    km: Math.round(distanzKm(samples, count) * 100) / 100,
  };
}

// NP nach dem Standardverfahren: 30-s-gleitender Mittelwert der Leistung,
// vierte Potenz, Mittel, vierte Wurzel. IF = NP/FTP, TSS = h·IF²·100.
function kennwerte(samples, count, ftp = 0) {
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
    const intensitaet = out.np / ftp;         // TSS aus dem ungerundeten IF
    out.if = Math.round(intensitaet * 100) / 100;
    out.tss = Math.round(count / 3600 * intensitaet * intensitaet * 100);
  }
  return out;
}
