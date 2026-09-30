// Fahrbildschirm: Livewerte, ±-Bedienung mit Tastenwiederholung, Not-Stopp,
// Geräte-Chips, Fokus-Modi, Statuszeile. Die DOM-Elemente überleben die
// Fahrt (ein Fahrbildschirm für alle Fahrten) — deshalb setzt der Konstruktor
// alles Sichtbare zurück und Handler werden ZUGEWIESEN statt angehängt.

import { LiveChart, WorkoutChart, zoneColor, zoneVar, beobachte } from './chart.js';
import { fmtTime, fmtKm } from '../format.js';
import * as signal from '../signals.js';
import { geraeteManager } from '../ble/geraete.js';
import { initAnsagen, ansageBlock, ansageFertig, stoppeAnsagen } from '../ansagen.js';
import { PiP } from './pip.js';
import { setSetting } from '../storage.js';
import { beendeMessung } from '../energie.js';
import { effektiveFtp, kadenzBereich } from '../metrics.js';
import { logError } from '../logger.js';
import { toast, toastErr } from './toast.js';
import { geraeteHinweis } from './geraete-leiste.js';
import { LedZeile } from './led-zeile.js';

const STOPP_SPERRE_MS = 3000;     // Panik-Schutz nach Not-Stopp
const HALTEN_PAUSE_MS = 500;      // ±-Knopf halten: erste Wiederholung
const HALTEN_TAKT_MS = 300;       //   … danach im Takt
const INFO_MS = 4000;             // kurze Rückmeldungen in der Statuszeile
const FEHLER_INFO_MS = 8000;      // einmalige Fehler (z. B. ein Write) verschwinden wieder

// Dauerhafte Zustände der Statuszeile, nach Priorität. Kurze Infos
// überblenden sie für ein paar Sekunden, danach kommt der Zustand zurück.
const STATUS_PRIO = ['trainer', 'stopp', 'geraet', 'ausfahren'];

// Geräte-Chip: Zustand als data-Attribut, Punkt und Rahmen per CSS (gleiche
// Regeln wie die Geräte-Leiste auf dem Home)
function setzeChip(btn, zustand, beschreibung) {
  btn.dataset.zustand = zustand;
  btn.setAttribute('aria-label', beschreibung);
}

const ROLLEN_LABEL = { hr: 'Herzgurt', controller: 'Lenker' };
const ZUSTAND_TEXT = { verbunden: 'verbunden', teilweise: 'teilweise verbunden', verbindet: 'verbindet',
  gemerkt: 'nicht verbunden', fehlt: 'nicht gekoppelt', fehler: 'nicht erreichbar' };

export class RideScreen {
  constructor(root, session, settings, onEnd, run = null) {
    this.root = root;
    this.session = session;
    this.settings = settings;
    this.onEnd = onEnd;
    this.run = run;                          // ProgramRun oder null (Freies Fahren)
    this.$ = id => root.querySelector(id);
    this.chart = run ? new WorkoutChart(this.$('#live-chart')) : new LiveChart(this.$('#live-chart'));
    this.tonAn = settings.tonAn !== false;
    this.ansagenAn = !!settings.sprachansagen;
    initAnsagen(signal.audioCtx());
    this.#led = new LedZeile(this.$('#m-status'));
    this.#zuruecksetzen();
    if (run) this.#bindProgramm();
    this.#bindGeraete();
    this.#bindSchalter();
    this.#bindPip();
    this.#bindBedienung();
    this.#bindFokus();
    this.#bindTrainer();
    // Chart-Resize (Rotation, Fokus-Wechsel, Fenster): sofort neu zeichnen
    // statt auf den nächsten Sekunden-Tick zu warten — sonst streckt CSS
    // die alte Bitmap kurz verzerrt (Standard-Muster: ResizeObserver + rAF)
    this.#abmelden = beobachte(this.$('#live-chart'), () => this.render());
    // session stirbt mit der Fahrt (Abos dort unkritisch); Pool-Clients leben
    // weiter — deren Listener MÜSSEN in destroy() wieder abgebaut werden
    session.addEventListener('tick', () => { this.render(); this.#pip?.update(); });
    session.addEventListener('target', () => { this.render(); this.#pip?.update(); });
    session.addEventListener('error', e => this.#info(e.detail, 'err', FEHLER_INFO_MS));
    this.render();
  }

  #pip = null;                // Bild-in-Bild-Instanz (lazy)
  #led = null;                // Statuszeile als LED-Laufschrift
  #abos = [];                 // [target, typ, fn] — Listener auf langlebigen Pool-Clients
  #uebernommen = new Set();   // Client-Objekte, die diese Fahrt schon verdrahtet hat
  #tot = false;               // destroy() gelaufen — späte Promises ignorieren
  #beendet = false;           // beenden() läuft/gelaufen
  #ansageTimer = null;        // jüngste geplante Sprachansage (Block/Fertig)
  #halten = new Map();        // Knopf → Wiederholungs-Timer (je Knopf eigener Slot)
  #stopSperre = null;
  #stopGesperrt = false;
  #endArm = null;
  #watchdog = null;
  #keys = null;
  #verbStatus = 'ok';         // 'ok' | 'reconnect' | 'lang' | 'unerreichbar'
  #koppelFallback = { hr: 0, controller: 0 };   // Zeitfenster: nächster Chip-Tap → Chooser
  #geraetZustand = { hr: null, controller: null };
  #cursorBlinkBis = 0;
  #zustaende = new Map();     // Statuszeile: art → { text, cls }
  #infoMeldung = null;
  #statusTimer = null;
  #abmelden = null;           // Resize-Beobachtung des Charts
  #rpmAbweichSeit = 0;

  #abo(target, typ, fn) {
    target.addEventListener(typ, fn);
    this.#abos.push([target, typ, fn]);
  }

  // Alles Sichtbare auf Fahrtbeginn: Reste der vorigen Fahrt (Statuszeile
  // „gestoppt", Restbalken, armierter Beenden-Knopf) dürfen nicht stehen bleiben
  #zuruecksetzen() {
    this.$('#m-time-label').textContent = this.run ? 'Intervall Rest' : 'Zeit';
    this.$('#m-total').hidden = !this.run;
    this.$('#m-total-label').textContent = 'Rest gesamt';
    this.$('#m-restbalken').hidden = !this.run;
    this.$('.ride-grid').classList.remove('fokus-werte', 'fokus-graph');
    this.#zeigeStatus();
  }

  // --- Statuszeile ---------------------------------------------------------

  #setzeZustand(art, text, cls = 'err') {
    if (text) this.#zustaende.set(art, { text, cls });
    else this.#zustaende.delete(art);
    this.#zeigeStatus();
  }

  #info(text, cls = 'ok', ms = INFO_MS) {
    this.#infoMeldung = { text, cls };
    clearTimeout(this.#statusTimer);
    this.#statusTimer = setTimeout(() => { this.#infoMeldung = null; this.#zeigeStatus(); }, ms);
    this.#zeigeStatus();
  }

  #zeigeStatus() {
    // Die Mulde bleibt immer stehen (feste Höhe) — nur die LED-Schrift wechselt
    const m = this.#infoMeldung ?? STATUS_PRIO.map(a => this.#zustaende.get(a)).find(Boolean);
    this.#led.setze(m?.text ?? '', m?.cls ?? '');
  }

  // --- Programm: Ansagen, Töne, Programmende --------------------------------

  #planeAnsage(b, verzoegerung) {
    // Nur die JÜNGSTE Ansage gewinnt (Skip-Spam): laufende sofort stoppen,
    // geplante verwerfen — sonst sprechen zwei Stimmen gleichzeitig
    clearTimeout(this.#ansageTimer);
    stoppeAnsagen();
    if (!this.ansagenAn) return;
    this.#ansageTimer = setTimeout(() => {
      if (this.#tot) return;
      const watt = this.run.zielFuer(b);
      ansageBlock(b.dauer, watt).then(ok => {
        // Bausteine fehlen (offline-Erstlauf o. Ä.): Live-TTS, aber nur
        // im Vordergrund — im Hintergrund stirbt SpeechSynthesis eh
        if (!ok && !document.hidden && !this.#tot) {
          const min = Math.round(b.dauer / 60 * 10) / 10;
          const minText = min < 1 ? '' : min === 1 ? '1 Minute, '
            : `${String(min).replace('.', ' Komma ')} Minuten, `;
          signal.sage(`${minText}${watt} Watt`);
        }
      });
    }, verzoegerung);
  }

  #bindProgramm() {
    const run = this.run;
    let prevWatt = null;
    run.addEventListener('block', e => {
      const tonGespielt = prevWatt !== null && this.tonAn;
      if (tonGespielt) signal.blockwechsel(e.detail.watt > prevWatt);
      prevWatt = e.detail.watt;
      // Erst der Wechselton, dann die Ansage — gleichzeitig maskiert
      // die (lautere) Stimme den Ton
      this.#planeAnsage(run.blocks[e.detail.index], tonGespielt ? 900 : 0);
    });
    // Der Konstruktor-#tick des Runs lief VOR dieser Registrierung —
    // das block-Event des ersten (bzw. aktuellen) Blocks kam nie an:
    // Ton-Referenz und Erst-Ansage von Hand nachziehen
    if (run.aktuellerBlock && run.index >= 0) {
      prevWatt = run.aktuellerBlock.watt;
      this.#planeAnsage(run.aktuellerBlock, 0);
    }
    run.addEventListener('countdown', () => { if (this.tonAn) signal.countdown(); });
    run.addEventListener('zeitsprung', () => {
      this.#cursorBlinkBis = Date.now() + 2000;   // Cursor kurz hervorheben
    });
    run.addEventListener('done', () => {
      if (this.tonAn) signal.fertig();
      clearTimeout(this.#ansageTimer);
      stoppeAnsagen();
      if (this.ansagenAn) {
        this.#ansageTimer = setTimeout(() => {
          if (this.#tot) return;
          ansageFertig().then(ok => {
            if (!ok && !document.hidden && !this.#tot) signal.sage('Programm beendet, gut gemacht');
          });
        }, this.tonAn ? 1100 : 0);
      }
      // Dauerhaft sichtbar machen, dass ab jetzt frei ausgefahren wird —
      // die Aufzeichnung läuft bewusst weiter, Beenden speichert
      this.#setzeZustand('ausfahren', 'Programm beendet — Ausfahren läuft, Beenden speichert', 'ok');
      this.render();
    });
  }

  // --- Geräte: Herzgurt und Lenker ------------------------------------------

  // Zustand eines Geräte-Chips aus dem Manager (dieselbe Quelle wie die
  // Home-Leiste): verbunden | teilweise | verbindet | gemerkt | fehlt.
  // Verlust während der Fahrt meldet die Statuszeile — auch im Werte-Fokus,
  // wo die Chips ausgeblendet sind.
  async #aktualisiereGeraet(rolle) {
    const btn = this.$(rolle === 'hr' ? '#btn-hr' : '#btn-click');
    let zustand;
    if (rolle === 'hr' && this.session.ftms.istDemo) zustand = 'verbunden';   // Demo: simulierter Gurt
    else {
      zustand = await geraeteManager.status(rolle);
      if (zustand === 'verbunden' && rolle === 'controller'
        && geraeteManager.clients(rolle).length < (await geraeteManager.gemerkte(rolle)).length) zustand = 'teilweise';
    }
    if (this.#tot) return;
    const vorher = this.#geraetZustand[rolle];
    this.#geraetZustand[rolle] = zustand;
    setzeChip(btn, zustand, `${ROLLEN_LABEL[rolle]}: ${ZUSTAND_TEXT[zustand]}`);
    const verloren = ['verbunden', 'teilweise'].includes(vorher) && ['gemerkt', 'fehlt'].includes(zustand);
    if (verloren) this.#setzeZustand('geraet', `${ROLLEN_LABEL[rolle]} getrennt — Chip tippen zum Neuverbinden`);
    else if (['verbunden', 'teilweise'].includes(zustand) && this.#zustaende.get('geraet')?.text.startsWith(ROLLEN_LABEL[rolle]))
      this.#setzeZustand('geraet', null);
  }

  #uebernehmeHR() {
    if (this.#tot) return;
    for (const hr of geraeteManager.clients('hr')) {
      if (this.#uebernommen.has(hr)) continue;
      this.#uebernommen.add(hr);
      this.session.attachHR(hr);
    }
    this.#aktualisiereGeraet('hr');
  }

  #uebernehmeCtrl() {
    if (this.#tot) return;
    const step = this.settings.wattSchritt;
    for (const ctrl of geraeteManager.clients('controller')) {
      if (this.#uebernommen.has(ctrl)) continue;
      this.#uebernommen.add(ctrl);
      // Fühlbares Feedback für jeden erkannten Druck: kurzer Tick + der
      // Zielwert blitzt auf — auch wenn die Taste (noch) keine Aktion hat
      this.#abo(ctrl, 'button', () => {
        if (this.tonAn) signal.tick();
        const ziel = this.$('#m-target');
        ziel.classList.remove('blitz');
        void ziel.offsetWidth;                 // Animation neu starten
        ziel.classList.add('blitz');
      });
      // Wiederholungen (Taste gehalten) tragen detail.wiederholung
      this.#abo(ctrl, 'plus', e => this.steuere(step, { wiederholung: !!e.detail?.wiederholung }));
      this.#abo(ctrl, 'minus', e => this.steuere(-step, { wiederholung: !!e.detail?.wiederholung }));
      this.#abo(ctrl, 'skip', () => this.#skip());
      this.#abo(ctrl, 'prev', () => this.#zurueck());
      this.#abo(ctrl, 'stopp', () => this.#stoppTaste());   // Panik-Sperre gilt auch hier
    }
    this.#aktualisiereGeraet('controller');
  }

  #bindGeraete() {
    // Manager-Änderungen (Trennung, Neu-Verbindung, laufender Aufbau) spiegeln
    this.#abo(geraeteManager, 'change', () => { this.#uebernehmeHR(); this.#uebernehmeCtrl(); });

    // Chip-Tap: verbunden → nur melden (kein Chooser über der Fahrt);
    // sonst verbinden (gemerkt) oder koppeln (Chooser) über den Manager
    for (const [rolle, id] of [['hr', '#btn-hr'], ['controller', '#btn-click']]) {
      const btn = this.$(id);
      const label = ROLLEN_LABEL[rolle];
      btn.onclick = async () => {
        const zustand = this.#geraetZustand[rolle];
        if (zustand === 'verbindet') return;
        if (zustand === 'verbunden') {
          const namen = rolle === 'hr' && this.session.ftms.istDemo ? 'Demo-Herzgurt'
            : geraeteManager.clients(rolle).map(c => c.deviceName ?? label).join(' + ');
          this.#info(`${namen} verbunden`);
          return;
        }
        if (!navigator.bluetooth) { this.#info('Kein Web Bluetooth in diesem Browser', 'err'); return; }
        try {
          const r = await geraeteManager.verbindeOderKoppel(rolle, {
            auswahl: Date.now() < this.#koppelFallback[rolle],
            vorAuswahl: grund => { const t = geraeteHinweis(label, { grund }); if (t) this.#info(t, 'err'); },
          });
          this.#koppelFallback[rolle] = 0;
          if (r.ergebnis === 'schlaeft') {
            // Zweiter Tap innerhalb von 30 s öffnet die Geräteauswahl —
            // so ist ein in der Fahrt verlorenes Pad wieder einfangbar
            this.#koppelFallback[rolle] = Date.now() + 30000;
            this.#info(`${label} nicht erreichbar — Gerät wecken oder Chip erneut tippen für die Geräteauswahl`, 'err', FEHLER_INFO_MS);
          }
        } catch (err) {
          this.#info(`${label}: ${err.message}`, 'err', FEHLER_INFO_MS);
        }
        rolle === 'hr' ? this.#uebernehmeHR() : this.#uebernehmeCtrl();
      };
    }
    // Schon verbundene Pool-Geräte sofort übernehmen; gemerkte best effort
    // nachverbinden (nicht in der Demo)
    this.#uebernehmeHR();
    this.#uebernehmeCtrl();
    if (!this.session.ftms.istDemo) {
      geraeteManager.verbinde('hr').then(() => this.#uebernehmeHR()).catch(() => {});
      geraeteManager.verbinde('controller').then(() => this.#uebernehmeCtrl()).catch(() => {});
    }
  }

  // --- Trainer ---------------------------------------------------------------

  // Chip und Statuszeile aus dem Verbindungszustand — EINE Stelle für alle
  // Trainer-Texte (Events und Watchdog überschrieben sich sonst gegenseitig)
  #zeigeTrainer() {
    const ok = this.session.ftms.connected;
    const zustand = ok ? 'verbunden' : this.#verbStatus === 'unerreichbar' ? 'fehler' : 'verbindet';
    setzeChip(this.$('#btn-trainer'), zustand, `Trainer: ${ZUSTAND_TEXT[zustand]}`);
    this.#setzeZustand('trainer', ok ? null
      : this.#verbStatus === 'unerreichbar' ? 'Trainer nicht erreichbar — Fahrt beenden und neu starten'
      : this.#verbStatus === 'lang' ? 'Trainer nicht erreichbar — eingeschaltet? Weiter wird versucht …'
      : 'Trainer getrennt — verbinde neu …');
  }

  #bindTrainer() {
    const ftms = this.session.ftms;
    this.#abo(ftms, 'connected', () => { this.#verbStatus = 'ok'; this.#zeigeTrainer(); });
    this.#abo(ftms, 'reconnected', () => { this.#verbStatus = 'ok'; this.#zeigeTrainer(); });
    this.#abo(ftms, 'disconnected', () => { this.#verbStatus = 'reconnect'; this.#zeigeTrainer(); });
    this.#abo(ftms, 'reconnectfehler', e => {
      if (e.detail.versuch >= 3 && this.#verbStatus !== 'unerreichbar') { this.#verbStatus = 'lang'; this.#zeigeTrainer(); }
    });
    this.#abo(ftms, 'aufgegeben', () => { this.#verbStatus = 'unerreichbar'; this.#zeigeTrainer(); });
    // Initialzustand ableiten statt aufs connected-Event zu warten — das ist
    // beim übernommenen Pool-Client längst gefeuert (Livetest: „verbinde …"
    // blieb die ganze Fahrt stehen)
    this.#zeigeTrainer();
    // Tap auf den Trainer-Chip löst mitten in der Fahrt nichts aus, er sagt
    // nur, was los ist
    this.$('#btn-trainer').onclick = () => {
      if (ftms.connected) this.#info(`${ftms.deviceName ?? 'Trainer'} verbunden`);
      else this.#zeigeStatus();
    };
    // Watchdog: erkennt still abgerissene GATT-Verbindungen (5-s-Takt)
    this.#watchdog = setInterval(() => {
      if (this.session.status === 'done') return;
      if (!ftms.connected && this.#verbStatus === 'ok') this.#verbStatus = 'reconnect';
      this.#zeigeTrainer();
    }, 5000);
  }

  // --- Schalter: Signaltöne, Sprachansagen -----------------------------------

  #bindSchalter() {
    // Zustand wandert in die Einstellungen zurück
    const schalter = (id, key, get, set) => {
      const btn = this.$(id);
      const zeige = () => { btn.classList.toggle('on', get()); btn.setAttribute('aria-pressed', String(get())); };
      zeige();
      btn.onclick = () => {
        set(!get());
        zeige();
        setSetting(key, get());
      };
    };
    schalter('#btn-ton', 'tonAn', () => this.tonAn, v => { this.tonAn = v; });
    schalter('#btn-sprich', 'sprachansagen', () => this.ansagenAn, v => {
      this.ansagenAn = v;
      if (!v) { clearTimeout(this.#ansageTimer); stoppeAnsagen(); }   // aus heißt sofort still
    });
  }

  // --- Bild-in-Bild (Experiment) ---------------------------------------------

  #pipDaten() {
    const s = this.session;
    const farbVar = zoneVar(s.smoothWatt, effektiveFtp(this.settings.ftp));
    return {
      watt: s.smoothWatt,
      ziel: s.target,
      rest: this.#zeitAnzeige().wert,
      rpm: Math.round(s.live.rpm || 0),
      hr: s.live.hr || 0,
      farbe: getComputedStyle(this.root).getPropertyValue(farbVar).trim() || '#e8f1f2',
    };
  }

  #bindPip() {
    // Nur anbieten, wenn der Browser es kann. arm() hält den Stream scharf
    // und registriert den Auto-PiP-Handler — Chrome kann das Fenster dann
    // selbst öffnen, wenn die App verlassen wird
    const pipBtn = this.$('#btn-pip');
    pipBtn.hidden = !PiP.verfuegbar();
    pipBtn.classList.remove('on');
    if (pipBtn.hidden) return;
    this.#pip = new PiP();
    this.#pip.onEnde = () => pipBtn.classList.remove('on');
    this.#pip.onAuto = () => pipBtn.classList.add('on');
    const daten = () => this.#pipDaten();
    this.#pip.arm(daten);
    pipBtn.onclick = async () => {
      try {
        const an = await this.#pip.toggle(daten);
        pipBtn.classList.toggle('on', an);
      } catch (err) { toastErr('Bild-in-Bild nicht möglich: ' + err.message); }
    };
  }

  // --- Bedienung: ±, Not-Stopp, Weiter, Beenden, Block-Aktionen ---------------

  // ± aus allen Quellen (Knöpfe, Halten, Lenker, Tastatur). Im Not-Stopp:
  // während der Panik-Sperre nichts; danach ist ± ein bewusstes Weiterfahren
  // mit angepasstem Ziel — sanft wie WEITER (50 % + Rampe), nie ein harter
  // Sprung auf volle Blocklast. Wiederholungen (gehaltene Taste) heben einen
  // Not-Stopp nie auf.
  steuere(delta, { wiederholung = false } = {}) {
    if (this.#beendet) return;
    const s = this.session;
    const imProgramm = this.run && !this.run.vorbei;
    if (s.gestoppt) {
      if (wiederholung || this.#stopGesperrt) return;
      if (imProgramm) this.run.adjust(delta, { anwenden: false });
      else s.zielVorStopp = Math.max(0, Math.min(this.settings.maxWatt, (s.zielVorStopp ?? 0) + delta));
      this.#weiter();
      return;
    }
    if (imProgramm) this.run.adjust(delta);
    else s.adjust(delta);
  }

  #zeigeStop() {
    const b = this.$('#btn-stop');
    b.textContent = 'STOPP';
    b.className = 'ctl ctl-stop';
    b.disabled = false;
  }

  #weiter() {
    // 50 % des Ziels sofort, dann sanfte Rampe (Recherche: harter
    // ERG-Wiedereinstieg ist die häufigste Beschwerde bei Resume)
    const ziel = this.run ? this.run.aktuellesZiel() : this.session.zielVorStopp ?? 0;
    if (this.run) this.session.weiterZu(ziel);
    else this.session.weiter();
    clearTimeout(this.#stopSperre);
    this.#stopGesperrt = false;
    this.#setzeZustand('stopp', null);
    this.#info(`Weiter — Ziel ${ziel} W`);
    this.#zeigeStop();
  }

  #stopp() {
    this.#halteAlleAn();                       // laufende ±-Wiederholung sofort beenden
    this.session.emergencyStop();
    this.#setzeZustand('stopp', 'Gestoppt — Ziel 0 W');
    const b = this.$('#btn-stop');
    b.textContent = 'GESTOPPT';
    b.disabled = true;
    this.#stopGesperrt = true;
    clearTimeout(this.#stopSperre);
    this.#stopSperre = setTimeout(() => {
      this.#stopGesperrt = false;
      if (!this.session.gestoppt) { this.#zeigeStop(); return; }
      b.textContent = 'WEITER';
      b.className = 'ctl ctl-weiter';
      b.disabled = false;
    }, STOPP_SPERRE_MS);
  }

  // STOPP-Knopf, Lenker-Taste und Leertaste: stoppt oder fährt weiter
  #stoppTaste() {
    if (this.#beendet || this.#stopGesperrt) return;
    if (this.session.gestoppt) this.#weiter();
    else this.#stopp();
  }

  #skip() {
    if (!this.run || this.run.vorbei) return;
    if (this.run.skip()) { this.render(); toast('Block übersprungen'); }
  }

  #zurueck() {
    if (!this.run || this.run.vorbei) return;
    const art = this.run.zurueck();
    if (art) { this.render(); toast(art === 'anfang' ? 'Blockanfang' : 'Vorheriger Block'); }
  }

  #verlaengern() {
    if (this.run?.verlaengern(30)) { this.render(); toast('Block +30 s'); }
  }

  // Halten = Wiederholen, mit eigenem Timer je Knopf: zwei Finger (+ und −
  // gleichzeitig) dürfen keine verwaiste Kette hinterlassen
  #halteAn(btn) {
    clearTimeout(this.#halten.get(btn));
    this.#halten.delete(btn);
  }

  #halteAlleAn() {
    for (const t of this.#halten.values()) clearTimeout(t);
    this.#halten.clear();
  }

  #bindHalten(btn, delta) {
    btn.onpointerdown = e => {
      e.preventDefault();
      this.#halteAn(btn);
      try { btn.setPointerCapture(e.pointerId); } catch { /* ältere Browser */ }
      this.steuere(delta);
      const tick = () => {
        // Not-Stopp beendet das Halten — die Kette hebt ihn nie auf
        if (this.session.gestoppt || this.#beendet) { this.#halteAn(btn); return; }
        this.steuere(delta, { wiederholung: true });
        this.#halten.set(btn, setTimeout(tick, HALTEN_TAKT_MS));
      };
      this.#halten.set(btn, setTimeout(tick, HALTEN_PAUSE_MS));
    };
    btn.onpointerup = btn.onpointercancel = btn.onlostpointercapture = () => this.#halteAn(btn);
  }

  #bindBedienung() {
    const step = this.settings.wattSchritt;
    // Block-Aktionen nur im Programm und nur solange es läuft
    for (const id of ['#btn-skip', '#btn-ext', '#btn-prev']) this.$(id).hidden = !this.run;
    this.$('#btn-skip').onclick = () => this.#skip();
    this.$('#btn-prev').onclick = () => this.#zurueck();
    this.$('#btn-ext').onclick = () => this.#verlaengern();
    this.#bindHalten(this.$('#btn-plus'), step);
    this.#bindHalten(this.$('#btn-minus'), -step);
    // Beschriftung folgt der eingestellten Schrittweite
    this.$('#btn-plus').textContent = `+${step}`;
    this.$('#btn-minus').textContent = `−${step}`;

    // Not-Stopp mit Panik-Schutz: nach dem Stopp bleibt der Slot 3 s
    // gesperrt („GESTOPPT"), erst dann wird er zum grünen WEITER —
    // ein Doppel-Tap in der Schrecksekunde reaktiviert nichts.
    this.#zeigeStop();
    this.$('#btn-stop').onclick = () => this.#stoppTaste();

    // Beenden zweistufig: erster Tap armiert („Sicher?", 3 s), erst der
    // zweite beendet — ein verrutschter Daumen killt keine Fahrt.
    const endBtn = this.$('#btn-end');
    const entarme = () => {
      clearTimeout(this.#endArm);
      endBtn.dataset.armiert = '';
      endBtn.textContent = 'Beenden';
      endBtn.classList.remove('armiert');
    };
    entarme();
    endBtn.onclick = () => {
      if (endBtn.dataset.armiert === '1') { entarme(); this.beenden(); return; }
      endBtn.dataset.armiert = '1';
      endBtn.textContent = 'Sicher?';
      endBtn.classList.add('armiert');
      clearTimeout(this.#endArm);
      this.#endArm = setTimeout(entarme, 3000);
    };

    // Tastatur (Laptop): Pfeile ±, Leertaste Stop
    this.#keys = e => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') this.steuere(step);
      else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') this.steuere(-step);
      else if (e.key === ' ') { e.preventDefault(); this.#stoppTaste(); }
    };
    addEventListener('keydown', this.#keys);
  }

  // Fahrt beenden und speichern — ohne Armierung (Zurück-Taste, zweiter Tap).
  // Auch wenn das Speichern scheitert, kommt der Nutzer aus dem Fahrbildschirm
  // heraus (sonst wäre Beenden tot und nur ein Reload hülfe).
  async beenden() {
    if (this.#beendet) return;
    this.#beendet = true;
    this.#halteAlleAn();
    this.session.akkuProStunde = beendeMessung();
    let gespeichert = true;
    try {
      await this.session.finish();
    } catch (err) {
      gespeichert = false;
      logError('session', 'Fahrt konnte nicht gespeichert werden', err.message);
      toastErr('Fahrt konnte nicht gespeichert werden: ' + err.message);
    }
    this.onEnd(this.session, gespeichert);
  }

  // --- Fokus-Modi ---------------------------------------------------------------

  // Fokus-Konzept (symmetrisch): Tap auf die Werte holt die WERTE in den
  // Fokus (Graph schrumpft zum Orientierungsstreifen), Tap auf den Graphen
  // holt den GRAPHEN in den Fokus (Werte kompakt, Chart groß und in voller
  // Detailstufe — inline, kein Overlay). Tap auf das bereits fokussierte
  // Element geht zurück zu Normal.
  #bindFokus() {
    const grid = this.$('.ride-grid');
    const setzeFokus = ziel => {
      const aktiv = grid.classList.contains(`fokus-${ziel}`);
      grid.classList.remove('fokus-werte', 'fokus-graph');
      if (!aktiv) grid.classList.add(`fokus-${ziel}`);
      this.render();                           // Canvas an neue Größe anpassen
    };
    // Großzügige Klickfläche: der gesamte obere Werte-Block toggelt den
    // Werte-Fokus (nicht nur die Watt-Zahl); Buttons bleiben ausgenommen
    this.$('.metrics').onclick = e => {
      if (e.target.closest('button')) return;
      setzeFokus('werte');
    };
    this.$('#live-chart').onclick = e => {
      // Totzonen: oberer Rand (knapp verfehlte Chips) und äußerste Ränder
      const rect = e.currentTarget.getBoundingClientRect();
      if (e.clientY - rect.top < 18) return;
      const relX = (e.clientX - rect.left) / rect.width;
      if (relX < 0.05 || relX > 0.95) return;
      setzeFokus('graph');
    };
  }

  // --- Anzeige ---------------------------------------------------------------------

  // Hauptzeit: Programm → Rest im Block bzw. Überzeit beim Ausfahren,
  // frei → Fahrzeit. Eine Stelle für Fahrbildschirm und Bild-in-Bild.
  #zeitAnzeige() {
    const s = this.session;
    if (!this.run) return { label: 'Zeit', wert: fmtTime(s.elapsed) };
    if (this.run.vorbei) return { label: 'Ausfahren', wert: '+' + fmtTime(this.run.ueberzeit(s.elapsed)) };
    return { label: 'Intervall Rest', wert: fmtTime(Math.max(0, this.run.restImBlock ?? 0)) };
  }

  render() {
    const s = this.session;
    const ftp = effektiveFtp(this.settings.ftp);   // Zonenfarben auch ohne hinterlegten FTP
    const watt = s.smoothWatt;
    const el = this.$('#m-watt');
    el.textContent = watt;
    el.style.color = zoneColor(watt, ftp);
    this.$('#m-target').textContent = s.target;
    const zeit = this.#zeitAnzeige();
    this.$('#m-time-label').textContent = zeit.label;
    this.$('#m-time').textContent = zeit.wert;
    if (this.run) {
      const vorbei = this.run.vorbei;
      this.$('#m-total-label').textContent = vorbei ? 'Fahrzeit' : 'Rest gesamt';
      this.$('#m-total-time').textContent = vorbei
        ? fmtTime(s.elapsed) : fmtTime(Math.max(0, this.run.restGesamt ?? this.run.total));
      // Block-Aktionen wirken nach Programmende nicht mehr
      for (const id of ['#btn-skip', '#btn-ext', '#btn-prev']) this.$(id).hidden = vorbei;
      const balken = this.$('#m-restbalken');
      const b = this.run.aktuellerBlock;
      balken.hidden = !b;
      if (b) {
        balken.firstElementChild.style.width =
          `${Math.max(0, Math.min(100, (this.run.restImBlock ?? 0) / b.dauer * 100))}%`;
        balken.style.setProperty('--balken-farbe', zoneColor(this.run.zielFuer(b), ftp));
      }
    }
    this.#renderRpm(s, ftp);
    this.$('#m-hr').textContent = s.live.hr || '–';
    this.$('#m-kj').textContent = Math.round(s.kj);
    this.$('#m-km').textContent = fmtKm(s.km);
    // Graph-Fokus = volle Detailstufe, sonst entscheidet die Chart-Höhe
    const detail = this.$('.ride-grid').classList.contains('fokus-graph') || null;
    if (this.run) this.chart.draw(this.run.blocks, this.run.total, s.samples, s.count, this.run.offset, ftp,
      t => this.run.programmZeit(t), Date.now() < this.#cursorBlinkBis, t => this.run.istPause(t), detail);
    else this.chart.draw(s.samples, s.count, s.target, ftp, detail);
  }

  // Kadenz-Vorgabe: zwo-Bereich des Blocks, sonst Zonen-Default aus der
  // Zielintensität (metrics.kadenzBereich). Unaufdringlich: die rpm-Zahl
  // färbt sich, gedämpft erst nach 5 s Abweichung, keine Töne.
  #rpmBereich(ftp) {
    if (!this.run) return kadenzBereich(this.session.target, ftp);
    const b = this.run.aktuellerBlock;
    if (!b) return null;                       // Programm vorbei: Ausfahren frei
    return b.rpm ?? kadenzBereich(this.run.zielFuer(b), ftp);
  }

  #renderRpm(s, ftp) {
    const el = this.$('#m-rpm');
    const rangeEl = this.$('#m-rpm-range');
    const rpm = s.live.rpm ? Math.round(s.live.rpm) : 0;
    el.textContent = rpm || '–';
    const range = rpm ? this.#rpmBereich(ftp) : null;
    rangeEl.hidden = !range;
    if (!range) { el.style.color = ''; this.#rpmAbweichSeit = 0; return; }
    rangeEl.textContent = range.high >= 140 ? `${range.low}+` : `${range.low}–${range.high}`;
    const drin = rpm >= range.low && rpm <= range.high;
    this.#rpmAbweichSeit = drin ? 0 : this.#rpmAbweichSeit + 1;
    el.style.color = drin ? 'var(--z2)' : this.#rpmAbweichSeit >= 5 ? 'var(--ink3)' : '';
  }

  destroy() {
    this.#tot = true;
    this.#beendet = true;
    clearTimeout(this.#ansageTimer);   // keine Geister-Ansage nach Fahrtende
    stoppeAnsagen();
    signal.audioSchlafen();            // Audiofokus zurück an die Musik-App
    this.#halteAlleAn();
    this.#abmelden?.();
    this.#led.destroy();
    this.#pip?.destroy();
    this.#pip = null;
    removeEventListener('keydown', this.#keys);
    clearInterval(this.#watchdog);
    clearTimeout(this.#stopSperre);
    clearTimeout(this.#statusTimer);
    clearTimeout(this.#endArm);
    // Nur die Verdrahtung dieser Fahrt lösen — die Verbindungen leben im
    // Pool weiter (Trennen macht der Nutzer über die Geräte-Leiste)
    for (const [t, typ, fn] of this.#abos) t.removeEventListener(typ, fn);
    this.#abos = [];
    this.#uebernommen.clear();
    this.$('.ride-grid').classList.remove('fokus-werte', 'fokus-graph');
  }
}
