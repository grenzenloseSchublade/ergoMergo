// Diagnose-Log: Ringpuffer im Speicher, gebündelt nach IndexedDB persistiert,
// parallel zur Konsole. Für BLE-Fehlersuche ohne angeschlossenen Rechner —
// Ansicht + Export in den Einstellungen.

import { appendLogs } from './storage.js';

const MAX = 2000;
const puffer = [];
let queue = [];
let flushTimer = null;

export function log(level, tag, msg, data) {
  const e = { t: Date.now(), level, tag, msg };
  if (data !== undefined) e.data = typeof data === 'string' ? data : safeJson(data);
  puffer.push(e);
  if (puffer.length > MAX) puffer.shift();
  (console[level] ?? console.log)(`[${tag}] ${msg}`, data ?? '');
  queue.push(e);
  flushTimer ??= setTimeout(flush, 2000);
}

export const logInfo = (tag, msg, data) => log('info', tag, msg, data);
export const logWarn = (tag, msg, data) => log('warn', tag, msg, data);
export const logError = (tag, msg, data) => log('error', tag, msg, data);

async function flush() {
  flushTimer = null;
  const batch = queue;
  queue = [];
  try { await appendLogs(batch); } catch { /* Log darf die App nie stören */ }
}

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
addEventListener('error', e => logError('js', e.message, `${e.filename}:${e.lineno}`));
addEventListener('unhandledrejection', e => logError('js', 'unhandled rejection', String(e.reason)));
