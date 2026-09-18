// Fahrbildschirm: Livewerte, ±-Bedienung mit Tastenwiederholung, Not-Stopp.

import { LiveChart, zoneColor } from './chart.js';

export class RideScreen {
  constructor(root, session, settings, onEnd) {
    this.root = root;
    this.session = session;
    this.settings = settings;
    this.onEnd = onEnd;
    this.chart = new LiveChart(root.querySelector('#live-chart'));
    this.$ = id => root.querySelector(id);
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
    const hold = (btn, delta) => {
      const fire = () => this.session.adjust(delta);
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
    this.$('#btn-stop').addEventListener('click', () => this.session.emergencyStop());
    this.$('#btn-end').addEventListener('click', async () => {
      await this.session.finish();
      this.onEnd(this.session);
    });
    // Tastatur (Laptop): Pfeile ±, Leertaste Stop
    this.#keys = e => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') this.session.adjust(step);
      else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') this.session.adjust(-step);
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
    this.$('#m-time').textContent = fmtTime(s.elapsed);
    this.$('#m-rpm').textContent = s.live.rpm ? Math.round(s.live.rpm) : '–';
    this.$('#m-hr').textContent = s.live.hr || '–';
    this.$('#m-kj').textContent = Math.round(s.kj);
    this.chart.draw(s.samples, s.count, s.target);
  }

  destroy() { removeEventListener('keydown', this.#keys); }
}

export function fmtTime(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
           : `${m}:${String(s).padStart(2, '0')}`;
}
