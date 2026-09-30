// Herzfrequenzgurt über den Standard-Dienst Heart Rate (0x180D).

const HR_SERVICE = 0x180d;
const CH_HR = 0x2a37;

export class HeartRate extends EventTarget {
  static CHOOSER = { filters: [{ services: [HR_SERVICE] }] };

  #device = null;
  #ch = null;
  // Benannt, damit disconnect() ihn abbaut — Chrome liefert beim Reconnect
  // dasselbe Characteristic-Objekt, eine ersetzte Instanz feuerte sonst weiter
  #onWert = e => {
    const dv = e.target.value;
    const bpm = dv.getUint8(0) & 0x01 ? dv.getUint16(1, true) : dv.getUint8(1);
    this.dispatchEvent(new CustomEvent('hr', { detail: bpm }));
  };

  async connect(device) {
    this.#device = device;                     // Chooser läuft in der Fassade
    const server = await this.#device.gatt.connect();
    const svc = await server.getPrimaryService(HR_SERVICE);
    this.#ch = await svc.getCharacteristic(CH_HR);
    this.#ch.addEventListener('characteristicvaluechanged', this.#onWert);
    await this.#ch.startNotifications();
    // Benannter Listener — disconnect() räumt ihn ab (kein Geister-Event
    // einer früheren Instanz am selben gemerkten Gerät)
    this.#onDisconnect = () => this.dispatchEvent(new Event('disconnected'));
    this.#device.addEventListener('gattserverdisconnected', this.#onDisconnect);
  }

  #onDisconnect = null;

  get deviceName() { return this.#device?.name ?? null; }
  get device() { return this.#device; }

  // gatt:false = nur Teardown — die physische Verbindung ist je device.id geteilt
  disconnect({ gatt = true } = {}) {
    if (this.#onDisconnect) this.#device?.removeEventListener('gattserverdisconnected', this.#onDisconnect);
    this.#ch?.removeEventListener('characteristicvaluechanged', this.#onWert);
    if (gatt) {
      try { this.#device?.gatt.disconnect(); } catch { /* schon getrennt */ }
    }
  }
}
