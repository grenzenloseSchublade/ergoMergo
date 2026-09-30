// Fahrten-Listen: Startbildschirm (Wochendiagramm + letzte Fahrten) und
// Screen „Fahrten" (Monate/Wochen). Die Detailansicht lebt in detail.js.

import { listSessions, getSamples, saveSession } from '../storage.js';
import { fmtTime, fmtKm, fmtDauer, esc } from '../format.js';
import { fahrtStats } from '../metrics.js';

// Zeit-in-Zonen als schmaler Farbbalken (HTML, nutzt --z1..--z6)
export function zonenBalken(zonenSek, hoehe = 6) {
  if (!zonenSek || !zonenSek.some(s => s > 0)) return '';
  const total = zonenSek.reduce((a, b) => a + b, 0);
  const teile = zonenSek.map((s, z) => s > 0
    ? `<i style="flex:${s / total};background:var(--z${z + 1})"></i>` : '').join('');
  return `<span class="zonen" style="height:${hoehe}px">${teile}</span>`;
}

// ---------- Wochen ----------

const WOCHEN_IM_DIAGRAMM = 8;

// Montag 0:00 (lokal) der Woche, in der t liegt
function wochenstart(t) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (d.getDay() + 6) % 7);
  return d.getTime();
}

// Wochenstart n Wochen vor/nach ws (Kalendertage, damit Zeitumstellung egal ist)
function wochePlus(ws, n) {
  const d = new Date(ws);
  d.setDate(d.getDate() + 7 * n);
  return d.getTime();
}

// ISO-Kalenderwoche (Donnerstag der Woche bestimmt das Jahr)
function kalenderwoche(ws) {
  const d = new Date(ws);
  d.setDate(d.getDate() + 3);
  const jan4 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d - jan4) / 864e5 - 3 + (jan4.getDay() + 6) % 7) / 7);
}

function wochenSumme(sessions) {
  return sessions.reduce((a, s) => ({
    n: a.n + 1, sek: a.sek + s.dauer, kJ: a.kJ + s.kJ, tss: a.tss + (s.tss ?? 0),
    km: a.km + (s.km ?? 0),
    akku: a.akku + (s.akkuProStunde ?? 0), akkuN: a.akkuN + (s.akkuProStunde ? 1 : 0),
  }), { n: 0, sek: 0, kJ: 0, tss: 0, km: 0, akku: 0, akkuN: 0 });
}

// „Diese Woche" / „Vorwoche" / „KW 38" + Datumsspanne Mo–So
function wochenName(ws) {
  const jetzt = wochenstart(Date.now());
  const name = ws === jetzt ? 'Diese Woche' : ws === wochePlus(jetzt, -1) ? 'Vorwoche' : `KW ${kalenderwoche(ws)}`;
  const tag = t => new Date(t).toLocaleDateString('de-DE', { day: 'numeric', month: 'numeric' });
  const so = new Date(ws); so.setDate(so.getDate() + 6);
  return { name, spanne: `${tag(ws)}–${tag(so)}` };
}

// Balkendiagramm Fahrzeit je Woche, aktuelle Woche in Akzentfarbe
function wochenDiagramm(sessions) {
  const jetzt = wochenstart(Date.now());
  const wochen = [];
  for (let i = WOCHEN_IM_DIAGRAMM - 1; i >= 0; i--) {
    const ws = wochePlus(jetzt, -i);
    const bis = wochePlus(ws, 1);
    wochen.push({ ws, ...wochenSumme(sessions.filter(s => s.start >= ws && s.start < bis)) });
  }
  const max = Math.max(...wochen.map(w => w.sek), 1);
  const balken = wochen.map(w => `<span class="wb${w.ws === jetzt ? ' jetzt' : ''}">
      <b>${w.sek ? fmtDauer(w.sek) : ''}</b>
      <i style="height:${(w.sek / max * 3).toFixed(2)}rem"></i>
      <s>${w.ws === jetzt ? 'jetzt' : kalenderwoche(w.ws)}</s></span>`).join('');
  const alle = wochenSumme(wochen.flatMap(w => sessions.filter(s => s.start >= w.ws && s.start < wochePlus(w.ws, 1))));
  return `<span class="bilanz-head">Fahrzeit je Woche <i>· KW, letzte ${WOCHEN_IM_DIAGRAMM} Wochen</i></span>
    <span class="wochen-balken">${balken}</span>${alle.akkuN
      ? `<span class="bilanz-fuss">Ø Akku ≈ ${Math.round(alle.akku / alle.akkuN * 10) / 10} %/h</span>` : ''}`;
}

// Kopfzeile einer Woche in der Fahrtenliste: Name + Summen
function wochenKopf(ws, fahrten) {
  const li = document.createElement('li');
  li.className = 'woche';
  const { name, spanne } = wochenName(ws);
  const w = wochenSumme(fahrten);
  li.innerHTML = `<span class="w-titel">${name} <i>${spanne}</i></span>
    <span class="w-summe">${w.n} ${w.n === 1 ? 'Fahrt' : 'Fahrten'} · ${fmtDauer(w.sek)}${w.km ? ` · ${fmtKm(w.km)} km` : ''}${w.tss ? ` · ${w.tss} TSS` : ''}</span>`;
  return li;
}

// Fahrten unter dieser Dauer (Probefahrten, Fehlstarts) gedimmt listen
const KURZ_SEK = 120;

// Programmende einer gespeicherten Fahrt: neue Fahrten speichern es, ältere
// nur die Ausfahr-Dauer
export const programmEndeVon = s => s.programmEndeBei ?? (s.ausgefahrenSek ? s.dauer - s.ausgefahrenSek : null);

// Kennwerte, die ältere Versionen noch nicht gespeichert haben (NP, km, HF,
// Zonen), aus den Rohsamples nachrechnen und persistieren — mit derselben
// Rechnung wie beim Speichern (Programmfenster!). Liefert true, wenn etwas
// ergänzt wurde.
export async function ergaenzeKennwerte(session, data) {
  if (session.np !== undefined && session.km !== undefined) return false;
  data ??= await getSamples(session.id);
  if (!data) return false;
  Object.assign(session, fahrtStats(data.samples, data.count, programmEndeVon(session), session.ftp ?? 0));
  await saveSession(session);
  return true;
}

// Eine Fahrt als Listenzeile: Datum + Programm, darunter die Kennzahlen,
// Zonenbalken; Probefahrten gedimmt
function fahrtZeile(s, onOpen) {
  const li = document.createElement('li');
  li.classList.toggle('kurz', s.dauer < KURZ_SEK);
  const d = new Date(s.start);
  li.innerHTML = `<span class="zeile"><span class="datum">${d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })}
    · ${d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</span>
    <span class="prog">${esc(s.programm)}</span></span>
    <span class="meta">${fmtTime(s.dauer)} · Ø ${s.avgW} W · ${s.kJ} kJ${s.km ? ` · ${fmtKm(s.km)} km` : ''}${s.final ? '' : ' · abgebrochen'}</span>
    ${zonenBalken(s.zonenSek, 5)}`;
  li.addEventListener('click', () => onOpen(s));
  return li;
}

// Alle Fahrten laden; Kennwerte, die ältere Versionen nicht gespeichert
// haben, einmalig nachrechnen (sonst fehlen km und Zonenbalken)
async function ladeFahrten() {
  const sessions = await listSessions();
  for (const s of sessions) await ergaenzeKennwerte(s);
  return sessions;
}

const HOME_FAHRTEN = 3;

// Startbildschirm: Wochendiagramm + die letzten Fahrten + „Alle Fahrten ›".
// Bleibt gleich lang, egal wie viele Fahrten gespeichert sind.
export async function renderHome(ul, onOpen, onAlle) {
  const sessions = await ladeFahrten();
  const bilanzEl = document.querySelector('#wochenbilanz');
  bilanzEl.hidden = !sessions.length;
  if (sessions.length) {
    bilanzEl.innerHTML = wochenDiagramm(sessions);
    bilanzEl.onclick = onAlle;
  }
  const alle = document.querySelector('#btn-alle-fahrten');
  alle.hidden = !sessions.length;
  alle.textContent = `Alle Fahrten (${sessions.length}) ›`;
  alle.onclick = onAlle;

  ul.replaceChildren();
  if (!sessions.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Noch keine Fahrten';
    ul.append(li);
    return;
  }
  for (const s of sessions.slice(0, HOME_FAHRTEN)) ul.append(fahrtZeile(s, onOpen));
}

// ---------- Screen „Fahrten": Monate als Bereiche ----------

const monatsKey = t => { const d = new Date(t); return d.getFullYear() * 12 + d.getMonth(); };
// Auf-/Zugeklappte Monate überleben das Neuzeichnen (Rückkehr aus der
// Detailansicht, Löschen) — getrennt für echte und Demo-Fahrten. gesehen:
// Monate, die schon einmal gezeigt wurden; ein neuer Monat (Monatswechsel
// ohne App-Neustart) klappt von selbst auf.
const offen = { echt: new Set(), demo: new Set() };
const gesehen = { echt: new Set(), demo: new Set() };

// Monatsinhalt: Wochen-Kopfzeilen (Summen nur über die Fahrten dieses
// Monats — eine Woche kann über den Monatswechsel reichen) + Fahrten
function monatsInhalt(fahrten, onOpen) {
  const ul = document.createElement('ul');
  ul.className = 'sessions';
  let woche = null;
  for (const s of fahrten) {
    const ws = wochenstart(s.start);
    if (ws !== woche) {
      woche = ws;
      ul.append(wochenKopf(ws, fahrten.filter(x => wochenstart(x.start) === ws)));
    }
    ul.append(fahrtZeile(s, onOpen));
  }
  return ul;
}

// demo: Fahrtenliste aus ?demo=fahrten (nichts wird gelesen oder gespeichert)
export async function renderFahrten(root, onOpen, { demo = null } = {}) {
  const sessions = demo ?? await ladeFahrten();
  root.querySelector('#f-demo').hidden = !demo;
  const modus = demo ? 'demo' : 'echt';
  root.querySelector('#fahrten-diagramm').innerHTML = sessions.length ? wochenDiagramm(sessions) : '';
  const monate = new Map();
  for (const s of sessions) {
    const k = monatsKey(s.start);
    if (!monate.has(k)) monate.set(k, []);
    monate.get(k).push(s);
  }
  // Default: aktueller und letzter Kalendermonat offen — bei längerer
  // Pause wenigstens der jüngste Monat mit Fahrten
  const offeneMonate = offen[modus];
  const erstesMal = !gesehen[modus].size;
  const jetzt = monatsKey(Date.now());
  for (const k of monate.keys()) {
    if (gesehen[modus].has(k)) continue;
    gesehen[modus].add(k);
    if (k >= jetzt - 1) offeneMonate.add(k);
  }
  if (erstesMal && !offeneMonate.size && monate.size) offeneMonate.add([...monate.keys()][0]);
  const wrap = root.querySelector('#fahrten-monate');
  wrap.replaceChildren();
  if (!sessions.length) {
    wrap.innerHTML = '<ul class="sessions"><li class="empty">Noch keine Fahrten</li></ul>';
    return;
  }
  for (const [k, fahrten] of monate) {
    const det = document.createElement('details');
    det.className = 'monat';
    const w = wochenSumme(fahrten);
    const name = new Date(fahrten[0].start).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
    // Kopf nur Anzahl + Zeit: bleibt bei 360 px einzeilig, km/TSS stehen in den Wochenköpfen
    det.innerHTML = `<summary><span class="m-titel">${name}</span>
      <span class="m-summe">${w.n} ${w.n === 1 ? 'Fahrt' : 'Fahrten'} · ${fmtDauer(w.sek)}</span></summary>`;
    // Fahrten erst beim ersten Aufklappen bauen — bleibt bei Hunderten schnell
    const fuelle = () => { if (det.open && !det.querySelector('ul')) det.append(monatsInhalt(fahrten, onOpen)); };
    det.addEventListener('toggle', () => {
      det.open ? offeneMonate.add(k) : offeneMonate.delete(k);
      fuelle();
    });
    det.open = offeneMonate.has(k);
    fuelle();
    wrap.append(det);
  }
}
