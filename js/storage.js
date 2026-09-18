// IndexedDB: sessions (Metadaten), sessionData (Rohsamples), settings, programme.
// Samples liegen als Int16Array n×6 [s, watt, ziel, rpm, hf, kmh×10].

const DB_NAME = 'ergomergo';
const DB_VERSION = 1;
export const FIELDS = 6;

let dbPromise = null;

function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      d.createObjectStore('sessions', { keyPath: 'id' });
      d.createObjectStore('sessionData', { keyPath: 'id' });
      d.createObjectStore('settings', { keyPath: 'key' });
      d.createObjectStore('programme', { keyPath: 'id' });
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
    t.oncomplete = () => resolve(r.result ?? r);
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

export async function getSettings() {
  const rows = await tx('settings', 'readonly', st => st.getAll());
  const defaults = { ftp: 0, wattSchritt: 10, maxWatt: 400, startWatt: 100, theme: 'dark' };
  return Object.assign(defaults, ...rows.map(r => ({ [r.key]: r.value })));
}
export const setSetting = (key, value) => tx('settings', 'readwrite', st => st.put({ key, value }));

export function requestPersistence() {
  navigator.storage?.persist?.().catch(() => {});
}
