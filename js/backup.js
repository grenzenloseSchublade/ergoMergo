// Komplettsicherung der lokalen Datenbank als JSON-Datei — und Wiederherstellung.
// Schutz gegen Browser-Datenverlust und der Weg für den Gerätewechsel.

import { listSessions, getAllSamples, saveSession, saveSamples, listProgramme, saveProgramm, getSettings, setSetting,
  EINSTELLUNGEN, pruefeEinstellung, FIELDS } from './storage.js';

const FORMAT = 'ergomergo-backup';
const FORMAT_VERSION = 1;

export async function exportiereAlles() {
  const [sessions, samples, programme, settings] = await Promise.all([
    listSessions(), getAllSamples(), listProgramme(), getSettings(),
  ]);
  // Gerätebezogenes bleibt draußen (gilt nur in diesem Browserprofil)
  const export_ = Object.fromEntries(Object.entries(settings).filter(([k]) => !EINSTELLUNGEN[k]?.lokal));
  return JSON.stringify({
    format: FORMAT,
    version: FORMAT_VERSION,
    exportiert: new Date().toISOString(),
    settings: export_,
    sessions,
    programme,
    // Int16Array ist nicht JSON-fähig → als Zahlenliste
    sessionData: samples.map(d => ({ id: d.id, count: d.count, samples: Array.from(d.samples) })),
  });
}

// --- Import: nur bekannte Felder mit passendem Typ übernehmen ---
// Eine Sicherung ist eine fremde Datei: Werte landen später in der Anzeige.
// Deshalb wird jede Fahrt und jedes Programm neu aufgebaut (Allowlist), statt
// das Objekt zu übernehmen — unbekannte oder falsch typisierte Felder fallen weg.
const zahlOk = v => typeof v === 'number' && Number.isFinite(v);
const text = (v, max = 200) => typeof v === 'string' ? v.slice(0, max) : undefined;
const ZAHLEN = ['start', 'dauer', 'ausgefahrenSek', 'avgW', 'maxW', 'kJ', 'avgRpm', 'np', 'hrAvg', 'hrMax',
  'km', 'if', 'tss', 'ftp', 'akkuProStunde', 'programmEndeBei', 'seed'];
const PLAN_FELDER = { ref: text, plan: text, typ: text, name: text, art: text, variante: text, statt: text,
  woche: v => zahlOk(v) ? v : undefined, laenge: v => (v === null || zahlOk(v)) ? v : undefined, ersatz: v => v === true || undefined };

export function bereinigeFahrt(s) {
  if (!s || typeof s !== 'object' || typeof s.id !== 'string' || !zahlOk(s.start)) return null;
  const f = { id: s.id.slice(0, 64), programm: text(s.programm) ?? 'Freies Fahren',
    programmId: text(s.programmId, 64) ?? null, final: s.final === true };
  for (const k of ZAHLEN) if (zahlOk(s[k])) f[k] = s[k]; else if (s[k] === null) f[k] = null;
  if (Array.isArray(s.zonenSek) && s.zonenSek.length === 6 && s.zonenSek.every(zahlOk)) f.zonenSek = s.zonenSek;
  if (typeof s.planRef === 'string') f.planRef = s.planRef.slice(0, 32);
  if (s.plan && typeof s.plan === 'object') {
    f.plan = {};
    for (const [k, pruefe] of Object.entries(PLAN_FELDER)) { const v = pruefe(s.plan[k]); if (v !== undefined) f.plan[k] = v; }
  }
  return zahlOk(f.dauer) ? f : null;
}

export function bereinigeProgramm(p) {
  if (!p || typeof p !== 'object' || typeof p.id !== 'string' || !Array.isArray(p.bloecke)) return null;
  const bloecke = p.bloecke.slice(0, 2000).map(b => {
    if (!b || !zahlOk(b.dauer) || b.dauer < 0 || !zahlOk(b.pct) || b.pct < 0 || b.pct > 5) return null;
    const blk = { dauer: b.dauer, pct: b.pct };
    if (b.rpm && zahlOk(b.rpm.low) && zahlOk(b.rpm.high)) blk.rpm = { low: b.rpm.low, high: b.rpm.high };
    if (typeof b.gruppe === 'string') blk.gruppe = b.gruppe.slice(0, 32);           // Wiederholungsklammer
    if (typeof b.gruppeLabel === 'string') blk.gruppeLabel = b.gruppeLabel.slice(0, 16);
    return blk;
  });
  if (!bloecke.length || bloecke.includes(null)) return null;
  return { id: p.id.slice(0, 64), name: text(p.name) ?? 'Importiertes Workout', bloecke };
}

export async function importiereAlles(text_) {
  const data = JSON.parse(text_);
  if (data?.format !== FORMAT) throw new Error('Keine ergoMergo-Sicherung');
  let n = 0;
  const fehler = [];
  for (const roh of Array.isArray(data.sessions) ? data.sessions : []) {
    const s = bereinigeFahrt(roh);
    if (!s) { fehler.push(`Fahrt ${typeof roh?.id === 'string' ? roh.id.slice(0, 24) : '?'} ungültig`); continue; }
    await saveSession(s);
    n++;
  }
  for (const d of Array.isArray(data.sessionData) ? data.sessionData : []) {
    // Länge gegen count prüfen — beschädigte Sicherungen nicht still übernehmen
    if (typeof d?.id !== 'string' || !Number.isInteger(d.count) || !Array.isArray(d.samples)
      || d.samples.length < d.count * FIELDS || !d.samples.every(Number.isFinite)) {
      fehler.push(`Rohdaten ${typeof d?.id === 'string' ? d.id.slice(0, 24) : '?'} unvollständig`);
      continue;
    }
    await saveSamples(d.id, new Int16Array(d.samples), d.count);
  }
  for (const roh of Array.isArray(data.programme) ? data.programme : []) {
    const p = bereinigeProgramm(roh);
    if (p) await saveProgramm(p); else fehler.push('Programm ungültig');
  }
  // Einstellungen nur aus dem Schema und mit gültigem Wert; Geräte nie
  for (const [key, value] of Object.entries(data.settings ?? {})) {
    if (EINSTELLUNGEN[key]?.lokal) continue;
    const v = pruefeEinstellung(key, value);
    if (v !== undefined) await setSetting(key, v);
  }
  if (fehler.length) throw new Error(`${n} Fahrten importiert, aber: ${fehler.join('; ')}`);
  return n;
}
