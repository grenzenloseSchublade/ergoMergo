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

export function istEntsperrt() { return entsperrt; }

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
export function wecke() {
  if (!ctx) return Promise.resolve();
  clearTimeout(suspendTimer);
  if (ctx.state === 'suspended')
    return ctx.resume().then(() => { entsperrt = true; }).catch(() => { /* ohne Ton weiter */ });
  return Promise.resolve();
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
  if (!ctx) return;
  if (!entsperrt && ctx.state === 'suspended') return;   // verwerfen statt aufstauen
  await wecke();
  const t = ctx.currentTime + 0.05;
  // hart (Watt rauf): A-Dur-Dreiklang aufwärts, Schlusston gehalten — „es
  // geht rauf". weich (Watt runter): zwei Töne abwärts — „wird leichter".
  if (hart) { tone(880, t, 0.11); tone(1109, t + 0.13, 0.11); tone(1319, t + 0.26, 0.45, 0.5, true); }
  else { tone(1319, t, 0.11, 0.4); tone(880, t + 0.13, 0.4, 0.5, true); }
}

// Kurzer Bestätigungs-Tick für Controller-Tastendrücke
export async function tick() {
  if (!ctx) return;
  if (!entsperrt && ctx.state === 'suspended') return;   // verwerfen statt aufstauen
  await wecke();
  tone(1200, ctx.currentTime + 0.02, 0.035, 0.15);
}

export async function countdown() {
  navigator.vibrate?.(80);
  if (!ctx) return;
  if (!entsperrt && ctx.state === 'suspended') return;   // verwerfen statt aufstauen
  await wecke();
  tone(880, ctx.currentTime + 0.05, 0.09, 0.4);
}

// Sprachansage (SpeechSynthesis) — z. B. „3 Minuten, 210 Watt"
export function sage(text) {
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'de-DE';
    u.rate = 1.1;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch { /* nicht überall verfügbar */ }
}

export async function fertig() {
  navigator.vibrate?.([150, 80, 150, 80, 400]);
  if (!ctx) return;
  if (!entsperrt && ctx.state === 'suspended') return;   // verwerfen statt aufstauen
  await wecke();
  const t = ctx.currentTime + 0.05;
  // Festliches Dur-Arpeggio aufwärts, Schlusston gehalten
  [659, 784, 1047].forEach((f, i) => tone(f, t + i * 0.16, 0.15));
  tone(1319, t + 3 * 0.16, 0.5, 0.5, true);
}
