// Gemerkte Geräte: Wiederverbinden ohne Chooser über getDevices() —
// funktioniert nur, wenn Chrome persistente Web-Bluetooth-Berechtigungen hat
// (Flag chrome://flags/#enable-web-bluetooth-new-permissions-backend bzw.
// sobald Chrome das default ausliefert). Ohne getDevices degradiert alles
// sauber auf den bisherigen Chooser-Weg.

import { getSettings, setSetting } from '../storage.js';
import { logInfo, logWarn } from '../logger.js';
import { FTMS } from './ftms.js';
import { HeartRate } from './hr.js';
import { ZwiftController } from './zwift-controller.js';

export const kannMerken = () => !!navigator.bluetooth?.getDevices;

async function findeGemerktesGeraet(id) {
  if (!id || !kannMerken()) return null;
  try {
    const geraete = await navigator.bluetooth.getDevices();
    return geraete.find(d => d.id === id) ?? null;
  } catch { return null; }
}

// gatt.connect() mit Obergrenze: Android bricht einen Verbindungsversuch zu
// einem schlafenden Gerät erst nach ~30 s ab — das blockierte den Fahrtstart
const ERSTVERBINDUNG_MS = 10000;
function verbindeMitFrist(device, ms) {
  let timer;
  return Promise.race([
    device.gatt.connect(),
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        try { device.gatt.disconnect(); } catch { /* egal */ }
        reject(new Error('Zeitüberschreitung beim Verbinden'));
      }, ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

// Verbindet ein bereits autorisiertes Gerät: erst direkt, sonst auf
// Advertisement warten (Gerät muss wach sein), dann verbinden.
// Kurzes Fenster: ein schlafendes Gerät darf den Kaltstart nicht lange bremsen
async function verbindeBekanntes(device, timeoutMs = 4000) {
  try {
    await verbindeMitFrist(device, ERSTVERBINDUNG_MS);
    return device;
  } catch { /* noch nicht in Reichweite — auf Advertisement warten */ }
  if (!device.watchAdvertisements) throw new Error('Gerät nicht erreichbar');
  const ctrl = new AbortController();
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ctrl.abort(); reject(new Error('Gerät antwortet nicht')); }, timeoutMs);
    device.addEventListener('advertisementreceived', () => {
      clearTimeout(timer);
      ctrl.abort();
      resolve();
    }, { once: true });
    device.watchAdvertisements({ signal: ctrl.signal }).catch(err => {
      clearTimeout(timer);
      reject(err);
    });
  });
  await device.gatt.connect();
  return device;
}

// Rolle: 'trainer' | 'hr' | 'controller'.
// controller hält bis zu ZWEI Geräte (Zwift-Lenker = linkes + rechtes Pad).
export function eintraegeVon(geraete, rolle) {
  const e = geraete?.[rolle];
  if (!e) return [];
  return Array.isArray(e) ? e : [e];          // Migration: Alt-Objekt → Liste
}

async function merkeGeraet(rolle, device, extra = {}) {
  const s = await getSettings();
  const geraete = { ...(s.geraete ?? {}) };
  const neu = { id: device.id, name: device.name ?? null, ...extra };
  if (rolle === 'controller') {
    const liste = eintraegeVon(geraete, rolle).filter(e => e.id !== device.id);
    geraete[rolle] = [...liste, neu].slice(-2);   // maximal zwei Pads
  } else {
    geraete[rolle] = neu;
  }
  await setSetting('geraete', geraete);
  logInfo('geraete', `${rolle} gemerkt: ${device.name}`);
}

async function vergissGeraet(rolle) {
  const s = await getSettings();
  const geraete = { ...(s.geraete ?? {}) };
  delete geraete[rolle];
  await setSetting('geraete', geraete);
}

// ---------------------------------------------------------------------------
// GeraeteManager: EINE Fassade für Koppeln/Verbinden/Status — Home-Leiste,
// Einstellungen und Fahrbildschirm sind nur noch Renderer darüber.
// Verbindungen leben im Pool über Fahrten hinweg, bis der Nutzer trennt.

// Chooser-Filter leben bei den Clients (Services an EINER Stelle)
const CHOOSER_FILTER = { trainer: FTMS.CHOOSER, hr: HeartRate.CHOOSER, controller: ZwiftController.CHOOSER };

class GeraeteManager extends EventTarget {
  #clients = { trainer: [], hr: [], controller: [] };   // gehaltene Clients je Rolle
  #verbindet = new Map();   // rolle → laufendes verbinde()-Promise (wird geteilt)
  #watchdog = null;
  #snapshot = '';
  #sessionAktiv = false;    // Fahrt läuft → Trainer darf/soll selbst reconnecten
  #generation = { trainer: 0, hr: 0, controller: 0 };   // trenne() zählt hoch → laufendes verbinde() verwirft sein Ergebnis

  // Reconnect-Absicht an den Fahrt-Lebenszyklus koppeln: während der Fahrt
  // kämpft der Trainer um die Verbindung, danach ist eine Trennung final
  // (Pool-Eintrag fällt raus, Leiste degradiert auf „gemerkt")
  starteSession() {
    this.#sessionAktiv = true;
    for (const c of this.#clients.trainer) c.autoReconnect = true;
  }

  beendeSession() {
    this.#sessionAktiv = false;
    for (const c of this.#clients.trainer) c.stoppeReconnect();
    // Wer beim Fahrtende gerade getrennt war (Reconnect lief noch) oder zwar
    // einen GATT-Link, aber keine FTMS-Kontrolle hat (halb gescheiterter
    // Reconnect), ist jetzt eine Leiche — raus, sonst übernähme die nächste
    // Fahrt einen Trainer ohne ERG
    const tote = this.#clients.trainer.filter(c => !c.device?.gatt.connected || !c.connected);
    for (const c of tote) c.disconnect({ gatt: !!c.device?.gatt.connected });
    if (tote.length) {
      this.#clients.trainer = this.#clients.trainer.filter(c => !tote.includes(c));
      this.#change();
    }
  }

  #change() {
    this.dispatchEvent(new Event('change'));
    this.#pruefeWatchdog();
  }

  // Watchdog entfernt NICHTS (Pool-Cleanup machen die disconnected-Listener) —
  // er erkennt nur still abgerissene Verbindungen und stößt die Renderer an
  #pruefeWatchdog() {
    const aktiv = Object.values(this.#clients).some(l => l.length);
    if (aktiv && !this.#watchdog) {
      this.#watchdog = setInterval(() => {
        const snap = Object.keys(this.#clients)
          .map(r => this.clients(r).length).join(',');
        if (snap !== this.#snapshot) { this.#snapshot = snap; this.#change(); }
      }, 5000);
    } else if (!aktiv && this.#watchdog) {
      clearInterval(this.#watchdog);
      this.#watchdog = null;
    }
  }

  // Verbunden = GATT-Link steht; beim Trainer zusätzlich FTMS-Kontrolle
  // (connected), sonst gälte ein Trainer ohne ERG als verbunden
  clients(rolle) {
    return this.#clients[rolle].filter(c => c.device?.gatt.connected && (rolle !== 'trainer' || c.connected));
  }
  client(rolle) { return this.clients(rolle)[0] ?? null; }

  async gemerkte(rolle) {
    return eintraegeVon((await getSettings()).geraete, rolle);
  }

  // 'fehlt' | 'gemerkt' | 'verbindet' | 'verbunden'
  async status(rolle) {
    if (this.clients(rolle).length) return 'verbunden';
    if (this.#verbindet.has(rolle)) return 'verbindet';
    // FTMS-interner Reconnect (Session): ehrlich „verbindet" statt „gemerkt"
    if (rolle === 'trainer' && this.#clients.trainer.some(c => c.verbindetNeu)) return 'verbindet';
    return (await this.gemerkte(rolle)).length ? 'gemerkt' : 'fehlt';
  }

  // Gemerkte Einträge, die Chrome noch kennt (getDevices) — schnell, braucht
  // keine User-Geste. Leer trotz gemerkter Geräte = Berechtigung weg → nur
  // der Chooser hilft. Ohne getDevices-Support ebenfalls leer (Chooser-Weg).
  async autorisiert(rolle) {
    if (!kannMerken()) return [];
    try {
      const ids = new Set((await navigator.bluetooth.getDevices()).map(d => d.id));
      return (await this.gemerkte(rolle)).filter(e => ids.has(e.id));
    } catch { return []; }
  }

  // EINE Entscheidung „verbinden oder Geräteauswahl?" für alle Oberflächen
  // (Start, Fahrbildschirm, Geräte-Leiste, Lern-Modus). Muss aus einer
  // frischen User-Geste kommen — der Chooser braucht sie. auswahl=true
  // erzwingt den Chooser (z. B. zweiter Tap nach Fehlschlag).
  // Ergebnis: { ergebnis: 'verbunden' | 'gekoppelt' | 'schlaeft' | 'abgebrochen',
  //             grund: null | 'keinMerken' | 'nichtAutorisiert' }
  // vorAuswahl(grund): wird direkt vor dem Chooser aufgerufen (Hinweis, warum
  // er erscheint)
  async verbindeOderKoppel(rolle, { auswahl = false, vorAuswahl = null } = {}) {
    const gemerkt = (await this.gemerkte(rolle)).length > 0;
    const autorisiert = gemerkt && (await this.autorisiert(rolle)).length > 0;
    if (auswahl || !autorisiert) {
      const grund = !gemerkt || auswahl ? null : kannMerken() ? 'nichtAutorisiert' : 'keinMerken';
      vorAuswahl?.(grund);
      try {
        await this.koppel(rolle);
      } catch (err) {
        if (err.name === 'NotFoundError') return { ergebnis: 'abgebrochen', grund };
        throw err;
      }
      return { ergebnis: 'gekoppelt', grund };
    }
    const n = await this.verbinde(rolle);
    return { ergebnis: n ? 'verbunden' : 'schlaeft', grund: null };
  }

  // Gelernte Tastenbelegung sofort an verbundene Controller durchreichen —
  // die Instanzen lesen ihre Map sonst nur beim Verbindungsaufbau
  setzeControllerMap(map) {
    for (const c of this.#clients.controller) c.map = map;   // ergänzt den Standard selbst
  }

  // Halten-Verhalten (Einstellungen: Schalter und Tempo) ebenso sofort durchreichen
  setzeHalten(halten) {
    for (const c of this.#clients.controller) c.halten = { ...c.halten, ...halten };
  }

  #neuerClient(rolle, settings) {
    if (rolle === 'trainer') return new FTMS();
    if (rolle === 'hr') return new HeartRate();
    return new ZwiftController(settings.controllerMap,
      { tasten: settings.haltenTasten, paddles: settings.haltenPaddles, tempo: settings.haltenTempo });
  }

  // Chooser öffnen (braucht User-Geste), Gerät merken und direkt verbinden.
  async koppel(rolle) {
    const device = await navigator.bluetooth.requestDevice(CHOOSER_FILTER[rolle]);
    const client = await this.#verbindeClient(rolle, device);
    await merkeGeraet(rolle, device, rolle === 'trainer' && client.firmware ? { fw: client.firmware } : {});
    this.#change();
    return client;
  }

  async #verbindeClient(rolle, device) {
    const settings = await getSettings();
    // Vorgänger desselben Geräts ZUERST entwaffnen (Listener/Timer weg), aber
    // OHNE GATT-Trennung: Clients gleicher device.id teilen sich die physische
    // Verbindung — ein spätes alt.disconnect() würde den frisch verbundenen
    // neuen Client gleich wieder trennen (Livetest: Pad nicht re-addbar)
    for (const alt of this.#clients[rolle]) {
      if (alt.device?.id === device.id) alt.disconnect({ gatt: false });
    }
    this.#clients[rolle] = this.#clients[rolle].filter(c => c.device?.id !== device.id);
    const client = this.#neuerClient(rolle, settings);
    if (rolle === 'trainer') client.autoReconnect = this.#sessionAktiv;
    await client.connect(device);
    const raus = () => {
      client.disconnect({ gatt: false });      // Listener der Leiche lösen
      this.#clients[rolle] = this.#clients[rolle].filter(c => c !== client);
    };
    client.addEventListener('disconnected', () => {
      // Trainer mit aktiver Session reconnectet selbst und bleibt im Pool —
      // alles andere ist nach Trennung eine Leiche und fliegt raus
      if (!(rolle === 'trainer' && client.autoReconnect)) raus();
      this.#change();
    });
    client.addEventListener('reconnected', () => this.#change());
    if (rolle === 'trainer') client.addEventListener('aufgegeben', () => { raus(); this.#change(); });
    this.#clients[rolle].push(client);
    return client;
  }

  // Alle gemerkten Geräte der Rolle verbinden (best effort, ohne Chooser).
  // Liefert die Zahl der jetzt verbundenen Clients. Läuft bereits ein
  // Aufbau, wird DESSEN Ergebnis geteilt (kein irreführendes Sofort-0).
  verbinde(rolle) {
    const laufend = this.#verbindet.get(rolle);
    if (laufend) return laufend;
    const p = this.#verbindeInner(rolle).finally(() => {
      this.#verbindet.delete(rolle);
      this.#change();
    });
    this.#verbindet.set(rolle, p);
    this.#change();
    return p;
  }

  async #verbindeInner(rolle) {
    const gen = this.#generation[rolle];
    const verbundeneIds = new Set(this.clients(rolle).map(c => c.device?.id));
    for (const eintrag of await this.gemerkte(rolle)) {
      if (verbundeneIds.has(eintrag.id)) continue;
      try {
        // Chrome kennt die id nicht mehr (Berechtigung nicht persistiert) —
        // hier hilft nur der Chooser (verbindeOderKoppel entscheidet das)
        const device = await findeGemerktesGeraet(eintrag.id);
        if (!device) continue;
        await verbindeBekanntes(device);
        const client = await this.#verbindeClient(rolle, device);
        if (gen !== this.#generation[rolle]) {
          // Während des Aufbaus getrennt/vergessen: Ergebnis verwerfen
          client.disconnect();
          this.#clients[rolle] = this.#clients[rolle].filter(c => c !== client);
          break;
        }
        // Firmware nach einem Update in den Einstellungen nachführen
        if (rolle === 'trainer' && client.firmware && client.firmware !== eintrag.fw)
          await merkeGeraet(rolle, device, { fw: client.firmware });
      } catch (err) {
        logWarn('geraete', `${rolle} verbinden fehlgeschlagen (${eintrag.name ?? eintrag.id})`, err.message);
      }
    }
    return this.clients(rolle).length;
  }

  trenne(rolle) {
    this.#generation[rolle]++;
    for (const c of this.#clients[rolle]) c.disconnect();
    this.#clients[rolle] = [];
    this.#change();
  }

  async vergiss(rolle) {
    this.trenne(rolle);
    await vergissGeraet(rolle);
    this.#change();
  }
}

export const geraeteManager = new GeraeteManager();
