// Bootstrap und Screen-Routing.

import { Session } from './state.js';
import { esc } from './format.js';
import { getSettings, setSetting, requestPersistence, listSessions, getSession, listProgramme, saveProgramm, deleteProgramm } from './storage.js';
import { RideScreen } from './ui/ride.js';
import { renderHome, renderFahrten } from './ui/list.js';
import { renderDetail } from './ui/detail.js';
import { drawProfile, beobachte } from './ui/chart.js';
import { zeigeGraphOverlay } from './ui/overlay.js';
import { logInfo, logError } from './logger.js';
import { geraeteManager } from './ble/geraete.js';
import { starteUpdateWatchdog, heileVersionsDrift, APP_VERSION } from './version.js';
import { toast, toastOk, toastErr } from './ui/toast.js';
import { oeffneModal, schliesseObersten, istStill, eintragAbbauen, zurueck,
  setzeReloadRegel, neuLaden, ausstehendNachholen } from './navigation.js';
import { openSettings, zeigeDatenBlatt } from './ui/settings.js';
import { startDemo, beispielFahrt, beispielHistorie } from './demo.js';

// Demo starten (Button auf Home + ?demo-Parameter) — durch denselben
// Guard wie startRide: kein Doppelstart neben laufendem BLE-Connect
async function demoStarten(variante) {
  if (variante === 'fahrt') return beispielfahrtZeigen();
  if (variante === 'fahrten') return beispielHistorieZeigen();
  if (startLaeuft || rideScreen) return;
  startLaeuft = true;
  try { await startDemo(variante, { betreteFahrt }); }
  finally { startLaeuft = false; }
}
import { zeichneGeraeteLeiste, geraeteHinweis } from './ui/geraete-leiste.js';
import { montiereIcons, svgIcon } from './ui/icons.js';
import { parseZwo, zwoProgramm } from './zwo.js';
import { besteDauerleistung, effektiveFtp, FTP_ANNAHME } from './metrics.js';
import { PROGRAMME, ProgramRun, baueBlocks, defaultOpts, holeSeed, neuerSeed, setzeSeed } from './program.js';
import { WORKOUTS } from './workouts.js';
import { renderPlan, oeffnePlanDialog, planErsatzHeute } from './ui/plan-ui.js';
import { initAudio } from './signals.js';
import { starteMessung } from './energie.js';

const $ = s => document.querySelector(s);
const screens = { home: $('#screen-home'), ride: $('#screen-ride'), detail: $('#screen-detail'), fahrten: $('#screen-fahrten') };

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
  ausstehendNachholen();                        // verpasstes Update nachholen
});

let rideScreen = null;
let startLaeuft = false;    // Doppel-Tap auf eine Kachel → nur ein Verbindungsaufbau

// Updates laden nie mitten in der Fahrt, beim Verbindungsaufbau oder mit
// offenem Dialog neu (Dialoge prüft navigation.js selbst)
setzeReloadRegel(() => !rideScreen && !startLaeuft);

// Gemeinsamer Fahrt-Eintritt für echte Fahrt UND Demo — eine Stelle für
// Screen-Wechsel, History, UI-State und WakeLock, damit die Demo bei
// Ergänzungen nicht wieder stumm zurückfällt (passiert mit keepAwake)
function betreteFahrt(session, settings, onEnd, run) {
  show('ride');
  history.pushState({ screen: 'ride' }, '');
  speichereUiState();
  keepAwake(true);
  rideScreen = new RideScreen(screens.ride, session, settings, onEnd, run);
  return rideScreen;
}

// Gegenstück: Fahrbildschirm abbauen und seinen History-Eintrag entfernen
// (bei Beenden per Doppel-Zurück ist er schon weg)
function verlasseFahrt() {
  rideScreen?.destroy();
  rideScreen = null;
  keepAwake(false);
  eintragAbbauen();
}

// plan: { vorgaben, planInfo, abgebrochen? } — Start aus dem Trainingsplan
// (Dialog vorbelegt); abgebrochen() läuft, wenn der Startdialog abgebrochen wird
async function startRide(programm = null, plan = null) {
  if (startLaeuft || rideScreen) return;
  startLaeuft = true;
  try {
    await startRideInner(programm, plan);
  } finally {
    startLaeuft = false;
  }
}

async function startRideInner(programm, plan = null) {
  // Ohne Web Bluetooth (Brave/Firefox/iOS) kann keine Fahrt starten — der
  // Tap bleibt möglich, damit der Nutzer den Grund erfährt statt eines
  // stumm toten Buttons
  if (!navigator.bluetooth) {
    toastErr(navigator.brave
      ? 'Brave blockiert Web Bluetooth — bitte Chrome verwenden'
      : 'Kein Web Bluetooth — Chrome unter Android/Desktop nötig');
    return;
  }
  const settings = await getSettings();
  initAudio();                              // braucht die User-Geste des Start-Taps
  let run = null, blocks = null, seed = null;
  if (programm) {
    const opts = await startDialog(programm, settings, plan?.vorgaben);
    if (!opts) { await plan?.abgebrochen?.(); return; }
    blocks = baueBlocks(programm, opts, settings.ftp);
    seed = opts.seed ?? null;
  }
  // Vorabcheck: ist der Bluetooth-Adapter überhaupt verfügbar/an?
  if (await navigator.bluetooth.getAvailability?.() === false) {
    toastErr('Bluetooth ist ausgeschaltet — bitte einschalten');
    return;
  }
  // Trainer: verbundenen Pool-Client übernehmen; sonst verbinden (gemerkt)
  // oder Geräteauswahl — die Entscheidung trifft der Manager zentral
  let ftms = geraeteManager.client('trainer');
  try {
    if (!ftms) {
      const r = await geraeteManager.verbindeOderKoppel('trainer', {
        // Ohne Flag ist der Chooser der normale Weg — nur echte Abläufe erklären
        vorAuswahl: grund => { if (grund === 'nichtAutorisiert') toast(geraeteHinweis('Trainer', { grund })); },
      });
      if (r.ergebnis === 'abgebrochen') {
        // Chooser abgebrochen ODER keine Berechtigung/kein Gerät — nicht still schlucken
        toastErr('Kein Trainer gewählt. Trainer wach? Chrome-Berechtigung „Geräte in der Nähe“ erteilt?');
        return;
      }
      ftms = geraeteManager.client('trainer');
      if (!ftms) { toastErr('Trainer schläft — Pedal kurz drehen, dann erneut starten'); return; }
    }
  } catch (err) {
    logError('app', 'Verbindung fehlgeschlagen', `${err.name}: ${err.message}`);
    toastErr('Verbindung fehlgeschlagen: ' + err.message);
    return;
  }
  $('#bt-support').textContent = '';
  requestPersistence();
  logInfo('app', `Session-Start: ${programm?.name ?? 'Freies Fahren'}`);
  geraeteManager.starteSession();           // Trainer kämpft ab jetzt um die Verbindung
  const session = new Session(ftms, settings, programm);
  session.seed = seed;                      // Zufallsprogramm exakt wiederholbar
  // Trainingsplan: aus dem Plan gestartet → diese Einheit; sonst gilt eine
  // Fahrt ≥ 15 min an einem Plantag als Ersatz für die offene Einheit
  session.planInfo = plan?.planInfo ?? await planErsatzHeute();
  starteMessung();                          // Akku-Delta pro Fahrt (Punkt „Strom messen")
  if (blocks) run = new ProgramRun(session, blocks);
  else session.setTarget(settings.startWatt, { instant: true });
  betreteFahrt(session, settings, async (_, gespeichert) => {
    verlasseFahrt();
    // Verbindung lebt im Pool weiter — getrennt wird über die Geräte-Leiste.
    // Aber: ohne Fahrt kein Auto-Reconnect mehr (sonst kämpft die App nach
    // Trainer-Standby endlos weiter — Livetest: >25 min Reconnect-Schleife)
    geraeteManager.beendeSession();
    if (gespeichert && session.count > 0) toastOk('Fahrt gespeichert');
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

// Startdialog: Optionsfelder aus der Programmdefinition. vorgaben: Werte
// aus dem Trainingsplan — Felder vorbelegt, Zusätze ohne Feld (z. B.
// tempo: false) gehen unverändert mit
function startDialog(programm, settings = {}, vorgaben = null) {
  const dlg = $('#dlg-start');
  $('#dlg-title').textContent = programm.name;
  const hint = $('#dlg-hint');
  const hinweise = [];
  if (programm.generieren && !settings.ftp)
    hinweise.push(`Kein FTP-Wert hinterlegt — Annahme ${FTP_ANNAHME} W. In den Einstellungen anpassen.`);
  // Die App kappt jedes Ziel an der Obergrenze — beim Rampentest wird daraus
  // sonst unbemerkt ein Plateau und der FTP-Vorschlag ist gedeckelt
  if (programm.id === 'rampentest')
    hinweise.push(`Die Rampe endet an der Obergrenze aus den Einstellungen (${settings.maxWatt} W).`);
  hint.hidden = !hinweise.length;
  hint.textContent = hinweise.join(' ');
  const fields = $('#dlg-fields');
  fields.replaceChildren();
  for (const [key, o] of Object.entries(programm.optionen)) {
    const label = document.createElement('label');
    label.textContent = o.label;
    const input = document.createElement('input');
    Object.assign(input, { type: 'number', min: o.min, max: o.max, value: vorgaben?.[key] ?? o.default, name: key });
    label.append(input);
    fields.append(label);
  }

  // Live-Vorschau des Intensitätsprofils, folgt den Eingaben
  const preview = $('#dlg-preview');
  // Zufallsprogramme: gespeicherter Startwert — Vorschau = gefahrener Ablauf
  let seed = programm.zufall ? holeSeed(programm.id) : undefined;
  const zusaetze = Object.fromEntries(Object.entries(vorgaben ?? {}).filter(([k]) => !(k in programm.optionen)));
  const leseOpts = () => {
    const opts = { ...zusaetze };
    for (const inp of fields.querySelectorAll('input'))
      opts[inp.name] = Math.min(inp.max, Math.max(inp.min, Number(inp.value) || 0));
    if (seed !== undefined) opts.seed = seed;
    return opts;
  };
  const zeichne = () => {
    try { drawProfile(preview, baueBlocks(programm, leseOpts(), settings.ftp), effektiveFtp(settings.ftp)); }
    catch { /* unvollständige Eingabe während des Tippens */ }
  };
  fields.oninput = zeichne;
  const wuerfeln = $('#dlg-wuerfeln');
  wuerfeln.hidden = !programm.zufall;
  wuerfeln.onclick = () => {
    seed = neuerSeed(programm.id);
    zeichne();
    renderProgrammTiles();                  // Kachel-Miniatur zeigt den neuen Ablauf
  };
  // Tap auf die Vorschau: Vollbild mit gut lesbaren Klammern und Zeitachse
  preview.onclick = () => {
    try { zeigeProfilOverlay(programm, baueBlocks(programm, leseOpts(), settings.ftp), settings.ftp); }
    catch { /* unvollständige Eingabe */ }
  };

  return new Promise(resolve => {
    let abmelden = null;
    dlg.onclose = () => {
      abmelden?.();
      resolve(dlg.returnValue === 'ok' ? leseOpts() : null);
    };
    oeffneModal(dlg, 'start');
    zeichne();            // erst nach showModal: Canvas braucht sein Layout
    abmelden = beobachte(preview, zeichne);   // Drehen: Vorschau neu zeichnen
  });
}

// Programmprofil im Vollbild-Overlay (Startdialog-Vorschau, ?big)
function zeigeProfilOverlay(programm, blocks, ftp) {
  const min = Math.round(blocks.reduce((a, b) => a + b.dauer, 0) / 60);
  zeigeGraphOverlay(c => drawProfile(c, blocks, effektiveFtp(ftp)),
    programm.name, `${min} min${ftp ? '' : ` · FTP-Annahme ${FTP_ANNAHME} W`}`);
}

// Importierte Programme — ein kaputtes einzeln überspringen (und loggen),
// statt die ganze Kachel-Liste samt „Zuletzt gefahren" zu verlieren
async function eigeneProgramme() {
  return (await listProgramme()).flatMap(p => {
    try { return [zwoProgramm(p)]; } catch (err) { logError('app', `Programm ${p?.id} unlesbar`, err.message); return []; }
  });
}

// Programm per id — eingebaut oder importiert (?dlg, ?big)
async function findeProgramm(id) {
  const customs = await eigeneProgramme();
  return [...WORKOUTS, ...PROGRAMME, ...customs].find(x => x.id === id) ?? null;
}

let tilesKette = Promise.resolve();
let kachelnAbmelden = [];   // Resize-Beobachtung der Kachel-Profile
function renderProgrammTiles() {
  tilesKette = tilesKette.then(renderProgrammTilesInner).catch(() => {});
  return tilesKette;
}

async function renderProgrammTilesInner() {
  const settings = await getSettings();
  const effFtp = effektiveFtp(settings.ftp);
  for (const ab of kachelnAbmelden) ab();
  kachelnAbmelden = [];
  // loeschen: optionaler Handler — eigener ✕-Knopf NEBEN der Kachel (kein
  // Knopf im Knopf), Tippfläche 44 px
  const fill = (sel, list, loeschen = null) => {
    const wrap = $(sel);
    wrap.replaceChildren();     // erneuter Aufruf (z. B. nach FTP-Änderung) ersetzt
    for (const p of list) {
      const btn = document.createElement('button');
      btn.className = 'tile';
      btn.innerHTML = `<span class="tile-title">${esc(p.name)}</span><span class="tile-sub">${esc(p.sub)}</span>`;
      const mini = document.createElement('canvas');
      mini.className = 'tile-profile';
      mini.width = 220; mini.height = 36;
      btn.append(mini);
      btn.addEventListener('click', () => startRide(p));
      let element = btn;
      if (loeschen) {
        element = document.createElement('div');
        element.className = 'tile-rahmen';
        const x = document.createElement('button');
        x.type = 'button';
        x.className = 'tile-x';
        x.textContent = '✕';
        x.setAttribute('aria-label', `„${p.name}“ löschen`);
        x.onclick = () => loeschen(p);
        element.append(btn, x);
      }
      wrap.append(element);
      try {
        const blocks = baueBlocks(p, defaultOpts(p), settings.ftp);
        const zeichne = () => drawProfile(mini, blocks, effFtp);
        zeichne();
        kachelnAbmelden.push(beobachte(mini, zeichne));   // Drehen: scharf neu zeichnen
      } catch { mini.remove(); }
    }
  };
  fill('#workout-tiles', WORKOUTS);
  fill('#programm-tiles', PROGRAMME);

  // Importierte .zwo-Workouts als eigene Kacheln mit Löschknopf. Der Import
  // ist eine Einstellung (standardmäßig aus); schon importierte Programme
  // bleiben auch ohne ihn sichtbar und fahrbar
  const customs = await eigeneProgramme();
  $('#btn-zwo').hidden = !settings.zwoImport;
  $('#rubrik-custom').hidden = !settings.zwoImport && !customs.length;
  fill('#custom-tiles', customs, async p => {
    if (confirm(`„${p.name}“ löschen?`)) { await deleteProgramm(p.id); renderProgrammTiles(); }
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
    lastBtn.onclick = () => {
      // Zufallsprogramm: den damals gefahrenen Ablauf wiederherstellen
      if (letztesProgramm.zufall && letzte.seed != null) {
        setzeSeed(letztesProgramm.id, letzte.seed);
        renderProgrammTiles();
      }
      startRide(letztesProgramm);
    };
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
    const { name, bloecke, uebersprungen } = parseZwo(await file.text());
    await saveProgramm({ id: `zwo-${Date.now()}`, name, bloecke });
    await renderProgrammTiles();
    logInfo('app', `.zwo importiert: ${name} (${bloecke.length} Blöcke)`, uebersprungen.join(', ') || undefined);
    toastOk(`„${name}“ importiert (${bloecke.length} Blöcke)`);
    if (uebersprungen.length) toast(`Nicht unterstützt, übersprungen: ${uebersprungen.join(', ')}`, 'info', 6000);
  } catch (err) {
    toastErr('Import fehlgeschlagen: ' + err.message);
  }
});

let detailCleanup = null;
let aktuelleDetailId = null;

// --- App-Zustand (M7): Screen + Scroll überleben App-Kill, 30-min-Fenster ---
history.scrollRestoration = 'manual';
const UISTATE_GUELTIG_MS = 30 * 60 * 1000;

function speichereUiState() {
  if (demoHistorie) return;          // Demo-Historie nie als App-Zustand merken
  try {
    localStorage.setItem('uiState', JSON.stringify({
      screen: !screens.detail.hidden ? 'detail' : !screens.ride.hidden ? 'ride'
        : !screens.fahrten.hidden ? 'fahrten' : 'home',
      detailId: aktuelleDetailId,
      scrollHome: screens.home.hidden ? 0 : Math.round(scrollY),
      scrollFahrten: screens.fahrten.hidden ? fahrtenScroll : Math.round(scrollY),
      savedAt: Date.now(),
    }));
  } catch { /* localStorage optional */ }
}
// Empfehlung aus der Recherche: visibilitychange+pagehide, NIE beforeunload
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') speichereUiState();
});
addEventListener('pagehide', speichereUiState);

// roh: beim Boot VOR goHome() gelesen — goHome speichert selbst den
// Home-Zustand und würde den gemerkten sonst überschreiben
async function restoreUiState(roh) {
  try {
    const s = JSON.parse(roh ?? 'null');
    if (!s || Date.now() - s.savedAt > UISTATE_GUELTIG_MS) return false;
    if (s.screen === 'detail' && s.detailId) {
      const meta = await getSession(s.detailId);
      if (meta) {
        history.pushState({ screen: 'detail' }, '');   // genau EIN Eintrag über Home
        await openDetail(meta, { push: false });
        return true;
      }
    }
    if (s.screen === 'fahrten') {
      fahrtenScroll = s.scrollFahrten ?? 0;
      await openFahrten({ scroll: fahrtenScroll });
      return true;
    }
    // 'ride' wird bewusst nie restauriert (BLE-Session ist tot) → Home
    if (s.scrollHome) requestAnimationFrame(() => scrollTo(0, s.scrollHome));
  } catch { /* defekter State → frisch starten */ }
  return false;
}

// --- Zurück-Taste: History-Einträge je Screen/Dialog (navigation.js), ---
// --- doppeltes Zurück beendet die Fahrt                                ---
let backArmiertBis = 0;

addEventListener('popstate', () => {
  if (istStill()) return;                    // eigener Abbau, Ansicht steht schon
  if (schliesseObersten()) return;           // offener Dialog: abbrechen
  if (!screens.detail.hidden) { zurueckAusDetail(); return; }
  if (!screens.fahrten.hidden) { zurueckAusFahrten(); return; }
  if (!screens.ride.hidden && rideScreen) {
    if (Date.now() < backArmiertBis) {
      rideScreen.beenden();                  // sauber beenden + speichern, ohne „Sicher?"
    } else {
      backArmiertBis = Date.now() + 2500;
      toast('Nochmal „Zurück“ beendet die Fahrt');
      history.pushState({ screen: 'ride' }, '');   // re-armieren
    }
  }
  // home: nichts — Systemverhalten (App in den Hintergrund)
});

async function goHome() {
  demoHistorie = null;                // Home verlässt die Demo-Historie
  // Demo-Parameter aus der Adresse: Reload/Update landet sonst wieder in der Demo
  if (new URLSearchParams(location.search).has('demo')) history.replaceState(history.state, '', location.pathname);
  renderProgrammTiles();          // „Zuletzt gefahren" sofort nachführen
  renderPlan({ starte: startRide, oeffneFahrt: s => openDetail(s) });
  zeichneGeraeteLeiste();
  detailCleanup?.();
  detailCleanup = null;
  aktuelleDetailId = null;
  show('home');
  speichereUiState();
  await renderHome($('#session-list'), openDetail, () => openFahrten());
  aktualisiereStatuszeile();
  ausstehendNachholen(2500);          // Update nach der Fahrt — „Fahrt gespeichert" noch lesbar
}

// Statuszeile unter dem Kopf: Datenbestand + Speicherschutz. (Die
// App-Aktualität daneben pflegt der Update-Watchdog aus version.js.)
async function aktualisiereStatuszeile() {
  try {
    const [sessions, persistent] = await Promise.all([
      listSessions(), navigator.storage?.persisted?.() ?? false,
    ]);
    $('#db-status').textContent =
      `${sessions.length} ${sessions.length === 1 ? 'Fahrt' : 'Fahrten'}`;
    $('#btn-speicher').hidden = persistent;
  } catch { /* Statuszeile ist nie kritisch */ }
}

// --- Fahrten-Historie: eigener Screen, Home zeigt nur die letzten Fahrten ---
let fahrtenScroll = 0;
let detailVonFahrten = false;   // Zurück aus der Detailansicht führt dorthin, woher man kam
let demoHistorie = null;        // { sessions, daten } solange ?demo=fahrten angezeigt wird

async function openFahrten({ push = true, scroll = 0 } = {}) {
  detailCleanup?.();
  detailCleanup = null;
  aktuelleDetailId = null;
  show('fahrten');
  if (push) history.pushState({ screen: 'fahrten' }, '');
  await renderFahrten(screens.fahrten, openDetail, { demo: demoHistorie?.sessions });
  scrollTo(0, scroll);
  speichereUiState();
}

function zurueckAusDetail() {
  if (detailVonFahrten) openFahrten({ push: false, scroll: fahrtenScroll });
  else goHome();
}

// Beispielfahrten (Button unter „Letzte Fahrten", Demo-Fahrbildschirm, ?demo=fahrten):
// derselbe Fahrten-Screen und dieselbe Detailansicht wie für echte Fahrten
// von: Demo-Fahrt, aus der die Historie geöffnet wurde (?demo=fahrten&von=…)
// — Zurück führt dann dorthin statt nach Home
async function beispielHistorieZeigen() {
  demoHistorie = await beispielHistorie();
  demoHistorie.vonFahrt = new URLSearchParams(location.search).get('von');
  await openFahrten();
}

// Wechsel in die Demo-Fahrt (per Neuladen — die Fahrt braucht frischen Zustand)
function zurDemoFahrt(variante) {
  location.replace(`${location.pathname}?demo=${encodeURIComponent(variante)}`);
}

// Zurück aus dem Fahrten-Screen: Home, oder — aus der Demo-Fahrt gekommen — dorthin
function zurueckAusFahrten() {
  if (demoHistorie?.vonFahrt) zurDemoFahrt(demoHistorie.vonFahrt);
  else goHome();
}

// Einzelne Beispielfahrt direkt in der Detailansicht (?demo=fahrt, UI-Arbeit)
// — derselbe Weg wie jede andere Fahrt, nur mit mitgelieferten Samples
async function beispielfahrtZeigen() {
  const { session, data } = await beispielFahrt();
  demoHistorie = { sessions: [session], daten: new Map([[session.id, data]]) };
  await openDetail(session);
}

async function openDetail(sessionMeta, { push = true } = {}) {
  detailVonFahrten = !screens.fahrten.hidden;
  if (detailVonFahrten) fahrtenScroll = Math.round(scrollY);
  show('detail');
  scrollTo(0, 0);
  aktuelleDetailId = sessionMeta.id;
  if (push) history.pushState({ screen: 'detail' }, '');
  speichereUiState();
  const demo = demoHistorie?.daten.get(sessionMeta.id) ?? null;
  // Nach dem Löschen: zurück über die History, wie mit dem Zurück-Knopf
  detailCleanup = await renderDetail(screens.detail, sessionMeta, () => zurueck(zurueckAusDetail), { demo });
}

$('#start-free').addEventListener('click', () => startRide());
$('#btn-demo').addEventListener('click', () => demoStarten('vo2max'));
$('#btn-demo-fahrt').addEventListener('click', beispielHistorieZeigen);
$('#btn-settings').addEventListener('click', () => openSettings({ nachSpeichern: renderProgrammTiles }));
$('#btn-daten').addEventListener('click', zeigeDatenBlatt);
$('#btn-speicher').addEventListener('click', zeigeDatenBlatt);
// Trainingsplan anlegen bzw. ändern — danach die Karte neu aufbauen
const planDialog = () => oeffnePlanDialog().then(geaendert => { if (geaendert) renderPlan({ starte: startRide, oeffneFahrt: s => openDetail(s) }); });
$('#plan-anlegen').addEventListener('click', planDialog);
$('#btn-plan').addEventListener('click', planDialog);
// Rückgängig aus dem Plan-Dialog (Pausieren) meldet sich hierüber
document.addEventListener('plan-geaendert', () => renderPlan({ starte: startRide, oeffneFahrt: s => openDetail(s) }));
$('#btn-back').addEventListener('click', () => zurueck(zurueckAusDetail));
$('#btn-back-fahrten').addEventListener('click', () => zurueck(zurueckAusFahrten));
$('#btn-demo-zur-fahrt').addEventListener('click', () => zurDemoFahrt(demoHistorie?.vonFahrt ?? 'vo2max'));
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
  const dauerhaft = await navigator.storage?.persist?.().catch(() => false);
  aktualisiereStatuszeile();
  toastOk(dauerhaft ? 'App installiert — Fahrten dauerhaft gespeichert' : 'App installiert');
});



// Flag-URLs sind nicht klickbar (Browser blocken chrome://-Links) — deshalb
// Kopier-Buttons. Ein delegierter Listener bedient alle .copy-btn; kopiert
// wird der Text des davorstehenden <code>-Elements (URL steht so nur EINMAL
// im Markup), data-copy bleibt als expliziter Override möglich.
document.addEventListener('click', e => {
  const b = e.target.closest('.copy-btn');
  if (!b) return;
  const text = b.dataset.copy ?? b.previousElementSibling?.textContent;
  if (!text) return;
  navigator.clipboard.writeText(text)
    .then(() => toastOk('Kopiert — in die Adresszeile einfügen'))
    .catch(() => toastErr('Kopieren fehlgeschlagen'));
});

// URL als <code> + Kopier-Button — svgIcon direkt einbetten, montiereIcons()
// ist zu diesem Zeitpunkt schon gelaufen
const flagChip = url => `<code>${url}</code> <button type="button" class="copy-btn" aria-label="Flag-Adresse kopieren" title="kopieren">${svgIcon('copy')}</button>`;

if (!navigator.bluetooth) {
  const linux = /Linux/.test(navigator.userAgent) && !/Android/.test(navigator.userAgent);
  $('#bt-support').innerHTML = navigator.brave
    ? `Brave blockiert Web Bluetooth — bitte Chrome verwenden (oder ${flagChip('brave://flags/#brave-web-bluetooth-api')})`
    : linux
      ? `Kein Web Bluetooth — unter Linux-Chrome erst ${flagChip('chrome://flags/#enable-web-bluetooth')} aktivieren`
      : 'Kein Web Bluetooth — Chrome unter Android/Desktop nötig';
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
    neuLaden('neuer Service Worker aktiv');   // nie mitten in der Fahrt — sonst nachgeholt
  });
}

const demoParam = new URLSearchParams(location.search).get('demo');
const dlgParam = new URLSearchParams(location.search).get('dlg');
if (demoParam !== null) demoStarten(demoParam);
else {
  let gemerkt = null;
  try { gemerkt = localStorage.getItem('uiState'); } catch { /* localStorage optional */ }
  goHome().then(() => { if (!dlgParam) restoreUiState(gemerkt); });
}
// ?dlg=<id> — Startdialog für UI-Arbeit/Screenshots direkt öffnen
if (dlgParam) {
  findeProgramm(dlgParam).then(async p => { if (p) startDialog(p, await getSettings()); });
}
// ?settings — Einstellungsdialog direkt öffnen (UI-Arbeit/Screenshots)
if (new URLSearchParams(location.search).has('settings')) {
  openSettings().then(() =>
    document.querySelectorAll('#dlg-settings details').forEach(d => { d.open = true; }));
}
// ?big=<id> — Graph-Vollbild direkt öffnen (UI-Arbeit/Screenshots)
const bigParam = new URLSearchParams(location.search).get('big');
if (bigParam) {
  findeProgramm(bigParam).then(async p => {
    if (!p) return;
    const { ftp } = await getSettings();
    zeigeProfilOverlay(p, baueBlocks(p, defaultOpts(p), ftp), ftp);
  });
}
