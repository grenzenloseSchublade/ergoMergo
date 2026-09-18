// Bootstrap und Screen-Routing.

import { FTMS } from './ble/ftms.js';
import { Session } from './state.js';
import { getSettings, setSetting, requestPersistence } from './storage.js';
import { RideScreen } from './ui/ride.js';
import { renderList, renderDetail } from './ui/list.js';
import { drawProfile } from './ui/chart.js';
import { PROGRAMME, expand, ProgramRun } from './program.js';
import { WORKOUTS, EFF_FTP_DEFAULT } from './workouts.js';
import { initAudio } from './signals.js';

const $ = s => document.querySelector(s);
const screens = { home: $('#screen-home'), ride: $('#screen-ride'), detail: $('#screen-detail') };

function show(name) {
  for (const [k, el] of Object.entries(screens)) el.hidden = k !== name;
}

let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on) {
      wakeLock = await navigator.wakeLock?.request('screen');
    } else {
      await wakeLock?.release();
      wakeLock = null;
    }
  } catch { /* Wake Lock optional */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !screens.ride.hidden) keepAwake(true);
});

let rideScreen = null;

async function startRide(programm = null) {
  const settings = await getSettings();
  initAudio();                              // braucht die User-Geste des Start-Taps
  let run = null, blocks = null;
  if (programm) {
    const opts = await startDialog(programm, settings);
    if (!opts) return;
    blocks = programm.generieren
      ? programm.generieren(opts, settings.ftp)
      : expand(programm.bauen(opts), settings.ftp);
  }
  const ftms = new FTMS();
  try {
    await ftms.connect();
  } catch (err) {
    if (err.name !== 'NotFoundError') alert('Verbindung fehlgeschlagen: ' + err.message);
    return;
  }
  requestPersistence();
  const session = new Session(ftms, settings, programm);
  if (blocks) run = new ProgramRun(session, programm.name, blocks);
  else session.setTarget(settings.startWatt, { instant: true });
  show('ride');
  keepAwake(true);
  rideScreen = new RideScreen(screens.ride, session, settings, async () => {
    rideScreen.destroy();
    rideScreen = null;
    ftms.disconnect();
    keepAwake(false);
    await goHome();
  }, run);
}

// Blockliste eines Programms für gegebene Optionen (Generator oder klassisch)
function baueBlocks(programm, opts, ftp) {
  return programm.generieren
    ? programm.generieren(opts, ftp)
    : expand(programm.bauen(opts), ftp);
}

function defaultOpts(programm) {
  return Object.fromEntries(Object.entries(programm.optionen).map(([k, v]) => [k, v.default]));
}

// Startdialog: Optionsfelder aus der Programmdefinition
function startDialog(programm, settings = {}) {
  const dlg = $('#dlg-start');
  $('#dlg-title').textContent = programm.name;
  const hint = $('#dlg-hint');
  hint.hidden = !(programm.generieren && !settings.ftp);
  hint.textContent = `Kein FTP-Wert hinterlegt — Annahme ${EFF_FTP_DEFAULT} W. In den Einstellungen anpassen.`;
  const fields = $('#dlg-fields');
  fields.replaceChildren();
  for (const [key, o] of Object.entries(programm.optionen)) {
    const label = document.createElement('label');
    label.textContent = o.label;
    const input = document.createElement('input');
    Object.assign(input, { type: 'number', min: o.min, max: o.max, value: o.default, name: key });
    label.append(input);
    fields.append(label);
  }

  // Live-Vorschau des Intensitätsprofils, folgt den Eingaben
  const preview = $('#dlg-preview');
  const leseOpts = () => {
    const opts = {};
    for (const inp of fields.querySelectorAll('input'))
      opts[inp.name] = Math.min(inp.max, Math.max(inp.min, Number(inp.value) || 0));
    return opts;
  };
  const zeichne = () => {
    try { drawProfile(preview, baueBlocks(programm, leseOpts(), settings.ftp), settings.ftp || EFF_FTP_DEFAULT); }
    catch { /* unvollständige Eingabe während des Tippens */ }
  };
  fields.oninput = zeichne;

  return new Promise(resolve => {
    dlg.onclose = () => {
      resolve(dlg.returnValue === 'ok' ? leseOpts() : null);
    };
    dlg.showModal();
    zeichne();            // erst nach showModal: Canvas braucht sein Layout
  });
}

async function openSettings() {
  const s = await getSettings();
  const dlg = $('#dlg-settings');
  $('#set-ftp').value = s.ftp;
  $('#set-schritt').value = s.wattSchritt;
  $('#set-max').value = s.maxWatt;
  $('#set-start').value = s.startWatt;
  dlg.onclose = async () => {
    if (dlg.returnValue !== 'ok') return;
    await setSetting('ftp', Number($('#set-ftp').value) || 0);
    await setSetting('wattSchritt', Math.max(1, Number($('#set-schritt').value) || 10));
    await setSetting('maxWatt', Math.max(100, Number($('#set-max').value) || 400));
    await setSetting('startWatt', Math.max(20, Number($('#set-start').value) || 100));
  };
  dlg.showModal();
}

async function renderProgrammTiles() {
  const settings = await getSettings();
  const effFtp = settings.ftp || EFF_FTP_DEFAULT;
  const fill = (sel, list) => {
    const wrap = $(sel);
    for (const p of list) {
      const btn = document.createElement('button');
      btn.className = 'tile';
      btn.innerHTML = `<span class="tile-title">${p.name}</span><span class="tile-sub">${p.sub}</span>`;
      const mini = document.createElement('canvas');
      mini.className = 'tile-profile';
      mini.width = 220; mini.height = 36;
      btn.append(mini);
      btn.addEventListener('click', () => startRide(p));
      wrap.append(btn);
      try { drawProfile(mini, baueBlocks(p, defaultOpts(p), settings.ftp), effFtp); }
      catch { mini.remove(); }
    }
  };
  fill('#workout-tiles', WORKOUTS);
  fill('#programm-tiles', PROGRAMME);
}

async function goHome() {
  show('home');
  await renderList($('#session-list'), openDetail);
}

async function openDetail(sessionMeta) {
  show('detail');
  await renderDetail(screens.detail, sessionMeta, goHome);
}

$('#start-free').addEventListener('click', () => startRide());
$('#btn-settings').addEventListener('click', openSettings);
$('#btn-back').addEventListener('click', goHome);
renderProgrammTiles();

// ?demo — Fahrbildschirm mit synthetischen Daten, ohne Trainer (UI-Arbeit, Screenshots).
// ?demo=programm zeigt den Programm-Modus mit Workout-Graph.
async function startDemo(variante) {
  const settings = await getSettings();
  const ftms = new EventTarget();
  Object.assign(ftms, { connected: true, busy: false, setTargetPower: async () => {}, disconnect: () => {} });
  const session = new Session(ftms, settings);
  let run = null;
  const prefill = (secs, zielAt) => {
    const F = 6;
    for (let k = 0; k < secs; k++) {
      const ziel = zielAt(k);
      const watt = ziel + Math.round(Math.sin(k / 3) * 10 + (Math.random() - 0.5) * 8);
      session.samples.set([k, watt, ziel, 88, 141, 325], k * F);
      session.kj += watt / 1000;
    }
    session.count = secs;
  };
  const workout = WORKOUTS.find(x => x.id === variante);
  if (workout) {
    const o = Object.fromEntries(Object.entries(workout.optionen).map(([k, v]) => [k, v.default]));
    const blocks = workout.generieren(o, settings.ftp);
    prefill(600, () => 120);
    run = new ProgramRun(session, workout.name, blocks);
  } else if (variante === 'programm') {
    const p = PROGRAMME.find(x => x.id === 'intervalle44');
    const blocks = expand(p.bauen({ wdh: 4, hart: 210, locker: 90 }), settings.ftp);
    prefill(600, k => k < 480 ? 108 : 210);
    run = new ProgramRun(session, p.name, blocks);
  } else {
    prefill(480, k => k < 120 ? 120 : k < 300 ? 200 : 160);
    session.setTarget(160, { instant: true });
  }
  Object.assign(session.live, { watt: session.target, rpm: 89, hr: 142, kmh: 32.5 });
  const ping = new URLSearchParams(location.search).has('ping');
  setInterval(() => {
    ftms.dispatchEvent(new CustomEvent('data', { detail: {
      watt: Math.round(session.target + (Math.random() - 0.5) * 10),
      rpm: 88 + Math.round(Math.random() * 4), kmh: 32.5, hr: 142,
    } }));
    // ?ping — Hintergrund-Throttling messen: 1 Request/s, Servlog zeigt Lücken
    if (ping) fetch(`ping?t=${session.elapsed}&vis=${document.visibilityState}`).catch(() => {});
  }, 1000);
  show('ride');
  rideScreen = new RideScreen(screens.ride, session, settings, async () => { location.search = ''; }, run);
  ftms.dispatchEvent(new Event('connected'));
}


if (!navigator.bluetooth) {
  $('#bt-support').textContent = 'Kein Web Bluetooth — Chrome unter Android/Desktop nötig';
  $('#start-free').disabled = true;
}

// Service Worker nur unter HTTPS/Produktion — localhost-Entwicklung bleibt cachefrei
if ('serviceWorker' in navigator && location.hostname !== 'localhost') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

const demoParam = new URLSearchParams(location.search).get('demo');
const dlgParam = new URLSearchParams(location.search).get('dlg');
if (demoParam !== null) startDemo(demoParam);
else goHome();
// ?dlg=<id> — Startdialog für UI-Arbeit/Screenshots direkt öffnen
if (dlgParam) {
  const p = [...WORKOUTS, ...PROGRAMME].find(x => x.id === dlgParam);
  if (p) getSettings().then(s => startDialog(p, s));
}
