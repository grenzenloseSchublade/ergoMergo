// Diagnose-Log: gebündelt als Ringpuffer in die IndexedDB geschrieben,
// parallel zur Konsole. Für BLE-Fehlersuche ohne angeschlossenen Rechner —
// Ansicht + Export in den Einstellungen.

import { appendLogs } from './storage.js';

let queue = [];
let flushTimer = null;

export function log(level, tag, msg, data) {
  const e = { t: Date.now(), level, tag, msg };
  if (data !== undefined) e.data = typeof data === 'string' ? data : safeJson(data);
  (console[level] ?? console.log)(`[${tag}] ${msg}`, data ?? '');
  queue.push(e);
  flushTimer ??= setTimeout(flush, 2000);
}

export const logInfo = (tag, msg, data) => log('info', tag, msg, data);
export const logWarn = (tag, msg, data) => log('warn', tag, msg, data);
export const logError = (tag, msg, data) => log('error', tag, msg, data);

async function flush() {
  clearTimeout(flushTimer);
  flushTimer = null;
  if (!queue.length) return;
  const batch = queue;
  queue = [];
  try { await appendLogs(batch); } catch { /* Log darf die App nie stören */ }
}

// Sofort schreiben: vor einem Reload und wenn die App in den Hintergrund
// geht (danach kann Android sie jederzeit beenden)
export const flushJetzt = flush;
addEventListener('pagehide', flush);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });

function safeJson(x) {
  try { return JSON.stringify(x); } catch { return String(x); }
}

export function formatLog(entries) {
  return entries.map(e =>
    `${new Date(e.t).toISOString()} ${e.level.toUpperCase().padEnd(5)} [${e.tag}] ${e.msg}${e.data ? ' ' + e.data : ''}`
  ).join('\n');
}

export const hex = b => [...b].map(x => x.toString(16).padStart(2, '0')).join(' ');

// Unbehandelte Fehler mitschneiden
addEventListener('error', e => logError('js', e.message, e.error?.stack ?? `${e.filename}:${e.lineno}`));
addEventListener('unhandledrejection', e => logError('js', 'unhandled rejection', e.reason?.stack ?? String(e.reason)));
