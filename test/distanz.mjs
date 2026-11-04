#!/usr/bin/env node
// Virtuelle Distanz: Modell monotonic, deterministisch, Einstellungen validiert.
import { geschwindigkeitKmh, distanzLeistungKm } from '../js/metrics.js';
import { FIELDS, pruefeEinstellung } from '../js/storage.js';

const fehler = [];
const soll = (name, wert, pruefung) => { if (!pruefung(wert)) fehler.push(name); };

const basis = geschwindigkeitKmh(200, 75);
soll('200 W ergibt plausible Modellgeschwindigkeit', basis, v => v > 25 && v < 40);
soll('mehr Leistung ergibt höhere Geschwindigkeit', geschwindigkeitKmh(250, 75), v => v > basis);
soll('mehr Gewicht senkt Geschwindigkeit', geschwindigkeitKmh(200, 100), v => v < basis);
soll('keine Leistung ergibt Stillstand', geschwindigkeitKmh(0, 75), v => v === 0);
soll('negative Leistung ergibt Stillstand', geschwindigkeitKmh(-50, 75), v => v === 0);
soll('Gewicht wird auf 0,1 kg geprüft', [pruefeEinstellung('gewichtKg', 73.26), pruefeEinstellung('gewichtKg', 10)],
  v => JSON.stringify(v) === JSON.stringify([73.3, 30]));

const samples = new Int16Array(3 * FIELDS);
samples.set([0, 100, 100, 80, 0, 0], 0);
samples.set([1, 200, 200, 80, 0, 0], FIELDS);
samples.set([2, 300, 300, 80, 0, 0], FIELDS * 2);
const distanz = distanzLeistungKm(samples, 3, 75);
soll('Distanz summiert Modellgeschwindigkeit pro Sekunde', distanz, v => Math.abs(v -
  (geschwindigkeitKmh(100, 75) + geschwindigkeitKmh(200, 75) + geschwindigkeitKmh(300, 75)) / 3600) < 0.0003);

if (fehler.length) { console.error(`Fehler: ${fehler.join(', ')}`); process.exit(1); }
console.log('ok — virtuelle Distanz: Modell, Richtung und Einstellungsgrenzen');
