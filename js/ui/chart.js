// Alle Canvas-Darstellungen der App. Gemeinsame Helfer: prepCanvas
// (DPR-Skalierung + gecachter CSS-Var-Zugriff), Zonenlogik, Zeitachse,
// Wiederholungsklammern. Darauf aufbauend: LiveChart (rollierendes Fenster
// beim freien Fahren), WorkoutChart (Programm-Graph während der Fahrt),
// drawProfile (statische Vorschau) und drawSessionChart (Detailansicht).

import { FIELDS } from '../storage.js';

// ---------- Helfer ----------

// Canvas auf Anzeigegröße × devicePixelRatio bringen (nur bei Änderung neu
// allokieren) und einen pro Aufruf gecachten CSS-Variablen-Getter liefern.
function prepCanvas(canvas) {
  const ctx = canvas.getContext('2d');
  const dpr = devicePixelRatio || 1;
  const w = canvas.clientWidth || canvas.width;
  const h = canvas.clientHeight || canvas.height;
  if (canvas.clientWidth &&
      (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr))) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  ctx.setTransform(canvas.width / w, 0, 0, canvas.height / h, 0, 0);
  const style = getComputedStyle(canvas);
  const css = name => style.getPropertyValue(name).trim();
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h, css };
}

// Powerzone (Zwift-Konvention, 6 Zonen %FTP) → CSS-Variablenname
function zoneVar(watt, ftp) {
  if (!ftp) return '--accent';
  const p = watt / ftp;
  return p < 0.60 ? '--z1' : p < 0.76 ? '--z2' : p < 0.90 ? '--z3'
       : p < 1.05 ? '--z4' : p < 1.19 ? '--z5' : '--z6';
}

// Für DOM-Styling (CSS löst var() selbst auf)
export function zoneColor(watt, ftp) {
  return `var(${zoneVar(watt, ftp)})`;
}

// Skalierungsfaktor: Schriften/Abstände wachsen mit der Canvas-Höhe,
// damit Miniatur (36 px) und Vollbild (400 px+) gleichermaßen lesbar sind.
function scaleOf(h) {
  return Math.min(2.2, Math.max(1, h / 120));
}

// Schriftgrößen wachsen NICHT linear mit (Lesbarkeitskonvention: Achsen-
// beschriftung 9–13 px, Labels bis 14 px — egal wie groß die Canvas ist)
const axisFont = s => Math.min(13, Math.round(9 * Math.sqrt(s)) + (s > 1.4 ? 2 : 0));
const labelFont = s => Math.min(14, Math.round(10 * Math.sqrt(s)) + (s > 1.4 ? 2 : 0));

// Zeitachse am unteren Rand: Minuten-Ticks in sinnvollem Raster
function zeichneZeitachse(ctx, css, w, h, fuss, total, s = 1) {
  const y = h - fuss + 0.5;
  ctx.strokeStyle = css('--line');
  ctx.fillStyle = css('--ink3');
  ctx.lineWidth = 1;
  ctx.font = `${axisFont(s)}px system-ui`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.beginPath();
  ctx.moveTo(0, y);
  ctx.lineTo(w, y);
  const step = [60, 120, 300, 600, 900, 1200, 1800, 3600].find(x => x / total * w >= 34 * s) ?? 3600;
  for (let t = step; t < total; t += step) {
    const x = t / total * w;
    if (x > w - 46 * s) break;               // Platz fürs Endlabel lassen
    ctx.moveTo(x, y);
    ctx.lineTo(x, y + 3 * s);
    ctx.fillText(String(t / 60), x, y + 4 * s);
  }
  ctx.stroke();
  ctx.textAlign = 'right';
  ctx.fillText(`${Math.round(total / 60)} min`, w - 1, y + 4 * s);
}

// Watt-Achse links (nur große Canvas). Zwei Phasen: Rasterlinien liegen
// unter den Balken, die Beschriftung darüber — sonst verdecken Balken den Text.
function zeichneWattachse(ctx, css, w, h, kopf, fuss, maxW, s, phase) {
  const raster = [25, 50, 100, 200].find(r => (h - kopf - fuss) * r / maxW >= 26 * s) ?? 200;
  ctx.strokeStyle = css('--line');
  ctx.fillStyle = css('--ink2');
  ctx.lineWidth = 1;
  ctx.font = `${axisFont(s)}px system-ui`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.beginPath();
  for (let v = raster; v < maxW / 1.02; v += raster) {
    const y = kopf + (h - kopf - fuss) * (1 - v / maxW);
    if (phase !== 'labels') {
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(w, y + 0.5);
    }
    if (phase !== 'linien') ctx.fillText(`${v} W`, 3, y - 2);
  }
  ctx.stroke();
}

// Wiederholte Abschnitte (gruppe/gruppeLabel an den Blöcken) einsammeln
function sammleGruppen(blocks) {
  const gruppen = new Map();
  let t = 0;
  for (const b of blocks) {
    if (b.gruppe) {
      const g = gruppen.get(b.gruppe) ?? { von: t, label: b.gruppeLabel };
      g.bis = t + b.dauer;
      gruppen.set(b.gruppe, g);
    }
    t += b.dauer;
  }
  return gruppen;
}

// Klammer „n×" über einem wiederholten Abschnitt
function zeichneKlammern(ctx, css, w, gruppen, total, s = 1) {
  ctx.strokeStyle = css('--ink3');
  ctx.fillStyle = css('--ink2');
  ctx.lineWidth = 1;
  ctx.font = `600 ${labelFont(s)}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const g of gruppen.values()) {
    const x0 = g.von / total * w + 1, x1 = g.bis / total * w - 1;
    if (x1 - x0 < 18 * s) continue;          // zu schmal für eine lesbare Klammer
    const y = 6.5 * s;
    const label = g.label ?? '×';
    const lw = ctx.measureText(label).width + 6;
    const mitte = (x0 + x1) / 2;
    ctx.beginPath();
    ctx.moveTo(x0, y + 3.5 * s); ctx.lineTo(x0, y);
    ctx.lineTo(mitte - lw / 2, y);
    ctx.moveTo(mitte + lw / 2, y);
    ctx.lineTo(x1, y); ctx.lineTo(x1, y + 3.5 * s);
    ctx.stroke();
    ctx.fillText(label, mitte, y + 0.5);
  }
}

// Wattzahl in breite Blöcke schreiben (nur Vollbild): Block muss Platz bieten
function zeichneBlockLabels(ctx, css, blocks, total, w, h, kopf, fuss, maxW, s) {
  ctx.fillStyle = css('--ink');
  ctx.font = `600 ${labelFont(s)}px system-ui`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  let t = 0;
  for (const b of blocks) {
    const bw = b.dauer / total * w;
    const y = kopf + (h - kopf - fuss) * (1 - b.watt / maxW);
    const label = String(b.watt);
    if (bw >= ctx.measureText(label).width + 10 && h - fuss - y >= 22) {
      ctx.fillText(label, (t + b.dauer / 2) / total * w, y + 3);
    }
    t += b.dauer;
  }
}

// Gefahrene Leistung als Linie über den Samples
function zeichneLeistungslinie(ctx, css, samples, count, xFn, yFn, breite = 1.5) {
  ctx.strokeStyle = css('--power-line');
  ctx.lineWidth = breite;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let k = 0; k < count; k++) {
    const px = xFn(k), py = yFn(samples[k * FIELDS + 1]);
    k ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
  }
  ctx.stroke();
}

// ---------- Darstellungen ----------

// Intensitätsprofil eines Programms: Zielblöcke als zonengefärbte Balken.
// Ab ~56 px Höhe zusätzlich Zeitachse, bei Gruppen Wiederholungsklammern.
export function drawProfile(canvas, blocks, ftp) {
  const { ctx, w, h, css } = prepCanvas(canvas);
  const total = blocks.reduce((a, b) => a + b.dauer, 0);
  if (!total) return;
  const s = scaleOf(h);
  const gruppen = sammleGruppen(blocks);
  const kopf = gruppen.size ? 13 * s : 0;
  const fuss = h >= 56 ? 13 * s : 0;
  const maxW = Math.max(...blocks.map(b => b.watt)) * 1.08;
  const gross = h >= 160;                    // Vollbild: Wattachse + Blocklabels
  if (gross) zeichneWattachse(ctx, css, w, h, kopf, fuss, maxW, s, 'linien');
  let t = 0;
  ctx.globalAlpha = 0.9;
  for (const b of blocks) {
    const x = t / total * w, bw = b.dauer / total * w;
    const y = kopf + (h - kopf - fuss) * (1 - b.watt / maxW);
    ctx.fillStyle = css(zoneVar(b.watt, ftp));
    ctx.fillRect(x + 0.5, y, Math.max(bw - 1, 0.5), h - fuss - y);
    t += b.dauer;
  }
  ctx.globalAlpha = 1;
  if (gross) {
    zeichneWattachse(ctx, css, w, h, kopf, fuss, maxW, s, 'labels');
    zeichneBlockLabels(ctx, css, blocks, total, w, h, kopf, fuss, maxW, s);
  }
  if (fuss) zeichneZeitachse(ctx, css, w, h, fuss, total, s);
  zeichneKlammern(ctx, css, w, gruppen, total, s);
}

// Programm-Graph während der Fahrt: Zielblöcke, Ist-Linie, Positionscursor,
// Zeitachse, Wiederholungsklammern (TrainerRoad-Muster).
export class WorkoutChart {
  constructor(canvas) { this.canvas = canvas; }

  draw(blocks, total, samples, count, offset, ftp) {
    const { ctx, w, h, css } = prepCanvas(this.canvas);
    const gruppen = sammleGruppen(blocks);
    const kopf = gruppen.size ? 13 : 0;
    const fuss = 13;
    let maxW = 150;
    for (const b of blocks) maxW = Math.max(maxW, b.watt + offset);
    for (let k = Math.max(0, count - 50); k < count; k++)
      maxW = Math.max(maxW, samples[k * FIELDS + 1]);
    maxW *= 1.15;
    const x = t => t / total * w;
    const y = v => (h - fuss) - Math.max(0, v) / maxW * (h - fuss - 6 - kopf);

    let t = 0;
    ctx.globalAlpha = 0.42;
    for (const b of blocks) {
      const watt = b.watt + offset;
      ctx.fillStyle = css(zoneVar(watt, ftp));
      ctx.fillRect(x(t) + 0.5, y(watt), x(t + b.dauer) - x(t) - 1, (h - fuss) - y(watt));
      t += b.dauer;
    }
    ctx.globalAlpha = 1;
    zeichneZeitachse(ctx, css, w, h, fuss, total);

    zeichneLeistungslinie(ctx, css, samples, count, k => x(samples[k * FIELDS]), y);

    if (count) {
      const px = x(samples[(count - 1) * FIELDS]);
      ctx.strokeStyle = css('--ink2');
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(px, kopf);
      ctx.lineTo(px, h - fuss);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    zeichneKlammern(ctx, css, w, gruppen, total);
  }
}

// Rollierendes 10-Minuten-Fenster beim freien Fahren:
// Zielleistung als Stufenfläche, Ist-Leistung als Linie.
const WINDOW_S = 600;

export class LiveChart {
  constructor(canvas) { this.canvas = canvas; }

  draw(samples, count, target) {
    const { ctx, w, h, css } = prepCanvas(this.canvas);
    if (!count) return;
    const from = Math.max(0, count - WINDOW_S);
    let maxW = target;
    for (let k = from; k < count; k++)
      maxW = Math.max(maxW, samples[k * FIELDS + 1], samples[k * FIELDS + 2]);
    maxW = Math.max(150, Math.ceil(maxW * 1.15 / 50) * 50);
    const x = k => (k - from) / WINDOW_S * w;
    const y = v => h - v / maxW * (h - 8);

    // Rasterlinien alle 50 W, dezent
    ctx.strokeStyle = css('--line');
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let v = 50; v < maxW; v += 50) { ctx.moveTo(0, y(v)); ctx.lineTo(w, y(v)); }
    ctx.stroke();

    // Zielleistung als gefüllte Stufenfläche
    ctx.fillStyle = css('--target-fill');
    ctx.beginPath();
    ctx.moveTo(x(from), h);
    for (let k = from; k < count; k++) {
      const v = samples[k * FIELDS + 2];
      ctx.lineTo(x(k), y(v));
      ctx.lineTo(x(k + 1), y(v));
    }
    ctx.lineTo(x(count), h);
    ctx.closePath();
    ctx.fill();

    zeichneLeistungslinie(ctx, css, samples.subarray(from * FIELDS), count - from,
      k => x(from + k), y, 2);

    ctx.fillStyle = css('--ink3');
    ctx.font = '10px system-ui';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(`${maxW} W`, 4, 12);
  }
}

// Detailansicht einer gespeicherten Fahrt: Zielfläche + Ist-Linie über die
// gesamte Dauer, mit Zeitachse.
export function drawSessionChart(canvas, samples, count) {
  const { ctx, w, h, css } = prepCanvas(canvas);
  if (!count) return;
  const s = scaleOf(h);
  const fuss = 13 * s;
  let maxW = 100;
  for (let k = 0; k < count; k++)
    maxW = Math.max(maxW, samples[k * FIELDS + 1], samples[k * FIELDS + 2]);
  maxW *= 1.1;
  const total = samples[(count - 1) * FIELDS] || count;
  const x = k => samples[k * FIELDS] / total * w;
  const y = v => (h - fuss) - v / maxW * (h - fuss - 8);

  ctx.fillStyle = css('--target-fill');
  ctx.beginPath();
  ctx.moveTo(0, h - fuss);
  for (let k = 0; k < count; k++) ctx.lineTo(x(k), y(samples[k * FIELDS + 2]));
  ctx.lineTo(w, h - fuss);
  ctx.closePath();
  ctx.fill();

  if (h >= 160) zeichneWattachse(ctx, css, w, h, 0, fuss, maxW, s);
  zeichneLeistungslinie(ctx, css, samples, count, x, y, 1.5 * s);
  zeichneZeitachse(ctx, css, w, h, fuss, total, s);
}
