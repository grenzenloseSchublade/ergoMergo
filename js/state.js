// Session-Zustandsautomat und Aufzeichnung.
// Hält das Wattziel, fährt Zielsprünge als 2-s-Rampe und schreibt
// höchstens alle 250 ms auf den Control Point.

import { FIELDS, saveSamples, saveSession } from './storage.js';
import { logInfo, logWarn } from './logger.js';
import { fahrtStats, geschwindigkeitKmh } from './metrics.js';
import { zaehltFuerPlan } from './plan.js';

const WRITE_INTERVAL = 250;   // ms — Schutz des Control Points
const RAMP_MS = 2000;         // Zielsprünge als Rampe, nicht als Sprung
const RESUME_RAMP_MS = 10000; // Wiedereinstieg nach Stopp: sanft hochfahren
const AUTOSAVE_MS = 5000;
const DATEN_VERALTET_MS = 3000;   // keine Trainerdaten mehr → Livewerte gelten nicht mehr
const HF_VERALTET_MS = 5000;      // kein HF-Wert mehr → Lücke statt eingefrorener Linie
// Programmuhr: Chrome drosselt Timer im Hintergrund auf bis zu 60 s. Der Takt
// misst deshalb die Wanduhr und holt verpasste Sekunden auf. Größere Lücken
// sind Standby oder ein eingefrorener Tab — die zählen nicht als gefahren
const MAX_NACHHOLEN_S = 120;
const UHR_TOLERANZ_MS = 100;      // Timer darf knapp vor der Sekunde feuern, ohne dass sie ausfällt

export class Session extends EventTarget {
  constructor(ftms, settings, programm = null) {
    super();
    this.ftms = ftms;
    this.settings = settings;
    this.programm = programm;                 // Programm-Definition (Name/id für die gespeicherte Fahrt)
    this.seed = null;                         // Startwert eines Zufallsprogramms (Fartlek)
    this.planInfo = null;                     // Trainingsplan: Einheit dieser Fahrt (plan.js planInfo)
    this.id = new Date().toISOString();
    this.start = Date.now();
    this.status = 'riding';                   // riding | done
    this.target = Math.min(settings.startWatt, settings.maxWatt);
    this.samples = new Int16Array(4 * 3600 * FIELDS);   // 4 h Vorrat, wächst bei Bedarf
    this.count = 0;
    this.live = { watt: 0, rpm: 0, hr: 0, kmh: 0 };
    this.kj = 0;
    this.km = 0;
    this.programmEndeBei = null;   // Aufzeichnungssekunde des Programmendes (ProgramRun setzt)
    this.holtAuf = false;          // true: nachgeholte Sekunde, weitere folgen — keine Töne, keine Ansage
    this.#startLoops();
    ftms.addEventListener('data', this.#onData);
  }

  #letzteDaten = performance.now();
  #letzteHf = 0;

  #ramp = null;               // { from, to, t0 }
  // Nach Reconnect Ziel sofort neu schreiben (der Timer ist im Hintergrund
  // gedrosselt); fürs Diagnose-Log festhalten, in welchem Zustand die Fahrt
  // die Verbindung zurückbekam
  #onReconnect = () => {
    this.#lastWritten = -1;
    logInfo('session', `Reconnect während der Fahrt: ${this.gestoppt ? 'gestoppt' : this.status}, Ziel ${this.target} W`);
    this.#schreibeZiel();
  };
  #lastWritten = -1;
  #writeTimer = null;
  #tickTimer = null;
  #autosaveTimer = null;
  #hrExternal = false;
  #onData = e => {
    // Notifications laufen im Hintergrund weiter und treiben die Uhr mit. Vor
    // dem Übernehmen: die verpassten Sekunden liegen vor diesem Messwert
    this.holeAuf();
    const d = { ...e.detail };
    if (this.#hrExternal) delete d.hr;      // Gurt schlägt Trainer-Bridge
    Object.assign(this.live, d);
    this.#letzteDaten = performance.now();
    if (d.hr) this.#letzteHf = this.#letzteDaten;
    // Laufende Rampe (v. a. der sanfte Wiedereinstieg nach Not-Stopp) und
    // noch nicht geschriebene Ziele im Takt der BLE-Notifications schreiben —
    // Timer sind im Hintergrund gedrosselt, Notifications kommen weiter
    if (this.#ramp || this.target !== this.#lastWritten) this.#schreibeZiel();
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
    else {
      const von = this.#currentRampValue();     // beendet eine abgelaufene Rampe
      // Läuft der sanfte Wiedereinstieg, darf ein höheres Ziel (±-Tap, gehaltener
      // Knopf, Blockwechsel) ihn nicht abkürzen: das neue Ziel kommt in seiner
      // Restzeit. Nach unten gilt die normale Rampe
      const alt = this.#ramp;
      const sanft = rampMs === RESUME_RAMP_MS || (alt?.sanft && w > von);
      const rest = alt?.sanft ? alt.ms - (performance.now() - alt.t0) : 0;
      const ms = rampMs === RESUME_RAMP_MS ? rampMs : sanft ? Math.max(RAMP_MS, rest) : rampMs;
      this.#ramp = { from: von, to: w, t0: performance.now(), ms, sanft };
      this.target = w;
    }
    this.dispatchEvent(new Event('target'));
    // Sofort schreiben statt auf den 250-ms-Timer warten: im Hintergrund
    // drosselt Chrome Timer massiv — der BLE-Tastendruck selbst liefert
    // den Task, damit ± auch bei PiP/Bildschirm-aus sofort wirkt
    this.#schreibeZiel();
  }

  adjust(delta) {
    this.holeAuf();
    this.gestoppt = false;                  // ±-Tap = bewusstes Weiterfahren
    this.setTarget(this.target + delta);
  }

  // Not-Stopp: Ziel sofort 0, vorheriges Ziel für „WEITER" merken.
  // Idempotent — wiederholte Aufrufe überschreiben zielVorStopp nicht.
  emergencyStop() {
    this.holeAuf();                         // verpasste Sekunden zählen noch als gefahren
    if (!this.gestoppt) this.zielVorStopp = this.target;
    this.gestoppt = true;
    this.setTarget(0, { instant: true });
  }

  // Weiterfahren nach Not-Stopp: Wiedereinstieg bei ~50 % des Ziels, dann
  // sanfte Rampe auf 100 % — verhindert den harten ERG-Einstieg (und damit
  // die "Spiral of Death" direkt nach dem Resume).
  weiterZu(ziel) {
    this.holeAuf();                         // verpasste Sekunden zählen noch als Stopp
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
    if (document.hidden && !this.#ramp?.sanft) this.#ramp = null;
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

    this.#tickTimer = setInterval(() => this.holeAuf(), 1000);
    // Autosave-Fehler (Speicher voll o. Ä.) nicht als unbehandelte Rejection
    // verlieren: melden, beim nächsten Intervall erneut versuchen
    this.#autosaveTimer = setInterval(() => this.save().catch(err => {
      logWarn('session', 'Autosave fehlgeschlagen', err.message);
      this.dispatchEvent(new CustomEvent('error', { detail: `Speichern fehlgeschlagen: ${err.message}` }));
    }), AUTOSAVE_MS);
  }

  #uhrStand = performance.now();   // Wanduhr, bis zu der die Sekunden verbucht sind

  // Fällige Sekunden verbuchen: im Vordergrund genau eine, sonst alles seit dem
  // letzten Aufruf — jede für sich, damit ProgramRun keinen Blockwechsel verliert
  // und jedes Sample das damalige Ziel trägt. Vor jeder Zustandsänderung (Stopp,
  // Weiter, ±, Skip) aufrufen: Sekunden davor zählen noch zum alten Zustand.
  // still: auch die letzte Sekunde ohne Töne (Fahrtende).
  holeAuf({ still = false } = {}) {
    if (this.status !== 'riding') return;
    const jetzt = performance.now();
    const faellig = Math.floor((jetzt - this.#uhrStand + UHR_TOLERANZ_MS) / 1000);
    if (faellig < 1) return;
    if (faellig > MAX_NACHHOLEN_S) {
      logWarn('session', `Uhr stand ${faellig} s — Standby, nicht nachgeholt`);
      this.#uhrStand = jetzt;
      return;
    }
    if (faellig >= 5) logInfo('bg', `Programmuhr holt ${faellig} s auf`);
    for (let k = 1; k <= faellig; k++) {
      this.#uhrStand += 1000;
      this.holtAuf = still || k < faellig;
      this.#sekunde(this.#uhrStand);
    }
    this.holtAuf = false;
    this.dispatchEvent(new Event('tick'));    // Anzeige: einmal, auch nach vielen Sekunden
  }

  #sekunde(zeit) {
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
    if (zeit - this.#letzteDaten > DATEN_VERALTET_MS) Object.assign(this.live, { watt: 0, rpm: 0, kmh: 0 });
    if (zeit - this.#letzteHf > HF_VERALTET_MS) this.live.hr = 0;
    const s = this.samples;
    s[i] = this.elapsed;
    s[i + 1] = this.live.watt;
    s[i + 2] = this.target;
    s[i + 3] = this.live.rpm;
    s[i + 4] = this.live.hr;
    s[i + 5] = Math.round(geschwindigkeitKmh(this.live.watt, this.settings.gewichtKg) * 10);
    this.count++;
    this.kj += this.live.watt / 1000;
    this.km += s[i + 5] / 36000;   // aus dem Sample, damit Live-km == distanzKm(samples)
    this.dispatchEvent(new Event('sekunde'));
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
    return fahrtStats(this.samples, this.count, this.programmEndeBei, this.settings.ftp, this.settings.gewichtKg);
  }

  async save(final = false) {
    if (!this.count) return;
    await saveSamples(this.id, this.samples, this.count);
    // Plan: nur speichern, wenn die Fahrt zählt (Abbruch nach 2 min ist nicht „gefahren")
    const plan = this.planInfo && zaehltFuerPlan({ dauer: this.count, programmId: this.programm?.id }) ? this.planInfo : null;
    await saveSession({
      id: this.id, start: this.start,
      programm: this.programm?.name ?? 'Freies Fahren',
      programmId: this.programm?.id ?? null,
      seed: this.seed,
      planRef: plan?.ref ?? null, plan,
      ftp: this.settings.ftp || null,
      gewichtKg: this.settings.gewichtKg ?? 75,
      akkuProStunde: this.akkuProStunde ?? null,
      programmEndeBei: this.programmEndeBei,   // Detail-Graph: Ausfahr-Bereich absetzen
      final, distanzModell: 1, ...this.stats(),
    });
  }

  async finish() {
    if (this.status === 'done') return;
    this.holeAuf({ still: true });
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
    // Ausgang fürs Diagnose-Log: bestätigt oder warum nicht
    let grund = 'Control Point blieb 1,2 s beschäftigt';
    for (let i = 0; i < 8; i++) {
      if (!this.ftms.connected) { grund = 'Trainer nicht verbunden'; break; }
      if (!this.ftms.busy) {
        try { await this.ftms.setTargetPower(0); grund = null; }
        catch (err) { grund = `Fehler: ${err.message}`; }   // Trainer ggf. weg
        break;
      }
      await new Promise(r => setTimeout(r, 150));
    }
    if (grund) logWarn('session', 'Fahrtende: Ziel 0 W nicht bestätigt', grund);
    else logInfo('session', 'Fahrtende: Ziel 0 W bestätigt');
    await this.save(true);
  }
}
