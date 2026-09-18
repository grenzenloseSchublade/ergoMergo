// Komplettsicherung der lokalen Datenbank als JSON-Datei — und Wiederherstellung.
// Schutz gegen Browser-Datenverlust und der Weg für den Gerätewechsel.

import { listSessions, getAllSamples, saveSession, saveSamples, listProgramme, saveProgramm, getSettings, setSetting } from './storage.js';

const FORMAT = 'ergomergo-backup';
const FORMAT_VERSION = 1;

export async function exportiereAlles() {
  const [sessions, samples, programme, settings] = await Promise.all([
    listSessions(), getAllSamples(), listProgramme(), getSettings(),
  ]);
  return JSON.stringify({
    format: FORMAT,
    version: FORMAT_VERSION,
    exportiert: new Date().toISOString(),
    settings,
    sessions,
    programme,
    // Int16Array ist nicht JSON-fähig → als Zahlenliste
    sessionData: samples.map(d => ({ id: d.id, count: d.count, samples: Array.from(d.samples) })),
  });
}

export async function importiereAlles(text) {
  const data = JSON.parse(text);
  if (data.format !== FORMAT) throw new Error('Keine ergoMergo-Sicherung');
  let n = 0;
  for (const s of data.sessions ?? []) { await saveSession(s); n++; }
  for (const d of data.sessionData ?? []) await saveSamples(d.id, new Int16Array(d.samples), d.count);
  for (const p of data.programme ?? []) await saveProgramm(p);
  for (const [key, value] of Object.entries(data.settings ?? {})) await setSetting(key, value);
  return n;
}
