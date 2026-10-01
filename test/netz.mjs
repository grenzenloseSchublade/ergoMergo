#!/usr/bin/env node
// Netz-Nachweis (Katalog docs/sicherheit.md) — mit aktivem Service Worker,
// jede Anfrage von Seite UND Service Worker wird mitgeschnitten:
//   NET-01  alle Anfragen gehen an die eigene Adresse, nur an ausgelieferte Dateien
//   NET-02  nur GET — die App schickt nirgends Daten hin (kein POST/PUT)
//   NET-03  ohne Zutun nur die Update-Prüfung (sw.js), während der Fahrt keine
//   CSP-03  Versuche, einen fremden Server zu erreichen, blockiert der Browser
//   STO-01/02  keine Cookies; Speicher nur wie dokumentiert
// Abläufe: Start mit Historie, Plan anlegen, Einstellungen + Sicherung,
// Demo-Fahrt (Skip, Stopp, Beenden), Beispielfahrten + Detail + TCX, Style Guide.
// Aufruf: node test/netz.mjs [--protokoll]   Exit 1 bei Abweichung.

import { server, browser, sleep, historieAnlegen } from './lib.mjs';
import { ausgelieferteDateien } from '../tools/auslieferung.mjs';

const PROTOKOLL = process.argv.includes('--protokoll');
const srv = await server();
const b = await browser({ breite: 412, hoehe: 900, swUmgehen: false });
const abweichungen = [];
let schritte = 0;
const soll = (was, ok, info = '') => { schritte++; if (!ok) abweichungen.push(`${was}${info ? ': ' + info : ''}`); };

// Mitschnitt: Seite + angehängter Service Worker
const anfragen = [];                      // { url, methode, quelle, id, blockiert }
const nachId = new Map();
b.hoere(m => {
  if (m.method === 'Target.attachedToTarget') {
    b.cdp('Network.enable', {}, m.params.sessionId);
    b.cdp('Runtime.runIfWaitingForDebugger', {}, m.params.sessionId);
  }
  if (m.method === 'Network.requestWillBeSent' && /^https?:/.test(m.params.request.url)) {
    const a = { url: m.params.request.url, methode: m.params.request.method, quelle: m.sessionId ? 'SW' : 'Seite', zeit: Date.now() };
    anfragen.push(a);
    nachId.set((m.sessionId ?? '') + m.params.requestId, a);
  }
  if (m.method === 'Network.loadingFailed' && m.params.blockedReason) {
    const a = nachId.get((m.sessionId ?? '') + m.params.requestId);
    if (a) a.blockiert = m.params.blockedReason;
  }
});
await b.cdp('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
// Update-Prüfung im Test beschleunigen: 10 min → 1 s (sonst nicht messbar)
await b.cdp('Page.addScriptToEvaluateOnNewDocument', { source: `
  const si = window.setInterval;
  window.setInterval = (f, ms, ...a) => si(f, ms === 600000 ? 1000 : ms, ...a);` });

const eigene = new URL(srv.url).origin;
const erlaubt = new Set(ausgelieferteDateien());
const pfad = url => { const p = decodeURIComponent(new URL(url).pathname).replace(/^\//, ''); return p === '' ? 'index.html' : p; };
const update = a => pfad(a.url) === 'sw.js' && new URL(a.url).searchParams.has('_');

try {
  // --- Abläufe ---
  await b.geh(srv.url, 3000);                                   // Erststart: SW installiert den App-Shell
  await b.ev(`import('./js/storage.js').then(m => m.setSetting('ftp', 220))`);
  await historieAnlegen(b);
  await b.geh(srv.url, 2500);
  await b.klick('#plan-anlegen', 700);
  await b.ev(`document.querySelector('#plan-ok').click()`); await sleep(1000);
  await b.klick('#btn-settings', 700);
  await b.ev(`import('./js/backup.js').then(m => m.exportiereAlles())`);
  await b.ev(`document.querySelector('#dlg-settings').close()`); await sleep(400);
  await b.geh(srv.url + '?demo=programm', 4000);
  await b.klick('#btn-skip', 500); await b.klick('#btn-stop', 3500); await b.klick('#btn-stop', 500);
  await b.klick('#btn-end', 300); await b.klick('#btn-end', 2500);
  await b.geh(srv.url + '?demo=fahrten', 2500);
  await b.klick('#fahrten-monate li:not(.woche)', 900);
  await b.klick('#btn-tcx', 500);
  await b.geh(srv.url + 'docs/stil.html', 2500);

  // --- Leerlauf: Update-Prüfung kommt (beschleunigt) regelmäßig, sonst nichts ---
  await b.geh(srv.url, 2000);
  const vorLeerlauf = anfragen.length;
  await sleep(5000);
  const leerlauf = anfragen.slice(vorLeerlauf);
  soll('Leerlauf: Update-Prüfung läuft', leerlauf.filter(update).length >= 3, `${leerlauf.filter(update).length}× sw.js`);
  soll('Leerlauf: sonst keine Anfrage', leerlauf.every(update), leerlauf.filter(a => !update(a)).map(a => a.url).join(', '));
  // --- Während der Fahrt: keine Update-Prüfung ---
  await b.geh(srv.url + '?demo', 3000);
  const vorFahrt = anfragen.length;
  await sleep(5000);
  const fahrt = anfragen.slice(vorFahrt);
  soll('Fahrt: keine Update-Prüfung', !fahrt.some(update), `${fahrt.filter(update).length}× sw.js`);

  // --- Auswertung des ganzen Mitschnitts (vor dem CSP-Versuch) ---
  const fremd = anfragen.filter(a => new URL(a.url).origin !== eigene);
  soll('NET-01 nur eigene Adresse', !fremd.length, fremd.map(a => a.url).join(', '));
  const unbekannt = anfragen.filter(a => new URL(a.url).origin === eigene && !erlaubt.has(pfad(a.url)));
  soll('NET-01 nur ausgelieferte Dateien', !unbekannt.length, [...new Set(unbekannt.map(a => pfad(a.url)))].join(', '));
  const senden = anfragen.filter(a => a.methode !== 'GET');
  soll('NET-02 nur GET', !senden.length, senden.map(a => `${a.methode} ${a.url}`).join(', '));
  soll('SW-Mitschnitt aktiv', anfragen.some(a => a.quelle === 'SW'));

  // --- CSP-03: fremde Server sind gesperrt ---
  const vorCsp = anfragen.length;
  await b.ev(`(async () => {
    try { await fetch('https://example.org/x'); } catch {}
    navigator.sendBeacon('https://example.org/b', 'daten');
    try { new WebSocket('wss://example.org/w'); } catch {}
    const i = new Image(); i.src = 'https://example.org/p.png';
    await new Promise(r => setTimeout(r, 1500)); })()`);
  await sleep(500);
  const versuche = anfragen.slice(vorCsp).filter(a => new URL(a.url).hostname === 'example.org');
  soll('CSP-03 nichts an fremde Server durchgelassen', versuche.every(a => a.blockiert), versuche.map(a => `${a.url} ${a.blockiert ?? 'GESENDET'}`).join(', '));
  const csp = b.fehler.filter(f => f.includes('CSP-Verstoß'));
  soll('CSP-03 alle vier Versuche gemeldet', csp.length >= 4, `${csp.length} gemeldet`);
  b.fehler.splice(0, b.fehler.length, ...b.fehler.filter(f => !f.includes('CSP-Verstoß')));

  // --- STO-01/02: Speicher-Inventar ---
  const kekse = (await b.cdp('Network.getAllCookies')).result?.cookies ?? [];
  soll('STO-01 keine Cookies', !kekse.length, kekse.map(k => k.name).join(', '));
  const speicher = await b.ev(`(async () => ({
    local: Object.keys(localStorage), session: Object.keys(sessionStorage),
    dbs: (await indexedDB.databases()).map(d => d.name), caches: await caches.keys() }))()`);
  soll('STO-02 localStorage nur dokumentierte Schlüssel', speicher.local.every(k => /^(uiState|rubrik-.+|seed-.+)$/.test(k)), speicher.local.join(', '));
  soll('STO-02 sessionStorage nur dokumentierte Schlüssel', speicher.session.every(k => /^driftReload$/.test(k)), speicher.session.join(', '));
  soll('STO-02 nur die Datenbank ergomergo', JSON.stringify(speicher.dbs) === '["ergomergo"]', speicher.dbs.join(', '));
  soll('STO-02 nur eigene Offline-Speicher', speicher.caches.every(k => /^ergomergo-v[\d.]+$/.test(k)), speicher.caches.join(', '));

  if (PROTOKOLL) {
    const zaehl = new Map();
    for (const a of anfragen) {
      const k = `${a.methode} ${new URL(a.url).origin === eigene ? '(eigene Adresse)' : new URL(a.url).origin} ${pfad(a.url)}${a.blockiert ? `  — Test-Versuch, vom Browser blockiert (${a.blockiert})` : ''}`;
      zaehl.set(k, (zaehl.get(k) ?? 0) + 1);
    }
    console.log(`Prüfprotokoll: ${anfragen.length} Anfragen (${anfragen.filter(a => a.quelle === 'SW').length} vom Service Worker), ${new Set(anfragen.map(a => pfad(a.url))).size} verschiedene Dateien`);
    for (const [k, n] of [...zaehl].sort()) console.log(`  ${String(n).padStart(4)}×  ${k}`);
  }
} catch (e) {
  abweichungen.push('Testfehler: ' + e.message);
} finally {
  abweichungen.push(...b.fehler.map(f => 'JS-Fehler: ' + f));
  b.schliesse();
  srv.schliesse();
}

console.log(abweichungen.length ? `${abweichungen.length} Abweichungen bei ${schritte} Prüfungen:\n  ${abweichungen.join('\n  ')}`
  : `ok — ${schritte} Netz- und Speicherprüfungen bestanden (${anfragen.filter(a => !a.blockiert).length} Anfragen mitgeschnitten, alle an die eigene Adresse, nur GET; Fremdversuche blockiert)`);
process.exit(abweichungen.length ? 1 : 0);
