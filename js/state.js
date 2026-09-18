// Session-Zustandsautomat und Aufzeichnung.
// Hält das Wattziel, fährt Zielsprünge als 2-s-Rampe und schreibt
// höchstens alle 250 ms auf den Control Point.

import { FIELDS, saveSamples, saveSession } from './storage.js';

const WRITE_INTERVAL = 250;   // ms — Schutz des Control Points
const RAMP_MS = 2000;         // Zielsprünge als Rampe, nicht als Sprung
const AUTOSAVE_MS = 5000;

export class Session extends EventTarget {
  constructor(ftms, settings, programm = null) {
    super();
    this.ftms = ftms;
    this.settings = settings;
    this.programm = programm;                 // V2: Programm-Engine hängt sich hier ein
    this.id = new Date().toISOString();
    this.start = Date.now();
    this.status = 'riding';                   // riding | paused | done
    this.target = settings.startWatt;
    this.samples = new Int16Array(4 * 3600 * FIELDS);   // 4 h Vorrat
    this.count = 0;
    this.live = { watt: 0, rpm: 0, hr: 0, kmh: 0 };
    this.kj = 0;
    this.#startLoops();
    ftms.addEventListener('data', this.#onData);
  }

  #ramp = null;               // { from, to, t0 }
  #lastWritten = -1;
  #writeTimer = null;
  #tickTimer = null;
  #autosaveTimer = null;
  #hrExternal = false;
  #onData = e => {
    const d = { ...e.detail };
    if (this.#hrExternal) delete d.hr;      // Gurt schlägt Trainer-Bridge
    Object.assign(this.live, d);
  };

  attachHR(hrClient) {
    this.#hrExternal = true;
    hrClient.addEventListener('hr', e => { this.live.hr = e.detail; });
    hrClient.addEventListener('disconnected', () => { this.#hrExternal = false; });
  }

  setTarget(watt, { instant = false } = {}) {
    const w = Math.min(Math.max(0, Math.round(watt)), this.settings.maxWatt);
    if (instant) { this.#ramp = null; this.target = w; }
    else { this.#ramp = { from: this.#currentRampValue(), to: w, t0: performance.now() }; this.target = w; }
    this.dispatchEvent(new Event('target'));
  }

  adjust(delta) { this.setTarget(this.target + delta); }

  emergencyStop() { this.setTarget(0, { instant: true }); }

  #currentRampValue() {
    if (!this.#ramp) return this.target;
    const p = Math.min(1, (performance.now() - this.#ramp.t0) / RAMP_MS);
    if (p >= 1) { this.#ramp = null; return this.target; }
    return Math.round(this.#ramp.from + (this.#ramp.to - this.#ramp.from) * p);
  }

  #startLoops() {
    this.#writeTimer = setInterval(() => {
      if (!this.ftms.connected || this.ftms.busy) return;
      const w = this.#currentRampValue();
      if (w !== this.#lastWritten) {
        this.#lastWritten = w;
        this.ftms.setTargetPower(w).catch(err => {
          this.#lastWritten = -1;           // erneut versuchen
          this.dispatchEvent(new CustomEvent('error', { detail: err.message }));
        });
      }
    }, WRITE_INTERVAL);

    // Nach Reconnect Kontrolle + Ziel neu setzen
    this.ftms.addEventListener('reconnected', () => { this.#lastWritten = -1; });

    this.#tickTimer = setInterval(() => this.#tick(), 1000);
    this.#autosaveTimer = setInterval(() => this.save(), AUTOSAVE_MS);
  }

  #tick() {
    if (this.status !== 'riding') return;
    const i = this.count * FIELDS;
    if (i + FIELDS > this.samples.length) return;
    const s = this.samples;
    s[i] = this.elapsed;
    s[i + 1] = this.live.watt;
    s[i + 2] = this.target;
    s[i + 3] = this.live.rpm;
    s[i + 4] = this.live.hr;
    s[i + 5] = Math.round(this.live.kmh * 10);
    this.count++;
    this.kj += this.live.watt / 1000;
    this.dispatchEvent(new Event('tick'));
  }

  get elapsed() { return this.count; }        // 1 Sample = 1 s Fahrzeit

  // 3-s-geglättete Leistung für die Anzeige
  get smoothWatt() {
    const n = Math.min(3, this.count);
    if (!n) return this.live.watt;
    let sum = 0;
    for (let k = this.count - n; k < this.count; k++) sum += this.samples[k * FIELDS + 1];
    return Math.round(sum / n);
  }

  pause() { this.status = 'paused'; this.dispatchEvent(new Event('status')); }
  resume() { this.status = 'riding'; this.dispatchEvent(new Event('status')); }

  stats() {
    let sumW = 0, maxW = 0, sumRpm = 0, rpmN = 0;
    for (let k = 0; k < this.count; k++) {
      const w = this.samples[k * FIELDS + 1];
      sumW += w; if (w > maxW) maxW = w;
      const r = this.samples[k * FIELDS + 3];
      if (r > 0) { sumRpm += r; rpmN++; }
    }
    return {
      dauer: this.count,
      avgW: this.count ? Math.round(sumW / this.count) : 0,
      maxW,
      kJ: Math.round(this.kj),
      avgRpm: rpmN ? Math.round(sumRpm / rpmN) : 0,
    };
  }

  async save(final = false) {
    if (!this.count) return;
    await saveSamples(this.id, this.samples, this.count);
    await saveSession({
      id: this.id, start: this.start,
      programm: this.programm?.name ?? 'Freies Fahren',
      final, ...this.stats(),
    });
  }

  async finish() {
    this.status = 'done';
    clearInterval(this.#writeTimer);
    clearInterval(this.#tickTimer);
    clearInterval(this.#autosaveTimer);
    this.ftms.removeEventListener('data', this.#onData);
    try { if (this.ftms.connected) await this.ftms.setTargetPower(0); } catch { /* Trainer ggf. weg */ }
    await this.save(true);
  }
}
