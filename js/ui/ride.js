// Fahrbildschirm: Livewerte, ±-Bedienung mit Tastenwiederholung, Not-Stopp,
// Statusleiste (LED-Zeile + Geräte-Symbole), Optionen-Panel, Fokus-Modi.
// Die DOM-Elemente überleben die Fahrt (ein Fahrbildschirm für alle
// Fahrten) — deshalb setzt der Konstruktor alles Sichtbare zurück und
// Handler werden ZUGEWIESEN statt angehängt.

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
import { oeffneModal } from '../navigation.js';
import { toastErr } from './toast.js';   // nur fürs Fahrtende — danach ist die LED-Zeile weg

import { geraeteHinweis } from './geraete-leiste.js';
import { LedZeile } from './led-zeile.js';

const STOPP_SPERRE_MS = 3000;     // Panik-Schutz nach Not-Stopp
const HALTEN_PAUSE_MS = 500;      // ±-Knopf halten: erste Wiederholung
const HALTEN_TAKT_MS = 300;       //   … danach im Takt
// Statuszeile (LED-Laufschrift): dauerhafte Zustände nach Priorität laufen,
// solange sie bestehen. Einmalige Meldungen laufen zweimal durch und
// überblenden den Zustand so lange — grüne Infos entfallen, solange ein
// Problem (rot) ansteht: Probleme gehen immer vor.
const STATUS_PRIO = ['trainer', 'stopp', 'geraet', 'ausfahren'];


const ROLLEN_LABEL = { trainer: 'Trainer', hr: 'Herzgurt', controller: 'Lenker' };
// Klartext der Geräte-Zeilen im Panel (verbunden: Gerätename statt Text)
const ZEILEN_TEXT = { verbindet: 'verbindet …', gemerkt: 'nicht verbunden — tippen zum Verbinden',
  fehlt: 'nicht gekoppelt — tippen zum Koppeln', fehler: 'nicht erreichbar — Fahrt beenden und neu starten' };

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
    this.#bindOptionen();
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
    session.addEventListener('error', e => this.#info(e.detail, 'err'));
    // Startmeldung: zeigt, womit gefahren wird — und dass die Tafel lebt
    if (session.ftms.connected) this.#info(`${session.ftms.deviceName ?? 'Trainer'} verbunden`);
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
  #koppelFallback = { hr: 0, controller: 0 };   // Zeitfenster: nächster Symbol-Tap → Chooser
  #geraetZustand = { trainer: null, hr: null, controller: null };
  #cursorBlinkBis = 0;
  #zustaende = new Map();     // Statuszeile: art → { text, cls }
  #infoMeldung = null;        // einmalige Meldung { text, cls, neu }
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
    this.$('#m-total-label').textContent = 'gesamt';
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

  // Einmalige Meldung (läuft zweimal durch). Öffentlich als melde() für main.js.
  // Ist das Panel offen, steht sie zusätzlich dort (die LED kann darunter liegen).
  #info(text, cls = 'ok') {
    if (this.$('#dlg-fahrt-optionen').open) {
      const h = this.$('#fo-hinweis');
      h.textContent = text;
      h.className = `fo-hinweis ${cls}`;
    }
    this.#infoMeldung = { text, cls, neu: true };
    this.#zeigeStatus();
  }

  melde(text, cls = 'ok') { this.#info(text, cls); }

  #zeigeStatus() {
    // Die Mulde bleibt immer stehen (feste Höhe) — nur die LED-Schrift wechselt
    const zustand = STATUS_PRIO.map(a => this.#zustaende.get(a)).find(Boolean);
    let m = this.#infoMeldung;
    if (m && m.cls !== 'err' && zustand?.cls === 'err') { m = null; this.#infoMeldung = null; }
    if (m) {
      const neu = m.neu;
      m.neu = false;
      this.#led.setze(m.text, m.cls, {
        neu,
        fertig: () => { if (this.#infoMeldung === m) { this.#infoMeldung = null; this.#zeigeStatus(); } },
      });
      return;
    }
    this.#led.setze(zustand?.text ?? '', zustand?.cls ?? '', { durchlaeufe: Infinity });
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

  // Zustand eines Geräte-Symbols aus dem Manager (dieselbe Quelle wie die
  // Home-Leiste): verbunden | teilweise | verbindet | gemerkt | fehlt.
  // Die Symbole stehen neben der LED-Zeile und bleiben in jedem Fokus-Modus
  // sichtbar; einen Verlust meldet zusätzlich die LED-Zeile im Klartext.
  // Zustand eines Geräts an EINER Stelle für Symbol oben links und
  // Panel-Zeile (beide tragen data-geraet): Punkt/Farbe per CSS, Klartext
  // in der Zeile, aria-label an beiden
  #zeigeGeraet(rolle, zustand) {
    this.#geraetZustand[rolle] = zustand;
    const verbunden = ['verbunden', 'teilweise'].includes(zustand);
    const text = verbunden
      ? `${this.#geraeteNamen(rolle)} · ${zustand === 'teilweise' ? 'nicht alle Pads — tippen' : 'verbunden'}`
      : rolle === 'trainer' && zustand === 'verbindet' ? 'verbindet neu …' : ZEILEN_TEXT[zustand];
    for (const el of this.root.querySelectorAll(`[data-geraet="${rolle}"]`)) {
      el.dataset.zustand = zustand;
      el.setAttribute('aria-label', `${ROLLEN_LABEL[rolle]}: ${text}`);
      const z = el.querySelector('.fo-zustand');
      if (z) z.textContent = text;
    }
  }

  #geraeteNamen(rolle) {
    if (rolle === 'trainer') return this.session.ftms.deviceName ?? 'Trainer';
    if (rolle === 'hr' && this.session.ftms.istDemo) return 'Demo-Herzgurt';
    return geraeteManager.clients(rolle).map(c => c.deviceName ?? ROLLEN_LABEL[rolle]).join(' + ') || ROLLEN_LABEL[rolle];
  }

  async #aktualisiereGeraet(rolle) {
    let zustand;
    if (rolle === 'hr' && this.session.ftms.istDemo) zustand = 'verbunden';   // Demo: simulierter Gurt
    else {
      zustand = await geraeteManager.status(rolle);
      if (zustand === 'verbunden' && rolle === 'controller'
        && geraeteManager.clients(rolle).length < (await geraeteManager.gemerkte(rolle)).length) zustand = 'teilweise';
    }
    if (this.#tot) return;
    const vorher = this.#geraetZustand[rolle];
    this.#zeigeGeraet(rolle, zustand);
    const verloren = ['verbunden', 'teilweise'].includes(vorher) && ['gemerkt', 'fehlt'].includes(zustand);
    // Neu verbunden (nicht schon beim Fahrtstart): kurz bestätigen
    if (vorher && !['verbunden', 'teilweise'].includes(vorher) && zustand === 'verbunden')
      this.#info(`${ROLLEN_LABEL[rolle]} verbunden`);
    if (verloren) this.#setzeZustand('geraet', `${ROLLEN_LABEL[rolle]} getrennt — Symbol oben links tippen`);
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

    // Tap auf Symbol oder Panel-Zeile: verbunden → nur melden (kein Chooser
    // über der Fahrt); sonst verbinden (gemerkt) oder koppeln (Chooser)
    for (const rolle of ['hr', 'controller']) {
      const label = ROLLEN_LABEL[rolle];
      const tipp = async () => {
        const zustand = this.#geraetZustand[rolle];
        if (zustand === 'verbindet') return;
        if (zustand === 'verbunden') { this.#info(`${this.#geraeteNamen(rolle)} verbunden`); return; }
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
            this.#info(`${label} nicht erreichbar — Gerät wecken und erneut tippen`, 'err');
          }
        } catch (err) {
          this.#info(`${label}: ${err.message}`, 'err');
        }
        rolle === 'hr' ? this.#uebernehmeHR() : this.#uebernehmeCtrl();
      };
      for (const el of this.root.querySelectorAll(`[data-geraet="${rolle}"]`)) el.onclick = tipp;
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

  // Symbol und Statuszeile aus dem Verbindungszustand — EINE Stelle für alle
  // Trainer-Texte (Events und Watchdog überschrieben sich sonst gegenseitig)
  #zeigeTrainer() {
    const ok = this.session.ftms.connected;
    const zustand = ok ? 'verbunden' : this.#verbStatus === 'unerreichbar' ? 'fehler' : 'verbindet';
    this.#zeigeGeraet('trainer', zustand);
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
    // Tap auf Trainer-Symbol oder -Zeile löst mitten in der Fahrt nichts aus,
    // er sagt nur, was los ist
    const tipp = () => {
      if (ftms.connected) this.#info(`${ftms.deviceName ?? 'Trainer'} verbunden`);
      else this.#info(this.#zustaende.get('trainer')?.text ?? 'Trainer getrennt', 'err');
    };
    for (const el of this.root.querySelectorAll('[data-geraet="trainer"]')) el.onclick = tipp;
    // Watchdog: erkennt still abgerissene GATT-Verbindungen (5-s-Takt)
    this.#watchdog = setInterval(() => {
      if (this.session.status === 'done') return;
      if (!ftms.connected && this.#verbStatus === 'ok') this.#verbStatus = 'reconnect';
      this.#zeigeTrainer();
    }, 5000);
  }

  // --- Panel „Geräte und Töne" hinter „⋯" oben rechts ------------------------

  // Geräte im Klartext (Name, Zustand, was ein Tipp bewirkt) und die selten
  // gebrauchten Schalter. Das Panel ist NICHT modal: STOPP und ± bleiben
  // daneben sofort bedienbar (ein Tipp daneben schließt es UND wirkt).
  // History-Eintrag: Zurück schließt es; Esc ebenso.
  #bindOptionen() {
    const dlg = this.$('#dlg-fahrt-optionen');
    const mehr = this.$('#btn-mehr');
    // Lage an „⋯" ausrichten: rechte Kante bündig, knapp darunter; passt es
    // unten nicht, darüber
    const platziere = () => {
      const c = mehr.getBoundingClientRect();
      const d = dlg.getBoundingClientRect();
      const rand = 8;
      const links = Math.max(rand, Math.min(innerWidth - d.width - rand, c.right - d.width));
      // „⋯" sitzt immer oben: Panel darunter, zu Hohes scrollt in sich
      const oben = Math.round(c.bottom + rand / 2);
      dlg.style.left = `${Math.round(links)}px`;
      dlg.style.top = `${oben}px`;
      dlg.style.maxHeight = `${innerHeight - oben - rand}px`;
    };
    const draussen = e => { if (!dlg.contains(e.target) && !mehr.contains(e.target)) dlg.close(); };
    const esc = e => { if (e.key === 'Escape') dlg.close(); };
    mehr.onclick = () => {
      if (dlg.open) { dlg.close(); return; }
      this.$('#fo-hinweis').textContent = '';   // alte Rückmeldung nicht wieder zeigen
      oeffneModal(dlg, 'fahrt-optionen', { modal: false });
      mehr.setAttribute('aria-expanded', 'true');
      platziere();
      addEventListener('resize', platziere);
      document.addEventListener('pointerdown', draussen, true);
      document.addEventListener('keydown', esc);
      dlg.addEventListener('close', () => {
        mehr.setAttribute('aria-expanded', 'false');
        removeEventListener('resize', platziere);
        document.removeEventListener('pointerdown', draussen, true);
        document.removeEventListener('keydown', esc);
      }, { once: true });
    };

    // Zustand wandert in die Einstellungen zurück
    const schalter = (id, key, get, set) => {
      const box = this.$(id);
      box.checked = get();
      box.onchange = () => { set(box.checked); setSetting(key, box.checked); };
    };
    schalter('#opt-ton', 'tonAn', () => this.tonAn, v => { this.tonAn = v; });
    schalter('#opt-sprache', 'sprachansagen', () => this.ansagenAn, v => {
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
    // Knopf im Panel (Aktion, keine Einstellung); fehlt, wo es kein PiP gibt
    const knopf = this.$('#opt-pip');
    const titel = this.$('#opt-pip-titel');
    const zeige = an => { titel.textContent = an ? 'Bild-in-Bild schließen' : 'Bild-in-Bild öffnen'; };
    knopf.hidden = !PiP.verfuegbar();
    zeige(false);
    if (knopf.hidden) return;
    this.#pip = new PiP();
    this.#pip.onEnde = () => zeige(false);
    this.#pip.onAuto = () => zeige(true);
    const daten = () => this.#pipDaten();
    this.#pip.arm(daten);
    // Der Tipp ist die Nutzergeste, die requestPictureInPicture braucht
    knopf.onclick = async () => {
      try {
        const an = await this.#pip.toggle(daten);
        zeige(an);
        if (an) this.$('#dlg-fahrt-optionen').close();   // das Fenster ist jetzt da
      } catch (err) {
        zeige(!!this.#pip.aktiv);
        this.#info('Bild-in-Bild nicht möglich: ' + err.message, 'err');
      }
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
    if (this.run.skip()) { this.render(); this.#info('Block übersprungen'); }
  }

  #zurueck() {
    if (!this.run || this.run.vorbei) return;
    const art = this.run.zurueck();
    if (art) { this.render(); this.#info(art === 'anfang' ? 'Blockanfang' : 'Vorheriger Block'); }
  }

  #verlaengern() {
    if (this.run?.verlaengern(30)) { this.render(); this.#info('Block +30 s'); }
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
      // Tasten in einem offenen Panel (Leertaste auf einem Schalter) gehören
      // dem Panel — sonst löste die Leertaste zugleich STOPP aus
      if (e.target.closest?.('dialog')) return;
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
      this.$('#m-total-label').textContent = vorbei ? 'Fahrzeit' : 'gesamt';
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
    const optionen = this.$('#dlg-fahrt-optionen');
    if (optionen.open) optionen.close();
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
    clearTimeout(this.#endArm);
    // Nur die Verdrahtung dieser Fahrt lösen — die Verbindungen leben im
    // Pool weiter (Trennen macht der Nutzer über die Geräte-Leiste)
    for (const [t, typ, fn] of this.#abos) t.removeEventListener(typ, fn);
    this.#abos = [];
    this.#uebernommen.clear();
    this.$('.ride-grid').classList.remove('fokus-werte', 'fokus-graph');
  }
}
