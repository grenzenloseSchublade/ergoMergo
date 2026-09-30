// Statuszeile im LED-Punktmatrix-Look: der Text wird in ein grobes Raster
// gerechnet (Systemschrift, Schwellwert) und jede Zelle als LED-Punkt
// gezeichnet, unbeleuchtete Punkte schwach sichtbar wie auf einer
// Anzeigetafel. Der Text läuft immer von rechts nach links: eine neue
// Meldung beginnt am linken Rand (sofort lesbar), läuft hinaus und kommt
// rechts wieder herein. Bei „Bewegung reduzieren" steht er links still.
// Der echte Text steht für Screenreader im DOM (sr-Span), das Canvas ist
// aria-hidden.

const ZEILEN = 11;              // Punktzeilen (Schrift ≈ 8 hoch + Unterlänge)
const TEMPO = 24;               // Punkte pro Sekunde
const BILDRATE_MS = 1000 / 30;  // 30 Bilder/s reichen für die Laufschrift

const wenigBewegung = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// Text → Punktraster [zeile][spalte] (true = leuchtet). Ein Quellpixel pro Punkt.
function raster(text) {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  const font = `600 ${ZEILEN}px system-ui, sans-serif`;
  // Ein Punkt Abstand zwischen den Zeichen — sonst verschmelzen „ch", „W" …
  const stil = x => { x.font = font; x.letterSpacing = '1px'; };
  stil(ctx);
  const breite = Math.max(1, Math.ceil(ctx.measureText(text).width));
  c.width = breite;
  c.height = ZEILEN;
  stil(ctx);                                // Größenänderung setzt den Kontext zurück
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#fff';
  ctx.fillText(text, 0, ZEILEN - 3);        // 3 Zeilen Platz für Unterlängen
  const px = ctx.getImageData(0, 0, breite, ZEILEN).data;
  const r = [];
  for (let y = 0; y < ZEILEN; y++) {
    const z = new Uint8Array(breite);
    for (let x = 0; x < breite; x++) z[x] = px[(y * breite + x) * 4 + 3] > 100 ? 1 : 0;
    r.push(z);
  }
  return { r, breite };
}

export class LedZeile {
  constructor(el) {
    this.el = el;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'led';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.sr = document.createElement('span');
    this.sr.className = 'sr-text';
    el.replaceChildren(this.canvas, this.sr);
    this.text = '';
    this.farbe = null;
    this.bild = null;
    this.raf = 0;
    this.ro = new ResizeObserver(() => this.#zeichne());
    this.ro.observe(el);
    // Im Hintergrund ruht die Laufschrift; beim Zurückkommen weiterlaufen
    this.#sichtbar = () => { if (!document.hidden) this.#zeichne(); };
    document.addEventListener('visibilitychange', this.#sichtbar);
  }

  #sichtbar = null;
  #naechstes = 0;
  // Bildtakt begrenzen: rAF liefert 60–120 Hz, die Laufschrift braucht 30
  #takt = t => {
    if (t < this.#naechstes) { this.raf = requestAnimationFrame(this.#takt); return; }
    this.#zeichne();
  };

  // text leer = Tafel aus; art: 'err' | 'ok' | ''
  setze(text, art = '') {
    if (text === this.text && art === this.art) return;
    this.text = text;
    this.art = art;
    this.sr.textContent = text;
    this.bild = text ? raster(text) : null;
    this.start = performance.now();
    this.#zeichne();
  }

  #zeichne = () => {
    cancelAnimationFrame(this.raf);
    const { canvas, el } = this;
    const w = el.clientWidth, h = el.clientHeight;
    if (!w || !h) return;
    const dpr = devicePixelRatio || 1;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const css = getComputedStyle(el);
    const p = h / (ZEILEN + 1);                  // Punktabstand aus der Höhe
    const spalten = Math.floor(w / p);
    const x0 = (w - spalten * p) / 2 + p / 2, y0 = p;
    const rAus = p * 0.3, rAn = p * 0.4;

    // Unbeleuchtete Punkte der Tafel
    ctx.fillStyle = css.getPropertyValue('--led-aus').trim() || 'rgba(255,255,255,.05)';
    ctx.beginPath();
    for (let y = 0; y < ZEILEN; y++)
      for (let s = 0; s < spalten; s++) { ctx.moveTo(x0 + s * p + rAus, y0 + y * p); ctx.arc(x0 + s * p, y0 + y * p, rAus, 0, 7); }
    ctx.fill();
    if (!this.bild) return;

    // Lage des Texts: startet am linken Rand, läuft nach links hinaus und
    // kommt rechts wieder herein (immer nur ein Exemplar sichtbar)
    const { r, breite } = this.bild;
    const laeuft = !wenigBewegung();
    let versatz = 0;
    if (laeuft) {
      const zyklus = breite + spalten;
      versatz = -Math.floor((performance.now() - this.start) / 1000 * TEMPO) % zyklus;
      if (versatz < -breite) versatz += zyklus;
    }
    const farbe = css.getPropertyValue(this.art === 'err' ? '--danger' : this.art === 'ok' ? '--ok' : '--ink2').trim();
    const zeichneText = dx => {
      ctx.beginPath();
      for (let y = 0; y < ZEILEN; y++) {
        const z = r[y];
        for (let x = 0; x < breite; x++) {
          if (!z[x]) continue;
          const s = x + dx;
          if (s < 0 || s >= spalten) continue;
          ctx.moveTo(x0 + s * p + rAn, y0 + y * p);
          ctx.arc(x0 + s * p, y0 + y * p, rAn, 0, 7);
        }
      }
      ctx.fill();
    };
    // Leuchten: weicher Hof unter dem Punkt, dann der Punkt selbst
    ctx.fillStyle = farbe;
    ctx.globalAlpha = 0.25;
    ctx.shadowColor = farbe;
    ctx.shadowBlur = p * 1.2;
    zeichneText(versatz);
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    zeichneText(versatz);

    if (laeuft && !document.hidden) {
      this.#naechstes = performance.now() + BILDRATE_MS;
      this.raf = requestAnimationFrame(this.#takt);
    }
  };

  destroy() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    document.removeEventListener('visibilitychange', this.#sichtbar);
  }
}
