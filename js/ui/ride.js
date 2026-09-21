// Fahrbildschirm: Livewerte, ±-Bedienung mit Tastenwiederholung, Not-Stopp.

import { LiveChart, WorkoutChart, zoneColor } from './chart.js';
import * as signal from '../signals.js';
import { geraeteManager } from '../ble/geraete.js';
import { initAnsagen, ansageBlock, ansageFertig } from '../ansagen.js';
import { PiP } from './pip.js';
import { setSetting } from '../storage.js';
import { beendeMessung } from '../energie.js';
import { toast, toastErr } from './toast.js';

export class RideScreen {
  constructor(root, session, settings, onEnd, run = null) {
    this.root = root;
    this.session = session;
    this.settings = settings;
    this.onEnd = onEnd;
    this.run = run;                          // ProgramRun oder null (Freies Fahren)
    this.chart = run ? new WorkoutChart(root.querySelector('#live-chart'))
                     : new LiveChart(root.querySelector('#live-chart'));
    this.$ = id => root.querySelector(id);
    this.$('#m-time-label').textContent = run ? 'Intervall Rest' : 'Zeit';
    this.$('#m-total').hidden = !run;
    this.tonAn = settings.tonAn !== false;
    this.ansagenAn = !!settings.sprachansagen;
    initAnsagen(signal.audioCtx());
    if (run) {
      let prevWatt = null;
      run.addEventListener('block', e => {
        if (prevWatt !== null && this.tonAn) signal.blockwechsel(e.detail.watt > prevWatt);
        prevWatt = e.detail.watt;
        if (this.ansagenAn) {
          const b = run.blocks[e.detail.index];
          ansageBlock(b.dauer, b.watt + run.offset).then(ok => {
            // Bausteine fehlen (offline-Erstlauf o. Ä.): Live-TTS, aber nur
            // im Vordergrund — im Hintergrund stirbt SpeechSynthesis eh
            if (!ok && !document.hidden) {
              const min = Math.round(b.dauer / 60 * 10) / 10;
              const minText = min < 1 ? '' : min === 1 ? '1 Minute, '
                : `${String(min).replace('.', ' Komma ')} Minuten, `;
              signal.sage(`${minText}${b.watt + run.offset} Watt`);
            }
          });
        }
      });
      run.addEventListener('countdown', () => { if (this.tonAn) signal.countdown(); });
      run.addEventListener('zeitsprung', () => {
        this.#cursorBlinkBis = Date.now() + 2000;   // Cursor kurz hervorheben
      });
      run.addEventListener('done', () => {
        if (this.tonAn) signal.fertig();
        if (this.ansagenAn) ansageFertig().then(ok => {
          if (!ok && !document.hidden) signal.sage('Programm beendet, gut gemacht');
        });
        // Dauerhaft sichtbar machen, dass ab jetzt frei ausgerollt wird —
        // die Aufzeichnung läuft bewusst weiter, Beenden speichert
        const el = this.$('#m-status');
        el.hidden = false;
        el.textContent = 'Programm beendet — Ausrollen läuft, Beenden speichert';
        el.className = 'status ok';
        clearTimeout(this.#statusTimer);       // kein Auto-Hide für diese Meldung
      });
    }
    this.#bind();
    // Chart-Resize (Rotation, Fokus-Wechsel, Fenster): sofort neu zeichnen
    // statt auf den nächsten Sekunden-Tick zu warten — sonst streckt CSS
    // die alte Bitmap kurz verzerrt (Standard-Muster: ResizeObserver + rAF)
    this.#resizeObs = new ResizeObserver(() => {
      cancelAnimationFrame(this.#resizeRaf);
      this.#resizeRaf = requestAnimationFrame(() => this.render());
    });
    this.#resizeObs.observe(root.querySelector('#live-chart'));
    // session stirbt mit der Fahrt (Abos dort unkritisch); ftms lebt im Pool
    // weiter — dessen Listener MÜSSEN in destroy() wieder abgebaut werden
    session.addEventListener('tick', () => { this.render(); this.#pip?.update(); });
    session.addEventListener('target', () => this.render());
    session.addEventListener('error', e => this.#status(e.detail, 'err'));
    this.#abo(session.ftms, 'connected', () => this.#status('verbunden', 'ok'));
    this.#abo(session.ftms, 'disconnected', () => this.#status('getrennt — verbinde neu …', 'err'));
    this.#abo(session.ftms, 'reconnected', () => this.#status('wieder verbunden', 'ok'));
    this.render();
  }

  #repeat = null;
  #pip = null;                // Bild-in-Bild-Instanz (lazy)
  #abos = [];                 // [target, typ, fn] — Listener auf langlebigen Pool-Clients
  #uebernommen = new Set();   // Client-Objekte, die diese Fahrt schon verdrahtet hat
  #tot = false;               // destroy() gelaufen — späte Auto-Connect-Promises ignorieren

  #abo(target, typ, fn) {
    target.addEventListener(typ, fn);
    this.#abos.push([target, typ, fn]);
  }

  #bind() {
    const step = this.settings.wattSchritt;
    const adjust = d => {
      this.session.gestoppt = false;          // ± = bewusstes Weiterfahren, auch im Programm
      this.run ? this.run.adjust(d) : this.session.adjust(d);
    };
    this.adjust = adjust;

    // Zusatzgeräte laufen über den GeraeteManager: Verbindungen leben im
    // Pool über Fahrten hinweg; hier wird nur verdrahtet (Abos je Fahrt).
    const uebernehmeHR = () => {
      if (this.#tot) return false;             // Fahrt schon beendet
      for (const hr of geraeteManager.clients('hr')) {
        if (this.#uebernommen.has(hr)) continue;
        this.#uebernommen.add(hr);
        this.session.attachHR(hr);
      }
      const on = geraeteManager.clients('hr').length > 0;
      this.$('#btn-hr').classList.toggle('on', on);
      return on;
    };
    const uebernehmeCtrl = () => {
      if (this.#tot) return false;             // Fahrt schon beendet
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
        this.#abo(ctrl, 'plus', () => adjust(step));
        this.#abo(ctrl, 'minus', () => adjust(-step));
        this.#abo(ctrl, 'skip', () => this.$('#btn-skip').hidden || this.$('#btn-skip').click());
        this.#abo(ctrl, 'prev', () => this.$('#btn-prev').hidden || this.$('#btn-prev').click());
        this.#abo(ctrl, 'stopp', () => {
          const b = this.$('#btn-stop');
          if (!b.disabled) b.click();            // GESTOPPT-Sperre gilt auch hier
        });
      }
      const on = geraeteManager.clients('controller').length > 0;
      this.$('#btn-click').classList.toggle('on', on);
      return on;
    };
    const uebernehme = { hr: uebernehmeHR, controller: uebernehmeCtrl };

    // Manager-Änderungen (Trennung, Neu-Verbindung) in Chips spiegeln
    this.#abo(geraeteManager, 'change', () => {
      this.$('#btn-hr').classList.toggle('on', geraeteManager.clients('hr').length > 0);
      this.$('#btn-click').classList.toggle('on', geraeteManager.clients('controller').length > 0);
      uebernehmeHR(); uebernehmeCtrl();          // frisch verbundene direkt verdrahten
    });

    // Chip-Tap: verbinden (gemerkt) oder koppeln (Chooser), dann übernehmen
    const chip = (id, rolle) => {
      const btn = this.$(id);
      btn.classList.remove('on');
      btn.onclick = async () => {
        try {
          // Chooser nur mit frischer Geste (nichts gemerkt) — nach einem
          // langen Verbindungsversuch wäre die Aktivierung verbraucht
          if ((await geraeteManager.gemerkte(rolle)).length === 0) {
            await geraeteManager.koppel(rolle);
          } else {
            const n = await geraeteManager.verbinde(rolle);
            if (!n) {
              this.#status(`${rolle === 'hr' ? 'Herzgurt' : 'Controller'} nicht erreichbar — Gerät wach?`, 'err');
              return;
            }
          }
          uebernehme[rolle]();
        } catch (err) {
          if (err.name !== 'NotFoundError') this.#status(err.message, 'err');
        }
      };
    };
    chip('#btn-hr', 'hr');
    chip('#btn-click', 'controller');

    // Icon-Chips: Signaltöne und Sprachansagen direkt im Fahrbildschirm
    // umschalten (Zustand wandert in die Einstellungen zurück)
    const toggleChip = (id, key, get, set) => {
      const btn = this.$(id);
      btn.classList.toggle('on', get());
      btn.onclick = () => {
        set(!get());
        btn.classList.toggle('on', get());
        setSetting(key, get());
      };
    };
    toggleChip('#btn-ton', 'tonAn', () => this.tonAn, v => { this.tonAn = v; });
    toggleChip('#btn-sprich', 'sprachansagen', () => this.ansagenAn, v => { this.ansagenAn = v; });

    // Bild-in-Bild (Experiment): nur anbieten, wenn der Browser es kann.
    // arm() hält den Stream scharf und registriert den Auto-PiP-Handler —
    // Chrome kann das Fenster dann selbst öffnen, wenn die App verlassen wird
    const pipBtn = this.$('#btn-pip');
    pipBtn.hidden = !PiP.verfuegbar();
    pipBtn.classList.remove('on');
    if (!pipBtn.hidden) {
      this.#pip ??= new PiP();
      this.#pip.onEnde = () => pipBtn.classList.remove('on');
      this.#pip.onAuto = () => pipBtn.classList.add('on');
      const pipDaten = () => ({
        watt: this.session.smoothWatt,
        ziel: this.session.target,
        rest: this.run ? fmtTime(Math.max(0, this.run.restImBlock ?? 0)) : fmtTime(this.session.elapsed),
        rpm: Math.round(this.session.live.rpm || 0),
        hr: this.session.live.hr || 0,
        farbe: getComputedStyle(this.root).getPropertyValue(
          zoneColor(this.session.smoothWatt, this.settings.ftp).slice(4, -1)).trim() || '#e8f1f2',
      });
      this.#pip.arm(pipDaten);
      pipBtn.onclick = async () => {
        try {
          const an = await this.#pip.toggle(pipDaten);
          pipBtn.classList.toggle('on', an);
        } catch (err) { toastErr('PiP nicht möglich: ' + err.message); }
      };
    }

    // Auto: schon verbundene Pool-Geräte sofort übernehmen; gemerkte
    // best effort nachverbinden (nicht in der Demo)
    uebernehmeHR();
    uebernehmeCtrl();
    if (!this.session.ftms.istDemo) {
      geraeteManager.verbinde('hr').then(uebernehmeHR).catch(() => {});
      geraeteManager.verbinde('controller').then(uebernehmeCtrl).catch(() => {});
    }

    // Intervallsteuerung nur im Programm-Modus
    this.$('#btn-skip').hidden = this.$('#btn-ext').hidden = this.$('#btn-prev').hidden = !this.run;
    this.$('#btn-skip').onclick = () => { this.run?.skip(); this.render(); toast('Block übersprungen'); };
    this.$('#btn-prev').onclick = () => {
      const art = this.run?.zurueck();
      if (art) { this.render(); toast(art === 'anfang' ? 'Blockanfang' : 'Vorheriger Block'); }
    };
    this.$('#btn-ext').onclick = () => { this.run?.verlaengern(30); this.render(); toast('Block +30 s'); };
    // Alle Ride-Buttons per Handler-ZUWEISUNG statt addEventListener:
    // die DOM-Elemente überleben die Session — Zuweisung überschreibt die
    // Handler der vorherigen Fahrt, sonst feuert jeder Tap mehrfach.
    const hold = (btn, delta) => {
      const fire = () => adjust(delta);
      btn.onpointerdown = e => {
        e.preventDefault();
        fire();
        const tick = () => { fire(); this.#repeat = setTimeout(tick, 300); };
        this.#repeat = setTimeout(tick, 500);
      };
      btn.onpointerup = btn.onpointercancel = btn.onpointerleave =
        () => clearTimeout(this.#repeat);
    };
    hold(this.$('#btn-plus'), step);
    hold(this.$('#btn-minus'), -step);
    // Beschriftung folgt der eingestellten Schrittweite
    this.$('#btn-plus').textContent = `+${step}`;
    this.$('#btn-minus').textContent = `−${step}`;
    // Fokus-Konzept (symmetrisch): Tap auf die Watt-Zahl holt die WERTE in
    // den Fokus (Graph schrumpft zum Orientierungsstreifen), Tap auf den
    // Graphen holt den GRAPHEN in den Fokus (Werte kompakt, Chart groß und
    // in voller Detailstufe — inline, kein Overlay). Tap auf das bereits
    // fokussierte Element geht zurück zu Normal.
    const grid = this.root.querySelector('.ride-grid');
    const setzeFokus = ziel => {
      const aktiv = grid.classList.contains(`fokus-${ziel}`);
      grid.classList.remove('fokus-werte', 'fokus-graph');
      if (!aktiv) grid.classList.add(`fokus-${ziel}`);
      this.render();                           // Canvas an neue Größe anpassen
    };
    // Großzügige Klickfläche: der gesamte obere Werte-Block toggelt den
    // Werte-Fokus (nicht nur die Watt-Zahl); Buttons blieben ausgenommen
    this.root.querySelector('.metrics').onclick = e => {
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
    // Not-Stopp mit Panik-Schutz: nach dem Stopp bleibt der Slot 3 s
    // gesperrt („GESTOPPT"), erst dann wird er zum grünen WEITER —
    // ein Doppel-Tap in der Schrecksekunde reaktiviert nichts.
    const stopBtn = this.$('#btn-stop');
    const zeigeStop = () => {
      stopBtn.textContent = 'STOPP';
      stopBtn.className = 'ctl ctl-stop';
      stopBtn.disabled = false;
    };
    zeigeStop();
    stopBtn.onclick = () => {
      if (this.session.gestoppt && stopBtn.classList.contains('ctl-weiter')) {
        // WEITER: 50 % des Ziels sofort, dann sanfte Rampe (Recherche: harter
        // ERG-Wiedereinstieg ist die häufigste Beschwerde bei Resume)
        if (this.run) this.session.weiterZu(this.run.aktuellesZiel());
        else this.session.weiter();
        this.#status(`weiter — Ziel ${this.run ? this.run.aktuellesZiel() : this.session.zielVorStopp} W`, 'ok');
        zeigeStop();
        return;
      }
      this.session.emergencyStop();
      this.#status('gestoppt — Ziel 0 W', 'err');
      stopBtn.textContent = 'GESTOPPT';
      stopBtn.disabled = true;
      clearTimeout(this.#stopSperre);
      this.#stopSperre = setTimeout(() => {
        if (!this.session.gestoppt) { zeigeStop(); return; }
        stopBtn.textContent = 'WEITER';
        stopBtn.className = 'ctl ctl-weiter';
        stopBtn.disabled = false;
      }, 3000);
    };
    // ±-Tap beendet den Stopp-Zustand ebenfalls → Button zurück auf STOP
    this.session.addEventListener('target', () => {
      if (!this.session.gestoppt && stopBtn.classList.contains('ctl-weiter')) zeigeStop();
    });
    // Beenden zweistufig: erster Tap armiert ("Wirklich beenden?", 3 s),
    // erst der zweite beendet — ein verrutschter Daumen killt keine Fahrt.
    const endBtn = this.$('#btn-end');
    endBtn.textContent = 'Beenden';
    endBtn.onclick = async () => {
      if (endBtn.dataset.armiert !== '1') {
        endBtn.dataset.armiert = '1';
        endBtn.textContent = 'Sicher?';
        endBtn.classList.add('armiert');
        clearTimeout(this.#endArm);
        this.#endArm = setTimeout(() => {
          endBtn.dataset.armiert = '';
          endBtn.textContent = 'Beenden';
          endBtn.classList.remove('armiert');
        }, 3000);
        return;
      }
      clearTimeout(this.#endArm);
      endBtn.onclick = null;                  // doppeltes finish verhindern
      endBtn.dataset.armiert = '';
      endBtn.textContent = 'Beenden';
      endBtn.classList.remove('armiert');
      this.session.akkuProStunde = beendeMessung();
      await this.session.finish();
      this.onEnd(this.session);
    };
    // Tastatur (Laptop): Pfeile ±, Leertaste Stop
    this.#keys = e => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') adjust(step);
      else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') adjust(-step);
      else if (e.key === ' ') { e.preventDefault(); this.$('#btn-stop').click(); }
    };
    addEventListener('keydown', this.#keys);

    // Geräte-Watchdog: erkennt still abgerissene GATT-Verbindungen und hält
    // die Chip-/Statusanzeige ehrlich (5-s-Takt)
    this.#watchdog = setInterval(() => {
      if (!this.session.ftms.connected && this.session.status !== 'done')
        this.#status('Trainer getrennt — verbinde neu …', 'err');
    }, 5000);
  }

  #keys = null;
  #watchdog = null;
  #stopSperre = null;
  #endArm = null;
  #cursorBlinkBis = 0;
  #statusTimer = null;
  #resizeObs = null;
  #resizeRaf = 0;

  // Erfolgsmeldungen verschwinden nach kurzer Zeit — dauerhaft sichtbar
  // bleiben nur Fehler (weniger Rauschen in der Sekundärzeile)
  #status(text, cls = '') {
    const el = this.$('#m-status');
    el.hidden = false;
    el.textContent = text;
    el.className = 'status ' + cls;
    clearTimeout(this.#statusTimer);
    if (cls === 'ok') {
      this.#statusTimer = setTimeout(() => { el.hidden = true; }, 4000);
    }
  }

  render() {
    const s = this.session;
    const watt = s.smoothWatt;
    const el = this.$('#m-watt');
    el.textContent = watt;
    el.style.color = zoneColor(watt, this.settings.ftp);
    this.$('#m-target').textContent = s.target;
    if (this.run) {
      this.$('#m-time').textContent = this.run.index === -2
        ? '–:–' : fmtTime(Math.max(0, this.run.restImBlock ?? 0));
      this.$('#m-total-time').textContent = fmtTime(Math.max(0, this.run.restGesamt ?? this.run.total));
      const balken = this.$('#m-restbalken');
      if (this.run.index === -2) balken.hidden = true;
      const b = this.run.index === -2 ? null : this.run.blocks[Math.max(0, this.run.index)];
      if (b) {
        balken.hidden = false;
        balken.firstElementChild.style.width =
          `${Math.max(0, Math.min(100, (this.run.restImBlock ?? 0) / b.dauer * 100))}%`;
        balken.style.setProperty('--balken-farbe', zoneColor(b.watt + this.run.offset, this.settings.ftp));
      }
    } else {
      this.$('#m-time').textContent = fmtTime(s.elapsed);
    }
    this.#renderRpm(s);
    this.$('#m-hr').textContent = s.live.hr || '–';
    this.$('#m-kj').textContent = Math.round(s.kj);
    if (this.run) this.chart.draw(this.run.blocks, this.run.total, s.samples, s.count, this.run.offset, this.settings.ftp,
      t => this.run.programmZeit(t), Date.now() < this.#cursorBlinkBis, t => this.run.istPause(t));
    else this.chart.draw(s.samples, s.count, s.target);
  }

  // Kadenz-Vorgabe: zwo-Bereich des Blocks, sonst Zonen-Default aus der
  // Zielintensität (Konsens TrainerRoad/Rouvy: Z2–Schwelle 85–95,
  // VO2max 100–110, Sprint 110+; Recovery frei). Unaufdringlich: die
  // rpm-Zahl färbt sich, gedämpft erst nach 5 s Abweichung, keine Töne.
  #rpmAbweichSeit = 0;

  #rpmRange() {
    if (this.run?.index === -2) return null;   // Programm vorbei: Ausrollen frei
    const b = this.run?.blocks[Math.max(0, this.run.index)];
    if (b?.rpm) return b.rpm;
    const ftp = this.settings.ftp;
    if (!ftp) return null;
    const ziel = this.run ? (b ? b.watt + this.run.offset : 0) : this.session.target;
    const pct = ziel / ftp;
    if (pct < 0.6) return null;                    // Recovery: Kadenz frei
    if (pct <= 1.05) return { low: 85, high: 95 };
    if (pct <= 1.3) return { low: 100, high: 110 };
    return { low: 110, high: 140 };
  }

  #renderRpm(s) {
    const el = this.$('#m-rpm');
    const rangeEl = this.$('#m-rpm-range');
    const rpm = s.live.rpm ? Math.round(s.live.rpm) : 0;
    el.textContent = rpm || '–';
    const range = rpm ? this.#rpmRange() : null;
    rangeEl.hidden = !range;
    if (!range) { el.style.color = ''; this.#rpmAbweichSeit = 0; return; }
    rangeEl.textContent = range.high >= 140 ? `${range.low}+` : `${range.low}–${range.high}`;
    const drin = rpm >= range.low && rpm <= range.high;
    this.#rpmAbweichSeit = drin ? 0 : this.#rpmAbweichSeit + 1;
    el.style.color = drin ? 'var(--z2)' : this.#rpmAbweichSeit >= 5 ? 'var(--ink3)' : '';
  }

  destroy() {
    this.#tot = true;
    this.#resizeObs?.disconnect();
    cancelAnimationFrame(this.#resizeRaf);
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
    this.root.querySelector('.ride-grid').classList.remove('fokus-werte', 'fokus-graph');
  }
}

export function fmtTime(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
           : `${m}:${String(s).padStart(2, '0')}`;
}
