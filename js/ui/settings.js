// Einstellungen-Dialog inkl. Geräte-Verwaltung und Tasten-Lern-Modus.
// Aus main.js ausgelagert; App-Rückwirkungen (Kachel-Refresh nach
// FTP-Änderung) laufen über injizierte Callbacks.

import { getSettings, setSetting, setSettings, getLogs, clearLogs, alleDatenLoeschen, listSessions, EINSTELLUNGEN, pruefeEinstellung, HALTEN_TEMPO,
  tastenVon, MAX_TASTEN_JE_AKTION } from '../storage.js';

// Formularfelder ↔ Einstellungen; Grenzen und Standardwerte stehen nur im
// Schema (EINSTELLUNGEN in storage.js)
const ZAHLFELDER = { '#set-ftp': 'ftp', '#set-schritt': 'wattSchritt', '#set-max': 'maxWatt', '#set-start': 'startWatt',
  '#set-puls': 'pulsGrenze' };
const SCHALTER = { '#set-sprache': 'sprachansagen', '#set-ton': 'tonAn', '#set-zwo': 'zwoImport',
  '#set-halten-tasten': 'haltenTasten', '#set-halten-paddles': 'haltenPaddles' };
import { esc, dateiStempel } from '../format.js';
import { geraeteManager, kannMerken, eintraegeVon } from '../ble/geraete.js';
import { tastenName, tasteInfo } from '../ble/zwift-controller.js';
import { lenkerKarte, zeigeBelegung, tasteMitName } from './lenker-karte.js';
import { CONTROLLER_AKTIONEN, istBelegbar } from './controller-aktionen.js';
import { GL_ROLLEN, GL_ICONS, koppelMitRueckmeldung, geraeteHinweis } from './geraete-leiste.js';
import { oeffneModal } from '../navigation.js';
import { toast, toastOk, toastErr } from './toast.js';
import { download } from '../export.js';
import { formatLog } from '../logger.js';
import { exportiereAlles, importiereAlles } from '../backup.js';
import { initAudio, tick } from '../signals.js';

const $ = s => document.querySelector(s);

async function sicherungSpeichern() {
  download(`ergomergo-backup-${dateiStempel()}.json`,
    await exportiereAlles(), 'application/json');
  toastOk('Sicherung heruntergeladen');
}

// „Deine Daten": was die App mit den Daten macht und ob der Browser sie
// dauerhaft aufhebt (navigator.storage.persisted — ohne darf er sie bei
// Platzmangel löschen). Geöffnet aus der Statuszeile und den Einstellungen.
export async function zeigeDatenBlatt() {
  const dlg = $('#dlg-daten');
  const dauerhaft = await navigator.storage?.persisted?.().catch(() => false) ?? false;
  $('#daten-speicher-titel').textContent = dauerhaft ? 'Dauerhaft gespeichert' : 'Noch nicht dauerhaft gespeichert';
  $('#daten-speicher').textContent = dauerhaft
    ? 'Der Browser hebt deine Fahrten auf, bis du sie selbst löschst. Gegen den Verlust des Geräts hilft eine Sicherung (Einstellungen → Sicherung).'
    : 'Wird der Platz auf dem Gerät knapp, darf der Browser die Fahrten löschen. Abhilfe: die App installieren (Chrome-Menü → „App installieren“) — dann hebt Chrome sie in der Regel dauerhaft auf — oder ab und zu eine Sicherung speichern.';
  $('#daten-sicherung').hidden = dauerhaft;
  $('#daten-sicherung').onclick = sicherungSpeichern;
  oeffneModal(dlg, 'daten');
}

export async function openSettings({ nachSpeichern } = {}) {
  // Fahrten vor dem Öffnen lesen: der Hinweis zur Pulsgrenze steht dann
  // gleich da, statt die Rubriken darunter nachträglich zu verschieben
  const [s, fahrten] = await Promise.all([getSettings(), listSessions().catch(() => [])]);
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
  // Halten-Tempo: drei Stufen als Auswahl, der Text darunter folgt der Wahl
  const sekunden = ms => String(ms / 1000).replace('.', ',');
  const zeigeTakt = stufe => {
    const { pause, takt } = HALTEN_TEMPO[stufe];
    $('#halten-takt').textContent = `Nach ${sekunden(pause)} s Halten geht es los, dann ein Wattschritt alle ${sekunden(takt)} s.`;
  };
  $('#halten-tempo').replaceChildren(...Object.entries(HALTEN_TEMPO).map(([stufe, { name }]) => {
    const l = document.createElement('label');
    l.innerHTML = `<input type="radio" name="halten-tempo" value="${stufe}"${stufe === s.haltenTempo ? ' checked' : ''}>${name}`;
    return l;
  }));
  $('#halten-tempo').onchange = e => zeigeTakt(e.target.value);
  zeigeTakt(s.haltenTempo);

  // Tastenbelegung des Controllers: Anzeige + Lern-Modus
  const zeigeMap = map => zeigeBelegung($('#ctrl-map-karte'), $('#ctrl-map-anzeige'), map);
  zeigeMap(s.controllerMap);
  $('#btn-map-lernen').onclick = () => lerneTasten(zeigeMap);
  for (const [id, k] of Object.entries(ZAHLFELDER)) $(id).value = s[k];
  // Pulsgrenze aus = leeres Feld („aus" als Platzhalter). Darunter zur
  // Orientierung der höchste Puls aus den gespeicherten Fahrten — wird nie
  // automatisch übernommen; ohne Fahrten mit Puls kein Hinweis
  $('#set-puls').value = s.pulsGrenze || '';
  const hrMax = fahrten.reduce((m, f) => Number.isFinite(f.hrMax) && f.hrMax > m ? f.hrMax : m, 0);
  $('#puls-max').hidden = !hrMax;
  $('#puls-max').textContent = hrMax ? ` Dein höchster gemessener Wert: ${hrMax} bpm.` : '';
  for (const [id, k] of Object.entries(SCHALTER)) $(id).checked = s[k];

  // Sicherung: Export/Import der kompletten Datenbank
  $('#btn-backup').onclick = sicherungSpeichern;
  $('#btn-daten-mehr').onclick = zeigeDatenBlatt;
  // Alles löschen ist unumkehrbar — deshalb hier (und nur hier) eine Rückfrage
  $('#btn-alles-loeschen').onclick = async () => {
    if (!confirm('Alle Fahrten, Einstellungen, Programme, den Trainingsplan und das Log auf diesem Gerät endgültig löschen?\n\nTipp: vorher unter „Sicherung" exportieren.')) return;
    dlg.close('cancel');
    try {
      await alleDatenLoeschen();
      toastOk('Alle Daten gelöscht — lade neu …');
    } catch (err) {
      toastErr('Löschen fehlgeschlagen: ' + err.message);
    }
    setTimeout(() => location.replace(location.pathname), 1200);
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
    neu.haltenTempo = pruefeEinstellung('haltenTempo', dlg.querySelector('[name="halten-tempo"]:checked')?.value)
      ?? EINSTELLUNGEN.haltenTempo.std;
    await setSettings(neu);
    // verbundene Pads sofort umstellen
    geraeteManager.setzeHalten({ tasten: neu.haltenTasten, paddles: neu.haltenPaddles, tempo: neu.haltenTempo });
    nachSpeichern?.();          // Zonenfarben/Profile an neue FTP anpassen
    toastOk('Einstellungen gespeichert');
  };
  oeffneModal(dlg, 'settings');
}

// Tasten-Lern-Modus: verbindet den Controller und fragt Aktion für Aktion
// die Tasten ab — ersetzt die alte Bit-Raterei über den Diagnose-Log. Je
// Aktion beliebig viele Tasten (bis MAX_TASTEN_JE_AKTION) nacheinander
// drücken; jede steht sofort da, erneutes Drücken nimmt sie wieder heraus.
// „Weiter" (ab einer Taste) bzw. „Ohne Belegung weiter" geht zur nächsten
// Aktion. Eine Taste gehört nur zu einer Aktion: schon vergebene Tasten
// früherer Schritte werden abgewiesen.
async function lerneTasten(zeigeMap) {
  const dlg = $('#dlg-mapping');
  const schritte = CONTROLLER_AKTIONEN;
  const map = {};
  let i = 0;
  let gewaehlt = [];                             // Tasten der laufenden Aktion, in Drück-Reihenfolge
  let fertig = false;
  initAudio();                                   // Klick kam per Geste — Audio freischalten
  // Belegung samt der Tasten des laufenden Schritts (für die Lenkeransicht)
  const bisher = () => ({ ...map, [schritte[i].key]: gewaehlt });
  // Gewählte Tasten des Schritts sofort zeigen (die gedrückte Richtung, nicht
  // das ganze Paddle); „Weiter" erst ab einer Taste, sonst „Ohne Belegung weiter"
  const zeigeGewaehlt = () => {
    $('#map-gewaehlt').innerHTML = gewaehlt.map(bit => tasteMitName({ bit, ganz: false })).join('');
    $('#btn-map-weiter').hidden = !gewaehlt.length;
    $('#btn-map-weiter').textContent = i === schritte.length - 1 ? 'Fertig' : 'Weiter';
    $('#btn-map-skip').hidden = gewaehlt.length > 0;
  };
  const zeigeSchritt = () => {
    $('#map-schritt').textContent = `Drücke die Taste für: ${schritte[i].label}`;
    zeigeGewaehlt();
  };
  // Lenkeransicht: zeigt die bisher gelernten Tasten, die zuletzt gedrückte blinkt
  const zeigeKarte = (blink = null) => { $('#map-karte').innerHTML = lenkerKarte(bisher(), { blink }); };
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
  // Schritt abschließen: eine Taste als Einzelbit (Format wie bisher),
  // mehrere als Liste, keine = bewusst unbelegt
  const weiter = async () => {
    if (fertig || i >= schritte.length) return;  // Doppeltipp auf „Fertig" während des Speicherns
    map[schritte[i].key] = gewaehlt.length > 1 ? gewaehlt : gewaehlt[0] ?? null;
    gewaehlt = [];
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
    zeigeKarte();
    $('#map-status').textContent = 'Eine oder mehrere Tasten drücken.';
  };
  $('#btn-map-weiter').onclick = weiter;
  $('#btn-map-skip').onclick = () => { gewaehlt = []; weiter(); };
  const onButton = e => {
    if (fertig || i >= schritte.length) return;
    const bit = e.detail;
    if (!istBelegbar(tasteInfo(bit))) {
      $('#map-status').textContent = 'Ein/Aus schaltet das Pad aus — bitte eine andere Taste drücken.';
      return;
    }
    const name = tastenName(bit);
    zeigeKarte(bit);
    // Nochmal gedrückt: wieder heraus (Korrektur ohne Neustart)
    if (gewaehlt.includes(bit)) {
      gewaehlt = gewaehlt.filter(b => b !== bit);
      zeigeGewaehlt();
      zeigeKarte();
      $('#map-status').textContent = `${name} wieder herausgenommen. Andere Taste drücken oder ${gewaehlt.length ? 'Weiter' : 'ohne Belegung weiter'}.`;
      return;
    }
    // Schon für eine frühere Aktion gedrückt? Dann nicht doppelt vergeben.
    // Nur ausdrücklich gedrückte Tasten zählen — die freie Gegenrichtung
    // eines Paddles darf eine eigene Aktion bekommen (außen +, innen −)
    const andere = schritte.find(a => tastenVon(map[a.key]).includes(bit));
    if (andere) {
      $('#map-status').textContent = `${name} ist schon für „${andere.kurz}“ belegt — andere Taste drücken.`;
      return;
    }
    if (gewaehlt.length >= MAX_TASTEN_JE_AKTION) {
      $('#map-status').textContent = `Höchstens ${MAX_TASTEN_JE_AKTION} Tasten je Aktion — jetzt Weiter tippen.`;
      return;
    }
    gewaehlt = [...gewaehlt, bit];
    tick();
    zeigeGewaehlt();
    zeigeKarte(bit);
    $('#map-status').textContent = 'Weitere Taste drücken oder Weiter. Nochmal drücken nimmt eine Taste wieder heraus.';
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
      `Verbunden: ${namen} — jetzt eine oder mehrere Tasten drücken. (Zwift Click hat feste ±-Tasten, Lernen ist nur für den Ride nötig.)`;
  } catch (err) {
    toastErr('Lenker-Verbindung fehlgeschlagen: ' + err.message);
    ende();
  }
}
