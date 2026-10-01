// Einstellungen-Dialog inkl. Geräte-Verwaltung und Tasten-Lern-Modus.
// Aus main.js ausgelagert; App-Rückwirkungen (Kachel-Refresh nach
// FTP-Änderung) laufen über injizierte Callbacks.

import { getSettings, setSetting, setSettings, getLogs, clearLogs, EINSTELLUNGEN, pruefeEinstellung } from '../storage.js';

// Formularfelder ↔ Einstellungen; Grenzen und Standardwerte stehen nur im
// Schema (EINSTELLUNGEN in storage.js)
const ZAHLFELDER = { '#set-ftp': 'ftp', '#set-schritt': 'wattSchritt', '#set-max': 'maxWatt', '#set-start': 'startWatt' };
const SCHALTER = { '#set-sprache': 'sprachansagen', '#set-ton': 'tonAn', '#set-zwo': 'zwoImport',
  '#set-halten-tasten': 'haltenTasten', '#set-halten-paddles': 'haltenPaddles' };
import { esc, dateiStempel } from '../format.js';
import { geraeteManager, kannMerken, eintraegeVon } from '../ble/geraete.js';
import { tastenName, tasteInfo, HALTEN_TAKT_MS } from '../ble/zwift-controller.js';
import { tastenSymbol } from './tasten-symbol.js';
import { lenkerKarte } from './lenker-karte.js';
import { CONTROLLER_AKTIONEN, istBelegt, istBelegbar } from './controller-aktionen.js';
import { GL_ROLLEN, GL_ICONS, koppelMitRueckmeldung, geraeteHinweis } from './geraete-leiste.js';
import { oeffneModal } from '../navigation.js';
import { toast, toastOk, toastErr } from './toast.js';
import { download } from '../export.js';
import { formatLog } from '../logger.js';
import { exportiereAlles, importiereAlles } from '../backup.js';
import { initAudio, tick } from '../signals.js';

const $ = s => document.querySelector(s);

export async function openSettings({ nachSpeichern } = {}) {
  const s = await getSettings();
  const dlg = $('#dlg-settings');
  // Diagnose-Log laden (letzte 200 Einträge, neueste unten)
  getLogs().then(entries => {
    $('#log-view').textContent = entries.length
      ? formatLog(entries.slice(-200)) : 'Noch keine Einträge.';
    $('#log-view').scrollTop = $('#log-view').scrollHeight;
  });
  $('#btn-log-export').onclick = async () =>
    download(`ergomergo-log-${dateiStempel()}.txt`,
      formatLog(await getLogs()), 'text/plain');
  $('#btn-log-clear').onclick = async () => {
    await clearLogs();
    $('#log-view').textContent = 'Geleert.';
  };

  // Geräte-Bereich: Karten je Rolle — reiner Renderer über den GeraeteManager
  $('#geraete-hint').hidden = kannMerken();
  const rollen = GL_ROLLEN;
  const zeichneGeraete = async () => {
    const geraete = (await getSettings()).geraete;
    const liste = $('#geraete-liste');
    liste.replaceChildren();
    for (const [rolle, label] of rollen) {
      const eintraege = eintraegeVon(geraete, rolle);
      const li = document.createElement('li');
      const namen = eintraege.map(e => `${esc(e.name ?? e.id)}${e.fw ? ` <span class="g-fw">FW ${esc(e.fw)}</span>` : ''}`).join(' + ');
      li.innerHTML = `
        <span class="g-icon">${GL_ICONS[rolle]}</span>
        <span class="g-info">
          <span class="g-rolle">${label}</span>
          <span class="g-name">${eintraege.length ? `<i class="dot on"></i>${namen}` : '<i class="dot"></i>nicht gemerkt'}</span>
        </span>`;
      const aktion = document.createElement('button');
      aktion.type = 'button';
      if (eintraege.length) {
        aktion.textContent = 'Entfernen';
        aktion.className = 'ghost';
        aktion.onclick = async () => {
          await geraeteManager.vergiss(rolle);
          toast(`${label} vergessen`);
          zeichneGeraete();
        };
      } else {
        aktion.textContent = 'Koppeln';
        aktion.onclick = () => koppelMitRueckmeldung(rolle, label);
      }
      li.append(aktion);
      // Lenker: zweites Pad nachkoppeln (linke + rechte Seite sind eigene Geräte)
      if (rolle === 'controller' && eintraege.length === 1) {
        const pad2 = document.createElement('button');
        pad2.type = 'button';
        pad2.className = 'ghost';
        pad2.textContent = '+ 2. Pad';
        pad2.title = 'Zweite Lenkerseite koppeln (eigenes BLE-Gerät)';
        pad2.onclick = () => koppelMitRueckmeldung('controller', 'Zweites Pad');
        li.append(pad2);
      }
      liste.append(li);
    }
  };
  zeichneGeraete();
  // Koppeln/Trennen (auch aus dem Lern-Modus) sofort in der Liste zeigen
  geraeteManager.addEventListener('change', zeichneGeraete);
  dlg.addEventListener('close', () => geraeteManager.removeEventListener('change', zeichneGeraete), { once: true });
  $('#halten-takt').textContent = `ein Wattschritt alle ${String(HALTEN_TAKT_MS / 1000).replace('.', ',')} s`;

  // Tastenbelegung des Controllers: Anzeige + Lern-Modus
  const zeigeMap = map => {
    $('#ctrl-map-karte').innerHTML = lenkerKarte(map ?? {});
    const belegt = CONTROLLER_AKTIONEN.filter(a => istBelegt(map, a.key));
    $('#ctrl-map-anzeige').innerHTML = belegt.length
      ? belegt.map(a => `<li>${a.label}<span class="belegung-taste">${tastenSymbol(map[a.key])}<small>${tastenName(map[a.key])}</small></span></li>`).join('')
      : '<li class="leer">Keine Tasten zugeordnet.</li>';
  };
  zeigeMap(s.controllerMap);
  $('#btn-map-lernen').onclick = () => lerneTasten(zeigeMap);
  for (const [id, k] of Object.entries(ZAHLFELDER)) $(id).value = s[k];
  for (const [id, k] of Object.entries(SCHALTER)) $(id).checked = s[k];

  // Sicherung: Export/Import der kompletten Datenbank
  $('#btn-backup').onclick = async () => {
    download(`ergomergo-backup-${dateiStempel()}.json`,
      await exportiereAlles(), 'application/json');
    toastOk('Sicherung heruntergeladen');
  };
  $('#btn-restore').onclick = () => $('#backup-file').click();
  $('#backup-file').onchange = async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (!confirm('Sicherung importieren? Einstellungen werden überschrieben, Fahrten ergänzt.')) return;
    // Dialog ohne Speichern schließen — sonst überschriebe „Speichern" die
    // importierten Einstellungen mit den alten Formularwerten
    dlg.close('cancel');
    try {
      const n = await importiereAlles(await file.text());
      toastOk(`Wiederhergestellt: ${n} Fahrten — lade neu …`);
    } catch (err) {
      toastErr('Import fehlgeschlagen: ' + err.message);
    }
    // Auch nach Teilimport neu laden: die App zeigt sonst einen Mischzustand
    setTimeout(() => location.reload(), 1500);
  };
  dlg.onclose = async () => {
    if (dlg.returnValue !== 'ok') return;
    // Zahlen über das Schema klemmen und runden — die Felder erzwingen keine
    // Schritte (ein Rampentest-FTP wie 248 blockierte sonst jedes Speichern);
    // leer oder 0 → Standardwert
    const neu = {};
    for (const [id, k] of Object.entries(ZAHLFELDER))
      neu[k] = pruefeEinstellung(k, Math.round(Number($(id).value)) || EINSTELLUNGEN[k].std);
    for (const [id, k] of Object.entries(SCHALTER)) neu[k] = $(id).checked;
    await setSettings(neu);
    geraeteManager.setzeHalten({ tasten: neu.haltenTasten, paddles: neu.haltenPaddles });   // verbundene Pads sofort umstellen
    nachSpeichern?.();          // Zonenfarben/Profile an neue FTP anpassen
    toastOk('Einstellungen gespeichert');
  };
  oeffneModal(dlg, 'settings');
}

// Tasten-Lern-Modus: verbindet den Controller und fragt Aktion für Aktion
// eine Taste ab — ersetzt die alte Bit-Raterei über den Diagnose-Log.
async function lerneTasten(zeigeMap) {
  const dlg = $('#dlg-mapping');
  const schritte = CONTROLLER_AKTIONEN;
  const map = {};
  let i = 0;
  let fertig = false;
  initAudio();                                   // Klick kam per Geste — Audio freischalten
  const zeigeSchritt = () => {
    $('#map-schritt').textContent = `Drücke die Taste für: ${schritte[i].label}`;
  };
  // Lenkeransicht: zeigt die bisher gelernten Tasten, die zuletzt gedrückte blinkt
  const zeigeKarte = (blink = null) => { $('#map-karte').innerHTML = lenkerKarte(map, { blink }); };
  let lauscher = [];                             // [client, fn] — beim Ende abbauen
  const ende = () => {
    fertig = true;
    for (const [c, fn] of lauscher) c.removeEventListener('button', fn);
    lauscher = [];
    dlg.close();                                 // Verbindungen bleiben im Pool
  };
  $('#btn-map-abbruch').onclick = () => dlg.close();
  // 'close' fängt ALLE Wege (ESC, Abbrechen, Zurück-Taste via popstate) —
  // oncancel feuert bei programmatischem close() nicht
  dlg.addEventListener('close', ende, { once: true });
  const weiter = async () => {
    i++;
    if (i >= schritte.length) {
      await setSetting('controllerMap', map);
      geraeteManager.setzeControllerMap(map);   // verbundene Pads sofort umbelegen
      zeigeMap(map);
      toastOk('Tastenbelegung gespeichert');
      ende();
      return;
    }
    zeigeSchritt();
  };
  $('#btn-map-skip').onclick = () => {
    if (fertig || i >= schritte.length) return;
    map[schritte[i].key] = null;
    weiter();
  };
  const onButton = e => {
    // i kann während des await in weiter() schon hinter dem letzten Schritt
    // stehen (zwei Bits in einer Notification) — hart abfangen
    if (fertig || i >= schritte.length) return;
    const bit = e.detail;
    if (!istBelegbar(tasteInfo(bit))) {
      $('#map-status').textContent = 'Ein/Aus schaltet das Pad aus — bitte eine andere Taste drücken.';
      return;
    }
    if (Object.values(map).includes(bit)) {
      zeigeKarte(bit);
      $('#map-status').innerHTML = `${tastenSymbol(bit)} ${tastenName(bit)} ist schon belegt — andere Taste drücken.`;
      return;
    }
    map[schritte[i].key] = bit;
    zeigeKarte(bit);
    tick();
    $('#map-status').innerHTML = `${tastenSymbol(bit)} ${tastenName(bit)} zugeordnet.`;
    weiter();
  };
  oeffneModal(dlg, 'mapping');
  zeigeSchritt();
  zeigeKarte();
  try {
    // Dieselbe Entscheidung wie überall: verbinden oder — ohne Berechtigung —
    // Geräteauswahl (Tap auf „Tasten zuordnen" ist die frische Geste)
    const r = await geraeteManager.verbindeOderKoppel('controller');
    if (fertig) return;                          // Abbruch — Pool behält die Verbindung
    if (r.ergebnis === 'abgebrochen') { ende(); return; }
    if (!geraeteManager.clients('controller').length) {
      $('#map-status').textContent = geraeteHinweis('Lenker', r) ?? 'Lenker nicht erreichbar — Gerät wecken und erneut öffnen.';
      return;
    }
    const clients = geraeteManager.clients('controller');
    for (const c of clients) { c.addEventListener('button', onButton); lauscher.push([c, onButton]); }
    const namen = clients.map(c => c.deviceName ?? 'Lenker').join(' + ');
    $('#map-status').textContent =
      `Verbunden: ${namen} — jetzt drücken. (Zwift Click hat feste ±-Tasten, Lernen ist nur für den Ride nötig.)`;
  } catch (err) {
    toastErr('Lenker-Verbindung fehlgeschlagen: ' + err.message);
    ende();
  }
}
