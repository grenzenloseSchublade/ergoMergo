// Detailansicht einer gespeicherten Fahrt: Kennwerte, Graph (mit HF),
// Intervall-Report, Export (TCX-Datei) und Löschen.

import { getSamples, deleteSession, getSettings, FIELDS } from '../storage.js';
import { toastOk } from './toast.js';
import { toTCX, download, tcxDateiname } from '../export.js';
import { drawSessionChart, beobachte } from './chart.js';
import { zeigeGraphOverlay } from './overlay.js';
import { fmtTime, fmtKm } from '../format.js';
import { effektiveFtp } from '../metrics.js';
import { planBeschreibung } from '../plan.js';
import { zonenBalken, ergaenzeKennwerte, programmEndeVon } from './list.js';

// Intervall-Report: Blöcke aus den Ziel-Samples ableiten (Lauflängen der
// Zielleistung) und je Block Ziel gegen gefahrenen Schnitt stellen. Nur bis
// Programmende (das Ausfahren verschmölze sonst mit dem letzten Block);
// Ziel 0 = Not-Stopp, ohne Wertung.
function complianceReport(samples, count, programmEnde) {
  const ende = programmEnde && programmEnde < count ? programmEnde : count;
  const bloecke = [];
  let start = 0;
  for (let k = 1; k <= ende; k++) {
    if (k === ende || samples[k * FIELDS + 2] !== samples[start * FIELDS + 2]) {
      const dauer = k - start;
      const ziel = samples[start * FIELDS + 2];
      // Rampen-/Übergangsstückchen ignorieren (Stopps ab 5 s zeigen)
      if (dauer >= (ziel ? 30 : 5)) {
        let sum = 0;
        for (let i = start; i < k; i++) sum += samples[i * FIELDS + 1];
        bloecke.push({ dauer, ziel, ist: Math.round(sum / dauer) });
      }
      start = k;
    }
  }
  return bloecke;
}

function complianceHtml(samples, count, programmEnde) {
  const bloecke = complianceReport(samples, count, programmEnde);
  if (bloecke.length < 2) return '';
  let nr = 0;
  const zeilen = bloecke.map(b => {
    if (!b.ziel) return `<tr class="stopp"><td></td><td>${fmtTime(b.dauer)}</td><td colspan="3">Stopp</td></tr>`;
    const diff = Math.round((b.ist / b.ziel - 1) * 100);
    const cls = Math.abs(diff) <= 5 ? 'ok' : diff < 0 ? 'unter' : 'ueber';
    return `<tr><td>${++nr}</td><td>${fmtTime(b.dauer)}</td><td>${b.ziel} W</td><td>${b.ist} W</td><td class="${cls}">${diff > 0 ? '+' : ''}${diff} %</td></tr>`;
  }).join('');
  return `<details class="compliance"><summary>Intervall-Report (${nr} Blöcke)</summary>
    <table><thead><tr><th>#</th><th>Dauer</th><th>Ziel</th><th>Ø Ist</th><th>Δ</th></tr></thead>
    <tbody>${zeilen}</tbody></table></details>`;
}

// demo: mitgelieferte Samples (?demo=fahrt/fahrten) — nichts wird gelesen,
// gespeichert, gelöscht oder hochgeladen. Liefert eine Aufräumfunktion.
export async function renderDetail(root, session, onClose, { demo = null } = {}) {
  root.dataset.fahrt = session.id;         // gegen späte Ergebnisse einer vorigen Fahrt
  root.querySelector('#d-title').textContent =
    new Date(session.start).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
  root.querySelector('#d-demo').hidden = !demo;
  // Programm und — bei Fahrten aus dem Trainingsplan — Woche und Einheit
  root.querySelector('#d-programm-name').textContent = session.programm ?? 'Freies Fahren';
  root.querySelector('#d-plan').hidden = !session.plan;
  root.querySelector('#d-plan-text').textContent = planBeschreibung(session.plan);
  const data = demo ?? await getSamples(session.id);
  const settings = await getSettings();

  if (data && !demo) await ergaenzeKennwerte(session, data);

  // Ø/max beziehen sich aufs Programm, sobald danach ausgefahren wurde
  const imProgramm = session.ausgefahrenSek > 0 ? ' (Programm)' : '';
  const stats = [
    ['Dauer', fmtTime(session.dauer)], [`Ø${imProgramm}`, `${session.avgW} W`], ['max', `${session.maxW} W`],
    ['Arbeit', `${session.kJ} kJ`], ['Ø Kadenz', `${session.avgRpm} rpm`],
  ];
  if (session.km) stats.push(['Distanz', `${fmtKm(session.km)} km`]);
  if (session.np) stats.push(['NP', `${session.np} W`]);
  if (session.if) stats.push(['IF', session.if], ['TSS', session.tss]);
  if (session.hrAvg) stats.push(['Ø HF', `${session.hrAvg} bpm`, 'hf'], ['max HF', `${session.hrMax} bpm`, 'hf']);
  if (session.akkuProStunde) stats.push(['Akku', `≈ ${session.akkuProStunde} %/h`]);
  root.querySelector('#d-stats').innerHTML =
    stats.map(([k, v, cls]) => `<span${cls ? ` class="${cls}"` : ''}>${k} <b>${v}</b></span>`).join('')
    + zonenBalken(session.zonenSek, 8);

  let aufraeumen = () => {};
  if (data) {
    const canvas = root.querySelector('#detail-chart');
    const opts = { ftp: effektiveFtp(session.ftp || settings.ftp), programmEnde: programmEndeVon(session) };
    const zeichne = c => drawSessionChart(c, data.samples, data.count, opts);
    zeichne(canvas);
    canvas.onclick = () => zeigeGraphOverlay(zeichne,
      session.programm, `${fmtTime(session.dauer)} · Ø ${session.avgW} W · max ${session.maxW} W`);
    aufraeumen = beobachte(canvas, zeichne);   // Drehen: neu zeichnen
  }

  root.querySelector('#d-compliance').innerHTML =
    data ? complianceHtml(data.samples, data.count, programmEndeVon(session)) : '';

  root.querySelector('#btn-tcx').onclick = () => {
    if (!data) return;
    download(tcxDateiname(session), toTCX(session, data.samples, data.count));
    toastOk('TCX heruntergeladen');
  };

  root.querySelector('#btn-delete').hidden = !!demo;
  root.querySelector('#btn-delete').onclick = async () => {
    if (confirm('Fahrt endgültig löschen?')) { await deleteSession(session.id); onClose(); }
  };
  return aufraeumen;
}
