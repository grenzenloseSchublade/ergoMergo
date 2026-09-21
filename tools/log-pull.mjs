#!/usr/bin/env node
// Diagnose-Log und Fahrtdaten direkt vom Android-Gerät ziehen — ohne Export
// in der App. Weg: adb forward auf den Chrome-DevTools-Socket, ergoMergo-Tab
// suchen, per Chrome DevTools Protocol die IndexedDB auslesen.
//
// Voraussetzungen: adb (Gerät per USB, Debugging erlaubt), Chrome auf dem
// Gerät mit offenem ergoMergo-Tab, Node >= 22 (globales WebSocket).
//
// Aufruf:
//   node tools/log-pull.mjs                  Log anzeigen + Komplett-Dump speichern
//   node tools/log-pull.mjs --logs-only      nur Log anzeigen, kein Dump
//   node tools/log-pull.mjs --seit 2026-09-21   Log erst ab diesem Datum
//   node tools/log-pull.mjs --out dump.json  Dump-Zieldatei

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = name => args.includes(name);
const opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };

const PORT = 9222;
const APP_URL = /grenzenloseschublade\.github\.io\/ergoMergo|localhost.*ergoMergo/i;

function adb(...a) {
  return execFileSync('adb', a, { encoding: 'utf8' });
}

// Chrome exponiert je Browser-Prozess einen abstrakten Unix-Socket; der
// nackte "chrome_devtools_remote" gehört Chrome stable, nummerierte Varianten
// anderen Chromium-Browsern (z. B. Brave). Alle durchprobieren.
function devtoolsSockets() {
  const raw = adb('shell', 'cat /proc/net/unix');
  const namen = new Set();
  for (const m of raw.matchAll(/@(chrome_devtools_remote(?:_\d+)?)/g)) namen.add(m[1]);
  return [...namen].sort((a, b) => a.length - b.length);   // stable zuerst
}

async function tabsVon(socket) {
  adb('forward', `tcp:${PORT}`, `localabstract:${socket}`);
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`, { signal: AbortSignal.timeout(8000) });
  return res.json();
}

async function findeTab() {
  for (const socket of devtoolsSockets()) {
    try {
      const tabs = await tabsVon(socket);
      const tab = tabs.find(t => t.type === 'page' && APP_URL.test(t.url ?? ''));
      if (tab) return tab;
    } catch { /* Socket tot oder Browser reagiert nicht — nächsten probieren */ }
  }
  return null;
}

// Ein Runtime.evaluate über den DevTools-WebSocket ausführen
function evaluate(wsUrl, expression) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => { ws.close(); reject(new Error('DevTools-Timeout')); }, 30000);
    ws.onopen = () => ws.send(JSON.stringify({
      id: 1, method: 'Runtime.evaluate',
      params: { expression, awaitPromise: true, returnByValue: true },
    }));
    ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.id !== 1) return;
      clearTimeout(timer);
      ws.close();
      if (m.result?.exceptionDetails) reject(new Error(JSON.stringify(m.result.exceptionDetails).slice(0, 300)));
      else resolve(m.result.result.value);
    };
    ws.onerror = () => { clearTimeout(timer); reject(new Error('WebSocket-Fehler')); };
  });
}

const DUMP_EXPR = (mitSamples) => `(async () => {
  const open = () => new Promise((res, rej) => {
    const r = indexedDB.open('ergomergo');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  const d = await open();
  const getAll = s => new Promise((res, rej) => {
    const t = d.transaction(s, 'readonly').objectStore(s).getAll();
    t.onsuccess = () => res(t.result); t.onerror = () => rej(t.error);
  });
  const [logs, sessions, settings${mitSamples ? ', sessionData' : ''}] = await Promise.all([
    getAll('logs'), getAll('sessions'), getAll('settings')${mitSamples ? ", getAll('sessionData')" : ''}
  ]);
  return JSON.stringify({ logs, sessions, settings${mitSamples
    ? ', sessionData: sessionData.map(x => ({ id: x.id, count: x.count, samples: Array.from(x.samples) }))' : ''} });
})()`;

let tab = null;
try {
  tab = await findeTab();
} catch (err) {
  console.error(`adb fehlgeschlagen: ${err.stderr?.trim() ?? err.message} — Gerät per USB verbunden und Debugging erlaubt?`);
  process.exit(1);
}
if (!tab) {
  console.error('Kein ergoMergo-Tab gefunden — App auf dem Gerät in Chrome öffnen (USB-Debugging an).');
  process.exit(1);
}
console.error(`Tab: ${tab.url}`);

const logsOnly = flag('--logs-only');
const data = JSON.parse(await evaluate(tab.webSocketDebuggerUrl, DUMP_EXPR(!logsOnly)));

// --- Log formatiert ausgeben (Muster aus js/logger.js formatLog) ---
const seit = opt('--seit') ? new Date(opt('--seit')).getTime() : 0;
const entries = (data.logs?.[0]?.entries ?? []).filter(e => e.t >= seit);
for (const e of entries) {
  const t = new Date(e.t).toISOString().replace('T', ' ').slice(0, 19);
  console.log(`${t} ${e.level.toUpperCase().padEnd(5)} [${e.tag}] ${e.msg}${e.data ? ' ' + e.data : ''}`);
}
console.error(`\n${entries.length} Log-Einträge${seit ? ` seit ${opt('--seit')}` : ''}.`);

// --- Session-Kurzüberblick ---
for (const s of (data.sessions ?? []).sort((a, b) => (a.start ?? 0) - (b.start ?? 0)).slice(-5)) {
  const start = s.start ? new Date(s.start).toLocaleString('de-DE') : '?';
  console.error(`  ${start}  ${s.programm ?? '?'}  ${s.dauer ?? 0}s  avg ${s.avgW ?? '–'} W  NP ${s.np ?? '–'}  TSS ${s.tss ?? '–'}${s.ausgefahrenSek ? `  +${s.ausgefahrenSek}s ausgefahren` : ''}`);
}

if (!logsOnly) {
  const out = opt('--out') ?? `ergomergo-dump-${new Date().toISOString().slice(0, 10)}.json`;
  writeFileSync(out, JSON.stringify(data));
  console.error(`Dump gespeichert: ${out}`);
}
