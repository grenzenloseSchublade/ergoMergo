// Zwift Click und Zwift Ride als ±-Geber. Protokoll reverse-engineert
// (Makinolo, ajchellew/zwiftplay, jat255): Handshake = ASCII "RideOn",
// unverschlüsselt; Tastenzustände als Protobuf-Notification 0x23.
//
// Click:  zwei Varint-Felder, Wert 0 = gedrückt (Feld 1 = plus, Feld 2 = minus)
// Ride:   Feld 1 = 32-Bit-Bitmap, invertierte Logik (Bit 0 → Taste gedrückt);
//         analoge Paddle-Werte in weiteren Feldern (werden nur geloggt).
//
// UUID-Falle: Ride-Firmware bis ~1.2.x nutzt den 128-Bit-Service 00000001-19ca-…,
// neuere Firmware (ab Jan 2025) stattdessen 0xFC82 — beide werden probiert.

import { logInfo, logWarn, hex } from '../logger.js';

const SERVICE_ALT = '00000001-19ca-4651-86e5-fa29dcdd09d1';
const SERVICE_FC82 = 0xfc82;
const CH_ASYNC = '00000002-19ca-4651-86e5-fa29dcdd09d1';   // Notifications (Tasten)
const CH_SYNC_RX = '00000003-19ca-4651-86e5-fa29dcdd09d1'; // Write (Handshake)
const CH_SYNC_TX = '00000004-19ca-4651-86e5-fa29dcdd09d1'; // Indications (Antworten)

const RIDE_ON = new TextEncoder().encode('RideOn');

// Flanken-Entprellung ÜBER alle Instanzen geteilt: sind beide Lenker-Pads
// verbunden und das rechte relayed die linken Tasten zusätzlich, kommt
// dieselbe Taste doppelt an — einmal pro Verbindung. bit → {t, quelle}.
const letzteFlanke = new Map();
const PRELL_GLEICHE_QUELLE_MS = 50;    // Geräte-Prellen
const PRELL_ANDERE_QUELLE_MS = 150;    // Relay-Doppel des zweiten Pads

export class ZwiftController extends EventTarget {
  #device = null;
  #clickState = { plus: false, minus: false };
  #rideBitmap = 0xffffffff;    // alle Bits 1 = nichts gedrückt

  // map: { plus, minus, skip, prev, stopp } → Bit-Indizes (per Lern-Modus belegt)
  constructor(map = {}) {
    super();
    this.map = { plus: 4, minus: 0, ...map };
  }

  get istRide() { return (this.#device?.name ?? '').includes('Ride'); }
  get deviceName() { return this.#device?.name ?? null; }
  get device() { return this.#device; }

  async connect(device = null) {
    this.#device = device ?? await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: 'Zwift' }],
      optionalServices: [SERVICE_ALT, SERVICE_FC82],
    });
    const server = await this.#device.gatt.connect();

    let svc;
    try { svc = await server.getPrimaryService(SERVICE_ALT); }
    catch { svc = await server.getPrimaryService(SERVICE_FC82); }
    logInfo('ctrl', `verbunden mit ${this.#device.name}`, svc.uuid);

    // Characteristics über bekannte UUIDs, sonst über Eigenschaften finden
    const chars = await svc.getCharacteristics();
    const byUuid = u => chars.find(c => c.uuid === u);
    const asyncCh = byUuid(CH_ASYNC) ?? chars.find(c => c.properties.notify && !c.properties.indicate);
    const rxCh = byUuid(CH_SYNC_RX) ?? chars.find(c => c.properties.write || c.properties.writeWithoutResponse);
    const txCh = byUuid(CH_SYNC_TX) ?? chars.find(c => c.properties.indicate);
    if (!asyncCh || !rxCh) throw new Error('Controller-Characteristics nicht gefunden');

    asyncCh.addEventListener('characteristicvaluechanged',
      e => this.#onNotify(new Uint8Array(e.target.value.buffer)));
    await asyncCh.startNotifications();

    if (txCh) {
      txCh.addEventListener('characteristicvaluechanged', e => {
        const b = new Uint8Array(e.target.value.buffer);
        logInfo('ctrl', 'Handshake-Antwort', new TextDecoder().decode(b.slice(0, 6)));
      });
      await txCh.startNotifications();
    }

    await rxCh.writeValueWithResponse(RIDE_ON);      // unverschlüsselter Handshake

    // Benannter Listener: disconnect() räumt ihn ab — sonst loggt jede
    // frühere Instanz am selben (gemerkten) Gerät die Trennung erneut
    this.#onDisconnect = () => {
      logWarn('ctrl', 'Controller getrennt');
      this.dispatchEvent(new Event('disconnected'));
    };
    this.#device.addEventListener('gattserverdisconnected', this.#onDisconnect);
  }

  #onDisconnect = null;

  #onNotify(b) {
    if (b[0] === 0x23) {
      const felder = parseProtoVarints(b, 1);
      this.istRide ? this.#rideTasten(felder) : this.#clickTasten(felder);
      return;
    }
    if (b[0] === 0x19 || b[0] === 0x15) return;      // Keepalive/Idle
    logInfo('ctrl', 'unbekanntes Paket', hex(b));
  }

  // Click: Feld 1 = Plus, Feld 2 = Minus; 0 = gedrückt (steigende Flanke feuert)
  #clickTasten(felder) {
    const state = { plus: felder[1] === 0, minus: felder[2] === 0 };
    if (state.plus && !this.#clickState.plus) this.dispatchEvent(new Event('plus'));
    if (state.minus && !this.#clickState.minus) this.dispatchEvent(new Event('minus'));
    this.#clickState = state;
  }

  // Ride: Feld 1 = Bitmap, Bit 0 → gedrückt. Neu gedrückte Bits = 1→0-Flanken.
  #rideTasten(felder) {
    if (felder[1] === undefined) return;
    const cur = felder[1] >>> 0;
    const neu = this.#rideBitmap & ~cur;              // Bits, die gerade auf 0 gingen
    this.#rideBitmap = cur;
    if (!neu) return;
    for (let bit = 0; bit < 32; bit++) {
      if (!(neu >>> bit & 1)) continue;
      const jetzt = Date.now();
      const vorher = letzteFlanke.get(bit);
      const fenster = vorher?.quelle === this ? PRELL_GLEICHE_QUELLE_MS : PRELL_ANDERE_QUELLE_MS;
      if (vorher && jetzt - vorher.t < fenster) continue;
      letzteFlanke.set(bit, { t: jetzt, quelle: this });
      logInfo('ctrl', `Ride-Taste Bit ${bit} gedrückt`);
      this.dispatchEvent(new CustomEvent('button', { detail: bit }));
      for (const [aktion, b] of Object.entries(this.map)) {
        if (b === bit) this.dispatchEvent(new Event(aktion));
      }
    }
  }

  disconnect() {
    if (this.#onDisconnect) this.#device?.removeEventListener('gattserverdisconnected', this.#onDisconnect);
    try { this.#device?.gatt.disconnect(); } catch { /* schon getrennt */ }
  }
}

// Minimaler Protobuf-Leser: nur Varint-Felder (wire type 0), Länge-präfixierte
// Felder (wire type 2, z. B. Paddle-Daten) werden übersprungen.
function parseProtoVarints(b, start) {
  const felder = {};
  let i = start;
  while (i < b.length) {
    const tag = b[i++];
    const feld = tag >> 3, wire = tag & 7;
    if (wire === 0) {
      let v = 0, shift = 0;
      while (i < b.length) {
        const byte = b[i++];
        v += (byte & 0x7f) * 2 ** shift;
        if (!(byte & 0x80)) break;
        shift += 7;
      }
      felder[feld] = v;
    } else if (wire === 2) {
      const len = b[i++];
      i += len;
    } else {
      break;                                          // unbekannter Wire-Type
    }
  }
  return felder;
}
