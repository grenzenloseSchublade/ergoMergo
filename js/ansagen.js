// Hintergrundfeste Sprachansagen aus vorgerenderten Audio-Bausteinen
// (Piper-TTS „thorsten", audio/*.ogg). Grund: Android-Chrome stoppt
// SpeechSynthesis sobald die Seite hidden ist, WebAudio läuft weiter —
// Bausteine + Konkatenation über die AudioContext-Uhr überleben das.
// Live-TTS (signals.sage) bleibt nur Fallback, wenn Bausteine fehlen.

import { bereit, quelleStart, quelleEnde } from './signals.js';

const BASE = new URL('../audio/', import.meta.url);

let ctx = null;
const puffer = new Map();          // name → AudioBuffer | Promise
let generation = 0;                // jede neue/abgebrochene Ansage zählt hoch
let laufend = [];                  // geplante Quellen der aktuellen Ansage

const EINER = [null, 'ein', 'zwei', 'drei', 'vier', 'fuenf', 'sechs', 'sieben',
  'acht', 'neun', 'zehn', 'elf', 'zwoelf', 'dreizehn', 'vierzehn', 'fuenfzehn',
  'sechzehn', 'siebzehn', 'achtzehn', 'neunzehn'];
const ZEHNER = [null, null, 'zwanzig', 'dreissig', 'vierzig', 'fuenfzig',
  'sechzig', 'siebzig', 'achtzig', 'neunzig'];

// 1–999 als Baustein-Folge in deutscher Komposition:
// 216 → zwei|hundert|sechzehn, 85 → fuenf|und|achtzig, 1 → eins.
function zahlBausteine(n) {
  n = Math.round(n);
  if (n < 1 || n > 999) return null;
  const out = [];
  if (n >= 100) {
    if (n >= 200) out.push(EINER[Math.floor(n / 100)]);
    out.push('hundert');
    n %= 100;
  }
  if (n === 0) return out;
  if (n === 1) { out.push('eins'); return out; }   // auch "hunderteins"
  if (n < 20) { out.push(EINER[n]); return out; }
  const e = n % 10, z = Math.floor(n / 10);
  if (e) out.push(EINER[e], 'und');
  out.push(ZEHNER[z]);
  return out;
}

async function lade(name) {
  if (puffer.has(name)) return puffer.get(name);
  const p = fetch(new URL(`${name}.ogg`, BASE))
    .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.arrayBuffer(); })
    .then(b => ctx.decodeAudioData(b))
    .then(buf => { puffer.set(name, buf); return buf; })
    // Fehlschlag nicht merken: offline beim ersten Mal soll ein späterer
    // Versuch (wieder online, SW-Cache gefüllt) den Baustein noch laden
    .catch(() => { puffer.delete(name); return null; });
  puffer.set(name, p);
  return p;
}

// Beim Fahrtstart aufrufen: teilt den AudioContext der Signale und wärmt
// die häufigsten Bausteine vor (der Rest lädt bei der ersten Ansage).
export function initAnsagen(audioCtx) {
  ctx = audioCtx;
  if (!ctx) return;
  for (const n of ['minuten', 'minute', 'watt', 'und', 'hundert', 'fertig', 'sekunden']) lade(n);
}

// Laufende und geplante Ansage sofort verstummen lassen (Skip während der
// Ansage, Fahrtende, Ansagen ausgeschaltet) — sonst sprechen zwei Stimmen
// gleichzeitig bzw. eine geplante Folge spielt beim nächsten resume() weiter
export function stoppeAnsagen() {
  generation++;
  for (const src of laufend) { try { src.stop(); } catch { /* schon beendet */ } }
  laufend = [];
}

// Baustein-Folge lückenlos über die AudioContext-Uhr planen; eine neue
// Ansage ersetzt die vorige. Danach legt die Quellen-Zählung in signals.js
// den Context wieder schlafen — ein dauerhaft laufender Context hält sonst
// den Android-Audiofokus.
async function spiele(namen) {
  if (!ctx || !namen?.length) return false;
  stoppeAnsagen();
  const gen = generation;
  const bufs = await Promise.all(namen.map(lade));
  if (bufs.some(b => !b)) return false;         // Baustein fehlt → Fallback TTS
  if (!await bereit() || ctx.state !== 'running') return false;
  if (gen !== generation) return true;          // inzwischen abgebrochen/ersetzt
  let t = ctx.currentTime + 0.05;
  for (const buf of bufs) {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    quelleStart();
    src.onended = () => { laufend = laufend.filter(q => q !== src); quelleEnde(); };
    src.start(t);
    laufend.push(src);
    t += buf.duration + 0.02;
  }
  return true;
}

// „4 Minuten, 210 Watt"; krumme Dauern als „19 Minuten und 30 Sekunden".
// Liefert false, wenn eine Zahl nicht komponierbar ist (> 999) oder
// Bausteine fehlen — der Aufrufer nutzt dann Live-TTS als Fallback.
export function ansageBlock(dauerSek, watt) {
  const teile = [];
  if (dauerSek >= 60) {
    const min = Math.floor(dauerSek / 60), rest = Math.round(dauerSek % 60);
    const m = zahlBausteine(min);
    if (!m) return Promise.resolve(false);
    if (min === 1) teile.push('eine', 'minute');
    else teile.push(...m, 'minuten');
    // „eine Sekunde" gibt es nicht als Baustein („eins Sekunden" klänge
    // falsch) — dann Live-TTS
    if (rest === 1) return Promise.resolve(false);
    if (rest > 0) {
      const r = zahlBausteine(rest);
      if (!r) return Promise.resolve(false);
      teile.push('und', ...r, 'sekunden');
    }
  } else if (dauerSek > 0) {
    if (Math.round(dauerSek) === 1) return Promise.resolve(false);
    const r = zahlBausteine(Math.round(dauerSek));
    if (!r) return Promise.resolve(false);
    teile.push(...r, 'sekunden');
  }
  const w = zahlBausteine(watt);
  if (!w) return Promise.resolve(false);       // z. B. > 999 W
  teile.push(...w, 'watt');
  return spiele(teile);
}

export function ansageFertig() {
  return spiele(['fertig']);
}
