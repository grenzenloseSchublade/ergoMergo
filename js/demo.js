// ?demo — Fahrbildschirm mit synthetischen Daten, ohne Trainer
// (Onboarding-Feature + UI-Arbeit/Screenshots). Aus main.js ausgelagert;
// Screen-Wechsel und rideScreen-Registrierung kommen als Callbacks.

import { getSettings } from './storage.js';
import { initAudio } from './signals.js';
import { Session } from './state.js';
import { RideScreen } from './ui/ride.js';
import { WORKOUTS } from './workouts.js';
import { PROGRAMME, ProgramRun, expand, defaultOpts } from './program.js';

const $ = s => document.querySelector(s);

// ?demo — Fahrbildschirm mit synthetischen Daten, ohne Trainer (UI-Arbeit, Screenshots).
// ?demo=programm zeigt den Programm-Modus mit Workout-Graph.
export async function startDemo(variante, { show, screens, registriere }) {
  const settings = await getSettings();
  const ftms = new EventTarget();
  Object.assign(ftms, { connected: true, busy: false, setTargetPower: async () => {}, disconnect: () => {} });
  const session = new Session(ftms, settings);
  session.save = async () => {};   // Demo-Fahrten nicht in die echte Historie schreiben
  ftms.istDemo = true;             // u. a.: kein Auto-Connect echter Geräte im Demo
  let run = null;
  const prefill = (secs, zielAt) => {
    const F = 6;
    for (let k = 0; k < secs; k++) {
      const ziel = zielAt(k);
      const watt = ziel + Math.round(Math.sin(k / 3) * 10 + (Math.random() - 0.5) * 8);
      session.samples.set([k, watt, ziel, 88, 141, 325], k * F);
      session.kj += watt / 1000;
    }
    session.count = secs;
  };
  const workout = WORKOUTS.find(x => x.id === variante);
  if (workout) {
    const blocks = workout.generieren(defaultOpts(workout), settings.ftp);
    prefill(600, () => 120);
    run = new ProgramRun(session, workout.name, blocks);
  } else if (variante === 'programm') {
    const p = PROGRAMME.find(x => x.id === 'intervalle44');
    const blocks = expand(p.bauen({ wdh: 4, hart: 210, locker: 90 }), settings.ftp);
    prefill(600, k => k < 480 ? 108 : 210);
    run = new ProgramRun(session, p.name, blocks);
  } else {
    prefill(480, k => k < 120 ? 120 : k < 300 ? 200 : 160);
    session.setTarget(160, { instant: true });
  }
  Object.assign(session.live, { watt: session.target, rpm: 89, hr: 142, kmh: 32.5 });
  const ping = new URLSearchParams(location.search).has('ping');
  setInterval(() => {
    ftms.dispatchEvent(new CustomEvent('data', { detail: {
      watt: Math.round(session.target + (Math.random() - 0.5) * 10),
      rpm: 88 + Math.round(Math.random() * 4), kmh: 32.5, hr: 142,
    } }));
    // ?ping — Hintergrund-Throttling messen: 1 Request/s, Servlog zeigt Lücken
    if (ping) fetch(`ping?t=${session.elapsed}&vis=${document.visibilityState}`).catch(() => {});
  }, 1000);
  // Audio wie in der echten Fahrt (Beeps + Ansage-Bausteine statt Browser-TTS).
  // Vor dem RideScreen, damit dessen initAnsagen den Context schon bekommt.
  // ?demo-Autostart hat keine User-Geste — erste Berührung entsperrt dann nach.
  initAudio();
  document.addEventListener('pointerdown', initAudio, { once: true });
  show('ride');
  history.pushState({ screen: 'ride' }, '');   // double-back-Schutz auch in der Demo
  // Reload räumt alle Demo-Timer ab — auch wenn ohne ?demo gestartet wurde
  registriere(new RideScreen(screens.ride, session, settings,
    async () => { $('#m-demo').hidden = true; location.href = location.pathname; }, run));
  ftms.dispatchEvent(new Event('connected'));
  $('#m-demo').hidden = false;                 // persistenter Badge, unabhängig vom Status
}
