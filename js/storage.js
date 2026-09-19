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
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return db().then(d => new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const r = fn(t.objectStore(store));
    t.oncomplete = () => resolve(r?.result);
    t.onerror = () => reject(t.error);
  }));
}

export const saveSession = s => tx('sessions', 'readwrite', st => st.put(s));
export const deleteSession = id => Promise.all([
  tx('sessions', 'readwrite', st => st.delete(id)),
  tx('sessionData', 'readwrite', st => st.delete(id)),
]);
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

export async function getSettings() {
  const rows = await tx('settings', 'readonly', st => st.getAll());
  const defaults = {
    ftp: 0, wattSchritt: 10, maxWatt: 400, startWatt: 100, theme: 'dark',
    controllerMap: { plus: 4, minus: 0 },   // Ride-Tasten, per Lern-Modus belegbar
    sprachansagen: true, tonAn: true, icuApiKey: '',
  };
  const s = Object.assign(defaults, ...rows.map(r => ({ [r.key]: r.value })));
  // Migration v27→v28: individuell ermittelte Ride-Tastenbits in die
  // controllerMap übernehmen, wenn der Lern-Modus noch nie lief
  if (!rows.some(r => r.key === 'controllerMap') &&
      (s.controllerPlusBit !== undefined || s.controllerMinusBit !== undefined)) {
    s.controllerMap = { plus: s.controllerPlusBit ?? 4, minus: s.controllerMinusBit ?? 0 };
  }
  return s;
}
export const setSetting = (key, value) => tx('settings', 'readwrite', st => st.put({ key, value }));

// Diagnose-Log: ein Datensatz mit gedeckeltem Eintrags-Array
const LOG_MAX = 2000;
export async function appendLogs(entries) {
  const alt = await tx('logs', 'readonly', st => st.get('ring'));
  const alle = [...(alt?.entries ?? []), ...entries].slice(-LOG_MAX);
  await tx('logs', 'readwrite', st => st.put({ key: 'ring', entries: alle }));
}
export const getLogs = () => tx('logs', 'readonly', st => st.get('ring')).then(r => r?.entries ?? []);
export const clearLogs = () => tx('logs', 'readwrite', st => st.delete('ring'));

export function requestPersistence() {
  navigator.storage?.persist?.().catch(() => {});
}
