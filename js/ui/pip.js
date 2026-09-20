// Bild-in-Bild-Fenster mit den Livewerten (Experiment). Android kennt kein
// Document-PiP — einziger Weg ist der Canvas-Trick: canvas.captureStream(0)
// → verstecktes <video muted playsinline> → requestPictureInPicture in der
// User-Geste. Frames werden aktiv per track.requestFrame() geschoben, weil
// requestAnimationFrame im Hintergrund gedrosselt wird.

export class PiP {
  #canvas = document.createElement('canvas');
  #video = document.createElement('video');
  #track = null;
  #datenFn = null;
  aktiv = false;
  onEnde = null;                 // UI-Callback, wenn das Fenster geschlossen wird

  constructor() {
    this.#canvas.width = 480;
    this.#canvas.height = 270;
    this.#video.muted = true;
    this.#video.playsInline = true;
    this.#video.style.display = 'none';
    document.body.append(this.#video);
  }

  static verfuegbar() {
    return document.pictureInPictureEnabled === true;
  }

  // In einer User-Geste aufrufen. datenFn liefert {watt, ziel, rest, farbe}.
  async toggle(datenFn) {
    if (this.aktiv) {
      await document.exitPictureInPicture().catch(() => {});
      return false;
    }
    this.#datenFn = datenFn;
    if (!this.#track) {
      const stream = this.#canvas.captureStream(0);
      this.#track = stream.getVideoTracks()[0];
      this.#video.srcObject = stream;
    }
    this.#zeichne();
    await this.#video.play();
    await this.#video.requestPictureInPicture();
    this.aktiv = true;
    this.#video.addEventListener('leavepictureinpicture', () => {
      this.aktiv = false;
      this.onEnde?.();
    }, { once: true });
    return true;
  }

  // Im Session-Tick aufrufen (1 Hz reicht fürs kleine Fenster)
  update() {
    if (this.aktiv) this.#zeichne();
  }

  #zeichne() {
    const d = this.#datenFn?.();
    if (!d) return;
    zeichnePipBild(this.#canvas, d);
    this.#track?.requestFrame?.();
  }

  destroy() {
    if (this.aktiv) document.exitPictureInPicture().catch(() => {});
    this.aktiv = false;
    this.#video.remove();
    this.#track?.stop();
    this.#track = null;
  }
}

// Bildaufbau separat und testbar: Ist-Watt dominant (zonengefärbt),
// Ziel klein darunter, unten eine Zeile mit Intervall-Rest, rpm und —
// nur wenn ein Gurt Werte liefert — Herzfrequenz. Mehr passt in ein
// PiP-Fenster (real oft nur 120–260 px breit) nicht lesbar hinein.
export function zeichnePipBild(canvas, d) {
  const c = canvas.getContext('2d');
  const { width: w, height: h } = canvas;
  c.fillStyle = '#0b1113';
  c.fillRect(0, 0, w, h);

  // Ist-Watt, groß und mittig
  c.textAlign = 'center';
  c.textBaseline = 'alphabetic';
  c.fillStyle = d.farbe || '#e8f1f2';
  c.font = '700 108px system-ui';
  const wattText = String(d.watt);
  const wattBreite = c.measureText(wattText).width;   // im 108px-Font messen
  c.fillText(wattText, w / 2, 128);
  c.font = '600 30px system-ui';
  c.fillStyle = '#8fa3a6';
  c.textAlign = 'left';
  c.fillText('W', w / 2 + wattBreite / 2 + 12, 128);
  c.textAlign = 'center';

  // Ziel darunter — die eine Zahl, gegen die ERG gerade regelt
  c.font = '500 34px system-ui';
  c.fillStyle = '#45c7d4';
  c.fillText(`Ziel ${d.ziel} W`, w / 2, 176);

  // Untere Zeile: Rest · rpm · ♥HF (HF nur mit Gurt)
  const spalten = [];
  if (d.rest) spalten.push({ wert: d.rest, einheit: '', farbe: '#e8f1f2' });
  spalten.push({ wert: String(d.rpm || '–'), einheit: 'rpm', farbe: '#e8f1f2' });
  if (d.hr) spalten.push({ wert: `♥ ${d.hr}`, einheit: '', farbe: '#ef6b5e' });
  const teil = w / (spalten.length + 1);
  spalten.forEach((s, i) => {
    const x = teil * (i + 1);
    c.fillStyle = s.farbe;
    c.font = '600 42px system-ui';
    const wb = c.measureText(s.wert).width;
    c.fillText(s.wert, s.einheit ? x - 20 : x, 246);
    if (s.einheit) {
      c.fillStyle = '#8fa3a6';
      c.font = '400 26px system-ui';
      c.textAlign = 'left';
      c.fillText(s.einheit, x - 20 + wb / 2 + 8, 246);
      c.textAlign = 'center';
    }
  });
}
