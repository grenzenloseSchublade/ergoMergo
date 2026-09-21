// Einstellungen-Dialog inkl. Geräte-Verwaltung und Tasten-Lern-Modus.
// Aus main.js ausgelagert; App-Rückwirkungen (Kachel-Refresh nach
// FTP-Änderung) laufen über injizierte Callbacks.

import { getSettings, setSetting, getLogs, clearLogs } from '../storage.js';
import { geraeteManager, kannMerken, eintraegeVon } from '../ble/geraete.js';
import { GL_ROLLEN, GL_ICONS } from './geraete-leiste.js';
import { toast, toastOk, toastErr } from './toast.js';
import { download } from '../export.js';
import { formatLog } from '../logger.js';
import { exportiereAlles, importiereAlles } from '../backup.js';
import { initAudio, tick } from '../signals.js';

const $ = s => document.querySelector(s);

// Controller-Aktionen: EINE Quelle für Belegungsanzeige und Lern-Modus
const CONTROLLER_AKTIONEN = [
  ['plus', 'Watt hoch (+)'], ['minus', 'Watt runter (−)'],
  ['skip', 'Block vor (⏭)'], ['prev', 'Block zurück (⏮)'], ['stopp', 'STOPP / WEITER'],
];


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
    download(`ergomergo-log-${new Date().toISOString().slice(0, 19).replaceAll(':', '-')}.txt`,
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
      const namen = eintraege.map(e => `${e.name ?? e.id}${e.fw ? ` <span class="g-fw">FW ${e.fw}</span>` : ''}`).join(' + ');
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
        aktion.onclick = async () => {
          try {
            await geraeteManager.koppel(rolle);
            toastOk(`${label} gekoppelt & verbunden`);
            zeichneGeraete();
          } catch (err) {
            if (err.name !== 'NotFoundError') toastErr('Koppeln fehlgeschlagen: ' + err.message);
          }
        };
      }
      li.append(aktion);
      // Lenker: zweites Pad nachkoppeln (linke + rechte Seite sind eigene Geräte)
      if (rolle === 'controller' && eintraege.length === 1) {
        const pad2 = document.createElement('button');
        pad2.type = 'button';
        pad2.className = 'ghost';
        pad2.textContent = '+ 2. Pad';
        pad2.title = 'Zweite Lenkerseite koppeln (eigenes BLE-Gerät)';
        pad2.onclick = async () => {
          try {
            await geraeteManager.koppel('controller');
            toastOk('Zweites Pad gekoppelt & verbunden');
            zeichneGeraete();
          } catch (err) {
            if (err.name !== 'NotFoundError') toastErr('Koppeln fehlgeschlagen: ' + err.message);
          }
        };
        li.append(pad2);
      }
      liste.append(li);
    }
  };
  zeichneGeraete();

  // Tastenbelegung des Controllers: Anzeige + Lern-Modus
  const zeigeMap = map => {
    const belegt = CONTROLLER_AKTIONEN.filter(([k]) => map?.[k] !== undefined && map[k] !== null);
    $('#ctrl-map-anzeige').textContent = belegt.length
      ? 'Belegung: ' + belegt.map(([k, l]) => `${l} = Taste ${map[k]}`).join(' · ')
      : 'Keine Tasten zugeordnet.';
  };
  zeigeMap(s.controllerMap);
  $('#btn-map-lernen').onclick = () => lerneTasten(zeigeMap);
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
    nachSpeichern?.();          // Zonenfarben/Profile an neue FTP anpassen
    toastOk('Einstellungen gespeichert');
  };
  dlg.showModal();
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
    $('#map-schritt').textContent = `Drücke die Taste für: ${schritte[i][1]}`;
  };
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
    map[schritte[i][0]] = null;
    weiter();
  };
  const onButton = e => {
    // i kann während des await in weiter() schon hinter dem letzten Schritt
    // stehen (zwei Bits in einer Notification) — hart abfangen
    if (fertig || i >= schritte.length) return;
    const bit = e.detail;
    if (Object.values(map).includes(bit)) {
      $('#map-status').textContent = `Taste ${bit} ist schon belegt — andere Taste drücken.`;
      return;
    }
    map[schritte[i][0]] = bit;
    tick();
    $('#map-status').textContent = `Taste ${bit} zugeordnet.`;
    weiter();
  };
  dlg.showModal();
  zeigeSchritt();
  try {
    if ((await geraeteManager.gemerkte('controller')).length === 0) {
      await geraeteManager.koppel('controller');   // frische Geste → Chooser ok
    } else {
      await geraeteManager.verbinde('controller');
    }
    if (fertig) return;                          // Abbruch — Pool behält die Verbindung
    if (!geraeteManager.clients('controller').length) {
      $('#map-status').textContent = 'Controller nicht erreichbar — Gerät wecken und erneut öffnen.';
      return;
    }
    const clients = geraeteManager.clients('controller');
    for (const c of clients) { c.addEventListener('button', onButton); lauscher.push([c, onButton]); }
    const namen = clients.map(c => c.deviceName ?? 'Controller').join(' + ');
    $('#map-status').textContent =
      `Verbunden: ${namen} — jetzt drücken. (Zwift Click hat feste ±-Tasten, Lernen ist nur für Ride nötig.)`;
  } catch (err) {
    if (err.name !== 'NotFoundError') toastErr('Controller-Verbindung fehlgeschlagen: ' + err.message);
    ende();
  }
}
