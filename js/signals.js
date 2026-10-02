// Akustik + Vibration für Blockwechsel. Töne über die AudioContext-Uhr
// geplant, damit Timer-Drosselung im Hintergrund sie nicht verschluckt.
//
// Android-Audiofokus: ein AudioContext im Zustand 'running' hält den Fokus
// DAUERHAFT — Spotify & Co. bleiben stumm, solange die App fährt (Livetest).
// Deshalb: Context nur zum Abspielen wecken, nach der letzten Quelle wieder
// suspendieren — der Fokus geht zurück an die Musik-App.

import { logInfo, logWarn } from './logger.js';

let ctx = null;
let suspendTimer = null;
let aktiveQuellen = 0;
// Erst nach dem ersten erfolgreichen resume() (User-Geste) dürfen Töne
// geplant werden — vorher hängt resume() endlos und Töne würden sich
// aufstauen und beim ersten Tap gleichzeitig herausplatzen (?demo-Autostart)
let entsperrt = false;
let entsperren = null;      // Promise des ersten resume() aus initAudio

// Geteilter Context für ansagen.js (Bausteine über dieselbe Audio-Uhr)
export function audioCtx() { return ctx; }

// Rücksichtsvolle Wiedergabe (Audio Session API, W3C-Entwurf): Töne und
// Ansagen sollen YouTube, Podcasts & Co. nicht anhalten. Typ 'ambient' ist
// laut Entwurf der einzige, der sich mit anderer Wiedergabe MISCHT, ohne
// sie zu ducken oder anzuhalten. 'transient' darf andere Wiedergabe ducken
// (auf Android typisch ein Transient-Fokus — genau der hält Videos an),
// 'transient-solo' und 'playback' sind exklusiv. Einmal vor dem ersten
// Abspielen setzen; ohne API (Stand 2026: nur Safari) bleibt alles, wie es ist.
let sitzungGesetzt = false;
function audioSitzung() {
  if (sitzungGesetzt) return;
  sitzungGesetzt = true;
  const s = navigator.audioSession;
  if (!s || !('type' in s)) { logInfo('audio', 'Audio Session API nicht vorhanden — Wiedergabe unverändert'); return; }
  try {
    s.type = 'ambient';
    // Rücklesen: ein unbekannter Wert würde still ignoriert
    logInfo('audio', `Audio Session API vorhanden — Typ ${s.type} gesetzt (gewünscht ambient)`);
  } catch (e) { logWarn('audio', 'Audio Session: Typ nicht gesetzt', String(e)); }
}

// Muss aus einer User-Geste heraus aufgerufen werden (Autoplay-Policy).
// Das erste resume() entsperrt den Context — spätere wecke()-Aufrufe
// brauchen dann keine Geste mehr.
export function initAudio() {
  try {
    audioSitzung();
    if (!ctx) {
      ctx = new AudioContext();
      logInfo('audio', `AudioContext angelegt (${ctx.state}, ${ctx.sampleRate} Hz)`);
      protokolliereZustand(ctx);
    }
    if (ctx.state === 'suspended')
      entsperren = ctx.resume().then(() => { entsperrt = true; }).catch(e => logWarn('audio', 'resume fehlgeschlagen', String(e)));
    else entsperrt = true;
    suspendBald(1500);
  } catch { /* ohne Audio weiterfahren */ }
}

// Diagnose Audiofokus: nur die Zustandswechsel des Contexts protokollieren
// (wach/schläft, mit Wachdauer und ob die App im Hintergrund ist) — nicht
// jeden Ton. Ein Wachzyklus = zwei Einträge; der Ringpuffer (LOG_MAX in
// storage.js) hält damit auch lange Intervallfahrten.
function protokolliereZustand(c) {
  let wachSeit = null;
  c.addEventListener('statechange', () => {
    const daten = { hidden: document.hidden };
    if (c.state === 'running') wachSeit = performance.now();
    else if (wachSeit !== null) { daten.wachMs = Math.round(performance.now() - wachSeit); wachSeit = null; }
    logInfo('audio', `Context ${c.state}`, daten);
  });
}

// Vor jeder Wiedergabe: anstehenden Suspend abräumen, Context aufwecken.
// Liefert ein Promise, das nach dem resume() auflöst — Töne erst DANACH
// planen (wie spiele() in ansagen.js): synchron bei suspended geplante
// Oszillatoren gehen auf Android teils verloren.
function wecke() {
  if (!ctx) return Promise.resolve();
  clearTimeout(suspendTimer);
  if (ctx.state === 'suspended')
    return ctx.resume().then(() => { entsperrt = true; })
      .catch(e => logWarn('audio', 'resume fehlgeschlagen', String(e)));   // ohne Ton weiter
  return Promise.resolve();
}

// Gemeinsames Tor vor jeder Wiedergabe (Töne und Ansagen): vor der ersten
// User-Geste verwerfen statt aufstauen, sonst Context wecken. false = nichts
// abspielen.
export async function bereit() {
  if (!ctx) return false;
  if (!entsperrt && ctx.state === 'suspended') return false;
  await wecke();
  return true;
}

// Quellen-Zählung: erst wenn die letzte Quelle geendet hat, wird suspendiert
export function quelleStart() { clearTimeout(suspendTimer); aktiveQuellen++; }
export function quelleEnde() {
  aktiveQuellen = Math.max(0, aktiveQuellen - 1);
  // 1.5 s Gnadenfrist: Countdown-Beeps (2s/1s), Wechselton und Ansage
  // bleiben ein Wachzyklus — jeder Suspend/Resume dazwischen riskiert
  // auf Android einen Sink-Neustart, der kurze Töne verschluckt
  if (!aktiveQuellen) suspendBald(1500);
}

// Fahrtende: nichts spielt mehr — Fokus sofort freigeben. Ein noch
// geplanter Auftakt wird abgebrochen (sonst klänge er beim nächsten
// resume() nach, s. auftaktAbbrechen)
export function audioSchlafen() { auftaktAbbrechen(); aktiveQuellen = 0; suspendBald(0); }

function suspendBald(ms = 250) {
  clearTimeout(suspendTimer);
  suspendTimer = setTimeout(() => {
    if (!aktiveQuellen && ctx?.state === 'running')
      ctx.suspend().catch(e => logWarn('audio', 'suspend fehlgeschlagen', String(e)));
  }, ms);
}

// Klangdesign: Dreieck statt Rechteck (Rechteck beißt bei kurzen Beeps in
// den Ohren), dazu eine leise Oktave obendrauf — mehrere Frequenzkomponenten
// tragen über Lüfter-/Fahrgeräusch, ohne lauter sein zu müssen. 10 ms
// Attack-Rampe gegen Knackser; halten = Pegel bis kurz vor Ende konstant
// (hörbar „langer" Ton — der Exponentialabfall allein klingt nach ~0.15 s
// wie vorbei). Frequenzen ab ~660 Hz: tiefere verzerren am Handy-Speaker.
function tone(freq, at, dur = 0.15, gainVal = 0.5, halten = false) {
  for (const [f, g] of [[freq, gainVal], [freq * 2, gainVal * 0.22]]) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = f;
    osc.type = 'triangle';
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.linearRampToValueAtTime(g, at + 0.01);
    if (halten) gain.gain.setValueAtTime(g, at + Math.max(0.01, dur - 0.1));
    gain.gain.exponentialRampToValueAtTime(0.001, at + dur);
    osc.connect(gain).connect(ctx.destination);
    quelleStart();
    osc.onended = quelleEnde;
    osc.start(at);
    osc.stop(at + dur);
  }
}

export async function blockwechsel(hart) {
  navigator.vibrate?.(hart ? [200, 100, 200] : 200);
  await auftaktFertig;
  if (!await bereit()) return;
  const t = ctx.currentTime + 0.05;
  // EIN gehaltener Ton genau beim Wechsel (nach den Countdown-Beeps) —
  // keine Vortöne. Unterscheidung über die Höhe: hart (Watt rauf) hoch,
  // weich (Watt runter) tief.
  if (hart) tone(1319, t, 0.5, 0.5, true);
  else tone(880, t, 0.5, 0.5, true);
}

// Kurzer Bestätigungs-Tick für Controller-Tastendrücke
// Während des Auftakts entfallen Ticks — verspätet nachgeliefert wären sie
// keine Rückmeldung mehr
export async function tick() {
  if (auftaktSpielt || !await bereit()) return;
  tone(1200, ctx.currentTime + 0.02, 0.035, 0.15);
}

// Lenkertaste ohne Aktion: tiefer Doppel-Tick, noch leiser — „erkannt, aber
// unbelegt", klar vom einfachen hohen Tick einer belegten Taste zu trennen.
// 700 Hz bleibt über der Verzerrungsgrenze des Handy-Speakers (s. tone()).
export async function tickUnbelegt() {
  if (auftaktSpielt || !await bereit()) return;
  const t = ctx.currentTime + 0.02;
  tone(700, t, 0.035, 0.12);
  tone(700, t + 0.08, 0.035, 0.12);
}

export async function countdown() {
  navigator.vibrate?.(80);
  await auftaktFertig;
  if (!await bereit()) return;
  tone(880, ctx.currentTime + 0.05, 0.09, 0.4);
}

// Auftakt beim Fahrtstart: zwei schwere, metallisch-dumpfe Schläge kurz
// hintereinander — reine Klangsynthese, kein Sample. Pro Schlag drei
// Schichten: tiefer Körper (Sinus mit Tonhöhenfall), kurzer Rausch-Knall
// (Bandpass) und metallische Teiltöne mit unharmonischen Verhältnissen;
// darüber ein kurzer Hall aus einer zur Laufzeit erzeugten Impulsantwort.
// Handy-Lautsprecher geben unter ~200 Hz kaum etwas wieder (s. o. zu tiefen
// Frequenzen): der Körper wird deshalb angesättigt — seine Obertöne
// (450, 750 … Hz) tragen die Wucht, das Ohr ergänzt den Grundton —, sein
// Tiefbass-Rest per Hochpass gekappt (kostet sonst nur Aussteuerung), und
// die Teiltöne liegen zwischen ~200 Hz und 1.4 kHz. Ein Kompressor am Ende
// hält die Spitzen unter Vollaussteuerung (gerendert: Spitze −1 dBFS,
// ~60 % der Energie zwischen 150 und 3000 Hz). Klang vom Nutzer abgenommen.
// Reserve für gleichzeitige Töne braucht es nicht: alle anderen Töne und
// Ansagen warten, bis der Auftakt samt Hall verklungen ist (auftaktVorbei).
// test/ablauf.mjs rendert die Synthese und prüft Spitze und Bandanteile.
const AUFTAKT_ABSTAND = 0.55;          // s zwischen erstem und zweitem Schlag
const AUFTAKT_ZWEITER = [0.94, 0.75];  // zweiter Schlag: Tonhöhen- und Pegelfaktor
const AUFTAKT_PEGEL = 1;               // Summe vor dem Kompressor
const KOERPER_HZ = [150, 50];          // Sinus, Tonhöhenfall von → bis
const KOERPER_FALL = 0.16;             // s für den Fall
const KOERPER_DAUER = 0.5;             // s bis ausgeklungen
const KOERPER_PEGEL = 0.45;
const KOERPER_SAETTIGUNG = 4;          // tanh-Treiber: Obertöne für kleine Lautsprecher
const KOERPER_HOCHPASS = 130;          // Hz: Rest-Tiefbass kostet nur Aussteuerung
const KNALL_HZ = 1800;                 // Bandpass-Mitte des Rausch-Transienten
const KNALL_Q = 1.1;
const KNALL_DAUER = 0.035;             // s
const KNALL_PEGEL = 1;
const METALL_HZ = 196;                 // Bezug der Teiltöne
// [Verhältnis, Pegel, Abklingzeit s] — unharmonisch (Membran/Platte),
// tiefe Teiltöne klingen länger als hohe
const METALL_TEILE = [[1, 0.45, 0.8], [1.59, 0.4, 0.65], [2.14, 0.32, 0.5],
  [2.65, 0.26, 0.4], [3.83, 0.18, 0.28], [5.27, 0.11, 0.18], [7.11, 0.06, 0.12]];
const HALL_DAUER = 1.2;                // s Impulsantwort (−60 dB am Ende)
const HALL_ANTEIL = 0.35;
// Ausklang eines Schlags (ohne Hall)
const SCHLAG_DAUER = Math.max(KOERPER_DAUER, ...METALL_TEILE.map(t => t[2]));

// Synthese in einen beliebigen Context (live oder OfflineAudioContext für
// die Prüfung in test/ablauf.mjs) — ziel: Ziel-Knoten, t0: Startzeit auf
// dessen Uhr. Liefert ende (Zeit, zu der auch der Hall verklungen ist) und
// aus (letzter Knoten vor dem Ziel: trennen = sofort still).
export function auftaktSynth(c, ziel = c.destination, t0 = c.currentTime) {
  const komp = c.createDynamicsCompressor();
  komp.threshold.value = -12;
  komp.knee.value = 6;
  komp.ratio.value = 4;
  komp.attack.value = 0.002;
  komp.release.value = 0.2;
  const aus = c.createGain();            // trennen = sofort still (Abbruch)
  komp.connect(aus).connect(ziel);
  const summe = c.createGain();
  summe.gain.value = AUFTAKT_PEGEL;
  summe.connect(komp);
  const hall = c.createConvolver();
  hall.buffer = hallImpuls(c);
  const nass = c.createGain();
  nass.gain.value = HALL_ANTEIL;
  hall.connect(nass).connect(summe);
  const bus = c.createGain();            // trocken + Hall-Eingang
  bus.connect(summe);
  bus.connect(hall);
  const kurve = Float32Array.from({ length: 1025 }, (_, i) =>
    Math.tanh(KOERPER_SAETTIGUNG * (i / 512 - 1)) / Math.tanh(KOERPER_SAETTIGUNG));
  const rauschen = c.createBuffer(1, Math.ceil(c.sampleRate * (KNALL_DAUER + 0.01)), c.sampleRate);
  const r = rauschen.getChannelData(0);
  for (let i = 0; i < r.length; i++) r[i] = Math.random() * 2 - 1;
  schlag(c, bus, kurve, rauschen, t0, 1, 1);
  schlag(c, bus, kurve, rauschen, t0 + AUFTAKT_ABSTAND, ...AUFTAKT_ZWEITER);
  return { ende: t0 + AUFTAKT_ABSTAND + SCHLAG_DAUER + HALL_DAUER, aus };
}

function schlag(c, bus, kurve, rauschen, t, ton, pegel) {
  // Hüllkurve: 0 → p in an (s), exponentiell auf ~0 bis t + ab
  const huelle = (p, an, ab) => {
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(p, t + an);
    g.gain.exponentialRampToValueAtTime(0.0001, t + ab);
    return g;
  };
  // Körper: Sinus mit Tonhöhenfall, Hüllkurve VOR der Sättigung — der
  // Anschlag zerrt am stärksten, der Ausklang wird wieder rund
  const koerper = c.createOscillator();
  koerper.frequency.setValueAtTime(KOERPER_HZ[0] * ton, t);
  koerper.frequency.exponentialRampToValueAtTime(KOERPER_HZ[1] * ton, t + KOERPER_FALL);
  const saettigung = c.createWaveShaper();
  saettigung.curve = kurve;
  saettigung.oversample = '2x';
  const kPegel = c.createGain();
  kPegel.gain.value = KOERPER_PEGEL * pegel;
  const hp = c.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = KOERPER_HOCHPASS;
  koerper.connect(huelle(1, 0.004, KOERPER_DAUER)).connect(saettigung).connect(hp).connect(kPegel).connect(bus);
  koerper.start(t);
  koerper.stop(t + KOERPER_DAUER + 0.02);
  // Knall: kurzes Bandpass-Rauschen
  const knall = c.createBufferSource();
  knall.buffer = rauschen;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = KNALL_HZ * ton;
  bp.Q.value = KNALL_Q;
  knall.connect(bp).connect(huelle(KNALL_PEGEL * pegel, 0.001, KNALL_DAUER)).connect(bus);
  knall.start(t);
  // Metall: unharmonische Teiltöne, kurz abklingend
  for (const [verh, p, ab] of METALL_TEILE) {
    const osc = c.createOscillator();
    osc.frequency.value = METALL_HZ * verh * ton;
    osc.connect(huelle(p * pegel, 0.003, ab)).connect(bus);
    osc.start(t);
    osc.stop(t + ab + 0.02);
  }
}

// Hall: exponentiell abklingendes Rauschen, Stereo mit unabhängigen Kanälen
function hallImpuls(c) {
  const n = Math.round(c.sampleRate * HALL_DAUER);
  const buf = c.createBuffer(2, n, c.sampleRate);
  for (let k = 0; k < 2; k++) {
    const d = buf.getChannelData(k);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-6.9 * i / n);
  }
  return buf;
}

// Laufender Auftakt. gen zählt bei jedem Start und Abbruch hoch: ein
// Auftakt, der noch auf das Entsperren wartet, merkt so, dass die Fahrt
// inzwischen vorbei ist (oder ein neuer begonnen hat), und spielt nicht mehr
let auftaktLauf = null;                // { waechter, aus }, solange geplant
let auftaktGen = 0;
let auftaktFertig = Promise.resolve();
let auftaktLoesen = () => {};
let auftaktSpielt = false;
// Löst auf, sobald der Auftakt samt Hall verklungen ist — sofort, wenn
// keiner spielt oder er gar nicht erklingt. Alle anderen Töne und die
// Ansagen warten darauf: erst der Auftakt, dann alles andere.
export function auftaktVorbei() { return auftaktFertig; }

export async function auftakt() {
  if (!ctx) return;
  const gen = ++auftaktGen;
  auftaktLoesen();                     // ein noch wartender Vorgänger ist vorbei
  let loese;
  auftaktFertig = new Promise(r => { loese = () => { auftaktSpielt = false; r(); }; });
  auftaktLoesen = loese;
  auftaktSpielt = true;
  navigator.vibrate?.([110, Math.round(AUFTAKT_ABSTAND * 1000) - 110, 90]);
  // Freies Fahren mit verbundenem Trainer: der Fahrbildschirm kann kommen,
  // bevor das resume() aus initAudio (Start-Tap) aufgelöst hat — kurz
  // darauf warten statt den Auftakt zu verwerfen (begrenzt: ohne Geste
  // hängt resume() endlos)
  if (!entsperrt && entsperren) await Promise.race([entsperren, new Promise(r => setTimeout(r, 500))]);
  if (gen !== auftaktGen || !await bereit() || gen !== auftaktGen) { loese(); return; }
  const t = ctx.currentTime + 0.05;
  const { ende, aus } = auftaktSynth(ctx, ctx.destination, t);
  // Quellen-Zählung über einen stummen Wächter auf der Audio-Uhr: er
  // endet erst, wenn auch der Hall verklungen ist
  const waechter = ctx.createConstantSource();
  waechter.offset.value = 0;
  waechter.connect(ctx.destination);
  quelleStart();
  waechter.onended = () => {
    if (auftaktLauf?.waechter === waechter) auftaktLauf = null;
    quelleEnde();
  };
  waechter.start(t);
  waechter.stop(ende);
  auftaktLauf = { waechter, aus };
  setTimeout(loese, (ende - ctx.currentTime) * 1000);   // samt Hall, ab jetzt
}

// Fahrtende mitten im Auftakt: geplante Knoten verstummen sofort, der
// Wächter zählt nicht mehr — sonst klängen die Schläge auf der angehaltenen
// Audio-Uhr beim nächsten resume() nach, und sein spätes onended zöge eine
// fremde Quelle vom Zähler ab (Suspend mitten im nächsten Ton)
function auftaktAbbrechen() {
  auftaktGen++;
  auftaktLoesen();
  if (!auftaktLauf) return;
  const { waechter, aus } = auftaktLauf;
  auftaktLauf = null;
  waechter.onended = null;
  aus.disconnect();
  try { waechter.stop(); } catch { /* schon beendet */ }
}

// Sprachansage (SpeechSynthesis) — Rückfall, z. B. „3 Minuten, 210 Watt".
// Nur mit einer LOKALEN deutschen Stimme: Online-Stimmen (localService
// false) schicken den Text an einen Sprachdienst — dann lieber schweigen.
let lokaleStimme;
function stimme() {
  if (lokaleStimme === undefined || lokaleStimme === null) {
    const alle = globalThis.speechSynthesis?.getVoices?.() ?? [];
    lokaleStimme = alle.find(v => v.localService && v.lang?.toLowerCase().startsWith('de')) ?? (alle.length ? false : null);
  }
  return lokaleStimme || null;
}
globalThis.speechSynthesis?.addEventListener?.('voiceschanged', () => { lokaleStimme = undefined; });
export async function sage(text) {
  await auftaktFertig;
  try {
    const v = stimme();
    if (!v) return;
    const u = new SpeechSynthesisUtterance(text);
    u.voice = v;
    u.lang = v.lang;
    u.rate = 1.1;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch { /* nicht überall verfügbar */ }
}

export async function fertig() {
  navigator.vibrate?.([150, 80, 150, 80, 400]);
  await auftaktFertig;
  if (!await bereit()) return;
  const t = ctx.currentTime + 0.05;
  // Festliches Dur-Arpeggio aufwärts, Schlusston gehalten
  [659, 784, 1047].forEach((f, i) => tone(f, t + i * 0.16, 0.15));
  tone(1319, t + 3 * 0.16, 0.5, 0.5, true);
}
