// Session-Zustandsautomat und Aufzeichnung.
// Hält das Wattziel, fährt Zielsprünge als 2-s-Rampe und schreibt
// höchstens alle 250 ms auf den Control Point.

import { FIELDS, saveSamples, saveSession } from './storage.js';
import { logInfo, logWarn } from './logger.js';
import { fahrtStats } from './metrics.js';

const WRITE_INTERVAL = 250;   // ms — Schutz des Control Points
const RAMP_MS = 2000;         // Zielsprünge als Rampe, nicht als Sprung
const RESUME_RAMP_MS = 10000; // Wiedereinstieg nach Stopp: sanft hochfahren
const AUTOSAVE_MS = 5000;
const DATEN_VERALTET_MS = 3000;   // keine Trainerdaten mehr → Livewerte gelten nicht mehr
const HF_VERALTET_MS = 5000;      // kein HF-Wert mehr → Lücke statt eingefrorener Linie

export class Session extends EventTarget {
  constructor(ftms, settings, programm = null) {
    super();
    this.ftms = ftms;
    this.settings = settings;
    this.programm = programm;                 // Programm-Definition (Name/id für die gespeicherte Fahrt)
    this.seed = null;                         // Startwert eines Zufallsprogramms (Fartlek)
    this.id = new Date().toISOString();
    this.start = Date.now();
    this.status = 'riding';                   // riding | paused | done
    this.target = settings.startWatt;
    this.samples = new Int16Array(4 * 3600 * FIELDS);   // 4 h Vorrat, wächst bei Bedarf
    this.count = 0;
    this.live = { watt: 0, rpm: 0, hr: 0, kmh: 0 };
    this.kj = 0;
    this.km = 0;
    this.programmEndeBei = null;   // Aufzeichnungssekunde des Programmendes (ProgramRun setzt)
    this.#startLoops();
    ftms.addEventListener('data', this.#onData);
  }

  #letzteDaten = performance.now();
  #letzteHf = 0;

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
    this.#letzteDaten = performance.now();
    if (d.hr) this.#letzteHf = this.#letzteDaten;
    // Laufende Rampe (v. a. der sanfte Wiedereinstieg nach Not-Stopp) im
    // Takt der BLE-Notifications weiterschreiben — Timer sind im
    // Hintergrund gedrosselt, Notifications kommen weiter
    if (this.#ramp) this.#schreibeZiel();
  };

  #hrAbos = [];   // [client, typ, fn] — Pool-Clients leben über Sessions hinaus
  #hrClients = new Set();

  attachHR(hrClient) {
    this.#hrExternal = true;
    this.#hrClients.add(hrClient);
    const onHr = e => { this.live.hr = e.detail; this.#letzteHf = performance.now(); };
    const onWeg = () => {
      // Gurt weg: HF sofort als Lücke (0) statt eingefrorenem Wert; die
      // Trainer-Bridge darf nur übernehmen, wenn kein anderer Gurt mehr hängt
      this.#hrClients.delete(hrClient);
      this.#hrExternal = [...this.#hrClients].some(c => c.device?.gatt?.connected);
      this.live.hr = 0;
    };
    hrClient.addEventListener('hr', onHr);
    hrClient.addEventListener('disconnected', onWeg);
    this.#hrAbos.push([hrClient, 'hr', onHr], [hrClient, 'disconnected', onWeg]);
  }

  detachHR() {
    for (const [c, typ, fn] of this.#hrAbos) c.removeEventListener(typ, fn);
    this.#hrAbos = [];
    this.#hrClients.clear();
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
    if (this.status !== 'riding' || !this.ftms.connected) return;
    const jetzt = performance.now();
    const abstand = jetzt - this.#letzterWriteT;
    // busy (Control-Point-Antwort steht aus) und Ratenlimit gleich
    // behandeln: Nachzügler planen statt den Write zu verlieren — im
    // Hintergrund käme der Interval-Timer sonst erst nach bis zu 60 s
    if (this.ftms.busy || abstand < WRITE_INTERVAL) {
      clearTimeout(this.#nachzuegler);
      this.#nachzuegler = setTimeout(() => this.#schreibeZiel(),
        Math.max(WRITE_INTERVAL - abstand, 50) + 10);
      return;
    }
    // Hintergrund: normale Rampen überspringen UND beenden (ihr Timer ist
    // gedrosselt; stehen bleibend würde sie beim Sichtbarwerden einen
    // niedrigeren Zwischenwert nachschreiben) — plus Diagnosespur. Der
    // sanfte Wiedereinstieg nach Not-Stopp bleibt: er läuft im Takt der
    // BLE-Notifications weiter (#onData), sonst stünde sofort volle Last an
    if (document.hidden && this.#ramp?.ms !== RESUME_RAMP_MS) this.#ramp = null;
    const w = this.#currentRampValue();
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
    // Autosave-Fehler (Speicher voll o. Ä.) nicht als unbehandelte Rejection
    // verlieren: melden, beim nächsten Intervall erneut versuchen
    this.#autosaveTimer = setInterval(() => this.save().catch(err => {
      logWarn('session', 'Autosave fehlgeschlagen', err.message);
      this.dispatchEvent(new CustomEvent('error', { detail: `Speichern fehlgeschlagen: ${err.message}` }));
    }), AUTOSAVE_MS);
  }

  #tick() {
    if (this.status !== 'riding') return;
    const i = this.count * FIELDS;
    if (i + FIELDS > this.samples.length) {
      // Über 4 h: Puffer verdoppeln statt still einzufrieren
      const neu = new Int16Array(this.samples.length * 2);
      neu.set(this.samples);
      this.samples = neu;
      logInfo('session', `Sample-Puffer auf ${neu.length / FIELDS / 3600} h erweitert`);
    }
    // Keine frischen Daten (Trainer getrennt/still, Gurt weg): nicht die
    // letzten Werte minutenlang weiterschreiben — sonst wachsen kJ, NP, TSS
    // und km, und die HF-Linie wird flach statt zur Lücke
    const jetzt = performance.now();
    if (jetzt - this.#letzteDaten > DATEN_VERALTET_MS) Object.assign(this.live, { watt: 0, rpm: 0, kmh: 0 });
    if (jetzt - this.#letzteHf > HF_VERALTET_MS) this.live.hr = 0;
    const s = this.samples;
    s[i] = this.elapsed;
    s[i + 1] = this.live.watt;
    s[i + 2] = this.target;
    s[i + 3] = this.live.rpm;
    s[i + 4] = this.live.hr;
    s[i + 5] = Math.round(this.live.kmh * 10);
    this.count++;
    this.kj += this.live.watt / 1000;
    this.km += s[i + 5] / 36000;   // aus dem Sample, damit Live-km == distanzKm(samples)
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
    return fahrtStats(this.samples, this.count, this.programmEndeBei, this.settings.ftp);
  }

  async save(final = false) {
    if (!this.count) return;
    await saveSamples(this.id, this.samples, this.count);
    await saveSession({
      id: this.id, start: this.start,
      programm: this.programm?.name ?? 'Freies Fahren',
      programmId: this.programm?.id ?? null,
      seed: this.seed,
      geraet: this.ftms.deviceName ?? null,
      fw: this.ftms.firmware ?? null,
      ftp: this.settings.ftp || null,
      akkuProStunde: this.akkuProStunde ?? null,
      programmEndeBei: this.programmEndeBei,   // Detail-Graph: Ausfahr-Bereich absetzen
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
    // Ziel 0 zuverlässig absetzen: busy/Ratenlimit kurz aussitzen (der
    // Writer-Loop ist schon gestoppt, hier hilft niemand mehr nach)
    for (let i = 0; i < 8; i++) {
      if (!this.ftms.connected) break;
      if (!this.ftms.busy) {
        try { await this.ftms.setTargetPower(0); } catch { /* Trainer ggf. weg */ }
        break;
      }
      await new Promise(r => setTimeout(r, 150));
    }
    await this.save(true);
  }
}
