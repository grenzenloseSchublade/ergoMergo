#!/usr/bin/env node
// Sicherheits-Prüfung (Katalog: docs/sicherheit.md):
//   DOM-01  präparierte Sicherung (Schadcode in Zahlenfeldern, Tastenbelegung,
//           Programmname) führt keinen Code aus und wird bereinigt
//   STO-02  unbekannte/alte Einstellungen (icuApiKey) werden verworfen und gelöscht
//   STO-03  Sicherung enthält keine gerätebezogenen Daten (geraete)
//   STO-04  „Alle Daten löschen“ entfernt Datenbank und Browser-Merker
// Aufruf: node test/sicherheit.mjs     Exit 1 bei Abweichung.

import { server, browser, sleep } from './lib.mjs';

const srv = await server();
const b = await browser({ breite: 412, hoehe: 900 });
const abweichungen = [];
let schritte = 0;
const soll = (was, ist, erwartet) => {
  schritte++;
  const ok = typeof erwartet === 'function' ? erwartet(ist) : JSON.stringify(ist) === JSON.stringify(erwartet);
  if (!ok) abweichungen.push(`${was}: ist ${JSON.stringify(ist)}`);
};

const PAYLOAD = '<img src=x onerror="window.__xss=1">';
const boese = {
  format: 'ergomergo-backup', version: 1,
  settings: {
    ftp: 230, maxWatt: 99999, icuApiKey: 'FREMDER-KEY', geraete: { trainer: { id: 'x', name: PAYLOAD } },
    controllerMap: { plus: PAYLOAD, minus: 3, skip: null }, zwoImport: true, ['__proto__']: { boese: 1 }, pulsGrenze: 999,
    unbekannt: 'x',
  },
  sessions: [
    { id: 'boese-1', start: Date.now() - 864e5, programm: PAYLOAD, programmId: 'vo2max', dauer: 2700,
      avgW: PAYLOAD, maxW: 300, kJ: PAYLOAD, km: PAYLOAD, np: 180, if: 0.8, tss: PAYLOAD, final: true,
      zonenSek: [PAYLOAD, 1, 1, 1, 1, 1], extra: PAYLOAD,
      plan: { ref: 'plan:2026-01-01', woche: PAYLOAD, name: PAYLOAD, laenge: 8 } },
    { id: 'ohne-start', dauer: 100 },
  ],
  programme: [
    { id: 'zwo-1', name: PAYLOAD, bloecke: [{ dauer: 60, pct: 0.8, gruppe: 'g', gruppeLabel: '2×' }] },
    { id: 'zwo-2', name: 'kaputt', bloecke: [{ dauer: 'x', pct: 1 }] },
  ],
  sessionData: [{ id: 'boese-1', count: 2, samples: [0, 100, 100, 90, 120, 300, 1, 110, 100, 91, 121, 301] }],
};

try {
  await b.geh(srv.url, 1500);
  // Alt-Schlüssel wie aus v3.2 direkt in die Datenbank (am Schema vorbei)
  await b.ev(`import('./js/storage.js').then(m => m.setSetting('icuApiKey', 'ALT-KEY'))`);
  const fehler = await b.ev(`import('./js/backup.js').then(m => m.importiereAlles(${JSON.stringify(JSON.stringify(boese))})).then(() => null, e => e.message)`);
  soll('Import meldet die ungültigen Teile', fehler, f => typeof f === 'string' && f.includes('ohne-start') && f.includes('Programm ungültig'));
  await b.geh(srv.url, 2500);
  soll('Kein Schadcode ausgeführt (Home)', await b.ev('window.__xss ?? null'), null);
  await b.geh(srv.url + '?fahrten', 1500);
  await b.ev(`document.querySelector('#btn-alle-fahrten')?.click()`); await sleep(800);
  soll('Kein Schadcode ausgeführt (Fahrten)', await b.ev('window.__xss ?? null'), null);
  await b.ev(`document.querySelector('#fahrten-monate li:not(.woche)')?.click()`); await sleep(900);
  soll('Kein Schadcode ausgeführt (Detail)', await b.ev('window.__xss ?? null'), null);
  soll('Kein <img> aus der Sicherung im DOM', await b.ev(`document.querySelectorAll('img[src="x"]').length`), 0);

  const fahrt = await b.ev(`import('./js/storage.js').then(m => m.getSession('boese-1'))`);
  // Text in Zahlenfeldern fällt weg; die Liste rechnet Kennwerte danach aus den Rohdaten neu
  soll('Zahlenfelder nur als Zahl', [fahrt?.avgW, fahrt?.kJ, fahrt?.km, fahrt?.tss], l => l.every(v => v == null || Number.isFinite(v)));
  soll('Fremde Felder fallen weg', fahrt?.extra, undefined);
  soll('Zonen mit Text verworfen', fahrt?.zonenSek, z => z == null || (Array.isArray(z) && z.every(Number.isFinite)));
  soll('Plan-Info nur mit gültigen Feldern', fahrt?.plan, p => p && p.woche === undefined && typeof p.name === 'string');
  soll('Programmname bleibt Text', fahrt?.programm, PAYLOAD);   // Text ist erlaubt — angezeigt wird er per textContent/esc

  const s = await b.ev(`import('./js/storage.js').then(m => m.getSettings())`);
  soll('Fremder API-Key nicht übernommen', 'icuApiKey' in s, false);
  soll('Alt-Schlüssel aus der Datenbank gelöscht', await b.ev(`new Promise(r => { const q = indexedDB.open('ergomergo');
    q.onsuccess = () => { const g = q.result.transaction('settings').objectStore('settings').get('icuApiKey');
      g.onsuccess = () => { r(g.result ?? null); q.result.close(); }; }; })`), null);
  soll('Geräte nie importiert', s.geraete, undefined);
  soll('Grenzen gelten auch beim Import', s.maxWatt, 1000);
  soll('… auch für die Pulsgrenze', s.pulsGrenze, 220);
  soll('Tastenbelegung nur mit gültigen Bits', s.controllerMap, { minus: 3, skip: null });
  soll('Unbekannte Einstellungen verworfen', 'unbekannt' in s, false);
  soll('Kein Prototyp-Eingriff', await b.ev('({}).boese ?? null'), null);

  const programme = await b.ev(`import('./js/storage.js').then(m => m.listProgramme())`);
  soll('Gültiges Programm übernommen, kaputtes verworfen', programme.map(p => p.id), ['zwo-1']);

  // Tastenbelegung: Einzelbit oder Liste (Mehrfachbelegung). Ein Paddle mit
  // EINER Richtung wirkt nach dem Import in beide; Listen nur eindeutig, mit
  // 1–4 bekannten Tasten ohne Ein/Aus; Text, Brüche, Bits außerhalb 0–63,
  // kaputte Listen und fremde Schlüssel fallen weg
  const tastenImport = async controllerMap => {
    await b.ev(`import('./js/backup.js').then(m => m.importiereAlles(${JSON.stringify(JSON.stringify({ format: 'ergomergo-backup', version: 1, settings: { controllerMap } }))}))`);
    return b.ev(`Promise.all([import('./js/storage.js'), import('./js/ble/zwift-controller.js')]).then(async ([st, z]) => {
      const map = (await st.getSettings()).controllerMap, c = new z.ZwiftController(map);
      return { map, wirkt: [24, 25, 26, 27, 0, 2].map(bit => c.aktionen(bit).join('+')) }; })`);
  };
  soll('Tastenbelegung (Paddle je eine Richtung) übernommen und beidseitig wirksam',
    await tastenImport({ plus: 27, minus: 24, skip: 2, prev: 0, stopp: 5 }),
    { map: { plus: 27, minus: 24, skip: 2, prev: 0, stopp: 5 }, wirkt: ['minus', 'minus', 'plus', 'plus', 'prev', 'skip'] });
  soll('Tastenbelegung als Liste übernommen, jedes Bit wirkt',
    await tastenImport({ plus: [26, 25], minus: [27, 24], skip: [2], prev: null, stopp: 5 }),
    { map: { plus: [26, 25], minus: [27, 24], skip: 2, prev: null, stopp: 5 }, wirkt: ['minus', 'plus', 'plus', 'minus', '', 'skip'] });   // [2] → Einzelbit
  soll('Tastenbelegung: Unsinn verworfen, Rest bleibt',
    await tastenImport({ plus: [26, 26], minus: 24, skip: '2', prev: 2.5, stopp: 64, 'paddle-x': 3, weiter: { bit: 1 }, aus: -1,
      a: [], b: [11, 2], c: [26, 99], d: [1, 2, 3, 4, 5], e: ['26'], f: [PAYLOAD], g: [[26]], h: [2.5] }),
    { map: { minus: 24 }, wirkt: ['minus', 'minus', 'plus', 'plus', 'prev', 'skip'] });   // Fehlendes ergänzt der Standard (nur freie Tasten)
  soll('Tastenbelegung als Liste insgesamt verworfen (alte bleibt)',
    (await tastenImport([26, 27])).map, { minus: 24 });
  // Sicherungen bis v3.3.1 trugen die damalige Werksbelegung immer mit — die
  // ist keine Nutzerwahl: ohne eigene Belegung gilt danach der heutige Standard
  await b.ev(`new Promise(r => { const q = indexedDB.open('ergomergo'); q.onsuccess = () => {
    const t = q.result.transaction('settings', 'readwrite'); t.objectStore('settings').delete('controllerMap');
    t.oncomplete = () => { q.result.close(); r(); }; }; })`);
  soll('Alte Werksbelegung aus Sicherung übergangen (heutiger Standard gilt)',
    await tastenImport({ plus: 4, minus: 0 }),
    { map: { plus: [26, 25], minus: [27, 24], skip: 2, prev: 0, stopp: 5 }, wirkt: ['minus', 'plus', 'plus', 'minus', 'prev', 'skip'] });

  // Sicherung: ohne Geräte
  await b.ev(`import('./js/storage.js').then(m => m.setSetting('geraete', { trainer: { id: 'abc', name: 'KICKR' } }))`);
  const export_ = await b.ev(`import('./js/backup.js').then(m => m.exportiereAlles()).then(JSON.parse)`);
  soll('Sicherung ohne Geräte', 'geraete' in export_.settings, false);
  soll('Sicherung mit Pulsgrenze (über das Schema)', export_.settings.pulsGrenze, 220);
  soll('Sicherung ohne Standardwerte (nie gesetzte Tastenbelegung, Wattschritt)',
    ['controllerMap', 'wattSchritt'].filter(k => k in export_.settings), []);
  // STO-04: „Alle Daten löschen" entfernt Datenbank und Browser-Merker
  await b.ev(`localStorage.setItem('uiState', 'x')`);
  await b.ev(`import('./js/storage.js').then(m => m.alleDatenLoeschen())`);
  const rest = await b.ev(`(async () => ({ dbs: (await indexedDB.databases()).map(d => d.name), local: Object.keys(localStorage) }))()`);
  soll('Alles gelöscht: keine Datenbank, keine Merker', rest, { dbs: [], local: [] });
} catch (e) {
  abweichungen.push('Testfehler: ' + e.message);
} finally {
  abweichungen.push(...b.fehler.map(f => 'JS-Fehler: ' + f));
  b.schliesse();
  srv.schliesse();
}

console.log(abweichungen.length ? `${abweichungen.length} Abweichungen bei ${schritte} Prüfungen:\n  ${abweichungen.join('\n  ')}` : `ok — ${schritte} Sicherheitsprüfungen bestanden`);
process.exit(abweichungen.length ? 1 : 0);
