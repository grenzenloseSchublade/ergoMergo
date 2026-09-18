// FTMS-Client für Web Bluetooth (Fitness Machine Service 0x1826).
// Kapselt die Control-Point-Reihenfolge: Notify 0x2AD2 → Indicate 0x2AD9 →
// 0x00 Request Control → 0x07 Start → 0x05 Set Target Power.

const FTMS_SERVICE = 0x1826;
const CH_BIKE_DATA = 0x2ad2;
const CH_FEATURE = 0x2acc;
const CH_CONTROL = 0x2ad9;
const CH_STATUS = 0x2ada;

const RESULT = { 1: 'Success', 2: 'Op Code Not Supported', 3: 'Invalid Parameter', 4: 'Operation Failed', 5: 'Control Not Permitted' };

export class FTMS extends EventTarget {
  #device = null;
  #cp = null;
  #pending = null;        // { opcode, resolve, reject, timer } — genau ein ausstehender Write
  #wantConnection = false;
  #reconnectTimer = null;
  connected = false;
  features = null;

  get deviceName() { return this.#device?.name ?? null; }

  async connect() {
    this.#device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: 'KICKR' }, { services: [FTMS_SERVICE] }],
      optionalServices: [FTMS_SERVICE],
    });
    this.#device.addEventListener('gattserverdisconnected', () => this.#onDisconnected());
    this.#wantConnection = true;
    try {
      await this.#setup();
    } catch (err) {
      // Fehlgeschlagener Erstaufbau darf keine Reconnect-Schleife hinterlassen
      this.disconnect();
      throw err;
    }
  }

  async #setup() {
    const server = await this.#device.gatt.connect();
    const svc = await server.getPrimaryService(FTMS_SERVICE);

    // Feature-Read zuerst: löst auf Android das Bonding aus und sagt, was das Gerät kann.
    try {
      const raw = new Uint8Array((await (await svc.getCharacteristic(CH_FEATURE)).readValue()).buffer);
      const target = raw[4] | raw[5] << 8 | raw[6] << 16 | raw[7] << 24;
      this.features = {
        powerTarget: !!(target & 1 << 3),
        resistanceTarget: !!(target & 1 << 2),
        simulation: !!(target & 1 << 13),
      };
    } catch { this.features = null; }

    // Chrome liefert beim Reconnect dieselben Characteristic-Objekte —
    // remove vor add verhindert doppelte Handler (und damit doppelte Events).
    const bike = await svc.getCharacteristic(CH_BIKE_DATA);
    bike.removeEventListener('characteristicvaluechanged', this.#onBikeData);
    bike.addEventListener('characteristicvaluechanged', this.#onBikeData);
    await bike.startNotifications();

    this.#cp = await svc.getCharacteristic(CH_CONTROL);
    this.#cp.removeEventListener('characteristicvaluechanged', this.#onCpIndication);
    this.#cp.addEventListener('characteristicvaluechanged', this.#onCpIndication);
    await this.#cp.startNotifications();

    try {
      const st = await svc.getCharacteristic(CH_STATUS);
      st.removeEventListener('characteristicvaluechanged', this.#onMachineStatus);
      st.addEventListener('characteristicvaluechanged', this.#onMachineStatus);
      await st.startNotifications();
    } catch { /* Status-Characteristic ist optional */ }

    await this.#write(0x00);          // Request Control — zwingend als Erstes
    await this.#write(0x07);          // Start/Resume
    this.connected = true;
    this.dispatchEvent(new Event('connected'));
  }

  #onBikeData = e => {
    this.dispatchEvent(new CustomEvent('data', { detail: parseBikeData(e.target.value) }));
  };

  #onCpIndication = e => this.#onIndication(e.target.value);

  #onMachineStatus = e => {
    this.dispatchEvent(new CustomEvent('machinestatus', { detail: new Uint8Array(e.target.value.buffer)[0] }));
  };

  #onIndication(value) {
    const b = new Uint8Array(value.buffer);
    if (b[0] !== 0x80 || !this.#pending || b[1] !== this.#pending.opcode) return;
    const p = this.#pending;
    this.#pending = null;
    clearTimeout(p.timer);
    if (b[2] === 1) p.resolve();
    else p.reject(new Error(`Control Point 0x${p.opcode.toString(16)}: ${RESULT[b[2]] ?? b[2]}`));
  }

  #write(opcode, params = []) {
    return new Promise((resolve, reject) => {
      if (this.#pending) return reject(new Error('Control Point beschäftigt'));
      const timer = setTimeout(() => { this.#pending = null; reject(new Error(`Keine Antwort auf 0x${opcode.toString(16)}`)); }, 5000);
      this.#pending = { opcode, resolve, reject, timer };
      this.#cp.writeValueWithResponse(new Uint8Array([opcode, ...params]))
        .catch(err => { clearTimeout(timer); this.#pending = null; reject(err); });
    });
  }

  // Zielleistung in Watt. Aufrufer drosselt (max. 1 Write / 250 ms).
  // Obergrenze sint16: darüber würde der Wert am Gerät negativ umschlagen.
  setTargetPower(watt) {
    const w = Math.max(0, Math.min(32767, Math.round(watt)));
    return this.#write(0x05, [w & 0xff, w >> 8 & 0xff]);
  }

  get busy() { return this.#pending !== null; }

  #onDisconnected() {
    this.connected = false;
    if (this.#pending) {
      clearTimeout(this.#pending.timer);
      this.#pending.reject(new Error('Verbindung getrennt'));
      this.#pending = null;
    }
    this.dispatchEvent(new Event('disconnected'));
    if (this.#wantConnection) this.#scheduleReconnect(1000);
  }

  #scheduleReconnect(delay) {
    clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = setTimeout(async () => {
      if (!this.#wantConnection) return;
      try {
        await this.#setup();
        this.dispatchEvent(new Event('reconnected'));
      } catch {
        this.#scheduleReconnect(Math.min(delay * 2, 10000));
      }
    }, delay);
  }

  disconnect() {
    this.#wantConnection = false;
    clearTimeout(this.#reconnectTimer);
    try { this.#device?.gatt.disconnect(); } catch { /* schon getrennt */ }
    this.connected = false;
  }
}

// Indoor Bike Data (0x2AD2), flag-basiert; toleriert fehlende Felder.
export function parseBikeData(dv) {
  const flags = dv.getUint16(0, true);
  let i = 2;
  const out = {};
  // Instantaneous Speed ist vorhanden, wenn Bit 0 („More Data") = 0 ist
  if ((flags & 0x0001) === 0) { out.kmh = dv.getUint16(i, true) / 100; i += 2; }
  if (flags & 0x0002) i += 2;                                       // Average Speed
  if (flags & 0x0004) { out.rpm = dv.getUint16(i, true) / 2; i += 2; }
  if (flags & 0x0008) i += 2;                                       // Average Cadence
  if (flags & 0x0010) i += 3;                                       // Total Distance
  if (flags & 0x0020) i += 2;                                       // Resistance Level
  if (flags & 0x0040) { out.watt = dv.getInt16(i, true); i += 2; }
  if (flags & 0x0080) i += 2;                                       // Average Power
  if (flags & 0x0100) i += 5;                                       // Expended Energy: Total + /h + /min
  if (flags & 0x0200) { out.hr = dv.getUint8(i); i += 1; }
  if (flags & 0x0400) i += 2;                                       // Metabolic Equivalent
  if (flags & 0x0800) i += 2;                                       // Elapsed Time
  if (flags & 0x1000) i += 2;                                       // Remaining Time
  return out;
}
