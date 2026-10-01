// Akustik + Vibration für Blockwechsel. Töne über die AudioContext-Uhr
// geplant, damit Timer-Drosselung im Hintergrund sie nicht verschluckt.
//
// Android-Audiofokus: ein AudioContext im Zustand 'running' hält den Fokus
// DAUERHAFT — Spotify & Co. bleiben stumm, solange die App fährt (Livetest).
// Deshalb: Context nur zum Abspielen wecken, nach der letzten Quelle wieder
// suspendieren — der Fokus geht zurück an die Musik-App.

let ctx = null;
let suspendTimer = null;
let aktiveQuellen = 0;
// Erst nach dem ersten erfolgreichen resume() (User-Geste) dürfen Töne
// geplant werden — vorher hängt resume() endlos und Töne würden sich
// aufstauen und beim ersten Tap gleichzeitig herausplatzen (?demo-Autostart)
let entsperrt = false;

// Geteilter Context für ansagen.js (Bausteine über dieselbe Audio-Uhr)
export function audioCtx() { return ctx; }

// Muss aus einer User-Geste heraus aufgerufen werden (Autoplay-Policy).
// Das erste resume() entsperrt den Context — spätere wecke()-Aufrufe
// brauchen dann keine Geste mehr.
export function initAudio() {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') ctx.resume().then(() => { entsperrt = true; }).catch(() => {});
    else entsperrt = true;
    suspendBald(1500);
  } catch { /* ohne Audio weiterfahren */ }
}

// Vor jeder Wiedergabe: anstehenden Suspend abräumen, Context aufwecken.
// Liefert ein Promise, das nach dem resume() auflöst — Töne erst DANACH
// planen (wie spiele() in ansagen.js): synchron bei suspended geplante
// Oszillatoren gehen auf Android teils verloren.
function wecke() {
  if (!ctx) return Promise.resolve();
  clearTimeout(suspendTimer);
  if (ctx.state === 'suspended')
    return ctx.resume().then(() => { entsperrt = true; }).catch(() => { /* ohne Ton weiter */ });
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

// Fahrtende: nichts spielt mehr — Fokus sofort freigeben
export function audioSchlafen() { aktiveQuellen = 0; suspendBald(0); }

function suspendBald(ms = 250) {
  clearTimeout(suspendTimer);
  suspendTimer = setTimeout(() => {
    if (!aktiveQuellen && ctx?.state === 'running') ctx.suspend().catch(() => { /* egal */ });
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
  if (!await bereit()) return;
  const t = ctx.currentTime + 0.05;
  // EIN gehaltener Ton genau beim Wechsel (nach den Countdown-Beeps) —
  // keine Vortöne. Unterscheidung über die Höhe: hart (Watt rauf) hoch,
  // weich (Watt runter) tief.
  if (hart) tone(1319, t, 0.5, 0.5, true);
  else tone(880, t, 0.5, 0.5, true);
}

// Kurzer Bestätigungs-Tick für Controller-Tastendrücke
export async function tick() {
  if (!await bereit()) return;
  tone(1200, ctx.currentTime + 0.02, 0.035, 0.15);
}

export async function countdown() {
  navigator.vibrate?.(80);
  if (!await bereit()) return;
  tone(880, ctx.currentTime + 0.05, 0.09, 0.4);
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
export function sage(text) {
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
  if (!await bereit()) return;
  const t = ctx.currentTime + 0.05;
  // Festliches Dur-Arpeggio aufwärts, Schlusston gehalten
  [659, 784, 1047].forEach((f, i) => tone(f, t + i * 0.16, 0.15));
  tone(1319, t + 3 * 0.16, 0.5, 0.5, true);
}
