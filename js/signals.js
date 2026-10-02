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
// hintereinander mit langem Nachhall — reine Klangsynthese, kein Sample
// (vom Nutzer gewählte Fassung „wuchtig"). Pro Schlag vier Schichten:
// tiefer Körper (Sinus mit Tonhöhenfall, stark angesättigt — seine Obertöne
// tragen die Wucht auch auf kleinen Lautsprechern), dumpfer Aufprall
// (tiefpassgefiltertes Rauschen), kurzer Knall (Bandpass-Rauschen) und
// metallische Teiltöne mit unharmonischen Verhältnissen, jeder doppelt und
// leicht verstimmt (Schwebung = Fülle). Darüber ein Stereo-Hall aus einer zur
// Laufzeit erzeugten Impulsantwort, die zum Ende hin dunkler wird. Ein
// Kompressor und ein fester Ausgangspegel halten die Spitzen unter
// Vollaussteuerung (gerendert ~−2 dBFS).
// Alle anderen Töne und Ansagen warten, bis der Auftakt hörbar verklungen
// ist (auftaktVorbei) — Reserve für Überlagerungen braucht es nicht.
// test/ablauf.mjs rendert die Synthese und prüft Spitze und Bandanteile.
const AUFTAKT_ABSTAND = 0.55;          // s zwischen erstem und zweitem Schlag
const AUFTAKT_ZWEITER = [0.97, 0.95];  // zweiter Schlag: Tonhöhen- und Pegelfaktor
const KOERPER_HZ = [95, 36];           // Sinus, Tonhöhenfall von → bis
const KOERPER_FALL = 0.2;              // s für den Fall
const KOERPER_DAUER = 1.2;             // s bis ausgeklungen
const KOERPER_PEGEL = 0.55;
const KOERPER_SAETTIGUNG = 7;          // tanh-Treiber: Obertöne für kleine Lautsprecher
const AUFPRALL_HZ = 260;               // Tiefpass des Rauschens: dumpfer Aufprall
const AUFPRALL_DAUER = 0.25;           // s
const AUFPRALL_PEGEL = 1;
const KNALL_HZ = 1800;                 // Bandpass-Mitte des Rausch-Transienten
const KNALL_Q = 1.1;
const KNALL_DAUER = 0.04;              // s
const KNALL_PEGEL = 0.8;
const METALL_HZ = 165;                 // Bezug der Teiltöne
const METALL_VERSTIMMUNG = 6;          // cent, je Teilton zwei Oszillatoren ±
// [Verhältnis, Pegel, Abklingzeit s] — unharmonisch (Membran/Platte),
// tiefe Teiltöne klingen länger als hohe
const METALL_TEILE = [[1, 0.45, 1.6], [1.59, 0.4, 1.3], [2.14, 0.32, 1], [2.65, 0.26, 0.8],
  [3.83, 0.18, 0.56], [5.27, 0.11, 0.36], [7.11, 0.06, 0.24]];
const HALL_DAUER = 3;                  // s Impulsantwort (−60 dB am Ende)
const HALL_VORLAUF = 0.02;             // s, bevor der Raum antwortet
const HALL_ANTEIL = 0.55;
const AUFTAKT_AUSGANG = 0.85;          // nach dem Kompressor: Spitze ~−2 dBFS statt ~−0,6
// Ausklang eines Schlags (ohne Hall)
const SCHLAG_DAUER = Math.max(KOERPER_DAUER, AUFPRALL_DAUER, ...METALL_TEILE.map(t => t[2]));
// Ab Anschlag ist der Auftakt nach dieser Zeit hörbar verklungen (gerendert:
// Pegel danach unter −40 dBFS) — so lange warten Töne und Ansagen; der Hall-
// Rest danach ist nur noch Raum und darf unter der Stimme liegen
const AUFTAKT_HOERBAR_S = 2.6;

// Synthese in einen beliebigen Context (live oder OfflineAudioContext für
// die Prüfung in test/ablauf.mjs) — ziel: Ziel-Knoten, t0: Startzeit auf
// dessen Uhr. Liefert ende (Zeit, zu der auch der Hall verklungen ist),
// hoerbar (Zeit, ab der andere Töne folgen dürfen) und aus (letzter Knoten
// vor dem Ziel: trennen = sofort still).
export function auftaktSynth(c, ziel = c.destination, t0 = c.currentTime) {
  const komp = c.createDynamicsCompressor();
  komp.threshold.value = -20;
  komp.knee.value = 8;
  komp.ratio.value = 4;
  komp.attack.value = 0.004;
  komp.release.value = 0.3;
  const aus = c.createGain();            // trennen = sofort still (Abbruch)
  aus.gain.value = AUFTAKT_AUSGANG;
  komp.connect(aus).connect(ziel);
  const summe = c.createGain();
  summe.connect(komp);
  const hall = c.createConvolver();
  hall.buffer = hallImpuls(c);
  const nass = c.createGain();
  nass.gain.value = HALL_ANTEIL;
  hall.connect(nass).connect(summe);
  const bus = c.createGain();            // trocken + Hall-Eingang
  bus.connect(summe);
  bus.connect(hall);
  const kurve = Float32Array.from({ length: 2049 }, (_, i) =>
    Math.tanh(KOERPER_SAETTIGUNG * (i / 1024 - 1)) / Math.tanh(KOERPER_SAETTIGUNG));
  const rauschen = c.createBuffer(1, Math.ceil(c.sampleRate * (AUFPRALL_DAUER + 0.05)), c.sampleRate);
  const r = rauschen.getChannelData(0);
  for (let i = 0; i < r.length; i++) r[i] = Math.random() * 2 - 1;
  schlag(c, bus, kurve, rauschen, t0, 1, 1);
  schlag(c, bus, kurve, rauschen, t0 + AUFTAKT_ABSTAND, ...AUFTAKT_ZWEITER);
  return { ende: t0 + AUFTAKT_ABSTAND + SCHLAG_DAUER + HALL_DAUER, hoerbar: t0 + AUFTAKT_HOERBAR_S, aus };
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
  koerper.connect(huelle(KOERPER_PEGEL * pegel, 0.003, KOERPER_DAUER)).connect(saettigung).connect(bus);
  koerper.start(t);
  koerper.stop(t + KOERPER_DAUER + 0.05);
  // Aufprall: tiefpassgefiltertes Rauschen — Gewicht wie ein schwerer Schlag
  const aufprall = c.createBufferSource();
  aufprall.buffer = rauschen;
  const tp = c.createBiquadFilter();
  tp.type = 'lowpass';
  tp.frequency.value = AUFPRALL_HZ;
  tp.Q.value = 0.9;
  aufprall.connect(tp).connect(huelle(AUFPRALL_PEGEL * pegel, 0.002, AUFPRALL_DAUER)).connect(bus);
  aufprall.start(t);
  // Knall: kurzes Bandpass-Rauschen
  const knall = c.createBufferSource();
  knall.buffer = rauschen;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = KNALL_HZ;
  bp.Q.value = KNALL_Q;
  knall.connect(bp).connect(huelle(KNALL_PEGEL * pegel, 0.001, KNALL_DAUER)).connect(bus);
  knall.start(t);
  knall.stop(t + KNALL_DAUER + 0.05);
  // Metall: unharmonische Teiltöne, je zwei leicht gegeneinander verstimmt
  for (const [verh, p, ab] of METALL_TEILE) {
    for (const cent of [-METALL_VERSTIMMUNG, METALL_VERSTIMMUNG]) {
      const osc = c.createOscillator();
      osc.frequency.value = METALL_HZ * verh * ton * 2 ** (cent / 1200);
      osc.connect(huelle(p * pegel / 2, 0.002, ab)).connect(bus);
      osc.start(t);
      osc.stop(t + ab + 0.05);
    }
  }
}

// Hall: Stereo-Impulsantwort aus unabhängigem Rauschen je Kanal, nach kurzem
// Vorlauf exponentiell auf −60 dB abklingend; ein einpoliger Tiefpass, der
// mit der Zeit zunimmt, macht den Nachklang dunkler (wie in einem Raum)
function hallImpuls(c) {
  const n = Math.round(c.sampleRate * HALL_DAUER);
  const buf = c.createBuffer(2, n, c.sampleRate);
  for (let k = 0; k < 2; k++) {
    const d = buf.getChannelData(k);
    let tief = 0;
    for (let i = 0; i < n; i++) {
      const t = i / c.sampleRate;
      const a = Math.min(0.96, 0.15 + 0.8 * t / HALL_DAUER);
      tief = tief * a + (Math.random() * 2 - 1) * (1 - a);
      d[i] = t < HALL_VORLAUF ? 0 : tief * 10 ** (-3 * t / HALL_DAUER);
    }
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
// Löst auf, sobald der Auftakt hörbar verklungen ist — sofort, wenn
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
  const { ende, hoerbar, aus } = auftaktSynth(ctx, ctx.destination, t);
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
  setTimeout(loese, (hoerbar - ctx.currentTime) * 1000);   // hörbar verklungen, ab jetzt
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
