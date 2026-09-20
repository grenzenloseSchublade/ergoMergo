// Herzfrequenzgurt über den Standard-Dienst Heart Rate (0x180D).

const HR_SERVICE = 0x180d;
const CH_HR = 0x2a37;

export class HeartRate extends EventTarget {
  #device = null;

  async connect(device = null) {
    this.#device = device ?? await navigator.bluetooth.requestDevice({
      filters: [{ services: [HR_SERVICE] }],
    });
    const server = await this.#device.gatt.connect();
    const svc = await server.getPrimaryService(HR_SERVICE);
    const ch = await svc.getCharacteristic(CH_HR);
    ch.addEventListener('characteristicvaluechanged', e => {
      const dv = e.target.value;
      const bpm = dv.getUint8(0) & 0x01 ? dv.getUint16(1, true) : dv.getUint8(1);
      this.dispatchEvent(new CustomEvent('hr', { detail: bpm }));
    });
    await ch.startNotifications();
    // Benannter Listener — disconnect() räumt ihn ab (kein Geister-Event
    // einer früheren Instanz am selben gemerkten Gerät)
    this.#onDisconnect = () => this.dispatchEvent(new Event('disconnected'));
    this.#device.addEventListener('gattserverdisconnected', this.#onDisconnect);
  }

  #onDisconnect = null;

  get deviceName() { return this.#device?.name ?? null; }
  get device() { return this.#device; }

  disconnect() {
    if (this.#onDisconnect) this.#device?.removeEventListener('gattserverdisconnected', this.#onDisconnect);
    try { this.#device?.gatt.disconnect(); } catch { /* schon getrennt */ }
  }
}
