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
  const fehler = [];
  for (const s of data.sessions ?? []) {
    if (!s?.id) { fehler.push('Session ohne id'); continue; }
    await saveSession(s);
    n++;
  }
  for (const d of data.sessionData ?? []) {
    // Länge gegen count prüfen — beschädigte Sicherungen nicht still übernehmen
    if (!d?.id || !Array.isArray(d.samples) || d.samples.length < d.count * 6) {
      fehler.push(`Rohdaten ${d?.id ?? '?'} unvollständig`);
      continue;
    }
    await saveSamples(d.id, new Int16Array(d.samples), d.count);
  }
  for (const p of data.programme ?? []) if (p?.id) await saveProgramm(p);
  // geraete-IDs sind gerätespezifisch (Web-Bluetooth-IDs gelten nur im
  // jeweiligen Browserprofil) — beim Import auslassen
  for (const [key, value] of Object.entries(data.settings ?? {})) {
    if (key === 'geraete') continue;
    await setSetting(key, value);
  }
  if (fehler.length) throw new Error(`${n} Fahrten importiert, aber: ${fehler.join('; ')}`);
  return n;
}
