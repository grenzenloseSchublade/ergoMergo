// Alle Canvas-Darstellungen der App. Gemeinsame Helfer: prepCanvas
// (DPR-Skalierung + gecachter CSS-Var-Zugriff), Zonenlogik, Zeitachse,
// Wiederholungsklammern. Darauf aufbauend: LiveChart (rollierendes Fenster
// beim freien Fahren), WorkoutChart (Programm-Graph während der Fahrt),
// drawProfile (statische Vorschau) und drawSessionChart (Detailansicht).

import { FIELDS } from '../storage.js';
import { zoneIndex } from '../metrics.js';

// ---------- Helfer ----------

// Canvas auf Anzeigegröße × devicePixelRatio bringen (nur bei Änderung neu
// allokieren) und einen pro Aufruf gecachten CSS-Variablen-Getter liefern.
// Breite und Höhe kommen immer aus DERSELBEN Quelle: Layout, oder — solange
// die Canvas nicht im Layout ist (versteckte Kachel) — die Attribute. Hat
// sie Layout, aber keine Höhe (sehr flaches Querfenster), wird nicht
// gezeichnet: gemischt wuchs die Bitmap-Höhe sonst mit jedem Aufruf um dpr.
// Liefert null, wenn nichts zu zeichnen ist.
function prepCanvas(canvas) {
  const imLayout = canvas.clientWidth > 0 || canvas.clientHeight > 0;
  if (imLayout && !(canvas.clientWidth > 0 && canvas.clientHeight > 0)) return null;
  const ctx = canvas.getContext('2d');
  const dpr = devicePixelRatio || 1;
  const w = imLayout ? canvas.clientWidth : canvas.width;
  const h = imLayout ? canvas.clientHeight : canvas.height;
  if (!w || !h) return null;
  if (imLayout &&
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

// Canvas bei jeder Größenänderung (Drehen, Fokus-Wechsel, Fenster) neu
// zeichnen — sonst streckt der Browser die alte Bitmap. Liefert die
// Abmeldefunktion.
export function beobachte(canvas, zeichne) {
  let raf = 0;
  const ro = new ResizeObserver(() => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => zeichne(canvas));
  });
  ro.observe(canvas);
  return () => { ro.disconnect(); cancelAnimationFrame(raf); };
}

// Powerzone → CSS-Variablenname (Grenzen zentral in metrics.js)
export function zoneVar(watt, ftp) {
  const z = zoneIndex(watt, ftp);
  return z < 0 ? '--accent' : `--z${z + 1}`;
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

// Zeitachse am unteren Rand. Ohne blocks: Minuten-Ticks in starrem Raster.
// Mit blocks: Ticks sitzen an den Blockgrenzen (dort passiert etwas), das
// Raster füllt nur lange grenzenlose Strecken; zu dichte Grenzen verlieren
// ihr Label, behalten aber den Tick.
// von: Zeit am linken Rand (rollierendes Fenster beim freien Fahren).
function zeichneZeitachse(ctx, css, w, h, fuss, total, s = 1, blocks = null, von = 0) {
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
  const spanne = total - von;
  const step = [60, 120, 300, 600, 900, 1200, 1800, 3600].find(x => x / spanne * w >= 34 * s) ?? 3600;
  const fmt = t => String(Math.round(t / 60));
  let ticks;
  if (blocks) {
    ticks = [];
    let t = 0;
    for (const b of blocks.slice(0, -1)) {
      t += b.dauer;
      ticks.push(t);
    }
    // grenzenlose Lücken mit Rasterticks füllen (z. B. 45-min-Grundlage)
    const alle = [0, ...ticks, total];
    for (let i = 0; i < alle.length - 1; i++) {
      for (let r = Math.ceil(alle[i] / step) * step + step; r < alle[i + 1] - step / 2; r += step) {
        if (r - alle[i] >= step && alle[i + 1] - r >= step) ticks.push(r);
      }
    }
    ticks.sort((a, b) => a - b);
  } else {
    ticks = [];
    for (let t = Math.floor(von / step) * step + step; t < total; t += step) ticks.push(t);
  }
  let letztesLabelX = -Infinity;
  for (const t of ticks) {
    const x = (t - von) / spanne * w;
    if (x > w - 46 * s) break;               // Platz fürs Endlabel lassen
    ctx.moveTo(x, y);
    ctx.lineTo(x, y + 3 * s);
    // zu dichte Grenzen oder krumme Zeiten: Tick ohne Label (fmt rundet
    // auf Minuten — ein Label an einer 90-s-Grenze würde lügen)
    if (x - letztesLabelX >= 30 * s && (!blocks || t % 60 === 0)) {
      ctx.fillText(fmt(t), x, y + 4 * s);
      letztesLabelX = x;
    }
  }
  ctx.stroke();
  ctx.textAlign = 'right';
  ctx.fillText(`${Math.round(total / 60)} min`, w - 1, y + 4 * s);
}

// Watt-Achse links (nur große Canvas). Zwei Phasen: Rasterlinien liegen
// unter den Balken, die Beschriftung darüber — sonst verdecken Balken den Text.
function zeichneWattachse(ctx, css, w, h, kopf, fuss, maxW, s, phase) {
  // Mindestabstand fix (Schrift ist gedeckelt) — nicht mit s skalieren,
  // sonst bleibt auf Handygröße nur eine einzige Rasterlinie übrig
  const raster = [25, 50, 100, 200].find(r => (h - kopf - fuss) * r / maxW >= 30) ?? 200;
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
    // oben abgeschnittene Beschriftung weglassen statt halb zeigen
    if (phase !== 'linien' && y - 2 - axisFont(s) >= 0) beschrifte(ctx, css, `${v} W`, 3, y - 2);
  }
  ctx.stroke();
}

// Achsentext mit Hof in Canvas-Hintergrundfarbe: bleibt lesbar, auch wenn
// eine Linie darunter durchläuft. Transparente Canvas (Fahrbildschirm)
// nimmt den Seitenhintergrund.
function beschrifte(ctx, css, text, x, y) {
  const bg = css('background-color');
  ctx.save();
  ctx.strokeStyle = !bg || bg === 'transparent' || bg.endsWith(', 0)') ? css('--bg') : bg;
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.strokeText(text, x, y);
  ctx.restore();
  ctx.fillText(text, x, y);
}

// Gestrichelte Referenzlinie bei 100 % FTP (nur wenn FTP bekannt und im Bild)
function zeichneFtpLinie(ctx, css, w, h, kopf, fuss, maxW, ftp, s, xLabel = w - 3) {
  if (!ftp || ftp >= maxW) return;
  const y = kopf + (h - kopf - fuss) * (1 - ftp / maxW);
  ctx.strokeStyle = css('--ink3');
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(0, y + 0.5);
  ctx.lineTo(w, y + 0.5);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = css('--ink2');
  ctx.font = `${axisFont(s)}px system-ui`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  beschrifte(ctx, css, 'FTP', xLabel, y - 1);
}

// Bereich nach Programmende (Ausfahren) gedämpft absetzen, mit gestrichelter
// Endlinie des Programms
function zeichneAusfahrBereich(ctx, css, x0, w, kopf, unten) {
  ctx.globalAlpha = 0.08;
  ctx.fillStyle = css('--ink2');
  ctx.fillRect(x0, kopf, w - x0, unten - kopf);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = css('--ink3');
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 4]);
  ctx.beginPath();
  ctx.moveTo(x0 + 0.5, kopf);
  ctx.lineTo(x0 + 0.5, unten);
  ctx.stroke();
  ctx.setLineDash([]);
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
    const mitte = (t + b.dauer / 2) / total * w;
    if (bw >= ctx.measureText(label).width + 10 && h - fuss - y >= 22) {
      ctx.fillText(label, mitte, y + 3);
      // Blockdauer darunter, wenn zusätzlich Platz ist
      const dauer = b.dauer % 60 === 0 ? `${b.dauer / 60} min`
        : `${Math.floor(b.dauer / 60)}:${String(b.dauer % 60).padStart(2, '0')}`;
      ctx.save();
      ctx.fillStyle = css('--power-line');
      ctx.globalAlpha = 0.7;
      ctx.font = `${axisFont(1)}px system-ui`;
      if (bw >= ctx.measureText(dauer).width + 10 && h - fuss - y >= 44) {
        ctx.fillText(dauer, mitte, y + 6 + labelFont(2));
      }
      ctx.restore();
    }
    t += b.dauer;
  }
}

// Gefahrene Leistung als Linie über den Samples. xFn darf null liefern
// (Sample ohne Position, z. B. Not-Stopp-Pause → Lücke). Springt x rückwärts
// (Block zurück), wird vom alten Durchlauf nur der tatsächlich ÜBERHOLTE
// Teil (x hinter der Sprungstelle) grau abgesetzt — er zählt nicht mehr;
// der Verlauf davor bleibt normal weiß. tFn (optional, Programmzeit pro
// Sample) macht Vorwärtssprünge (Skip) erkennbar: dort keine durchgezogene
// Linie, sondern eine graue gestrichelte Brücke über die Lücke.
function zeichneLeistungslinie(ctx, css, samples, count, xFn, yFn, breite = 1.5, tFn = null) {
  const zeichne = (pts, farbe, alpha) => {
    if (!pts.length) return;
    ctx.globalAlpha = alpha;
    if (pts.length === 1) {                    // Einzelpunkt sichtbar halten
      ctx.fillStyle = farbe;
      ctx.fillRect(pts[0][0] - breite / 2, pts[0][1] - breite / 2, breite, breite);
    } else {
      ctx.strokeStyle = farbe;
      ctx.lineWidth = breite;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  };
  const seg = [];
  let tPrev = null;
  for (let k = 0; k < count; k++) {
    const px = xFn(k);
    if (px === null) {                         // Lücke: Segment normal beenden
      zeichne(seg, css('--power-line'), 1);
      seg.length = 0;
      tPrev = null;
      continue;
    }
    const py = yFn(samples[k * FIELDS + 1]);
    const t = tFn ? tFn(k) : null;
    if (seg.length && tPrev !== null && t !== null && t - tPrev > 1.5) {
      // Vorwärtssprung (Skip): weißes Segment beenden, die übersprungene
      // Strecke nur als graue gestrichelte Brücke andeuten
      const [lx, ly] = seg[seg.length - 1];
      zeichne(seg, css('--power-line'), 1);
      seg.length = 0;
      ctx.globalAlpha = 0.8;
      ctx.strokeStyle = css('--ink3');
      ctx.lineWidth = Math.max(1, breite * 0.6);
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(lx, ly);
      ctx.lineTo(px, py);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
    if (seg.length && px < seg[seg.length - 1][0]) {
      // Rücksprung: Segment an der Sprungstelle teilen — vorderer Teil
      // bleibt gültig, der überholte hintere wird grau verworfen
      let i = seg.findIndex(p => p[0] >= px);
      if (i < 0) i = seg.length - 1;
      zeichne(seg.slice(0, i + 1), css('--power-line'), 1);
      zeichne(seg.slice(i), css('--ink3'), 0.8);
      seg.length = 0;
    }
    seg.push([px, py]);
    if (t !== null) tPrev = t;
  }
  zeichne(seg, css('--power-line'), 1);
}

// ---------- Darstellungen ----------

// Intensitätsprofil eines Programms: Zielblöcke als zonengefärbte Balken.
// Ab ~56 px Höhe zusätzlich Zeitachse, bei Gruppen Wiederholungsklammern.
export function drawProfile(canvas, blocks, ftp) {
  const p = prepCanvas(canvas);
  if (!p) return;
  const { ctx, w, h, css } = p;
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
    zeichneFtpLinie(ctx, css, w, h, kopf, fuss, maxW, ftp, s);
    zeichneBlockLabels(ctx, css, blocks, total, w, h, kopf, fuss, maxW, s);
  }
  if (fuss) zeichneZeitachse(ctx, css, w, h, fuss, total, s, gross ? blocks : null);
  zeichneKlammern(ctx, css, w, gruppen, total, s);
}

// Programm-Graph während der Fahrt: Zielblöcke, Ist-Linie, Positionscursor,
// Zeitachse, Wiederholungsklammern (TrainerRoad-Muster).
export class WorkoutChart {
  constructor(canvas) { this.canvas = canvas; }

  // zeitMap: Aufzeichnungszeit → Programmzeit (stückweise Offsets aus dem
  // ProgramRun) — Linie und Cursor liegen damit auch nach Zeitsprüngen exakt
  // auf der Programmachse. blink: Cursor nach einem Zeitsprung hervorheben.
  // Detailstufe (Wattachse, FTP-Linie, Blocklabels — wie drawProfile, nur
  // live): gross=true erzwingt sie (Graph-Fokus im Fahrbildschirm), sonst ab
  // 220 px Höhe; der kleine Fahrbildschirm-Chart bleibt reduziert.
  draw(blocks, total, samples, count, offset, ftp, zeitMap = t => t, blink = false, istPause = null, gross = null) {
    const p = prepCanvas(this.canvas);
    if (!p) return;
    const { ctx, w, h, css } = p;
    const s = scaleOf(h);
    gross ??= h >= 220;
    const gruppen = sammleGruppen(blocks);
    // Oberkante der Watt-Skala: Platz für Wiederholungsklammern + Polster —
    // dieselbe Abbildung für Balken, Linie, Achse, FTP-Linie und Labels
    const kopf = (gruppen.size ? 13 * s : 0) + 6 * s;
    const fuss = 13 * s;
    // Skala über ALLE Samples (nicht nur die letzten): sonst springt sie,
    // sobald eine Spitze aus dem Fenster fällt
    let maxW = 150;
    for (const b of blocks) maxW = Math.max(maxW, b.watt + offset);
    for (let k = 0; k < count; k++) maxW = Math.max(maxW, samples[k * FIELDS + 1]);
    maxW *= 1.15;
    // Ausfahren nach Programmende: Achse wächst mit, statt die Linie rechts
    // aus dem Canvas laufen zu lassen (Livetest: „nichts mehr getrackt")
    const letzteT = count ? zeitMap(samples[(count - 1) * FIELDS]) : 0;
    const anzeigeTotal = Math.max(total, letzteT);
    const x = t => t / anzeigeTotal * w;
    const y = v => (h - fuss) - Math.max(0, v) / maxW * (h - fuss - kopf);
    // Blocklabels/Balken zeigen die effektiven Watt (inkl. ±-Offset)
    const effBlocks = offset ? blocks.map(b => ({ ...b, watt: b.watt + offset })) : blocks;

    if (gross) zeichneWattachse(ctx, css, w, h, kopf, fuss, maxW, s, 'linien');
    let t = 0;
    ctx.globalAlpha = 0.42;
    for (const b of effBlocks) {
      ctx.fillStyle = css(zoneVar(b.watt, ftp));
      ctx.fillRect(x(t) + 0.5, y(b.watt), x(t + b.dauer) - x(t) - 1, (h - fuss) - y(b.watt));
      t += b.dauer;
    }
    ctx.globalAlpha = 1;
    // Ausfahr-Bereich optisch absetzen: gedämpfte Fläche + Endlinie des Programms
    if (anzeigeTotal > total) zeichneAusfahrBereich(ctx, css, x(total), w, kopf, h - fuss);
    if (gross) {
      zeichneWattachse(ctx, css, w, h, kopf, fuss, maxW, s, 'labels');
      zeichneFtpLinie(ctx, css, w, h, kopf, fuss, maxW, ftp, s);
      zeichneBlockLabels(ctx, css, effBlocks, anzeigeTotal, w, h, kopf, fuss, maxW, s);
    }
    zeichneZeitachse(ctx, css, w, h, fuss, anzeigeTotal, s, blocks);

    zeichneLeistungslinie(ctx, css, samples, count, k => {
      const t = samples[k * FIELDS];
      return istPause?.(t) ? null : x(zeitMap(t));
    }, y, 1.5 * Math.min(s, 1.6), k => zeitMap(samples[k * FIELDS]));

    if (count) {
      const px = x(zeitMap(samples[(count - 1) * FIELDS]));
      ctx.strokeStyle = blink ? css('--accent') : css('--ink2');
      ctx.lineWidth = blink ? 2.5 : 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(px, kopf);
      ctx.lineTo(px, h - fuss);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    zeichneKlammern(ctx, css, w, gruppen, anzeigeTotal, s);
  }
}

// Rollierendes 10-Minuten-Fenster beim freien Fahren: Zielleistung als
// Stufenfläche, Ist-Leistung als Linie. Achsen aus denselben Bausteinen wie
// die übrigen Charts; Detailstufe (Beschriftung, FTP-Linie, Zeitachse) im
// Graph-Fokus bzw. ab 220 px Höhe.
const WINDOW_S = 600;

export class LiveChart {
  constructor(canvas) { this.canvas = canvas; }

  draw(samples, count, target, ftp = 0, gross = null) {
    const p = prepCanvas(this.canvas);
    if (!p || !count) return;
    const { ctx, w, h, css } = p;
    const s = scaleOf(h);
    gross ??= h >= 220;
    const from = Math.max(0, count - WINDOW_S);
    let maxW = target;
    for (let k = from; k < count; k++)
      maxW = Math.max(maxW, samples[k * FIELDS + 1], samples[k * FIELDS + 2]);
    maxW = Math.max(150, Math.ceil(maxW * 1.15 / 50) * 50);
    const kopf = 6 * s;
    const fuss = gross ? 13 * s : 0;
    const x = k => (k - from) / WINDOW_S * w;
    const y = v => (h - fuss) - v / maxW * (h - fuss - kopf);

    zeichneWattachse(ctx, css, w, h, kopf, fuss, maxW, s, 'linien');

    // Zielleistung als gefüllte Stufenfläche
    ctx.fillStyle = css('--target-fill');
    ctx.beginPath();
    ctx.moveTo(x(from), h - fuss);
    for (let k = from; k < count; k++) {
      const v = samples[k * FIELDS + 2];
      ctx.lineTo(x(k), y(v));
      ctx.lineTo(x(k + 1), y(v));
    }
    ctx.lineTo(x(count), h - fuss);
    ctx.closePath();
    ctx.fill();

    zeichneLeistungslinie(ctx, css, samples.subarray(from * FIELDS), count - from,
      k => x(from + k), y, 2);

    if (gross) {
      zeichneWattachse(ctx, css, w, h, kopf, fuss, maxW, s, 'labels');
      zeichneFtpLinie(ctx, css, w, h, kopf, fuss, maxW, ftp, s);
      zeichneZeitachse(ctx, css, w, h, fuss, from + WINDOW_S, s, null, from);
    } else {
      // Reduziert: nur die Skalen-Obergrenze als Orientierung
      ctx.fillStyle = css('--ink3');
      ctx.font = `${axisFont(1)}px system-ui`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      beschrifte(ctx, css, `${maxW} W`, 4, 2);
    }
  }
}

// Gleitender, zentrierter Mittelwert eines Sample-Felds. mitNullen=false:
// 0 heißt „kein Wert" (HF ohne Gurtkontakt) — zählt nicht mit und bleibt als
// Lücke (NaN) stehen, statt die Kurve auf 0 zu ziehen.
function glaette(samples, count, feld, fenster, mitNullen = true) {
  const out = new Float32Array(count);
  const r = Math.floor(fenster / 2);
  for (let k = 0; k < count; k++) {
    if (!mitNullen && !samples[k * FIELDS + feld]) { out[k] = NaN; continue; }
    let sum = 0, n = 0;
    for (let j = Math.max(0, k - r); j <= Math.min(count - 1, k + r); j++) {
      const v = samples[j * FIELDS + feld];
      if (mitNullen || v) { sum += v; n++; }
    }
    out[k] = sum / n;
  }
  return out;
}

// Detailansicht einer gespeicherten Fahrt (klein und im Vollbild-Overlay):
// Zielblöcke zonengefärbt wie im Fahrbildschirm, Ist-Leistung 3-s-geglättet,
// Herzfrequenz als eigene Kurve mit bpm-Achse rechts, Not-Stopps und
// Ausfahren nach Programmende gedämpft.
// opts: ftp (Zonenfarben + FTP-Linie), programmEnde (Sekunde, ab der
// ausgefahren wurde — null bei freiem Fahren/alten Fahrten)
export function drawSessionChart(canvas, samples, count, { ftp = 0, programmEnde = null } = {}) {
  const p = prepCanvas(canvas);
  if (!p || !count) return;
  const { ctx, w, h, css } = p;
  const s = scaleOf(h);
  const gross = h >= 160;                    // Achsen + FTP-Linie
  const kopf = 6 * s;
  const fuss = 13 * s;
  const unten = h - fuss;
  const watt = glaette(samples, count, 1, 3);
  let maxW = 100;
  for (let k = 0; k < count; k++) maxW = Math.max(maxW, watt[k], samples[k * FIELDS + 2]);
  maxW *= 1.1;
  const x = k => k / count * w;
  const y = v => unten - Math.max(0, v) / maxW * (unten - kopf);

  if (gross) zeichneWattachse(ctx, css, w, h, kopf, fuss, maxW, s, 'linien');

  // Zielblöcke: Lauflängen der Zielleistung. Ziel 0 vor Programmende =
  // Not-Stopp/Pause → gedämpfter Streifen statt Block
  const ende = programmEnde && programmEnde < count ? programmEnde : count;
  for (let a = 0, k = 1; k <= count; k++) {
    const ziel = samples[a * FIELDS + 2];
    if (k < count && samples[k * FIELDS + 2] === ziel) continue;
    if (ziel > 0) {
      ctx.globalAlpha = 0.42;
      ctx.fillStyle = css(zoneVar(ziel, ftp));
      ctx.fillRect(x(a), y(ziel), x(k) - x(a), unten - y(ziel));
    } else if (a < ende) {
      ctx.globalAlpha = 0.08;
      ctx.fillStyle = css('--ink2');
      ctx.fillRect(x(a), kopf, x(Math.min(k, ende)) - x(a), unten - kopf);
    }
    a = k;
  }
  ctx.globalAlpha = 1;
  if (ende < count) zeichneAusfahrBereich(ctx, css, x(ende), w, kopf, unten);

  // HF-Skala: eigener Bereich (10er-gerundet) über die volle Plothöhe
  const hf = glaette(samples, count, 4, 5, false);
  let hfMin = Infinity, hfMax = 0;
  for (const v of hf) if (v > 0) { hfMin = Math.min(hfMin, v); hfMax = Math.max(hfMax, v); }
  const mitHf = hfMax > 0;
  const hfLo = Math.floor((hfMin - 5) / 10) * 10, hfHi = Math.ceil((hfMax + 5) / 10) * 10;
  const yHf = v => unten - (v - hfLo) / (hfHi - hfLo) * (unten - kopf);

  const breite = 1.4 * Math.min(s, 1.3);     // wächst im Overlay kaum mit
  const geglaettet = Int16Array.from(samples.subarray(0, count * FIELDS));
  for (let k = 0; k < count; k++) geglaettet[k * FIELDS + 1] = Math.round(watt[k]);
  zeichneLeistungslinie(ctx, css, geglaettet, count, x, y, breite);

  if (mitHf) {
    ctx.strokeStyle = css('--hr-line');
    ctx.lineWidth = breite;
    ctx.lineJoin = 'round';
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    let offen = false;
    for (let k = 0; k < count; k++) {
      if (Number.isNaN(hf[k])) { offen = false; continue; }
      offen ? ctx.lineTo(x(k), yHf(hf[k])) : ctx.moveTo(x(k), yHf(hf[k]));
      offen = true;
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  let xFtpLabel = w - 3;
  if (gross) {
    zeichneWattachse(ctx, css, w, h, kopf, fuss, maxW, s, 'labels');
    if (mitHf) {
      // bpm-Beschriftung rechts, ohne eigene Rasterlinien (die gehören der Wattachse)
      ctx.fillStyle = css('--hr-line');
      ctx.font = `${axisFont(s)}px system-ui`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      const schritt = [10, 20, 40].find(r => (unten - kopf) * r / (hfHi - hfLo) >= 30) ?? 40;
      for (let v = Math.ceil((hfLo + 1) / schritt) * schritt; v < hfHi; v += schritt) {
        const yy = yHf(v);
        if (yy - 2 - axisFont(s) >= 0 && unten - yy >= 4) beschrifte(ctx, css, `${v} bpm`, w - 3, yy - 2);
      }
      xFtpLabel = w - 3 - ctx.measureText('000 bpm').width - 8;
    }
    zeichneFtpLinie(ctx, css, w, h, kopf, fuss, maxW, ftp, s, xFtpLabel);
  }
  zeichneZeitachse(ctx, css, w, h, fuss, count, s);
}
