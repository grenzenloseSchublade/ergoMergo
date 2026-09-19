// Fahrbildschirm: Livewerte, ±-Bedienung mit Tastenwiederholung, Not-Stopp.

import { LiveChart, WorkoutChart, zoneColor } from './chart.js';
import * as signal from '../signals.js';
import { HeartRate } from '../ble/hr.js';
import { ZwiftController } from '../ble/zwift-controller.js';
import { schnellverbinde, merkeGeraet } from '../ble/geraete.js';

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
    this.$('#m-time-label').textContent = run ? 'Intervall' : 'Zeit';
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

    // Zusatzgeräte: Herzgurt und Zwift Click (experimentell).
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
      const device = await schnellverbinde(rolle);
      if (!device) return;
      const btn = this.$(id);
      try { await fn(btn, device); btn.classList.add('on'); }
      catch { /* Gerät nicht bereit — manueller Chip-Weg bleibt */ }
    };
    auto('hr', '#btn-hr', verbindeHR);
    auto('controller', '#btn-click', verbindeCtrl);

    // Intervallsteuerung nur im Programm-Modus
    this.$('#btn-skip').hidden = this.$('#btn-ext').hidden = !this.run;
    this.$('#btn-skip').onclick = () => { this.run?.skip(); this.render(); };
    this.$('#btn-ext').onclick = () => { this.run?.verlaengern(30); this.render(); };
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
    this.$('#btn-stop').onclick = () => this.session.emergencyStop();
    this.$('#btn-end').onclick = async () => {
      this.$('#btn-end').onclick = null;      // Doppel-Tap = doppeltes finish verhindern
      await this.session.finish();
      this.onEnd(this.session);
    };
    // Tastatur (Laptop): Pfeile ±, Leertaste Stop
    this.#keys = e => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') adjust(step);
      else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') adjust(-step);
      else if (e.key === ' ') { e.preventDefault(); this.session.emergencyStop(); }
    };
    addEventListener('keydown', this.#keys);

    // Geräte-Watchdog: erkennt still abgerissene GATT-Verbindungen und hält
    // die Chip-/Statusanzeige ehrlich (5-s-Takt)
    this.#watchdog = setInterval(() => {
      if (!this.session.ftms.connected && this.session.status !== 'done')
        this.#status('Trainer getrennt — verbinde neu …', 'err');
      for (const g of this.#geraete) {
        if (g.btn.classList.contains('on') && !g.client.device?.gatt.connected)
          g.btn.classList.remove('on');
      }
    }, 5000);
  }

  #keys = null;
  #watchdog = null;

  #status(text, cls = '') {
    const el = this.$('#m-status');
    el.textContent = text;
    el.className = 'status ' + cls;
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
    } else {
      this.$('#m-time').textContent = fmtTime(s.elapsed);
    }
    this.$('#m-rpm').textContent = s.live.rpm ? Math.round(s.live.rpm) : '–';
    this.$('#m-hr').textContent = s.live.hr || '–';
    this.$('#m-kj').textContent = Math.round(s.kj);
    if (this.run) this.chart.draw(this.run.blocks, this.run.total, s.samples, s.count, this.run.offset, this.settings.ftp, this.run.zeitOffset);
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
