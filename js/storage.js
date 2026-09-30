// IndexedDB: sessions (Metadaten), sessionData (Rohsamples), settings, programme.
// Samples liegen als Int16Array n×6 [s, watt, ziel, rpm, hf, kmh×10].

const DB_NAME = 'ergomergo';
const DB_VERSION = 2;
export const FIELDS = 6;

let dbPromise = null;

function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      for (const name of ['sessions', 'sessionData'])
        if (!d.objectStoreNames.contains(name)) d.createObjectStore(name, { keyPath: 'id' });
      if (!d.objectStoreNames.contains('settings')) d.createObjectStore('settings', { keyPath: 'key' });
      if (!d.objectStoreNames.contains('programme')) d.createObjectStore('programme', { keyPath: 'id' });
      // v2: Diagnose-Log als ein Ringpuffer-Datensatz
      if (!d.objectStoreNames.contains('logs')) d.createObjectStore('logs', { keyPath: 'key' });
    };
    req.onsuccess = () => {
      const d = req.result;
      // Neue Version in anderem Tab/nach Update: Verbindung freigeben,
      // nächster Zugriff öffnet frisch (sonst blockiert das Upgrade)
      d.onversionchange = () => { d.close(); dbPromise = null; };
      resolve(d);
    };
    req.onerror = () => reject(req.error);
  }).catch(err => { dbPromise = null; throw err; });   // Fehlschlag nicht dauerhaft merken
  return dbPromise;
}

// Eine Transaktion über einen oder mehrere Stores. fn bekommt die Stores in
// derselben Reihenfolge. onabort fängt Quota-Fehler beim Commit — ohne ihn
// hinge das Promise für immer (Beenden-Knopf tot).
function tx(stores, mode, fn) {
  const namen = [stores].flat();
  return db().then(d => new Promise((resolve, reject) => {
    const t = d.transaction(namen, mode);
    const r = fn(...namen.map(n => t.objectStore(n)));
    t.oncomplete = () => resolve(r?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error ?? new Error('Transaktion abgebrochen'));
  }));
}

export const saveSession = s => tx('sessions', 'readwrite', st => st.put(s));
// Metadaten und Samples gemeinsam — nie eine Fahrt ohne Daten zurücklassen
export const deleteSession = id => tx(['sessions', 'sessionData'], 'readwrite', (meta, daten) => {
  meta.delete(id);
  daten.delete(id);
});
export const listSessions = () => tx('sessions', 'readonly', st => st.getAll())
  .then(list => list.sort((a, b) => b.start - a.start));
export const getSession = id => tx('sessions', 'readonly', st => st.get(id));

export const saveSamples = (id, samples, count) =>
  tx('sessionData', 'readwrite', st => st.put({ id, count, samples: samples.slice(0, count * FIELDS) }));
export const getSamples = id => tx('sessionData', 'readonly', st => st.get(id));
export const getAllSamples = () => tx('sessionData', 'readonly', st => st.getAll());

// Eigene (importierte) Programme
export const listProgramme = () => tx('programme', 'readonly', st => st.getAll());
export const saveProgramm = p => tx('programme', 'readwrite', st => st.put(p));
export const deleteProgramm = id => tx('programme', 'readwrite', st => st.delete(id));

// Werkseitige Tastenbelegung des Lenkers (Ride-Bits A = plus, Pfeil links =
// minus) — einzige Stelle, Controller und Manager ergänzen damit
export const STANDARD_TASTEN = { plus: 4, minus: 0 };

export async function getSettings() {
  const rows = await tx('settings', 'readonly', st => st.getAll());
  const defaults = {
    ftp: 0, wattSchritt: 10, maxWatt: 400, startWatt: 100,
    controllerMap: { ...STANDARD_TASTEN },   // Ride-Tasten, per Lern-Modus belegbar
    haltenTasten: true, haltenPaddles: true, // ±-Taste/Paddle halten = wiederholen
    sprachansagen: true, tonAn: true, icuApiKey: '',
    zwoImport: false,                        // .zwo-Import (Zwift-Workouts) — Funktion für Fortgeschrittene, standardmäßig aus
  };
  return Object.assign(defaults, ...rows.map(r => ({ [r.key]: r.value })));
}
export const setSetting = (key, value) => tx('settings', 'readwrite', st => st.put({ key, value }));

// Diagnose-Log: ein Datensatz mit gedeckeltem Eintrags-Array
const LOG_MAX = 2000;
// Lesen und Schreiben in EINER Transaktion — kein Wettlauf mit clearLogs
export function appendLogs(entries) {
  return tx('logs', 'readwrite', st => {
    const req = st.get('ring');
    req.onsuccess = () => {
      const alle = [...(req.result?.entries ?? []), ...entries].slice(-LOG_MAX);
      st.put({ key: 'ring', entries: alle });
    };
  });
}
export const getLogs = () => tx('logs', 'readonly', st => st.get('ring')).then(r => r?.entries ?? []);
export const clearLogs = () => tx('logs', 'readwrite', st => st.delete('ring'));

export function requestPersistence() {
  navigator.storage?.persist?.().catch(() => {});
}
