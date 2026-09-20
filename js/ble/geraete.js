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

export async function findeGemerktesGeraet(id) {
  if (!id || !kannMerken()) return null;
  try {
    const geraete = await navigator.bluetooth.getDevices();
    return geraete.find(d => d.id === id) ?? null;
  } catch { return null; }
}

// Verbindet ein bereits autorisiertes Gerät: erst direkt, sonst auf
// Advertisement warten (Gerät muss wach sein), dann verbinden.
// Kurzes Fenster: ein schlafendes Gerät darf den Kaltstart nicht lange bremsen
export async function verbindeBekanntes(device, timeoutMs = 4000) {
  try {
    await device.gatt.connect();
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

export async function merkeGeraet(rolle, device, extra = {}) {
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

export async function vergissGeraet(rolle) {
  const s = await getSettings();
  const geraete = { ...(s.geraete ?? {}) };
  delete geraete[rolle];
  await setSetting('geraete', geraete);
}

// Bequemer Einstieg: gemerktes Gerät der Rolle suchen und verbinden, null wenn nicht möglich
export async function schnellverbinde(rolle) {
  const s = await getSettings();
  const eintrag = s.geraete?.[rolle];
  const device = await findeGemerktesGeraet(eintrag?.id);
  if (!device) return null;
  try {
    return await verbindeBekanntes(device);
  } catch (err) {
    logWarn('geraete', `Schnellverbindung ${rolle} fehlgeschlagen`, err.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// GeraeteManager: EINE Fassade für Koppeln/Verbinden/Status — Home-Leiste,
// Einstellungen und Fahrbildschirm sind nur noch Renderer darüber.
// Verbindungen leben im Pool über Fahrten hinweg, bis der Nutzer trennt.

const CHOOSER_FILTER = {
  trainer: { filters: [{ namePrefix: 'KICKR' }, { services: [0x1826] }], optionalServices: [0x1826, 0x180a] },
  hr: { filters: [{ services: [0x180d] }] },
  controller: { filters: [{ namePrefix: 'Zwift' }], optionalServices: ['00000001-19ca-4651-86e5-fa29dcdd09d1', 0xfc82] },
};

class GeraeteManager extends EventTarget {
  #clients = { trainer: [], hr: [], controller: [] };   // gehaltene Clients je Rolle
  #verbindet = new Map();   // rolle → laufendes verbinde()-Promise (wird geteilt)
  #watchdog = null;
  #snapshot = '';

  #change() {
    this.dispatchEvent(new Event('change'));
    this.#pruefeWatchdog();
  }

  // Watchdog entfernt NICHTS (der FTMS-Client reconnectet selbst) — er
  // erkennt nur Live-Statuswechsel und stößt die Renderer an
  #pruefeWatchdog() {
    const aktiv = Object.values(this.#clients).some(l => l.length);
    if (aktiv && !this.#watchdog) {
      this.#watchdog = setInterval(() => {
        const snap = ['trainer', 'hr', 'controller']
          .map(r => this.clients(r).length).join(',');
        if (snap !== this.#snapshot) { this.#snapshot = snap; this.#change(); }
      }, 5000);
    } else if (!aktiv && this.#watchdog) {
      clearInterval(this.#watchdog);
      this.#watchdog = null;
    }
  }

  clients(rolle) { return this.#clients[rolle].filter(c => c.device?.gatt.connected); }
  client(rolle) { return this.clients(rolle)[0] ?? null; }

  async gemerkte(rolle) {
    return eintraegeVon((await getSettings()).geraete, rolle);
  }

  // 'fehlt' | 'gemerkt' | 'verbindet' | 'verbunden'
  async status(rolle) {
    if (this.clients(rolle).length) return 'verbunden';
    if (this.#verbindet.has(rolle)) return 'verbindet';
    return (await this.gemerkte(rolle)).length ? 'gemerkt' : 'fehlt';
  }

  // Gelernte Tastenbelegung sofort an verbundene Controller durchreichen —
  // die Instanzen lesen ihre Map sonst nur beim Verbindungsaufbau
  setzeControllerMap(map) {
    for (const c of this.#clients.controller) c.map = { plus: 4, minus: 0, ...map };
  }

  #neuerClient(rolle, settings) {
    if (rolle === 'trainer') return new FTMS();
    if (rolle === 'hr') return new HeartRate();
    return new ZwiftController(settings.controllerMap);
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
    const client = this.#neuerClient(rolle, settings);
    await client.connect(device);
    // Trennung nur melden — nicht entfernen: FTMS reconnectet selbstständig,
    // und clients() filtert ohnehin live auf gatt.connected
    client.addEventListener('disconnected', () => this.#change());
    client.addEventListener('reconnected', () => this.#change());
    // Vorgänger desselben Geräts ERSETZEN heißt: sauber abbauen — sonst
    // lebt dessen Reconnect-Schleife/Listener als Zombie weiter und
    // verbindet z. B. den Trainer nach bewusstem Trennen wieder
    for (const alt of this.#clients[rolle]) {
      if (alt.device?.id === device.id) alt.disconnect();
    }
    this.#clients[rolle] = this.#clients[rolle]
      .filter(c => c.device?.id !== device.id)
      .concat(client);
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
    const verbundeneIds = new Set(this.clients(rolle).map(c => c.device?.id));
    for (const eintrag of await this.gemerkte(rolle)) {
      if (verbundeneIds.has(eintrag.id)) continue;
      try {
        const device = await findeGemerktesGeraet(eintrag.id);
        if (!device) continue;
        await verbindeBekanntes(device);
        await this.#verbindeClient(rolle, device);
      } catch (err) {
        logWarn('geraete', `${rolle} verbinden fehlgeschlagen (${eintrag.name ?? eintrag.id})`, err.message);
      }
    }
    return this.clients(rolle).length;
  }

  trenne(rolle) {
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
export { CHOOSER_FILTER };
