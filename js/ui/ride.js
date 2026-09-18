// Fahrbildschirm: Livewerte, ±-Bedienung mit Tastenwiederholung, Not-Stopp.

import { LiveChart, WorkoutChart, zoneColor } from './chart.js';
import * as signal from '../signals.js';
import { HeartRate } from '../ble/hr.js';
import { ZwiftClick } from '../ble/click.js';

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
      });
      run.addEventListener('countdown', () => signal.countdown());
      run.addEventListener('done', () => signal.fertig());
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

  #bind() {
    const step = this.settings.wattSchritt;
    const adjust = d => this.run ? this.run.adjust(d) : this.session.adjust(d);
    this.adjust = adjust;

    // Zusatzgeräte: Herzgurt und Zwift Click (experimentell)
    const chip = (id, connectFn) => {
      const btn = this.$(id);
      btn.addEventListener('click', async () => {
        try { await connectFn(); btn.classList.add('on'); }
        catch (err) { if (err.name !== 'NotFoundError') this.#status(err.message, 'err'); }
      });
    };
    chip('#btn-hr', async () => {
      const hr = new HeartRate();
      await hr.connect();
      this.session.attachHR(hr);
      hr.addEventListener('disconnected', () => this.$('#btn-hr').classList.remove('on'));
    });
    chip('#btn-click', async () => {
      const click = new ZwiftClick();
      await click.connect();
      click.addEventListener('plus', () => adjust(step));
      click.addEventListener('minus', () => adjust(-step));
      click.addEventListener('disconnected', () => this.$('#btn-click').classList.remove('on'));
    });
    const hold = (btn, delta) => {
      const fire = () => adjust(delta);
      btn.addEventListener('pointerdown', e => {
        e.preventDefault();
        fire();
        const tick = () => { fire(); this.#repeat = setTimeout(tick, 300); };
        this.#repeat = setTimeout(tick, 500);
      });
      for (const ev of ['pointerup', 'pointercancel', 'pointerleave'])
        btn.addEventListener(ev, () => clearTimeout(this.#repeat));
    };
    hold(this.$('#btn-plus'), step);
    hold(this.$('#btn-minus'), -step);
    // Large-Print-Umschalter (PM5-Muster): Tap auf die große Zahl
    this.$('#m-watt').addEventListener('click', () =>
      this.root.querySelector('.ride-grid').classList.toggle('large'));
    this.$('#btn-stop').addEventListener('click', () => this.session.emergencyStop());
    this.$('#btn-end').addEventListener('click', async () => {
      await this.session.finish();
      this.onEnd(this.session);
    });
    // Tastatur (Laptop): Pfeile ±, Leertaste Stop
    this.#keys = e => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') adjust(step);
      else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') adjust(-step);
      else if (e.key === ' ') { e.preventDefault(); this.session.emergencyStop(); }
    };
    addEventListener('keydown', this.#keys);
  }

  #keys = null;

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
    if (this.run) this.chart.draw(this.run.blocks, this.run.total, s.samples, s.count, this.run.offset, this.settings.ftp);
    else this.chart.draw(s.samples, s.count, s.target);
  }

  destroy() { removeEventListener('keydown', this.#keys); }
}

export function fmtTime(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
           : `${m}:${String(s).padStart(2, '0')}`;
}
