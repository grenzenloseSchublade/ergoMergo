// Trainingsliste (Start) und Detailansicht mit Export/Löschen.

import { listSessions, getSamples, deleteSession, getSettings, FIELDS } from '../storage.js';
import { logInfo, logError } from '../logger.js';
import { toastOk, toastErr } from './toast.js';
import { toTCX, download } from '../export.js';
import { drawSessionChart } from './chart.js';
import { zeigeGraphOverlay } from './overlay.js';
import { fmtTime } from '../format.js';
import { kennwerte } from '../metrics.js';

// Zeit-in-Zonen als schmaler Farbbalken (HTML, nutzt --z1..--z6)
function zonenBalken(zonenSek, hoehe = 6) {
  if (!zonenSek || !zonenSek.some(s => s > 0)) return '';
  const total = zonenSek.reduce((a, b) => a + b, 0);
  const teile = zonenSek.map((s, z) => s > 0
    ? `<i style="flex:${s / total};background:var(--z${z + 1})"></i>` : '').join('');
  return `<span class="zonen" style="height:${hoehe}px">${teile}</span>`;
}

// Compliance-Report: Blöcke aus den Ziel-Samples ableiten (Lauflängen der
// Zielleistung) und je Block Ziel gegen gefahrenen Schnitt stellen.
function complianceReport(samples, count) {
  const bloecke = [];
  let start = 0;
  for (let k = 1; k <= count; k++) {
    if (k === count || samples[k * FIELDS + 2] !== samples[start * FIELDS + 2]) {
      const dauer = k - start;
      if (dauer >= 30) {                     // Rampen-/Übergangsstückchen ignorieren
        let sum = 0;
        for (let i = start; i < k; i++) sum += samples[i * FIELDS + 1];
        bloecke.push({ dauer, ziel: samples[start * FIELDS + 2], ist: Math.round(sum / dauer) });
      }
      start = k;
    }
  }
  return bloecke;
}

function complianceHtml(samples, count) {
  const bloecke = complianceReport(samples, count);
  if (bloecke.length < 2) return '';
  const zeilen = bloecke.map((b, i) => {
    const diff = b.ziel ? Math.round((b.ist / b.ziel - 1) * 100) : 0;
    const cls = Math.abs(diff) <= 5 ? 'ok' : diff < 0 ? 'unter' : 'ueber';
    return `<tr><td>${i + 1}</td><td>${fmtTime(b.dauer)}</td><td>${b.ziel} W</td><td>${b.ist} W</td><td class="${cls}">${diff > 0 ? '+' : ''}${diff} %</td></tr>`;
  }).join('');
  return `<details class="compliance"><summary>Intervall-Report (${bloecke.length} Blöcke)</summary>
    <table><thead><tr><th>#</th><th>Dauer</th><th>Ziel</th><th>Ø Ist</th><th>Δ</th></tr></thead>
    <tbody>${zeilen}</tbody></table></details>`;
}

// Wochenbilanz: aktuelle Woche (ab Montag) gegen Vorwoche
export function wochenbilanz(sessions) {
  const jetzt = new Date();
  const wochenstart = new Date(jetzt);
  wochenstart.setHours(0, 0, 0, 0);
  wochenstart.setDate(wochenstart.getDate() - (wochenstart.getDay() + 6) % 7);
  const vorwochenstart = new Date(wochenstart);
  vorwochenstart.setDate(vorwochenstart.getDate() - 7);
  const summe = list => list.reduce((a, s) => ({
    n: a.n + 1, sek: a.sek + s.dauer, kJ: a.kJ + s.kJ, tss: a.tss + (s.tss ?? 0),
    akku: a.akku + (s.akkuProStunde ?? 0), akkuN: a.akkuN + (s.akkuProStunde ? 1 : 0),
  }), { n: 0, sek: 0, kJ: 0, tss: 0, akku: 0, akkuN: 0 });
  return {
    woche: summe(sessions.filter(s => s.start >= wochenstart.getTime())),
    vorwoche: summe(sessions.filter(s => s.start >= vorwochenstart.getTime() && s.start < wochenstart.getTime())),
  };
}

export async function renderList(ul, onOpen) {
  const sessions = await listSessions();

  // Wochenbilanz über der Liste
  const bilanzEl = document.querySelector('#wochenbilanz');
  if (bilanzEl) {
    if (sessions.length) {
      const { woche, vorwoche } = wochenbilanz(sessions);
      const fmt = b => `${b.n} ${b.n === 1 ? 'Fahrt' : 'Fahrten'} · ${fmtTime(b.sek)} · ${Math.round(b.kJ)} kJ${b.tss ? ` · ${b.tss} TSS` : ''}${b.akkuN ? ` · ≈ ${Math.round(b.akku / b.akkuN * 10) / 10} %/h Akku` : ''}`;
      bilanzEl.innerHTML = `<b>Diese Woche:</b> ${fmt(woche)}<br><span>Vorwoche: ${fmt(vorwoche)}</span>`;
      bilanzEl.hidden = false;
    } else {
      bilanzEl.hidden = true;
    }
  }

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
    li.innerHTML = `<span class="zeile"><span>${d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })}
      ${d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</span>
      <span class="meta">${s.programm} · ${fmtTime(s.dauer)} · Ø ${s.avgW} W · ${s.kJ} kJ${s.final ? '' : ' · abgebrochen'}</span></span>
      ${zonenBalken(s.zonenSek, 5)}`;
    li.addEventListener('click', () => onOpen(s));
    ul.append(li);
  }
}

export async function renderDetail(root, session, onClose) {
  root.querySelector('#d-title').textContent =
    new Date(session.start).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
  const data = await getSamples(session.id);

  // Fehlende Kennwerte (alte Sessions) aus den Rohsamples nachberechnen
  if (data && session.np === undefined) {
    Object.assign(session, kennwerte(data.samples, data.count, session.ftp ?? 0));
  }

  const stats = [
    ['Dauer', fmtTime(session.dauer)], ['Ø', `${session.avgW} W`], ['max', `${session.maxW} W`],
    ['Arbeit', `${session.kJ} kJ`], ['Ø Kadenz', `${session.avgRpm} rpm`],
  ];
  if (session.np) stats.push(['NP', `${session.np} W`]);
  if (session.if) stats.push(['IF', session.if], ['TSS', session.tss]);
  if (session.hrAvg) stats.push(['Ø HF', `${session.hrAvg} bpm`], ['max HF', `${session.hrMax} bpm`]);
  if (session.akkuProStunde) stats.push(['Akku', `≈ ${session.akkuProStunde} %/h`]);
  root.querySelector('#d-stats').innerHTML =
    stats.map(([k, v]) => `<span>${k} <b>${v}</b></span>`).join('')
    + zonenBalken(session.zonenSek, 8);
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

  root.querySelector('#d-compliance').innerHTML =
    data ? complianceHtml(data.samples, data.count) : '';

  root.querySelector('#btn-tcx').onclick = () => {
    if (!data) return;
    download(`ergomergo-${session.id.slice(0, 19).replaceAll(':', '-')}.tcx`,
      toTCX(session, data.samples, data.count));
    toastOk('TCX heruntergeladen');
  };

  // Upload zu intervals.icu (Basic Auth, CORS nur auf /api/v1/-Endpunkten)
  const { icuApiKey } = await getSettings();
  const icuBtn = root.querySelector('#btn-icu');
  icuBtn.hidden = !icuApiKey || !data;
  icuBtn.onclick = async () => {
    icuBtn.disabled = true;
    try {
      const fd = new FormData();
      fd.append('file', new Blob([toTCX(session, data.samples, data.count)], { type: 'application/xml' }),
        `ergomergo-${session.id.slice(0, 19).replaceAll(':', '-')}.tcx`);
      fd.append('name', `ergoMergo: ${session.programm}`);
      const resp = await fetch('https://intervals.icu/api/v1/athlete/0/activities', {
        method: 'POST',
        headers: { Authorization: 'Basic ' + btoa('API_KEY:' + icuApiKey) },
        body: fd,
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      logInfo('icu', 'Upload ok', session.id);
      icuBtn.textContent = '✓ hochgeladen';
      toastOk('Bei intervals.icu hochgeladen');
    } catch (err) {
      logError('icu', 'Upload fehlgeschlagen', err.message);
      toastErr('intervals.icu-Upload fehlgeschlagen: ' + err.message);
      icuBtn.disabled = false;
    }
  };
  icuBtn.disabled = false;
  icuBtn.textContent = '→ intervals.icu';
  root.querySelector('#btn-delete').onclick = async () => {
    if (confirm('Fahrt endgültig löschen?')) { await deleteSession(session.id); onClose(); }
  };
  return cleanup;
}
