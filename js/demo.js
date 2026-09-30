// ?demo — Fahrbildschirm mit synthetischen Daten, ohne Trainer
// (Onboarding-Feature + UI-Arbeit/Screenshots). Aus main.js ausgelagert;
// Screen-Wechsel und rideScreen-Registrierung kommen als Callbacks.

import { getSettings, FIELDS } from './storage.js';
import { distanzKm, fahrtStats, kadenzBereich } from './metrics.js';
import { initAudio } from './signals.js';
import { Session } from './state.js';
import { WORKOUTS } from './workouts.js';
import { PROGRAMME, ProgramRun, expand, baueBlocks } from './program.js';

const $ = s => document.querySelector(s);

// Einfaches Fahrermodell für alle Demo-Daten (Vorgeschichte, Live-Werte,
// Beispielfahrt): ERG regelt in wenigen Sekunden nach, beim Stopp rollt die
// Leistung aus; HF folgt der Leistung träge (schneller Anstieg, langsamer
// Abfall, leichte Drift); Kadenz mitten im Bereich, den der Fahrbildschirm
// vorgibt (metrics.kadenzBereich), sonst locker 89.
function fahrermodell(ftp, rnd = () => Math.random() - 0.5) {
  let watt = 0, hf = 92;
  return (ziel, k) => {
    watt += Math.max(-45, Math.min(35, ziel - watt));
    const w = Math.max(0, Math.round(watt + (ziel ? rnd() * 14 : 0)));
    const hfZiel = 78 + w * 0.36 + k / 150;
    hf += (hfZiel - hf) / (hfZiel > hf ? 28 : 55);
    const bereich = kadenzBereich(ziel, ftp);
    const rpm = w ? Math.round((bereich ? (bereich.low + Math.min(bereich.high, bereich.low + 20)) / 2 : 89) + rnd() * 6) : 0;
    return { watt: w, rpm, hr: Math.round(hf + rnd() * 2), kmh: w ? 14 + w / 11 : 0 };
  };
}

// Zielleistung eines Blockablaufs zur Programmzeit t
function zielBei(blocks, t) {
  for (const b of blocks) {
    if (t < b.dauer) return b.watt;
    t -= b.dauer;
  }
  return blocks.at(-1)?.watt ?? 0;
}

// Demo-Einstieg: 20 s vor Beginn des ersten härtesten Blocks — gleich
// passiert etwas (Countdown, Töne, Ansage, Sprung im Graph)
function einstiegVorWechsel(blocks) {
  const max = Math.max(...blocks.map(b => b.watt));
  let t = 0;
  for (const b of blocks) {
    if (b.watt === max) return Math.max(0, t - 20);
    t += b.dauer;
  }
  return 0;
}

// ?demo — Fahrbildschirm mit synthetischen Daten, ohne Trainer (UI-Arbeit, Screenshots).
// ?demo=programm zeigt den Programm-Modus mit Workout-Graph.
export async function startDemo(variante, { betreteFahrt }) {
  const settings = await getSettings();
  const ftms = new EventTarget();
  Object.assign(ftms, { connected: true, busy: false, deviceName: 'Demo-Trainer',
    setTargetPower: async () => {}, disconnect: () => {} });
  const session = new Session(ftms, settings);
  session.save = async () => {};   // Demo-Fahrten nicht in die echte Historie schreiben
  ftms.istDemo = true;             // u. a.: kein Auto-Connect echter Geräte im Demo
  let run = null;
  const fahrer = fahrermodell(settings.ftp);
  // Vorgeschichte aus demselben Ablauf wie der Graph — sonst läge die
  // Ist-Linie neben den Zielblöcken und sähe nach verpatzter Fahrt aus
  const prefill = (secs, zielAt) => {
    for (let k = 0; k < secs; k++) {
      const ziel = zielAt(k);
      const d = fahrer(ziel, k);
      session.samples.set([k, d.watt, ziel, d.rpm, d.hr, Math.round(d.kmh * 10)], k * FIELDS);
      session.kj += d.watt / 1000;
      Object.assign(session.live, d);
    }
    session.count = secs;
    session.km = distanzKm(session.samples, secs);   // zentral aus den Samples, kein zweiter Rechenweg
  };
  // ?demo=<id> für jedes eingebaute Programm; ?demo=programm = 4×4 mit festen Watt
  const programm = variante === 'programm' ? PROGRAMME.find(x => x.id === 'intervalle44')
    : [...WORKOUTS, ...PROGRAMME].find(x => x.id === variante);
  if (programm) {
    const opts = variante === 'programm' ? { wdh: 4, hart: 210, locker: 90 } : optsFuer(programm, 1);
    const blocks = baueBlocks(programm, opts, settings.ftp);
    prefill(einstiegVorWechsel(blocks), t => zielBei(blocks, t));
    run = new ProgramRun(session, blocks);
  } else {
    prefill(480, k => k < 120 ? 120 : k < 300 ? 200 : 160);
    session.setTarget(160, { instant: true });
  }
  const ping = new URLSearchParams(location.search).has('ping');
  setInterval(() => {
    ftms.dispatchEvent(new CustomEvent('data', { detail: fahrer(session.target, session.elapsed) }));
    // ?ping — Hintergrund-Throttling messen: 1 Request/s, Servlog zeigt Lücken
    if (ping) fetch(`ping?t=${session.elapsed}&vis=${document.visibilityState}`).catch(() => {});
  }, 1000);
  // Audio wie in der echten Fahrt (Beeps + Ansage-Bausteine statt Browser-TTS).
  // Vor dem RideScreen, damit dessen initAnsagen den Context schon bekommt.
  // ?demo-Autostart hat keine User-Geste — erste Berührung entsperrt dann nach.
  initAudio();
  document.addEventListener('pointerdown', initAudio, { once: true });
  // Reload räumt alle Demo-Timer ab — auch wenn ohne ?demo gestartet wurde
  // replace statt href: Zurück führt danach nicht wieder in die Demo
  betreteFahrt(session, settings,
    async () => { $('#m-demo').hidden = true; location.replace(location.pathname); }, run);
  ftms.dispatchEvent(new Event('connected'));
  $('#m-demo').hidden = false;                 // persistenter Badge, unabhängig vom Status
  // Sprung zu den gespeicherten Beispielfahrten — per Neuladen, das räumt wie
  // „Beenden" alle Demo-Timer ab. von= merkt die Variante: Zurück aus den
  // Beispielfahrten führt wieder in diese Demo-Fahrt
  $('#btn-demo-beispiel').onclick = () => {
    location.replace(`${location.pathname}?demo=fahrten&von=${encodeURIComponent(variante || 'frei')}`);
  };
}

// ---------- Gespeicherte Demo-Fahrten (Detailansicht + Fahrten-Historie) ----------
// Landen nie in der IndexedDB. Samples über dasselbe Fahrermodell wie der
// Demo-Fahrbildschirm, Kennwerte über dieselbe Rechnung wie echte Fahrten
// (fahrtStats) — die Demo zeigt damit exakt, was die App speichern würde.

// Deterministischer Zufall (Park-Miller): gleiche Demo bei jedem Aufruf
const zufallAus = seed => () => (seed = seed * 16807 % 2147483647) / 2147483647 - 0.5;

// gurtAb/gurtLuecke: Sekunden ohne HF (Gurt spät verbunden, Kontaktverlust)
function demoFahrt({ id, start, programm, ziele, programmEndeBei = null, ftp, seed, gurtAb = 0, gurtLuecke = null }) {
  const fahrer = fahrermodell(ftp, zufallAus(seed));
  const count = ziele.length;
  const samples = new Int16Array(count * FIELDS);
  for (let k = 0; k < count; k++) {
    const d = fahrer(ziele[k], k);
    const mitGurt = k >= gurtAb && !(gurtLuecke && k > gurtLuecke[0] && k < gurtLuecke[1]);
    samples.set([k, d.watt, ziele[k], d.rpm, mitGurt ? d.hr : 0, Math.round(d.kmh * 10)], k * FIELDS);
  }
  // Metadaten in derselben Form wie Session.save()
  const session = {
    id, start, programm: programm.name, programmId: programm.id ?? null, seed: null,
    geraet: 'Demo-Trainer', fw: null, ftp: ftp || null, akkuProStunde: null,
    programmEndeBei, final: true, ...fahrtStats(samples, count, programmEndeBei, ftp),
  };
  return { session, data: { samples, count } };
}

const zieleAus = blocks => blocks.flatMap(b => Array(b.dauer).fill(b.watt));

// Standardoptionen ohne Nebenwirkung (defaultOpts würde bei Zufallsprogrammen
// einen Startwert in localStorage anlegen)
const optsFuer = (p, seed) => ({
  ...Object.fromEntries(Object.entries(p.optionen).map(([k, v]) => [k, v.default])),
  ...(p.zufall ? { seed } : {}),
});

// ?demo=fahrt — Beispiel einer gespeicherten Fahrt: 4×4 Intervalle mit
// Not-Stopp, Ausfahren nach Programmende, Gurt erst nach 90 s verbunden und
// kurzer Kontaktverlust. Gestern 18:30.
function beispielFahrtMit(ftp) {
  const p = PROGRAMME.find(x => x.id === 'intervalle44');
  const ziele = zieleAus(expand(p.bauen({ wdh: 4, hart: 210, locker: 90 })));
  const stoppBei = 8 * 60 + 2 * 7 * 60 + 4 * 60 + 60;   // in der 3. Erholung
  ziele.splice(stoppBei, 0, ...Array(45).fill(0));
  const programmEndeBei = ziele.length;
  ziele.push(...Array(150).fill(ziele.at(-1)));          // Ausfahren
  const start = new Date();
  start.setDate(start.getDate() - 1);
  start.setHours(18, 30, 0, 0);
  return demoFahrt({ id: 'demo-fahrt', start: start.getTime(), programm: p, ziele, programmEndeBei,
    ftp, seed: 7, gurtAb: 90, gurtLuecke: [1700, 1725] });
}

export async function beispielFahrt() {
  return beispielFahrtMit((await getSettings()).ftp);
}

// ?demo=fahrten — Fahrten-Historie der letzten ~10 Wochen: die Beispielfahrt
// als jüngste, davor ~3 Fahrten pro Woche aus den eingebauten Programmen,
// eine Urlaubswoche, vereinzelt Probefahrten unter 2 min.
export async function beispielHistorie() {
  const { ftp } = await getSettings();
  const rnd = zufallAus(42);
  const mix = [...WORKOUTS.filter(w => w.id !== 'sprint3030'),
    ...PROGRAMME.filter(p => ['intervalle44', 'pyramide', 'fartlek'].includes(p.id))];
  const fahrten = [beispielFahrtMit(ftp)];
  for (let tage = 2; tage <= 70; tage++) {
    if (tage >= 22 && tage <= 29) continue;              // Urlaub
    const r = rnd() + 0.5;
    if (r > 0.45) continue;
    const start = new Date();
    start.setDate(start.getDate() - tage);
    start.setHours(r < 0.2 ? 7 : 18, r < 0.2 ? 15 : 30, 0, 0);
    const id = `demo-${tage}`;
    const seed = 1000 + tage;
    if (r < 0.04) {                                      // Probefahrt/Fehlstart
      fahrten.push(demoFahrt({ id, start: start.getTime(), programm: { name: 'Freies Fahren' },
        ziele: Array(80).fill(100), ftp, seed }));
      continue;
    }
    const p = mix[Math.floor((rnd() + 0.5) * mix.length)];
    const ziele = zieleAus(baueBlocks(p, optsFuer(p, seed), ftp));
    const programmEndeBei = ziele.length;
    ziele.push(...Array(60 + Math.round((rnd() + 0.5) * 120)).fill(ziele.at(-1)));
    fahrten.push(demoFahrt({ id, start: start.getTime(), programm: p, ziele, programmEndeBei, ftp, seed,
      gurtAb: Math.round((rnd() + 0.5) * 60) }));
  }
  return {
    sessions: fahrten.map(f => f.session),
    daten: new Map(fahrten.map(f => [f.session.id, f.data])),
  };
}
