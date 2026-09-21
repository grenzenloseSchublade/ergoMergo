// Bootstrap und Screen-Routing.

import { Session } from './state.js';
import { getSettings, setSetting, requestPersistence, listSessions, getSession } from './storage.js';
import { RideScreen } from './ui/ride.js';
import { renderList, renderDetail } from './ui/list.js';
import { drawProfile } from './ui/chart.js';
import { zeigeGraphOverlay } from './ui/overlay.js';
import { logInfo, logError } from './logger.js';
import { geraeteManager } from './ble/geraete.js';
import { starteUpdateWatchdog, heileVersionsDrift, APP_VERSION } from './version.js';
import { toast, toastOk, toastErr } from './ui/toast.js';
import { openSettings } from './ui/settings.js';
import { startDemo } from './demo.js';

// Demo mit den App-Callbacks starten (Button auf Home + ?demo-Parameter)
const demoStarten = variante =>
  startDemo(variante, { show, screens, registriere: rs => { rideScreen = rs; } });
import { zeichneGeraeteLeiste } from './ui/geraete-leiste.js';
import { montiereIcons } from './ui/icons.js';
import { parseZwo, zwoProgramm } from './zwo.js';
import { listProgramme, saveProgramm, deleteProgramm } from './storage.js';
import { besteDauerleistung } from './metrics.js';
import { PROGRAMME, ProgramRun, baueBlocks, defaultOpts } from './program.js';
import { WORKOUTS, EFF_FTP_DEFAULT } from './workouts.js';
import { initAudio } from './signals.js';
import { starteMessung } from './energie.js';

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
    blocks = baueBlocks(programm, opts, settings.ftp);
  }
  // Vorabcheck: ist der Bluetooth-Adapter überhaupt verfügbar/an?
  if (await navigator.bluetooth.getAvailability?.() === false) {
    toastErr('Bluetooth ist ausgeschaltet — bitte einschalten.');
    return;
  }
  // Trainer: verbundenen Pool-Client übernehmen; sonst Schnellverbindung
  // über die Fassade; letzter Weg: Chooser
  let ftms = geraeteManager.client('trainer');
  try {
    if (!ftms) {
      // Chooser nur mit frischer User-Geste — nach einem langen (4-s-)
      // Verbindungsversuch wäre sie verbraucht und requestDevice würde mit
      // SecurityError platzen. Frisch ist sie in zwei Fällen: nichts gemerkt,
      // oder gemerkt aber Chrome kennt die Berechtigung nicht mehr
      // (getDevices leer → verbinde() kann nur scheitern).
      if ((await geraeteManager.gemerkte('trainer')).length === 0) {
        ftms = await geraeteManager.koppel('trainer');
      } else if ((await geraeteManager.autorisiert('trainer')).length === 0) {
        toast('Bluetooth-Berechtigung abgelaufen — Trainer bitte neu wählen');
        ftms = await geraeteManager.koppel('trainer');
      } else {
        await geraeteManager.verbinde('trainer');
        ftms = geraeteManager.client('trainer');
        if (!ftms) throw Object.assign(new Error('Trainer schläft — Pedal kurz drehen, dann erneut starten.'), { name: 'NichtErreichbar' });
      }
    }
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
  geraeteManager.starteSession();           // Trainer kämpft ab jetzt um die Verbindung
  const session = new Session(ftms, settings, programm);
  starteMessung();                          // Akku-Delta pro Fahrt (Punkt „Strom messen")
  if (blocks) run = new ProgramRun(session, programm.name, blocks);
  else session.setTarget(settings.startWatt, { instant: true });
  show('ride');
  history.pushState({ screen: 'ride' }, '');
  speichereUiState();
  keepAwake(true);
  rideScreen = new RideScreen(screens.ride, session, settings, async () => {
    rideScreen.destroy();
    rideScreen = null;
    // Verbindung lebt im Pool weiter — getrennt wird über die Geräte-Leiste.
    // Aber: ohne Fahrt kein Auto-Reconnect mehr (sonst kämpft die App nach
    // Trainer-Standby endlos weiter — Livetest: >25 min Reconnect-Schleife)
    geraeteManager.beendeSession();
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
  for (const id of ['#dlg-mapping', '#dlg-graph', '#dlg-settings', '#dlg-start']) {
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
  renderProgrammTiles();          // „Zuletzt gefahren" sofort nachführen
  zeichneGeraeteLeiste();
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
$('#btn-demo').addEventListener('click', () => { if (!rideScreen) demoStarten('vo2max'); });
$('#btn-settings').addEventListener('click', () => openSettings({ nachSpeichern: renderProgrammTiles }));
$('#btn-back').addEventListener('click', goHome);
// Statischer Intro-Absatz ist nur für Crawler/JS-lose Erstbesucher —
// sobald die App läuft, weg damit
$('#seo-intro').hidden = true;
renderProgrammTiles();
montiereIcons();
$('#app-version').textContent = APP_VERSION;
zeichneGeraeteLeiste();
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
if (demoParam !== null) demoStarten(demoParam);
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
