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
    const c = this.#canvas.getContext('2d');
    const { width: w, height: h } = this.#canvas;
    c.fillStyle = '#0b1113';
    c.fillRect(0, 0, w, h);
    c.textAlign = 'center';
    c.fillStyle = d.farbe || '#e8f1f2';
    c.font = '700 110px system-ui';
    c.textBaseline = 'alphabetic';
    c.fillText(String(d.watt), w / 2, 150);
    c.font = '28px system-ui';
    c.fillStyle = '#8fa3a6';
    c.fillText('Watt', w / 2, 186);
    c.font = '600 34px system-ui';
    c.fillStyle = '#45c7d4';
    c.textAlign = 'left';
    c.fillText(`Ziel ${d.ziel} W`, 24, 244);
    if (d.rest) {
      c.textAlign = 'right';
      c.fillStyle = '#e8f1f2';
      c.fillText(d.rest, w - 24, 244);
    }
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
