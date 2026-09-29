// Zwift Click und Zwift Ride als ±-Geber. Protokoll reverse-engineert
// (Makinolo, ajchellew/zwiftplay, jat255): Handshake = ASCII "RideOn",
// unverschlüsselt; Tastenzustände als Protobuf-Notification 0x23.
//
// Click:  zwei Varint-Felder, Wert 0 = gedrückt (Feld 1 = plus, Feld 2 = minus)
// Ride:   Feld 1 = 32-Bit-Bitmap, invertierte Logik (Bit 0 → Taste gedrückt);
//         die orangen Paddles sind analog (−100…+100) und werden per Schwelle
//         zu virtuellen Tasten (Bits laut zwift-ride-tasten.json).
//
// UUID-Falle: Ride-Firmware bis ~1.2.x nutzt den 128-Bit-Service 00000001-19ca-…,
// neuere Firmware (ab Jan 2025) stattdessen 0xFC82 — beide werden probiert.

import { logInfo, logWarn, hex } from '../logger.js';
import RIDE_TASTEN from './zwift-ride-tasten.json' with { type: 'json' };

// Klartextname einer Ride-Taste für Lern-Modus und Belegungsanzeige.
// Bits, bei denen sich die Quellen widersprechen (sicher: false), zeigen
// zusätzlich die Bit-Nummer — so fällt eine falsche Zuordnung am Gerät auf.
const TASTE_JE_BIT = new Map(RIDE_TASTEN.tasten.map(t => [t.bit, t]));
export function tastenName(bit) {
  const t = TASTE_JE_BIT.get(bit);
  if (!t) return `Taste ${bit}`;
  const farbe = t.farbe !== 'schwarz' && t.farbe;
  const zusatz = [farbe, !t.sicher && `Bit ${bit}`].filter(Boolean);
  return zusatz.length ? `${t.label} (${zusatz.join(', ')})` : t.label;
}

// Paddle-Ort (0 = links, 1 = rechts) → virtuelles Bit. Schwelle mit
// Hysterese: erst ab 40 gedrückt, erst unter 20 wieder losgelassen — sonst
// feuert ein Paddle um die Schwelle herum mehrfach.
const PADDLE_BIT = new Map(RIDE_TASTEN.tasten
  .filter(t => t.analogOrt !== undefined).map(t => [t.analogOrt, t.bit]));
const PADDLE_AN = 40;
const PADDLE_AUS = 20;

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
  #paddleGedrueckt = new Map(); // Paddle-Ort → gedrückt (Hysterese-Zustand)
  #paddleSpitze = new Map();    // Paddle-Ort → stärkster Rohwert des laufenden Drucks

  // map: { plus, minus, skip, prev, stopp } → Bit-Indizes (per Lern-Modus belegt)
  constructor(map = {}) {
    super();
    this.map = { plus: 4, minus: 0, ...map };
  }

  get istRide() { return (this.#device?.name ?? '').includes('Ride'); }
  get deviceName() { return this.#device?.name ?? null; }
  get device() { return this.#device; }

  async connect(device) {
    this.#device = device;                     // Chooser läuft in der Fassade
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

    this.#onNotifyFn = e => this.#onNotify(new Uint8Array(e.target.value.buffer));
    this.#asyncCh = asyncCh;
    asyncCh.addEventListener('characteristicvaluechanged', this.#onNotifyFn);
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
  #onNotifyFn = null;
  #asyncCh = null;

  #onNotify(b) {
    if (b[0] === 0x23) {
      const { varints, bloecke } = parseProto(b, 1);
      if (this.istRide) {
        this.#rideTasten(varints);
        this.#ridePaddles(bloecke);
      } else {
        this.#clickTasten(varints);
      }
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
      if (neu >>> bit & 1) this.#taste(bit);
    }
  }

  // Paddles: ältere Firmware liefert sie gesammelt in Feld 2 (je Paddle ein
  // verschachteltes Feld 1), neuere einzeln in Feld 3. Je Paddle-Nachricht:
  // Feld 1 = Ort (fehlt = 0), Feld 2 = Wert als sint32 (ZigZag).
  #ridePaddles(bloecke) {
    const nachrichten = [
      ...(bloecke[3] ?? []),
      ...(bloecke[2] ?? []).flatMap(gruppe => parseProto(gruppe, 0).bloecke[1] ?? []),
    ];
    for (const n of nachrichten) {
      const f = parseProto(n, 0).varints;
      const ort = f[1] ?? 0;
      const bit = PADDLE_BIT.get(ort);
      if (bit === undefined) continue;                // Ort 2/3: reserviert, immer 0
      const wert = zigzag(f[2] ?? 0);
      const betrag = Math.abs(wert);
      if (!this.#paddleGedrueckt.get(ort)) {
        if (betrag < PADDLE_AN) continue;
        this.#paddleGedrueckt.set(ort, true);
        this.#paddleSpitze.set(ort, wert);
        this.#taste(bit, ` — Rohwert ${wert}`);
      } else if (betrag < PADDLE_AUS) {
        // Druckstärke fürs Log: Spitze des Drucks (Vorzeichen = Richtung)
        this.#paddleGedrueckt.set(ort, false);
        logInfo('ctrl', `Ride-Paddle ${ort ? 'rechts' : 'links'} losgelassen — Spitze ${this.#paddleSpitze.get(ort)}`);
      } else if (betrag > Math.abs(this.#paddleSpitze.get(ort))) {
        this.#paddleSpitze.set(ort, wert);
      }
    }
  }

  // Eine gedrückte Taste (echt oder virtuell): entprellen, loggen, melden
  #taste(bit, logZusatz = '') {
    const jetzt = Date.now();
    const vorher = letzteFlanke.get(bit);
    const fenster = vorher?.quelle === this ? PRELL_GLEICHE_QUELLE_MS : PRELL_ANDERE_QUELLE_MS;
    if (vorher && jetzt - vorher.t < fenster) return;
    letzteFlanke.set(bit, { t: jetzt, quelle: this });
    logInfo('ctrl', `Ride-Taste Bit ${bit} gedrückt (laut Tabelle: ${TASTE_JE_BIT.get(bit)?.id ?? '?'})${logZusatz}`);
    this.dispatchEvent(new CustomEvent('button', { detail: bit }));
    for (const [aktion, b] of Object.entries(this.map)) {
      if (b === bit) this.dispatchEvent(new Event(aktion));
    }
  }

  // gatt:false = nur Teardown — die physische Verbindung ist je device.id geteilt
  disconnect({ gatt = true } = {}) {
    if (this.#onDisconnect) this.#device?.removeEventListener('gattserverdisconnected', this.#onDisconnect);
    // Chrome liefert beim Reconnect dieselben Characteristic-Objekte —
    // ohne Abbau würde eine ersetzte Instanz weiter Notifications empfangen
    if (this.#onNotifyFn) this.#asyncCh?.removeEventListener('characteristicvaluechanged', this.#onNotifyFn);
    if (gatt) {
      try { this.#device?.gatt.disconnect(); } catch { /* schon getrennt */ }
    }
  }
}

// Minimaler Protobuf-Leser: Varint-Felder (wire type 0) als Zahlen,
// Länge-präfixierte Felder (wire type 2) als Byte-Blöcke je Feldnummer
// (wiederholte Felder → mehrere Einträge). Andere Wire-Types brechen ab.
function parseProto(b, start) {
  const varints = {}, bloecke = {};
  let i = start;
  const leseVarint = () => {
    let v = 0, shift = 0;
    while (i < b.length) {
      const byte = b[i++];
      v += (byte & 0x7f) * 2 ** shift;
      if (!(byte & 0x80)) break;
      shift += 7;
    }
    return v;
  };
  while (i < b.length) {
    const tag = leseVarint();
    const feld = tag >>> 3, wire = tag & 7;
    if (wire === 0) {
      varints[feld] = leseVarint();
    } else if (wire === 2) {
      const len = leseVarint();
      (bloecke[feld] ??= []).push(b.subarray(i, i + len));
      i += len;
    } else {
      break;                                          // unbekannter Wire-Type
    }
  }
  return { varints, bloecke };
}

// sint32 (ZigZag): 0→0, 1→−1, 2→1, 3→−2 …
const zigzag = v => (v % 2 ? -(v + 1) / 2 : v / 2);
