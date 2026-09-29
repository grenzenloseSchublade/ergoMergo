// Zwift Click und Zwift Ride als ±-Geber. Protokoll reverse-engineert
// (Makinolo, ajchellew/zwiftplay, jat255): Handshake = ASCII "RideOn",
// unverschlüsselt; Tastenzustände als Protobuf-Notification 0x23.
//
// Click:  zwei Varint-Felder, Wert 0 = gedrückt (Feld 1 = plus, Feld 2 = minus)
// Ride:   Feld 1 = 32-Bit-Bitmap, invertierte Logik (Bit 0 → Taste gedrückt);
//         die orangen Paddles sind analog (−100…+100, Vorzeichen = Richtung)
//         und werden per Schwelle zu virtuellen Tasten, je Richtung eine
//         (Bits laut zwift-ride-tasten.json).
//
// UUID-Falle: Ride-Firmware bis ~1.2.x nutzt den 128-Bit-Service 00000001-19ca-…,
// neuere Firmware (ab Jan 2025) stattdessen 0xFC82 — beide werden probiert.

import { logInfo, logWarn, hex } from '../logger.js';
import RIDE_TASTEN from './zwift-ride-tasten.json' with { type: 'json' };

// Klartextname einer Ride-Taste für Lern-Modus und Belegungsanzeige.
// Die Farbe steht nur bei A/B/Y/Z im Namen — nur dort ist sie eindeutig
// (orange tragen auch Z, Schalttasten und Paddles). Ungeprüfte Tasten
// (sicher: false) zeigen zusätzlich die Bit-Nummer.
const TASTE_JE_BIT = new Map(RIDE_TASTEN.tasten.map(t => [t.bit, t]));
export const tasteInfo = bit => TASTE_JE_BIT.get(bit) ?? null;
export const alleTasten = () => RIDE_TASTEN.tasten;
export function tastenName(bit) {
  const t = TASTE_JE_BIT.get(bit);
  if (!t) return `Taste ${bit}`;
  const farbe = t.gruppe === 'aktion' && t.farbe;
  const zusatz = [farbe, !t.sicher && `Bit ${bit}`].filter(Boolean);
  return zusatz.length ? `${t.label} (${zusatz.join(', ')})` : t.label;
}

// Paddles schlagen in beide Richtungen aus (Vorzeichen des Analogwerts);
// je Paddle und Richtung eine virtuelle Taste: "Ort:Richtung" → Bit.
// Schwelle mit Hysterese: erst ab 40 gedrückt, erst unter 20 wieder
// losgelassen — sonst feuert ein Paddle um die Schwelle herum mehrfach.
const PADDLE_BIT = new Map(RIDE_TASTEN.tasten
  .filter(t => t.analogOrt !== undefined).map(t => [`${t.analogOrt}:${t.richtung}`, t.bit]));
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

// Halten = Wiederholen, nur für die Watt-Aktionen — Block vor/zurück und
// STOPP feuern bewusst nie doppelt. Tasten: fester Takt nach einer Pause;
// Paddles: Takt folgt dem Druck (Schwelle → langsam, Vollausschlag → schnell).
const WIEDERHOLBAR = new Set(['plus', 'minus']);
const HALTEN_PAUSE_MS = 500;
const HALTEN_TAKT_MS = 400;
const PADDLE_TAKT_MS = { langsam: 600, schnell: 150 };
const PADDLE_PAUSE_MIN_MS = 400;       // kurzes Antippen löst nur einmal aus
// Sicherheitsgrenze: geht die Loslass-Meldung verloren (Funkloch), würde die
// Wiederholung sonst endlos Watt hochzählen
const HALTEN_MAX_MS = 10000;

const paddleTakt = druck => {
  const anteil = Math.min(1, Math.max(0, (druck - PADDLE_AN) / (100 - PADDLE_AN)));
  return Math.round(PADDLE_TAKT_MS.langsam - anteil * (PADDLE_TAKT_MS.langsam - PADDLE_TAKT_MS.schnell));
};

export class ZwiftController extends EventTarget {
  #device = null;
  #clickState = { plus: false, minus: false };
  #rideBitmap = 0xffffffff;    // alle Bits 1 = nichts gedrückt
  #paddle = new Map();          // Paddle-Ort → {richtung, bit, spitze, eigen} des laufenden Drucks
  #statusGeloggt = false;       // 0x2a-Statusmeldung nur einmal je Verbindung loggen
  #gehalten = new Map();        // Taste (Bit bzw. 'plus'/'minus' beim Click) → {timer, druck, seit}

  // map: { plus, minus, skip, prev, stopp } → Bit-Indizes (per Lern-Modus belegt)
  // halten: { tasten, paddles } — Halten wiederholt ± (Einstellungen)
  constructor(map = {}, halten = {}) {
    super();
    this.map = { plus: 4, minus: 0, ...map };
    this.halten = { tasten: halten.tasten ?? true, paddles: halten.paddles ?? true };
  }

  get istRide() { return (this.#device?.name ?? '').includes('Ride'); }
  get deviceName() { return this.#device?.name ?? null; }
  get device() { return this.#device; }

  async connect(device) {
    this.#device = device;                     // Chooser läuft in der Fassade
    const server = await this.#device.gatt.connect();
    this.#statusGeloggt = false;

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
      this.#loslassenAlle();
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
    if (b[0] === 0x2a) {                               // Status nach dem Verbinden, mehrfach
      if (!this.#statusGeloggt) logInfo('ctrl', 'Statusmeldung', hex(b));
      this.#statusGeloggt = true;
      return;
    }
    logInfo('ctrl', 'unbekanntes Paket', hex(b));
  }

  // Click: Feld 1 = Plus, Feld 2 = Minus; 0 = gedrückt (steigende Flanke feuert)
  #clickTasten(felder) {
    const state = { plus: felder[1] === 0, minus: felder[2] === 0 };
    for (const aktion of ['plus', 'minus']) {
      if (state[aktion] && !this.#clickState[aktion]) {
        this.dispatchEvent(new Event(aktion));
        this.#halteFest(aktion, aktion);
      } else if (!state[aktion] && this.#clickState[aktion]) {
        this.#loslassen(aktion);
      }
    }
    this.#clickState = state;
  }

  // Ride: Feld 1 = Bitmap, Bit 0 → gedrückt. Gedrückt = 1→0-Flanke,
  // losgelassen = 0→1-Flanke.
  #rideTasten(felder) {
    if (felder[1] === undefined) return;
    const cur = felder[1] >>> 0;
    const neu = this.#rideBitmap & ~cur;
    const los = ~this.#rideBitmap & cur;
    this.#rideBitmap = cur;
    for (let bit = 0; bit < 32; bit++) {
      if (los >>> bit & 1) this.#loslassen(bit);
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
      if (ort > 1) continue;                          // Ort 2/3: reserviert, immer 0
      const wert = zigzag(f[2] ?? 0);
      const betrag = Math.abs(wert);
      const richtung = Math.sign(wert);
      const p = this.#paddle.get(ort);
      if (p) {
        // Losgelassen — oder in einem Zug auf die Gegenseite gekippt, ohne
        // zwischen zwei Meldungen unter die Schwelle zu fallen
        if (betrag >= PADDLE_AUS && richtung === p.richtung) {
          if (betrag > Math.abs(p.spitze)) p.spitze = wert;
          const h = this.#gehalten.get(p.bit);
          if (h) h.druck = betrag;                    // Wiederholtakt folgt dem Druck
          continue;
        }
        this.#paddleLos(ort, p);
      }
      if (betrag < PADDLE_AN) continue;
      const bit = PADDLE_BIT.get(`${ort}:${richtung}`);
      // eigen = diese Verbindung hat den Druck gemeldet; das rechte Paddle
      // kommt zusätzlich über das linke Pad an und würde sonst doppelt loggen
      const eigen = this.#taste(bit, ` — Rohwert ${wert}`, betrag);
      this.#paddle.set(ort, { richtung, bit, spitze: wert, eigen });
    }
  }

  #paddleLos(ort, p) {
    this.#paddle.delete(ort);
    this.#loslassen(p.bit);
    // Druckstärke fürs Log: Spitze des Drucks (Vorzeichen = Richtung)
    if (p.eigen) logInfo('ctrl', `Ride-Paddle ${ort ? 'rechts' : 'links'} losgelassen — Spitze ${p.spitze}`);
  }

  // Eine gedrückte Taste (echt oder virtuell): entprellen, loggen, melden.
  // druck = Paddle-Betrag (40…100), null bei digitalen Tasten.
  // Rückgabe: false, wenn die Entprellung den Druck verworfen hat.
  #taste(bit, logZusatz = '', druck = null) {
    const jetzt = Date.now();
    const vorher = letzteFlanke.get(bit);
    const fenster = vorher?.quelle === this ? PRELL_GLEICHE_QUELLE_MS : PRELL_ANDERE_QUELLE_MS;
    if (vorher && jetzt - vorher.t < fenster) return false;
    letzteFlanke.set(bit, { t: jetzt, quelle: this });
    logInfo('ctrl', `Ride-Taste Bit ${bit} gedrückt (laut Tabelle: ${TASTE_JE_BIT.get(bit)?.id ?? '?'})${logZusatz}`);
    this.dispatchEvent(new CustomEvent('button', { detail: bit }));
    for (const [aktion, b] of Object.entries(this.map)) {
      if (b !== bit) continue;
      this.dispatchEvent(new Event(aktion));
      this.#halteFest(bit, aktion, druck);
    }
    return true;
  }

  // Wiederholung starten, solange die Taste gehalten wird. Nur die Instanz,
  // deren Flanke die Entprellung gewonnen hat, kommt hier an — ein zweites
  // (relayendes) Pad wiederholt also nicht doppelt.
  #halteFest(taste, aktion, druck = null) {
    if (!WIEDERHOLBAR.has(aktion)) return;
    if (!(druck === null ? this.halten.tasten : this.halten.paddles)) return;
    this.#loslassen(taste);
    const h = { timer: null, druck, seit: Date.now() };
    const takt = () => (h.druck === null ? HALTEN_TAKT_MS : paddleTakt(h.druck));
    const planen = ms => {
      h.timer = setTimeout(() => {
        if (Date.now() - h.seit > HALTEN_MAX_MS) {
          logWarn('ctrl', `Halten nach ${HALTEN_MAX_MS / 1000} s abgebrochen (kein Loslassen empfangen)`);
          this.#loslassen(taste);
          return;
        }
        this.dispatchEvent(new Event(aktion));
        planen(takt());
      }, ms);
    };
    this.#gehalten.set(taste, h);
    planen(druck === null ? HALTEN_PAUSE_MS : Math.max(PADDLE_PAUSE_MIN_MS, takt()));
  }

  #loslassen(taste) {
    clearTimeout(this.#gehalten.get(taste)?.timer);
    this.#gehalten.delete(taste);
  }

  #loslassenAlle() {
    for (const taste of [...this.#gehalten.keys()]) this.#loslassen(taste);
    this.#paddle.clear();
  }

  // gatt:false = nur Teardown — die physische Verbindung ist je device.id geteilt
  disconnect({ gatt = true } = {}) {
    this.#loslassenAlle();
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
