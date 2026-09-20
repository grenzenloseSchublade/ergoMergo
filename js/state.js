// Session-Zustandsautomat und Aufzeichnung.
// Hält das Wattziel, fährt Zielsprünge als 2-s-Rampe und schreibt
// höchstens alle 250 ms auf den Control Point.

import { FIELDS, saveSamples, saveSession } from './storage.js';
import { logInfo, logWarn } from './logger.js';
import { kennwerte } from './metrics.js';

const WRITE_INTERVAL = 250;   // ms — Schutz des Control Points
const RAMP_MS = 2000;         // Zielsprünge als Rampe, nicht als Sprung
const RESUME_RAMP_MS = 10000; // Wiedereinstieg nach Stopp: sanft hochfahren
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
  #onReconnect = () => { this.#lastWritten = -1; };
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

  #hrAbos = [];   // [client, typ, fn] — Pool-Clients leben über Sessions hinaus

  attachHR(hrClient) {
    this.#hrExternal = true;
    const onHr = e => { this.live.hr = e.detail; };
    const onWeg = () => { this.#hrExternal = false; };
    hrClient.addEventListener('hr', onHr);
    hrClient.addEventListener('disconnected', onWeg);
    this.#hrAbos.push([hrClient, 'hr', onHr], [hrClient, 'disconnected', onWeg]);
  }

  detachHR() {
    for (const [c, typ, fn] of this.#hrAbos) c.removeEventListener(typ, fn);
    this.#hrAbos = [];
  }

  setTarget(watt, { instant = false, rampMs = RAMP_MS } = {}) {
    const w = Math.min(Math.max(0, Math.round(watt)), this.settings.maxWatt);
    if (instant) { this.#ramp = null; this.target = w; }
    else { this.#ramp = { from: this.#currentRampValue(), to: w, t0: performance.now(), ms: rampMs }; this.target = w; }
    this.dispatchEvent(new Event('target'));
    // Sofort schreiben statt auf den 250-ms-Timer warten: im Hintergrund
    // drosselt Chrome Timer massiv — der BLE-Tastendruck selbst liefert
    // den Task, damit ± auch bei PiP/Bildschirm-aus sofort wirkt
    this.#schreibeZiel();
  }

  adjust(delta) {
    this.gestoppt = false;                  // ±-Tap = bewusstes Weiterfahren
    this.setTarget(this.target + delta);
  }

  // Not-Stopp: Ziel sofort 0, vorheriges Ziel für „WEITER" merken.
  // Idempotent — wiederholte Aufrufe überschreiben zielVorStopp nicht.
  emergencyStop() {
    if (!this.gestoppt) this.zielVorStopp = this.target;
    this.gestoppt = true;
    this.setTarget(0, { instant: true });
  }

  // Weiterfahren nach Not-Stopp: Wiedereinstieg bei ~50 % des Ziels, dann
  // sanfte Rampe auf 100 % — verhindert den harten ERG-Einstieg (und damit
  // die "Spiral of Death" direkt nach dem Resume).
  weiterZu(ziel) {
    this.gestoppt = false;
    if (ziel > 0) {
      this.setTarget(Math.round(ziel * 0.5), { instant: true });
      this.setTarget(ziel, { rampMs: RESUME_RAMP_MS });
    }
  }

  weiter() { this.weiterZu(this.zielVorStopp ?? 0); }

  #currentRampValue() {
    if (!this.#ramp) return this.target;
    const p = Math.min(1, (performance.now() - this.#ramp.t0) / (this.#ramp.ms ?? RAMP_MS));
    if (p >= 1) { this.#ramp = null; return this.target; }
    return Math.round(this.#ramp.from + (this.#ramp.to - this.#ramp.from) * p);
  }

  #letzterWriteT = 0;
  #nachzuegler = null;

  // Zentraler Ziel-Writer: hält das 1-Write-pro-250-ms-Limit des Trainers
  // ein, egal ob der Aufruf vom Timer oder event-getrieben kommt.
  #schreibeZiel() {
    if (this.status !== 'riding' || !this.ftms.connected || this.ftms.busy) return;
    const jetzt = performance.now();
    const abstand = jetzt - this.#letzterWriteT;
    if (abstand < WRITE_INTERVAL) {
      clearTimeout(this.#nachzuegler);
      this.#nachzuegler = setTimeout(() => this.#schreibeZiel(), WRITE_INTERVAL - abstand + 10);
      return;
    }
    // Hintergrund: Rampe überspringen (deren Timer ist gedrosselt) —
    // direkt der Zielwert, plus Diagnosespur für den Livetest
    const w = document.hidden ? this.target : this.#currentRampValue();
    if (w === this.#lastWritten) return;
    this.#letzterWriteT = jetzt;
    this.#lastWritten = w;
    if (document.hidden) logInfo('bg', `Ziel-Write im Hintergrund: ${w} W`);
    this.ftms.setTargetPower(w).catch(err => {
      this.#lastWritten = -1;               // erneut versuchen
      if (document.hidden) logWarn('bg', 'Hintergrund-Write fehlgeschlagen', err.message);
      this.dispatchEvent(new CustomEvent('error', { detail: err.message }));
    });
  }

  #startLoops() {
    this.#writeTimer = setInterval(() => this.#schreibeZiel(), WRITE_INTERVAL);

    // Nach Reconnect Ziel neu schreiben
    this.ftms.addEventListener('reconnected', this.#onReconnect);

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
      ...kennwerte(this.samples, this.count, this.settings.ftp),
    };
  }

  async save(final = false) {
    if (!this.count) return;
    await saveSamples(this.id, this.samples, this.count);
    await saveSession({
      id: this.id, start: this.start,
      programm: this.programm?.name ?? 'Freies Fahren',
      programmId: this.programm?.id ?? null,
      geraet: this.ftms.deviceName ?? null,
      fw: this.ftms.firmware ?? null,
      ftp: this.settings.ftp || null,
      akkuProStunde: this.akkuProStunde ?? null,
      final, ...this.stats(),
    });
  }

  async finish() {
    if (this.status === 'done') return;
    this.status = 'done';
    clearInterval(this.#writeTimer);
    clearInterval(this.#tickTimer);
    clearInterval(this.#autosaveTimer);
    clearTimeout(this.#nachzuegler);
    this.ftms.removeEventListener('data', this.#onData);
    this.ftms.removeEventListener('reconnected', this.#onReconnect);
    this.detachHR();
    try { if (this.ftms.connected) await this.ftms.setTargetPower(0); } catch { /* Trainer ggf. weg */ }
    await this.save(true);
  }
}
