// Trainingskennwerte aus den Rohsamples (Int16 n×6: s, watt, ziel, rpm, hf, kmh×10).
// Alles nachträglich aus sessionData ableitbar — alte Sessions lassen sich
// damit in der Detailansicht nachberechnen (inkl. virtueller Leistungsdistanz).

import { FIELDS } from './storage.js';

// FTP-Annahme für Freizeitfahrer ohne hinterlegten Wert (~2 W/kg): Workouts
// in %FTP brauchen eine Basis, und Zonenfarben sollen auch ohne FTP überall
// gleich aussehen (Vorschau, Fahrt, Detail). Kennwerte (IF/TSS/Zonenzeit)
// rechnen bewusst NUR mit dem echten FTP.
export const FTP_ANNAHME = 170;
export const effektiveFtp = ftp => ftp || FTP_ANNAHME;

// Modell: CdA 0,32 m², Crr 0,004, Luftdichte 1,225 kg/m³,
// 10 kg Fahrrad/Ausrüstung; Windstille und ebene Straße.
const LUFTDICHTE = 1.225, CDA = 0.32, CRR = 0.004, G = 9.80665, FAHRRAD_KG = 10;

// Löst P = ½ρCdA·v³ + Crr·m·g·v (Radleistung) per Binärsuche.
export function geschwindigkeitKmh(watt, gewichtKg = 75) {
  if (!(watt > 0)) return 0;
  const luft = 0.5 * LUFTDICHTE * CDA;
  const roll = CRR * (gewichtKg + FAHRRAD_KG) * G;
  let low = 0, high = 30;
  for (let i = 0; i < 32; i++) {
    const v = (low + high) / 2;
    if (luft * v ** 3 + roll * v < watt) low = v;
    else high = v;
  }
  return (low + high) * 1.8; // m/s → km/h
}

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

// Pulsgrenze (Einstellung pulsGrenze, 0 = aus): ab Erreichen gilt der Puls
// als darüber, neutral erst wieder PULS_HYSTERESE bpm unter der Grenze — so
// flackert die Farbe nicht, wenn der Puls um die Grenze pendelt. Ohne Gurt
// (hr 0) nie darüber. Nur Anzeige: kein Ton, keine Vibration.
export const PULS_HYSTERESE = 3;
export function ueberPulsGrenze(hr, grenze, vorher = false) {
  if (!grenze || !hr) return false;
  return hr >= grenze || (vorher && hr > grenze - PULS_HYSTERESE);
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

// Distanz aus gespeicherter Modellgeschwindigkeit (Feld 5, kmh×10, 1 Sample = 1 s).
export function distanzKm(samples, count) {
  let sum = 0;
  for (let k = 0; k < count; k++) sum += samples[k * FIELDS + 5];
  return sum / 36000;
}

export function distanzLeistungKm(samples, count, gewichtKg = 75) {
  let sum = 0;
  for (let k = 0; k < count; k++)
    sum += Math.round(geschwindigkeitKmh(samples[k * FIELDS + 1], gewichtKg) * 10);
  return sum / 36000;
}

// Kennwerte einer Fahrt wie gespeichert (Session.stats() und Demo-Fahrten).
// Intensitätswerte (Ø/max W, Kadenz, NP/IF/TSS, HF, Zonen) bewusst aufs
// Programmfenster begrenzt: das Ausfahren danach verzerrt sie nicht.
// Dauer, Arbeit und Distanz zählen die ganze Fahrt inkl. Ausrollen.
export function fahrtStats(samples, count, programmEndeBei, ftp, gewichtKg = 75) {
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
    // Distanz über die ganze Fahrt inkl. Ausfahren — konsistent zum TCX-Export
    km: Math.round(distanzLeistungKm(samples, count, gewichtKg) * 100) / 100,
  };
}

// NP nach dem Standardverfahren: 30-s-gleitender Mittelwert der Leistung,
// vierte Potenz, Mittel, vierte Wurzel. IF = NP/FTP, TSS = h·IF²·100.
function kennwerte(samples, count, ftp = 0) {
  const out = { np: 0, hrAvg: 0, hrMax: 0, zonenSek: null };
  if (!count) return out;

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
