// Bootstrap und Screen-Routing.

import { FTMS } from './ble/ftms.js';
import { Session } from './state.js';
import { getSettings, setSetting, requestPersistence, listSessions, getSession } from './storage.js';
import { RideScreen } from './ui/ride.js';
import { renderList, renderDetail } from './ui/list.js';
import { drawProfile } from './ui/chart.js';
import { zeigeGraphOverlay } from './ui/overlay.js';
import { logInfo, logError, formatLog } from './logger.js';
import { schnellverbinde, merkeGeraet, vergissGeraet, kannMerken } from './ble/geraete.js';
import { starteUpdateWatchdog, heileVersionsDrift } from './version.js';
import { toast, toastOk, toastErr } from './ui/toast.js';
import { exportiereAlles, importiereAlles } from './backup.js';
import { parseZwo, zwoProgramm } from './zwo.js';
import { listProgramme, saveProgramm, deleteProgramm } from './storage.js';
import { besteDauerleistung } from './metrics.js';
import { getLogs, clearLogs } from './storage.js';
import { download } from './export.js';
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
  if (document.visibilityState !== 'visible') return;
  if (!screens.ride.hidden) { keepAwake(true); return; }
  if (reloadAusstehend) location.reload();      // verpasstes Update nachholen
});

let rideScreen = null;
let startLaeuft = false;    // Doppel-Tap auf eine Kachel → nur ein Verbindungsaufbau

async function startRide(programm = null) {
  if (startLaeuft || rideScreen) return;
  startLaeuft = true;
  try {
    await startRideInner(programm);
  } finally {
    startLaeuft = false;
  }
}

async function startRideInner(programm) {
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
  // Vorabcheck: ist der Bluetooth-Adapter überhaupt verfügbar/an?
  if (await navigator.bluetooth.getAvailability?.() === false) {
    toastErr('Bluetooth ist ausgeschaltet — bitte einschalten.');
    return;
  }
  const ftms = new FTMS();
  try {
    // Schnellverbindung: gemerkter Trainer ohne Chooser (wenn getDevices verfügbar)
    const bekannt = await schnellverbinde('trainer');
    await ftms.connect(bekannt);
    merkeGeraet('trainer', ftms.device, ftms.firmware ? { fw: ftms.firmware } : {});
  } catch (err) {
    logError('app', 'Verbindung fehlgeschlagen', `${err.name}: ${err.message}`);
    if (err.name === 'NotFoundError') {
      // Chooser abgebrochen ODER keine Berechtigung/kein Gerät — nicht still schlucken
      $('#bt-support').textContent = 'Kein Gerät gewählt. Trainer wach? Chrome-Berechtigung „Geräte in der Nähe" erteilt?';
    } else {
      toastErr('Verbindung fehlgeschlagen: ' + err.message);
    }
    return;
  }
  $('#bt-support').textContent = '';
  requestPersistence();
  logInfo('app', `Session-Start: ${programm?.name ?? 'Freies Fahren'}`);
  const session = new Session(ftms, settings, programm);
  if (blocks) run = new ProgramRun(session, programm.name, blocks);
  else session.setTarget(settings.startWatt, { instant: true });
  show('ride');
  history.pushState({ screen: 'ride' }, '');
  speichereUiState();
  keepAwake(true);
  rideScreen = new RideScreen(screens.ride, session, settings, async () => {
    rideScreen.destroy();
    rideScreen = null;
    ftms.disconnect();
    keepAwake(false);
    if (session.count > 0) toastOk('Fahrt gespeichert');
    // FTP-Rampentest: 0,75 × beste 60-s-Leistung als neuen FTP anbieten
    if (programm?.id === 'rampentest' && session.count >= 90) {
      const best = besteDauerleistung(session.samples, session.count);
      const ftpNeu = Math.round(best * 0.75);
      if (ftpNeu >= 50 && confirm(`Rampentest: beste Minute ${best} W → FTP ${ftpNeu} W übernehmen?`)) {
        await setSetting('ftp', ftpNeu);
        renderProgrammTiles();
      }
    }
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
  // Tap auf die Vorschau: Vollbild mit gut lesbaren Klammern und Zeitachse
  preview.onclick = () => {
    try {
      const opts = leseOpts();
      const blocks = baueBlocks(programm, opts, settings.ftp);
      const min = Math.round(blocks.reduce((a, b) => a + b.dauer, 0) / 60);
      zeigeGraphOverlay(c => drawProfile(c, blocks, settings.ftp || EFF_FTP_DEFAULT),
        `${programm.name} <span>· ${min} min${settings.ftp ? '' : ` · FTP-Annahme ${EFF_FTP_DEFAULT} W`}</span>`);
    } catch { /* unvollständige Eingabe */ }
  };

  return new Promise(resolve => {
    dlg.onclose = () => {
      // History-Eintrag des Dialogs abräumen, wenn per OK/Abbrechen/Esc
      // geschlossen wurde (bei Zurück-Taste ist er schon gepoppt)
      if (history.state?.dialog === 'start') history.back();
      resolve(dlg.returnValue === 'ok' ? leseOpts() : null);
    };
    history.pushState({ dialog: 'start' }, '');
    dlg.showModal();
    zeichne();            // erst nach showModal: Canvas braucht sein Layout
  });
}

async function openSettings() {
  const s = await getSettings();
  const dlg = $('#dlg-settings');
  // Diagnose-Log laden (letzte 200 Einträge, neueste unten)
  getLogs().then(entries => {
    $('#log-view').textContent = entries.length
      ? formatLog(entries.slice(-200)) : 'Noch keine Einträge.';
    $('#log-view').scrollTop = $('#log-view').scrollHeight;
  });
  $('#btn-log-export').onclick = async () =>
    download(`ergomergo-log-${new Date().toISOString().slice(0, 19).replaceAll(':', '-')}.txt`,
      formatLog(await getLogs()), 'text/plain');
  $('#btn-log-clear').onclick = async () => {
    await clearLogs();
    $('#log-view').textContent = 'Geleert.';
  };

  // Geräte-Bereich: Karten je Rolle mit Koppeln/Entfernen
  $('#geraete-hint').hidden = kannMerken();
  const chooserFilter = {
    trainer: { filters: [{ namePrefix: 'KICKR' }, { services: [0x1826] }], optionalServices: [0x1826, 0x180a] },
    hr: { filters: [{ services: [0x180d] }] },
    controller: { filters: [{ namePrefix: 'Zwift' }], optionalServices: ['00000001-19ca-4651-86e5-fa29dcdd09d1', 0xfc82] },
  };
  const rollen = [['trainer', 'Trainer', '⚙'], ['hr', 'Herzgurt', '♥'], ['controller', 'Controller', '±']];
  const zeichneGeraete = geraete => {
    const liste = $('#geraete-liste');
    liste.replaceChildren();
    for (const [rolle, label, icon] of rollen) {
      const e = geraete?.[rolle];
      const li = document.createElement('li');
      li.innerHTML = `
        <span class="g-icon">${icon}</span>
        <span class="g-info">
          <span class="g-rolle">${label}</span>
          <span class="g-name">${e ? `<i class="dot on"></i>${e.name ?? e.id}` : '<i class="dot"></i>nicht gemerkt'}${e?.fw ? ` <span class="g-fw">FW ${e.fw}</span>` : ''}</span>
        </span>`;
      const aktion = document.createElement('button');
      aktion.type = 'button';
      if (e) {
        aktion.textContent = 'Entfernen';
        aktion.className = 'ghost';
        aktion.onclick = async () => {
          await vergissGeraet(rolle);
          toast(`${label} vergessen`);
          zeichneGeraete((await getSettings()).geraete);
        };
      } else {
        aktion.textContent = 'Koppeln';
        aktion.onclick = async () => {
          try {
            const device = await navigator.bluetooth.requestDevice(chooserFilter[rolle]);
            await merkeGeraet(rolle, device);
            toastOk(`${label} gekoppelt: ${device.name ?? device.id}`);
            zeichneGeraete((await getSettings()).geraete);
            aktualisiereStatuszeile();
          } catch (err) {
            if (err.name !== 'NotFoundError') toastErr('Koppeln fehlgeschlagen: ' + err.message);
          }
        };
      }
      li.append(aktion);
      liste.append(li);
    }
  };
  zeichneGeraete(s.geraete);
  history.pushState({ dialog: 'settings' }, '');
  dlg.addEventListener('close', () => {
    if (history.state?.dialog === 'settings') history.back();
  }, { once: true });
  $('#set-ftp').value = s.ftp;
  $('#set-schritt').value = s.wattSchritt;
  $('#set-max').value = s.maxWatt;
  $('#set-start').value = s.startWatt;
  $('#set-sprache').checked = s.sprachansagen;
  $('#set-icukey').value = s.icuApiKey;
  $('#set-plusbit').value = s.controllerPlusBit;
  $('#set-minusbit').value = s.controllerMinusBit;

  // Sicherung: Export/Import der kompletten Datenbank
  $('#btn-backup').onclick = async () => {
    download(`ergomergo-backup-${new Date().toISOString().slice(0, 10)}.json`,
      await exportiereAlles(), 'application/json');
    toastOk('Sicherung heruntergeladen');
  };
  $('#btn-restore').onclick = () => $('#backup-file').click();
  $('#backup-file').onchange = async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const n = await importiereAlles(await file.text());
      toastOk(`Wiederhergestellt: ${n} Fahrten — lade neu …`);
      setTimeout(() => location.reload(), 1200);
    } catch (err) { toastErr('Import fehlgeschlagen: ' + err.message); }
  };
  dlg.onclose = async () => {
    if (dlg.returnValue !== 'ok') return;
    await setSetting('ftp', Number($('#set-ftp').value) || 0);
    await setSetting('wattSchritt', Math.max(1, Number($('#set-schritt').value) || 10));
    await setSetting('maxWatt', Math.max(100, Number($('#set-max').value) || 400));
    await setSetting('startWatt', Math.max(20, Number($('#set-start').value) || 100));
    await setSetting('sprachansagen', $('#set-sprache').checked);
    await setSetting('icuApiKey', $('#set-icukey').value.trim());
    await setSetting('controllerPlusBit', Math.min(31, Math.max(0, Number($('#set-plusbit').value) || 0)));
    await setSetting('controllerMinusBit', Math.min(31, Math.max(0, Number($('#set-minusbit').value) || 0)));
    renderProgrammTiles();      // Zonenfarben/Profile an neue FTP anpassen
    toastOk('Einstellungen gespeichert');
  };
  dlg.showModal();
}

let tilesKette = Promise.resolve();
function renderProgrammTiles() {
  tilesKette = tilesKette.then(renderProgrammTilesInner).catch(() => {});
  return tilesKette;
}

async function renderProgrammTilesInner() {
  const settings = await getSettings();
  const effFtp = settings.ftp || EFF_FTP_DEFAULT;
  const fill = (sel, list) => {
    const wrap = $(sel);
    wrap.replaceChildren();     // erneuter Aufruf (z. B. nach FTP-Änderung) ersetzt
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

  // Importierte .zwo-Workouts als eigene Kacheln mit Löschknopf
  const customs = (await listProgramme()).map(p => zwoProgramm(p, EFF_FTP_DEFAULT));
  fill('#custom-tiles', customs);
  const wrap = $('#custom-tiles');
  [...wrap.children].forEach((btn, i) => {
    const x = document.createElement('span');
    x.className = 'tile-x';
    x.textContent = '✕';
    x.onclick = async e => {
      e.stopPropagation();
      if (confirm(`„${customs[i].name}" löschen?`)) { await deleteProgramm(customs[i].id); renderProgrammTiles(); }
    };
    btn.append(x);
  });

  // „Zuletzt gefahren"-Kachel: letztes Programm mit einem Tap wieder starten
  const letzte = (await listSessions()).find(x => x.programmId);
  const alle = [...WORKOUTS, ...PROGRAMME, ...customs];
  const letztesProgramm = letzte && alle.find(p => p.id === letzte.programmId);
  const lastBtn = $('#start-last');
  if (letztesProgramm) {
    $('#last-title').textContent = letztesProgramm.name;
    $('#last-sub').textContent = new Date(letzte.start)
      .toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
    lastBtn.hidden = false;
    lastBtn.onclick = () => startRide(letztesProgramm);
  } else {
    lastBtn.hidden = true;
  }
}

// Rubriken: Auf-/Zu-Zustand über Reloads merken
for (const det of document.querySelectorAll('details.rubrik')) {
  try {
    const merk = localStorage.getItem(`rubrik-${det.id}`);
    if (merk !== null) det.open = merk === '1';
  } catch { /* localStorage optional */ }
  det.addEventListener('toggle', () => {
    try { localStorage.setItem(`rubrik-${det.id}`, det.open ? '1' : '0'); } catch { /* egal */ }
  });
}

// .zwo-Import: Datei wählen → parsen → als eigenes Programm speichern.
// stopPropagation: der Button sitzt in der Rubrik-Summary und darf sie nicht toggeln.
$('#btn-zwo').addEventListener('click', e => {
  e.preventDefault();
  e.stopPropagation();
  $('#zwo-file').click();
});
$('#zwo-file').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const { name, bloecke } = parseZwo(await file.text());
    await saveProgramm({ id: `zwo-${Date.now()}`, name, bloecke });
    await renderProgrammTiles();
    logInfo('app', `.zwo importiert: ${name} (${bloecke.length} Blöcke)`);
    toastOk(`„${name}" importiert (${bloecke.length} Blöcke)`);
  } catch (err) {
    toastErr('Import fehlgeschlagen: ' + err.message);
  }
});

let detailCleanup = null;
let reloadAusstehend = false;   // SW-Update kam während einer Fahrt an
let aktuelleDetailId = null;

// --- App-Zustand (M7): Screen + Scroll überleben App-Kill, 30-min-Fenster ---
history.scrollRestoration = 'manual';
const UISTATE_GUELTIG_MS = 30 * 60 * 1000;

function speichereUiState() {
  try {
    localStorage.setItem('uiState', JSON.stringify({
      screen: !screens.detail.hidden ? 'detail' : !screens.ride.hidden ? 'ride' : 'home',
      detailId: aktuelleDetailId,
      scrollHome: screens.home.hidden ? 0 : Math.round(scrollY),
      savedAt: Date.now(),
    }));
  } catch { /* localStorage optional */ }
}
// Empfehlung aus der Recherche: visibilitychange+pagehide, NIE beforeunload
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') speichereUiState();
});
addEventListener('pagehide', speichereUiState);

async function restoreUiState() {
  try {
    const s = JSON.parse(localStorage.getItem('uiState') ?? 'null');
    if (!s || Date.now() - s.savedAt > UISTATE_GUELTIG_MS) return false;
    if (s.screen === 'detail' && s.detailId) {
      const meta = await getSession(s.detailId);
      if (meta) {
        history.pushState({ screen: 'detail' }, '');   // genau EIN Eintrag über Home
        await openDetail(meta, { push: false });
        return true;
      }
    }
    // 'ride' wird bewusst nie restauriert (BLE-Session ist tot) → Home
    if (s.scrollHome) requestAnimationFrame(() => scrollTo(0, s.scrollHome));
  } catch { /* defekter State → frisch starten */ }
  return false;
}

// --- Zurück-Taste (M6): History-Einträge je Screen, double-back in der Fahrt ---
let backArmiertBis = 0;

addEventListener('popstate', () => {
  // Realen UI-Zustand prüfen statt event.state (robust gegen tote Einträge)
  for (const id of ['#dlg-graph', '#dlg-settings', '#dlg-start']) {
    const dlg = $(id);
    if (dlg?.open) { dlg.close(); return; }
  }
  if (!screens.detail.hidden) { goHome(); return; }
  if (!screens.ride.hidden) {
    if (Date.now() < backArmiertBis) {
      $('#btn-end').click();                 // sauber beenden + speichern
    } else {
      backArmiertBis = Date.now() + 2500;
      toast('Nochmal „Zurück" beendet die Fahrt');
      history.pushState({ screen: 'ride' }, '');   // re-armieren
    }
  }
  // home: nichts — Systemverhalten (App in den Hintergrund)
});

async function goHome() {
  if (reloadAusstehend) { location.reload(); return; }
  detailCleanup?.();
  detailCleanup = null;
  aktuelleDetailId = null;
  show('home');
  speichereUiState();
  await renderList($('#session-list'), openDetail);
  aktualisiereStatuszeile();
}

// Statuszeile im Footer: Datenbestand + Speicherschutz, gemerkte Geräte.
// (Die App-Aktualität daneben pflegt der Update-Watchdog aus version.js.)
async function aktualisiereStatuszeile() {
  try {
    const [sessions, s, persistent] = await Promise.all([
      listSessions(), getSettings(), navigator.storage?.persisted?.() ?? false,
    ]);
    $('#db-status').textContent =
      `${sessions.length} ${sessions.length === 1 ? 'Fahrt' : 'Fahrten'} · Speicher ${persistent ? 'geschützt' : 'ungeschützt'}`;
    const mark = rolle => s.geraete?.[rolle] ? '✓' : '–';
    $('#geraete-status').textContent =
      `Trainer ${mark('trainer')} · Herzgurt ${mark('hr')} · Controller ${mark('controller')}`;
  } catch { /* Statuszeile ist nie kritisch */ }
}

async function openDetail(sessionMeta, { push = true } = {}) {
  show('detail');
  aktuelleDetailId = sessionMeta.id;
  if (push) history.pushState({ screen: 'detail' }, '');
  speichereUiState();
  detailCleanup = await renderDetail(screens.detail, sessionMeta, goHome);
}

$('#start-free').addEventListener('click', () => startRide());
$('#btn-demo').addEventListener('click', () => { if (!rideScreen) startDemo('vo2max'); });
$('#btn-settings').addEventListener('click', openSettings);
$('#btn-back').addEventListener('click', goHome);
renderProgrammTiles();
starteUpdateWatchdog($('#version-status'));
heileVersionsDrift();

// Speicherschutz früh anfragen (Chrome gewährt nach Heuristik, v. a. wenn
// installiert) und nach einer App-Installation direkt erneut
requestPersistence();
addEventListener('appinstalled', async () => {
  await navigator.storage?.persist?.();
  aktualisiereStatuszeile();
  toastOk('App installiert — Speicher geschützt');
});

// ?demo — Fahrbildschirm mit synthetischen Daten, ohne Trainer (UI-Arbeit, Screenshots).
// ?demo=programm zeigt den Programm-Modus mit Workout-Graph.
async function startDemo(variante) {
  const settings = await getSettings();
  const ftms = new EventTarget();
  Object.assign(ftms, { connected: true, busy: false, setTargetPower: async () => {}, disconnect: () => {} });
  const session = new Session(ftms, settings);
  session.save = async () => {};   // Demo-Fahrten nicht in die echte Historie schreiben
  ftms.istDemo = true;             // u. a.: kein Auto-Connect echter Geräte im Demo
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
  history.pushState({ screen: 'ride' }, '');   // double-back-Schutz auch in der Demo
  // Reload räumt alle Demo-Timer ab — auch wenn ohne ?demo gestartet wurde
  rideScreen = new RideScreen(screens.ride, session, settings,
    async () => { $('#m-demo').hidden = true; location.href = location.pathname; }, run);
  ftms.dispatchEvent(new Event('connected'));
  $('#m-demo').hidden = false;                 // persistenter Badge, unabhängig vom Status
}


if (!navigator.bluetooth) {
  $('#bt-support').textContent = navigator.brave
    ? 'Brave blockiert Web Bluetooth — bitte Chrome verwenden (oder brave://flags/#brave-web-bluetooth-api)'
    : 'Kein Web Bluetooth — Chrome unter Android/Desktop nötig';
  $('#start-free').disabled = true;
} else if (navigator.brave) {
  // Brave lässt die API teils existieren, blockt aber den Chooser
  $('#bt-support').textContent = 'Brave blockiert Web Bluetooth meist — bei Problemen Chrome verwenden';
}

// Service Worker nur unter HTTPS/Produktion — localhost-Entwicklung bleibt cachefrei.
// Übernimmt ein neuer Worker die Kontrolle (Update deployt), einmal neu laden,
// damit sofort die frische Version läuft statt erst beim übernächsten Start.
if ('serviceWorker' in navigator && location.hostname !== 'localhost') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
  let hatteController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hatteController) { hatteController = true; return; }   // Erstinstallation
    if (screens.ride.hidden) location.reload();
    else reloadAusstehend = true;               // nie mitten in der Fahrt — nachholen
  });
}

const demoParam = new URLSearchParams(location.search).get('demo');
const dlgParam = new URLSearchParams(location.search).get('dlg');
if (demoParam !== null) startDemo(demoParam);
else goHome().then(() => { if (!dlgParam) restoreUiState(); });
// ?dlg=<id> — Startdialog für UI-Arbeit/Screenshots direkt öffnen
if (dlgParam) {
  const p = [...WORKOUTS, ...PROGRAMME].find(x => x.id === dlgParam);
  if (p) getSettings().then(s => startDialog(p, s));
}
// ?settings — Einstellungsdialog direkt öffnen (UI-Arbeit/Screenshots)
if (new URLSearchParams(location.search).has('settings')) {
  openSettings().then(() =>
    document.querySelectorAll('#dlg-settings details').forEach(d => { d.open = true; }));
}
// ?big=<id> — Graph-Vollbild direkt öffnen (UI-Arbeit/Screenshots)
const bigParam = new URLSearchParams(location.search).get('big');
if (bigParam) {
  const p = [...WORKOUTS, ...PROGRAMME].find(x => x.id === bigParam);
  if (p) getSettings().then(s => {
    const blocks = baueBlocks(p, defaultOpts(p), s.ftp);
    const min = Math.round(blocks.reduce((a, b) => a + b.dauer, 0) / 60);
    zeigeGraphOverlay(c => drawProfile(c, blocks, s.ftp || EFF_FTP_DEFAULT),
      `${p.name} <span>· ${min} min</span>`);
  });
}
