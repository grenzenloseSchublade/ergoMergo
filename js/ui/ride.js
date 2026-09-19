// Fahrbildschirm: Livewerte, ±-Bedienung mit Tastenwiederholung, Not-Stopp.

import { LiveChart, WorkoutChart, zoneColor } from './chart.js';
import * as signal from '../signals.js';
import { HeartRate } from '../ble/hr.js';
import { ZwiftController } from '../ble/zwift-controller.js';
import { schnellverbinde, merkeGeraet } from '../ble/geraete.js';
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
    if (run) {
      let prevWatt = null;
      run.addEventListener('block', e => {
        if (prevWatt !== null) signal.blockwechsel(e.detail.watt > prevWatt);
        prevWatt = e.detail.watt;
        if (settings.sprachansagen) {
          const b = run.blocks[e.detail.index];
          const min = Math.round(b.dauer / 60 * 10) / 10;
          signal.sage(`${min >= 1 ? `${min} Minuten, ` : ''}${b.watt + run.offset} Watt`);
        }
      });
      run.addEventListener('countdown', () => signal.countdown());
      run.addEventListener('zeitsprung', () => {
        this.#cursorBlinkBis = Date.now() + 2000;   // Cursor kurz hervorheben
      });
      run.addEventListener('done', () => {
        signal.fertig();
        if (settings.sprachansagen) signal.sage('Programm beendet, gut gemacht');
      });
    }
    this.#bind();
    session.addEventListener('tick', () => this.render());
    session.addEventListener('target', () => this.render());
    session.ftms.addEventListener('connected', () => this.#status('verbunden', 'ok'));
    session.ftms.addEventListener('disconnected', () => this.#status('getrennt — verbinde neu …', 'err'));
    session.ftms.addEventListener('reconnected', () => this.#status('wieder verbunden', 'ok'));
    session.addEventListener('error', e => this.#status(e.detail, 'err'));
    this.render();
  }

  #repeat = null;
  #geraete = [];              // verbundene Zusatzgeräte, beim Beenden trennen

  #bind() {
    const step = this.settings.wattSchritt;
    const adjust = d => this.run ? this.run.adjust(d) : this.session.adjust(d);
    this.adjust = adjust;

    // Zusatzgeräte: Herzgurt und Zwift-Controller (Click/Ride).
    // onclick statt addEventListener: die Buttons überleben die Session,
    // Zuweisung überschreibt den Handler der vorherigen Fahrt.
    const chip = (id, connectFn) => {
      const btn = this.$(id);
      btn.classList.remove('on');
      btn.onclick = async () => {
        try { await connectFn(btn); btn.classList.add('on'); }
        catch (err) { if (err.name !== 'NotFoundError') this.#status(err.message, 'err'); }
      };
    };
    const verbindeHR = async (btn, device = null) => {
      const hr = new HeartRate();
      await hr.connect(device);
      this.#geraete.push({ client: hr, btn });
      this.session.attachHR(hr);
      merkeGeraet('hr', hr.device);
      hr.addEventListener('disconnected', () => btn.classList.remove('on'));
    };
    const verbindeCtrl = async (btn, device = null) => {
      const ctrl = new ZwiftController({
        plusBit: this.settings.controllerPlusBit,
        minusBit: this.settings.controllerMinusBit,
      });
      await ctrl.connect(device);
      this.#geraete.push({ client: ctrl, btn });
      ctrl.addEventListener('plus', () => adjust(step));
      ctrl.addEventListener('minus', () => adjust(-step));
      merkeGeraet('controller', ctrl.device);
      ctrl.addEventListener('disconnected', () => btn.classList.remove('on'));
    };
    chip('#btn-hr', verbindeHR);
    chip('#btn-click', verbindeCtrl);

    // Gemerkte Zusatzgeräte automatisch mitverbinden (best effort, ohne Chooser)
    const auto = async (rolle, id, fn) => {
      if (this.session.ftms.istDemo) return;   // Demo verbindet keine echten Geräte
      const device = await schnellverbinde(rolle);
      if (!device) return;
      const btn = this.$(id);
      try { await fn(btn, device); btn.classList.add('on'); }
      catch { /* Gerät nicht bereit — manueller Chip-Weg bleibt */ }
    };
    auto('hr', '#btn-hr', verbindeHR);
    auto('controller', '#btn-click', verbindeCtrl);

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
    // Large-Print-Umschalter (PM5-Muster): Tap auf die große Zahl
    this.$('#m-watt').onclick = () =>
      this.root.querySelector('.ride-grid').classList.toggle('large');
    // Tap auf den Graphen: vergrößerte Darstellung (Details wie Klammern/Achse)
    this.$('#live-chart').onclick = () => {
      this.root.querySelector('.ride-grid').classList.toggle('chartmax');
      this.render();
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
        this.#status('weiter', 'ok');
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
    this.$('#btn-end').onclick = async () => {
      this.$('#btn-end').onclick = null;      // Doppel-Tap = doppeltes finish verhindern
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
      for (const g of this.#geraete) {
        if (g.btn.classList.contains('on') && !g.client.device?.gatt.connected) {
          g.btn.classList.remove('on');
          toastErr(`${g.client.deviceName ?? 'Zusatzgerät'} getrennt`);
        }
      }
    }, 5000);
  }

  #keys = null;
  #watchdog = null;
  #stopSperre = null;
  #cursorBlinkBis = 0;

  #statusTimer = null;

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
      this.$('#m-time').textContent = fmtTime(Math.max(0, this.run.restImBlock ?? 0));
      this.$('#m-total-time').textContent = fmtTime(Math.max(0, this.run.restGesamt ?? this.run.total));
      const balken = this.$('#m-restbalken');
      const b = this.run.blocks[Math.max(0, this.run.index)];
      if (b) {
        balken.hidden = false;
        balken.firstElementChild.style.width =
          `${Math.max(0, Math.min(100, (this.run.restImBlock ?? 0) / b.dauer * 100))}%`;
        balken.style.setProperty('--balken-farbe', zoneColor(b.watt + this.run.offset, this.settings.ftp));
      }
    } else {
      this.$('#m-time').textContent = fmtTime(s.elapsed);
    }
    this.$('#m-rpm').textContent = s.live.rpm ? Math.round(s.live.rpm) : '–';
    this.$('#m-hr').textContent = s.live.hr || '–';
    this.$('#m-kj').textContent = Math.round(s.kj);
    if (this.run) this.chart.draw(this.run.blocks, this.run.total, s.samples, s.count, this.run.offset, this.settings.ftp,
      t => this.run.programmZeit(t), Date.now() < this.#cursorBlinkBis);
    else this.chart.draw(s.samples, s.count, s.target);
  }

  destroy() {
    removeEventListener('keydown', this.#keys);
    clearInterval(this.#watchdog);
    for (const g of this.#geraete) g.client.disconnect();
    this.#geraete = [];
    this.root.querySelector('.ride-grid').classList.remove('large', 'chartmax');
  }
}

export function fmtTime(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
           : `${m}:${String(s).padStart(2, '0')}`;
}
