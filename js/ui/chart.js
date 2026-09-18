// Live-Leistungskurve auf Canvas 2D. Zeigt die letzten 10 Minuten:
// Zielleistung als Stufenfläche, Ist-Leistung als Linie. Redraw 1 Hz.

import { FIELDS } from '../storage.js';

const WINDOW_S = 600;

export function zoneColor(watt, ftp) {
  if (!ftp) return 'var(--accent)';
  const p = watt / ftp;
  if (p < 0.60) return 'var(--z1)';
  if (p < 0.76) return 'var(--z2)';
  if (p < 0.90) return 'var(--z3)';
  if (p < 1.05) return 'var(--z4)';
  if (p < 1.19) return 'var(--z5)';
  return 'var(--z6)';
}

// Hex-Werte der Zonenfarben für Canvas (fillStyle kann kein var())
export function zoneHex(watt, ftp, css) {
  if (!ftp) return css('--accent');
  const p = watt / ftp;
  const name = p < 0.60 ? '--z1' : p < 0.76 ? '--z2' : p < 0.90 ? '--z3'
             : p < 1.05 ? '--z4' : p < 1.19 ? '--z5' : '--z6';
  return css(name);
}

// Intensitätsprofil eines Programms: Zielblöcke als zonengefärbte Balken.
// Für Kachel-Miniaturen und die Vorschau im Startdialog.
export function drawProfile(canvas, blocks, ftp) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  const total = blocks.reduce((a, b) => a + b.dauer, 0);
  if (!total) return;

  // Wiederholte Abschnitte (gruppe/gruppeLabel) → Klammer „n×" über dem Profil
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
  const kopf = gruppen.size ? 13 : 0;        // Platz für die Klammern reservieren

  const maxW = Math.max(...blocks.map(b => b.watt)) * 1.08;
  const css = n => getComputedStyle(canvas).getPropertyValue(n).trim();
  ctx.clearRect(0, 0, w, h);
  t = 0;
  for (const b of blocks) {
    const x = t / total * w, bw = b.dauer / total * w;
    const y = kopf + (h - kopf) * (1 - b.watt / maxW);
    ctx.fillStyle = zoneHex(b.watt, ftp, css);
    ctx.globalAlpha = 0.9;
    ctx.fillRect(x + 0.5, y, Math.max(bw - 1, 0.5), h - y);
    t += b.dauer;
  }
  ctx.globalAlpha = 1;

  ctx.strokeStyle = css('--ink3');
  ctx.fillStyle = css('--ink2');
  ctx.lineWidth = 1;
  ctx.font = `600 10px ${css('--mono') || 'monospace'}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const g of gruppen.values()) {
    const x0 = g.von / total * w + 1, x1 = g.bis / total * w - 1;
    if (x1 - x0 < 18) continue;              // zu schmal für eine lesbare Klammer
    const y = 6.5;
    const label = g.label ?? '×';
    const lw = ctx.measureText(label).width + 6;
    const mitte = (x0 + x1) / 2;
    ctx.beginPath();
    ctx.moveTo(x0, y + 3.5); ctx.lineTo(x0, y);                    // linker Abschluss
    ctx.lineTo(mitte - lw / 2, y);
    ctx.moveTo(mitte + lw / 2, y);
    ctx.lineTo(x1, y); ctx.lineTo(x1, y + 3.5);                    // rechter Abschluss
    ctx.stroke();
    ctx.fillText(label, mitte, y + 0.5);
  }
}

// Ganzes Programm: Zielblöcke als zonengefärbte Flächen, gefahrene Leistung
// als Linie, senkrechter Cursor an der aktuellen Position (TrainerRoad-Muster).
export class WorkoutChart {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
  }

  #css = name => getComputedStyle(this.canvas).getPropertyValue(name).trim();

  draw(blocks, total, samples, count, offset, ftp) {
    const c = this.canvas, ctx = this.ctx;
    const dpr = devicePixelRatio || 1;
    const w = c.clientWidth, h = c.clientHeight;
    if (c.width !== w * dpr) { c.width = w * dpr; c.height = h * dpr; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    let maxW = 150;
    for (const b of blocks) maxW = Math.max(maxW, b.watt + offset);
    for (let k = Math.max(0, count - 50); k < count; k++)
      maxW = Math.max(maxW, samples[k * FIELDS + 1]);
    maxW *= 1.15;
    const x = t => t / total * w;
    const y = v => h - Math.max(0, v) / maxW * (h - 6);

    // Zielblöcke, 1 px Fuge zwischen den Flächen
    let t = 0;
    for (const b of blocks) {
      const watt = b.watt + offset;
      ctx.fillStyle = zoneHex(watt, ftp, this.#css);
      ctx.globalAlpha = 0.42;
      ctx.fillRect(x(t) + 0.5, y(watt), x(t + b.dauer) - x(t) - 1, h - y(watt));
      t += b.dauer;
    }
    ctx.globalAlpha = 1;

    // Gefahrene Leistung
    ctx.strokeStyle = this.#css('--power-line');
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let k = 0; k < count; k++) {
      const px = x(samples[k * FIELDS]), py = y(samples[k * FIELDS + 1]);
      k ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.stroke();

    // Positionscursor
    if (count) {
      const px = x(samples[(count - 1) * FIELDS]);
      ctx.strokeStyle = this.#css('--ink2');
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, h);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}

export class LiveChart {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
  }

  #css(name) { return getComputedStyle(this.canvas).getPropertyValue(name).trim(); }

  draw(samples, count, target) {
    const c = this.canvas, ctx = this.ctx;
    const dpr = devicePixelRatio || 1;
    const w = c.clientWidth, h = c.clientHeight;
    if (c.width !== w * dpr) { c.width = w * dpr; c.height = h * dpr; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!count) return;

    const from = Math.max(0, count - WINDOW_S);
    const n = count - from;
    let maxW = target;
    for (let k = from; k < count; k++) {
      maxW = Math.max(maxW, samples[k * FIELDS + 1], samples[k * FIELDS + 2]);
    }
    maxW = Math.max(150, Math.ceil(maxW * 1.15 / 50) * 50);
    const x = k => (k - from) / WINDOW_S * w;
    const y = v => h - v / maxW * (h - 8);

    // Rasterlinien alle 50 W, dezent
    ctx.strokeStyle = this.#css('--line');
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let v = 50; v < maxW; v += 50) { ctx.moveTo(0, y(v)); ctx.lineTo(w, y(v)); }
    ctx.stroke();

    // Zielleistung als gefüllte Stufenfläche
    ctx.fillStyle = this.#css('--target-fill');
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

    // Ist-Leistung als Linie
    ctx.strokeStyle = this.#css('--power-line');
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let k = from; k < count; k++) {
      const px = x(k), py = y(samples[k * FIELDS + 1]);
      k === from ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.stroke();

    // Skalenbeschriftung
    ctx.fillStyle = this.#css('--ink3');
    ctx.font = '10px system-ui';
    ctx.fillText(`${maxW} W`, 4, 12);
  }
}
