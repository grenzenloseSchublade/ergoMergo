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
