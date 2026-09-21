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
    // Signal an Chrome: dieses Video darf beim App-Verlassen automatisch
    // in PiP wechseln (Best Effort — Chrome entscheidet nach Media-
    // Engagement-Index und Nutzer-Setting)
    this.#video.autoPictureInPicture = true;
    this.#video.style.display = 'none';
    document.body.append(this.#video);
  }

  #stelleStreamSicher() {
    if (this.#track) return;
    const stream = this.#canvas.captureStream(0);
    this.#track = stream.getVideoTracks()[0];
    this.#video.srcObject = stream;
  }

  #beiEnde() {
    this.#video.addEventListener('leavepictureinpicture', () => {
      this.aktiv = false;
      this.onEnde?.();
    }, { once: true });
  }

  // Fahrtstart: Stream scharf halten + Auto-PiP-Handler registrieren,
  // damit browser-initiiertes PiP (ohne User-Geste) möglich wird
  async arm(datenFn) {
    this.#datenFn = datenFn;
    this.#stelleStreamSicher();
    this.#zeichne();
    try { await this.#video.play(); } catch { /* ohne Geste evtl. verweigert */ }
    try {
      navigator.mediaSession.setActionHandler('enterpictureinpicture', async () => {
        try {
          await this.#video.requestPictureInPicture();
          this.aktiv = true;
          this.#beiEnde();
          this.onAuto?.();
        } catch { /* Chrome hat es sich anders überlegt */ }
      });
    } catch { /* Action in diesem Browser unbekannt */ }
  }

  disarm() {
    try { navigator.mediaSession.setActionHandler('enterpictureinpicture', null); } catch { /* egal */ }
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
    this.#stelleStreamSicher();
    this.#zeichne();
    await this.#video.play();
    await this.#video.requestPictureInPicture();
    this.aktiv = true;
    this.#beiEnde();
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
    this.disarm();
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
  // Slot fix auf 3 Ziffern bemessen — die Anzeige springt sonst bei 99→100
  const wattSlot = c.measureText('000').width;
  c.fillText(String(d.watt), w / 2, 128);
  c.font = '600 30px system-ui';
  c.fillStyle = '#8fa3a6';
  c.textAlign = 'left';
  c.fillText('W', w / 2 + wattSlot / 2 + 12, 128);
  c.textAlign = 'center';

  // Ziel darunter — die eine Zahl, gegen die ERG gerade regelt
  c.font = '500 34px system-ui';
  c.fillStyle = '#45c7d4';
  c.fillText(`Ziel ${d.ziel} W`, w / 2, 176);

  // Untere Zeile: Rest · rpm · ♥HF (HF nur mit Gurt). Als EINE zentrierte
  // Gruppe mit festen Lücken layoutet — ein Spaltenraster kollidiert bei
  // 3-stelligen Werten (Einheit ragte ins Herz der HF).
  const LUECKE = 44, WERT_F = '600 42px system-ui', EINH_F = '400 26px system-ui';
  const segmente = [];
  if (d.rest) segmente.push({ wert: d.rest, slot: '00:00', einheit: '', farbe: '#e8f1f2' });
  segmente.push({ wert: String(d.rpm || '–'), slot: '000', einheit: 'rpm', farbe: '#e8f1f2' });
  if (d.hr) segmente.push({ wert: `♥ ${d.hr}`, slot: '♥ 000', einheit: '', farbe: '#ef6b5e' });
  c.textAlign = 'left';
  for (const s of segmente) {
    c.font = WERT_F;
    // Slot nach Maximalbreite bemessen (Ziffern fix 3-stellig gedacht) —
    // die Zeile bleibt damit über alle Werte hinweg ortsstabil
    s.wb = c.measureText(s.slot ?? s.wert).width;
    c.font = EINH_F;
    s.eb = s.einheit ? c.measureText(s.einheit).width + 8 : 0;
  }
  const gesamt = segmente.reduce((a, s) => a + s.wb + s.eb, 0)
    + LUECKE * (segmente.length - 1);
  let x = (w - gesamt) / 2;
  for (const s of segmente) {
    c.fillStyle = s.farbe;
    c.font = WERT_F;
    const istB = c.measureText(s.wert).width;
    c.fillText(s.wert, x + (s.wb - istB) / 2, 246);
    x += s.wb;
    if (s.einheit) {
      c.fillStyle = '#8fa3a6';
      c.font = EINH_F;
      c.fillText(s.einheit, x + 8, 246);
      x += s.eb;
    }
    x += LUECKE;
  }
  c.textAlign = 'center';
}
