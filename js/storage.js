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
      // Store → Schlüsselfeld (v2: logs als ein Ringpuffer-Datensatz)
      const STORES = { sessions: 'id', sessionData: 'id', settings: 'key', programme: 'id', logs: 'key' };
      for (const [name, keyPath] of Object.entries(STORES))
        if (!d.objectStoreNames.contains(name)) d.createObjectStore(name, { keyPath });
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

// --- Einstellungen: EIN Schema für Standardwerte, Grenzen und Import ---
// pruefe(v) liefert einen gültigen Wert oder undefined (= verwerfen).
// Unbekannte Schlüssel (z. B. icuApiKey bis v3.2) werden beim Lesen
// verworfen und aus der Datenbank gelöscht.
const ganz = (min, max) => v => typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : undefined;
const jaNein = v => typeof v === 'boolean' ? v : undefined;
const objekt = v => v && typeof v === 'object' && !Array.isArray(v) ? v : v === null ? null : undefined;
// Tastenbelegung: Aktion → Bit 0–63 oder null (bewusst unbelegt)
const tastenMap = v => objekt(v) ? Object.fromEntries(Object.entries(v)
  .filter(([k, b]) => /^[a-z]+$/i.test(k) && (b === null || (Number.isInteger(b) && b >= 0 && b < 64)))) : undefined;
export const EINSTELLUNGEN = {
  ftp: { std: 0, pruefe: ganz(0, 500) },
  wattSchritt: { std: 10, pruefe: ganz(1, 50) },
  maxWatt: { std: 400, pruefe: ganz(100, 1000) },
  startWatt: { std: 100, pruefe: ganz(20, 300) },
  controllerMap: { std: STANDARD_TASTEN, pruefe: tastenMap },   // per Lern-Modus belegbar
  haltenTasten: { std: true, pruefe: jaNein },                  // ±-Taste halten = wiederholen
  haltenPaddles: { std: true, pruefe: jaNein },
  sprachansagen: { std: true, pruefe: jaNein },
  tonAn: { std: true, pruefe: jaNein },
  zwoImport: { std: false, pruefe: jaNein },                    // .zwo-Import, standardmäßig aus
  plan: { std: null, pruefe: objekt },                          // Trainingsplan (js/plan.js)
  // Gemerkte Geräte: Web-Bluetooth-IDs gelten nur in diesem Browserprofil —
  // nie exportieren, nie importieren
  geraete: { std: undefined, pruefe: objekt, lokal: true },
};
// Wert gegen das Schema prüfen (Dialog, Import) — undefined = ungültig
export const pruefeEinstellung = (key, value) =>
  Object.hasOwn(EINSTELLUNGEN, key) ? EINSTELLUNGEN[key].pruefe(value) : undefined;

export async function getSettings() {
  const rows = await tx('settings', 'readonly', st => st.getAll());
  const s = {};
  for (const [key, { std }] of Object.entries(EINSTELLUNGEN))
    s[key] = std && typeof std === 'object' ? structuredClone(std) : std;
  const veraltet = [];
  for (const { key, value } of rows) {
    if (!Object.hasOwn(EINSTELLUNGEN, key)) { veraltet.push(key); continue; }
    const v = EINSTELLUNGEN[key].pruefe(value);
    if (v !== undefined) s[key] = v;
  }
  if (veraltet.length) await tx('settings', 'readwrite', st => veraltet.forEach(k => st.delete(k)));
  return s;
}
// Alle Daten der App auf diesem Gerät löschen: Datenbank (Fahrten, Einstellungen,
// Programme, Log) und die kleinen Merker im Browser-Speicher. Die App-Dateien
// im Offline-Speicher bleiben — sie enthalten keine persönlichen Daten.
export async function alleDatenLoeschen() {
  const d = await dbPromise?.catch(() => null);
  d?.close();
  dbPromise = null;
  await new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = resolve;
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Datenbank noch in einem anderen Tab geöffnet — dort schließen'));
  });
  try { localStorage.clear(); sessionStorage.clear(); } catch { /* optional */ }
}

export const setSetting = (key, value) => tx('settings', 'readwrite', st => st.put({ key, value }));
// Mehrere Einstellungen in EINER Transaktion (alles oder nichts)
export const setSettings = werte => tx('settings', 'readwrite', st => {
  for (const [key, value] of Object.entries(werte)) st.put({ key, value });
});

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
