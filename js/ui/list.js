// Trainingsliste (Start) und Detailansicht mit Export/Löschen.

import { listSessions, getSamples, deleteSession } from '../storage.js';
import { toTCX, download } from '../export.js';
import { drawSessionChart } from './chart.js';
import { zeigeGraphOverlay } from './overlay.js';
import { fmtTime } from './ride.js';

export async function renderList(ul, onOpen) {
  const sessions = await listSessions();
  ul.replaceChildren();
  if (!sessions.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Noch keine Fahrten';
    ul.append(li);
    return;
  }
  for (const s of sessions) {
    const li = document.createElement('li');
    const d = new Date(s.start);
    li.innerHTML = `<span>${d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })}
      ${d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</span>
      <span class="meta">${s.programm} · ${fmtTime(s.dauer)} · Ø ${s.avgW} W · ${s.kJ} kJ${s.final ? '' : ' · abgebrochen'}</span>`;
    li.addEventListener('click', () => onOpen(s));
    ul.append(li);
  }
}

export async function renderDetail(root, session, onClose) {
  root.querySelector('#d-title').textContent =
    new Date(session.start).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
  root.querySelector('#d-stats').innerHTML = [
    ['Dauer', fmtTime(session.dauer)], ['Ø', `${session.avgW} W`], ['max', `${session.maxW} W`],
    ['Arbeit', `${session.kJ} kJ`], ['Ø Kadenz', `${session.avgRpm} rpm`],
  ].map(([k, v]) => `<span>${k} <b>${v}</b></span>`).join('');

  const data = await getSamples(session.id);
  let cleanup = () => {};
  if (data) {
    const canvas = root.querySelector('#detail-chart');
    const redraw = () => drawSessionChart(canvas, data.samples, data.count);
    redraw();
    canvas.onclick = () => zeigeGraphOverlay(
      c => drawSessionChart(c, data.samples, data.count),
      `${session.programm} <span>· ${fmtTime(session.dauer)} · Ø ${session.avgW} W · max ${session.maxW} W</span>`);
    // Bei Orientierungswechsel neu zeichnen; Aufrufer baut den Listener ab
    addEventListener('resize', redraw);
    cleanup = () => removeEventListener('resize', redraw);
  }

  root.querySelector('#btn-tcx').onclick = () =>
    data && download(`ergomergo-${session.id.slice(0, 19).replaceAll(':', '-')}.tcx`,
      toTCX(session, data.samples, data.count));
  root.querySelector('#btn-delete').onclick = async () => {
    if (confirm('Fahrt endgültig löschen?')) { await deleteSession(session.id); onClose(); }
  };
  return cleanup;
}

function drawWhole(chart, samples, count) {
  const c = chart.canvas, ctx = chart.ctx;
  const dpr = devicePixelRatio || 1;
  const w = c.clientWidth, h = c.clientHeight;
  c.width = w * dpr; c.height = h * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (!count) return;
  let maxW = 100;
  for (let k = 0; k < count; k++) maxW = Math.max(maxW, samples[k * FIELDS + 1], samples[k * FIELDS + 2]);
  maxW *= 1.1;
  const x = k => k / count * w, y = v => h - v / maxW * (h - 8);
  const css = n => getComputedStyle(c).getPropertyValue(n).trim();
  ctx.fillStyle = css('--target-fill');
  ctx.beginPath();
  ctx.moveTo(0, h);
  for (let k = 0; k < count; k++) ctx.lineTo(x(k), y(samples[k * FIELDS + 2]));
  ctx.lineTo(w, h); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = css('--power-line');
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let k = 0; k < count; k++) {
    const px = x(k), py = y(samples[k * FIELDS + 1]);
    k ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
  }
  ctx.stroke();
}
