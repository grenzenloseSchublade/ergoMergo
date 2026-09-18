// Zwift Click als ±-Geber. EXPERIMENTELL: Das Protokoll ist reverse-engineert
// (Quellen: ajchellew/zwiftplay, jat255/zwift_click_handling, Makinolo).
// Click v1 spricht nach einem Geräte-Reset unverschlüsselt; der beim CORE 2
// beiliegende v2 ist nur teilweise dokumentiert. Deshalb: großzügiges Logging —
// unbekannte Pakete landen als Hexdump in der Konsole, damit sich das Protokoll
// am echten Gerät nachziehen lässt.

const ZWIFT_SERVICE = '00000001-19ca-4651-86e5-fa29dcdd09d1';
const CH_ASYNC = '00000002-19ca-4651-86e5-fa29dcdd09d1';   // Notifications (Tasten)
const CH_SYNC_RX = '00000003-19ca-4651-86e5-fa29dcdd09d1'; // Write (Handshake)
const CH_SYNC_TX = '00000004-19ca-4651-86e5-fa29dcdd09d1'; // Indications (Antworten)

const RIDE_ON = new TextEncoder().encode('RideOn');

export class ZwiftClick extends EventTarget {
  #device = null;
  #lastState = { plus: false, minus: false };

  async connect() {
    this.#device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: 'Zwift Click' }, { namePrefix: 'Click' }],
      optionalServices: [ZWIFT_SERVICE],
    });
    const server = await this.#device.gatt.connect();
    const svc = await server.getPrimaryService(ZWIFT_SERVICE);

    const asyncCh = await svc.getCharacteristic(CH_ASYNC);
    asyncCh.addEventListener('characteristicvaluechanged', e => this.#onNotify(new Uint8Array(e.target.value.buffer)));
    await asyncCh.startNotifications();

    try {
      const tx = await svc.getCharacteristic(CH_SYNC_TX);
      tx.addEventListener('characteristicvaluechanged', e =>
        console.debug('[click] sync-tx', hex(new Uint8Array(e.target.value.buffer))));
      await tx.startNotifications();
    } catch { /* v2 hat die Characteristic evtl. nicht */ }

    // Unverschlüsselter Handshake (funktioniert bei zurückgesetzten v1-Geräten)
    const rx = await svc.getCharacteristic(CH_SYNC_RX);
    await rx.writeValueWithResponse(RIDE_ON);

    this.#device.addEventListener('gattserverdisconnected', () =>
      this.dispatchEvent(new Event('disconnected')));
  }

  // Tasten-Notification: 0x23, dann Protobuf { 1: plus, 2: minus }, 0 = gedrückt.
  #onNotify(b) {
    if (b[0] === 0x23 && b.length >= 5) {
      const state = { plus: b[2] === 0, minus: b[4] === 0 };
      if (state.plus && !this.#lastState.plus) this.dispatchEvent(new Event('plus'));
      if (state.minus && !this.#lastState.minus) this.dispatchEvent(new Event('minus'));
      this.#lastState = state;
      return;
    }
    if (b[0] === 0x19 || b[0] === 0x15) return;   // Keepalive/Batterie — uninteressant
    console.debug('[click] unbekanntes Paket', hex(b));
  }

  get deviceName() { return this.#device?.name ?? null; }

  disconnect() {
    try { this.#device?.gatt.disconnect(); } catch { /* schon getrennt */ }
  }
}

const hex = b => [...b].map(x => x.toString(16).padStart(2, '0')).join(' ');
