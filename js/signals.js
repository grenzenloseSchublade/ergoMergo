// Akustik + Vibration für Blockwechsel. Töne über die AudioContext-Uhr
// geplant, damit Timer-Drosselung im Hintergrund sie nicht verschluckt.

let ctx = null;

// Geteilter Context für ansagen.js (Bausteine über dieselbe Audio-Uhr)
export function audioCtx() { return ctx; }

// Muss aus einer User-Geste heraus aufgerufen werden (Autoplay-Policy).
export function initAudio() {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') ctx.resume();
  } catch { /* ohne Audio weiterfahren */ }
}

function tone(freq, at, dur = 0.15, gainVal = 0.4) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = freq;
  osc.type = 'square';
  gain.gain.setValueAtTime(gainVal, at);
  gain.gain.exponentialRampToValueAtTime(0.001, at + dur);
  osc.connect(gain).connect(ctx.destination);
  osc.start(at);
  osc.stop(at + dur);
}

export function blockwechsel(hart) {
  navigator.vibrate?.(hart ? [200, 100, 200] : 200);
  if (!ctx) return;
  const t = ctx.currentTime;
  if (hart) { tone(880, t); tone(880, t + 0.2); tone(1175, t + 0.4, 0.3); }
  else { tone(587, t, 0.25); }
}

// Kurzer Bestätigungs-Tick für Controller-Tastendrücke
export function tick() {
  if (!ctx) return;
  tone(1350, ctx.currentTime, 0.035, 0.18);
}

export function countdown() {
  navigator.vibrate?.(80);
  if (!ctx) return;
  tone(660, ctx.currentTime, 0.08, 0.25);
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

export function fertig() {
  navigator.vibrate?.([150, 80, 150, 80, 400]);
  if (!ctx) return;
  const t = ctx.currentTime;
  [523, 659, 784, 1047].forEach((f, i) => tone(f, t + i * 0.18, 0.16));
}
