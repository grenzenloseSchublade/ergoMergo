// Bild-in-Bild-Fenster mit den Livewerten (Experiment). Android kennt kein
// Document-PiP — einziger Weg ist der Canvas-Trick: canvas.captureStream(0)
// → verstecktes <video muted playsinline> → requestPictureInPicture in der
// User-Geste. Frames werden aktiv per track.requestFrame() geschoben, weil
// requestAnimationFrame im Hintergrund gedrosselt wird.

import { zeichneIcon } from './icons.js';
import { tokenLeser, canvasSchrift } from './tokens.js';
import { logInfo, logWarn } from '../logger.js';

// Farb-Tokens zur Zeichenzeit aus dem CSS lesen — Palette-Änderungen
// ziehen damit automatisch ins PiP-Fenster mit
function tokens() {
  const t = tokenLeser();
  return { bg: t('--bg'), ink: t('--ink'), ink2: t('--ink2'), ink3: t('--ink3'), accent: t('--accent'),
    hr: t('--hr-line'), danger: t('--danger'), z2: t('--z2') };
}

export class PiP {
  #canvas = document.createElement('canvas');
  #video = document.createElement('video');
  #track = null;
  #datenFn = null;
  #zuDurch = null;               // wer schließt — fürs Diagnose-Log
  aktiv = false;
  onEnde = null;                 // UI-Callback, wenn das Fenster geschlossen wird
  onAuto = null;                 // UI-Callback, wenn Chrome das Fenster selbst öffnet

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

  // Geöffnet: Ende abonnieren und protokollieren (Diagnose-Log: ob das
  // Fenster überhaupt aufgeht — Auto-PiP entscheidet Chrome selbst)
  #beiEnde(durch) {
    logInfo('pip', 'Bild-in-Bild auf', { durch });
    this.#zuDurch = null;
    this.#video.addEventListener('leavepictureinpicture', () => {
      this.aktiv = false;
      logInfo('pip', 'Bild-in-Bild zu', { durch: this.#zuDurch ?? 'Fenster' });
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
          this.#beiEnde('automatisch');
          this.onAuto?.();
        } catch (err) { logInfo('pip', 'automatisches Bild-in-Bild abgelehnt', err.message); }
      });
    } catch { /* Action in diesem Browser unbekannt */ }
  }

  disarm() {
    try { navigator.mediaSession.setActionHandler('enterpictureinpicture', null); } catch { /* egal */ }
  }

  static verfuegbar() {
    return document.pictureInPictureEnabled === true;
  }

  // In einer User-Geste aufrufen. datenFn liefert die Werte für
  // zeichnePipBild (siehe dort).
  async toggle(datenFn) {
    if (this.aktiv) {
      this.#zuDurch = 'Nutzer';
      await document.exitPictureInPicture().catch(() => {});
      return false;
    }
    this.#datenFn = datenFn;
    this.#stelleStreamSicher();
    this.#zeichne();
    try {
      await this.#video.play();
      await this.#video.requestPictureInPicture();
    } catch (err) {
      logWarn('pip', 'Bild-in-Bild nicht möglich', err.message);
      throw err;
    }
    this.aktiv = true;
    this.#beiEnde('Nutzer');
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
    if (this.aktiv) {
      this.#zuDurch = 'Fahrtende';
      document.exitPictureInPicture().catch(() => {});
    }
    this.aktiv = false;
    this.#video.remove();
    this.#track?.stop();
    this.#track = null;
  }
}

// Bildaufbau separat und testbar: Ist-Watt dominant (zonengefärbt),
// darunter eine Zeile — im Programm das Ziel des NÄCHSTEN Blocks („danach
// 250 W"; ein Pfeil war bei 120 px Fensterbreite nicht mehr zu erkennen —
// das aktuelle Ziel hält ERG ohnehin, die Ist-Watt zeigen es), frei bzw. im
// letzten Block das Ziel, im Not-Stopp „GESTOPPT" —, unten Intervall-Rest,
// rpm (im Bereich eingefärbt wie auf dem Fahrbildschirm) und — nur
// wenn ein Gurt Werte liefert — Herzfrequenz (neutral, ab der Pulsgrenze
// die Zahl in --hr-line wie auf dem Fahrbildschirm). Mehr passt in ein
// PiP-Fenster (real oft nur 120–260 px breit) nicht lesbar hinein.
// d: { watt, ziel, naechstes (W oder null), gestoppt, rest, rpm,
//      rpmLage ('drin' | 'daneben' | ''), rpmPfeil (+1 | −1 | 0), hr,
//      hrUeber (Pulsgrenze erreicht), farbe }
export function zeichnePipBild(canvas, d) {
  const c = canvas.getContext('2d');
  const { width: w } = canvas;
  const farbe = tokens();
  c.fillStyle = farbe.bg;
  c.fillRect(0, 0, w, canvas.height);

  // Ist-Watt, groß und mittig; im Not-Stopp gedämpft (der Trainer regelt
  // nicht mehr — die Zahl ist dann nur noch Auslaufen)
  c.textAlign = 'center';
  c.textBaseline = 'alphabetic';
  c.fillStyle = d.gestoppt ? farbe.ink3 : d.farbe || farbe.ink;
  c.font = canvasSchrift(108, 700);
  // Slot fix auf 3 Ziffern bemessen — die Anzeige springt sonst bei 99→100
  const wattSlot = c.measureText('000').width;
  c.fillText(String(d.watt), w / 2, 128);
  c.font = canvasSchrift(30, 600);
  c.fillStyle = farbe.ink2;
  c.textAlign = 'left';
  c.fillText('W', w / 2 + wattSlot / 2 + 12, 128);
  c.textAlign = 'center';

  // Zeile darunter: Not-Stopp geht vor, sonst was als Nächstes kommt
  if (d.gestoppt) {
    c.font = canvasSchrift(34, 700);
    c.fillStyle = farbe.danger;
    c.fillText('GESTOPPT', w / 2, 176);
  } else {
    c.font = canvasSchrift(34, 500);
    c.fillStyle = farbe.accent;
    c.fillText(d.naechstes != null ? `danach ${d.naechstes} W` : `Ziel ${d.ziel} W`, w / 2, 176);
  }

  // Untere Zeile: Rest · rpm · HF — Icons aus derselben Quelle wie der
  // Fahrbildschirm (icons.js), als EINE zentrierte Gruppe mit festen Lücken
  const LUECKE = 36, ICON = 26, ICON_ABSTAND = 8, WERT_F = canvasSchrift(42, 600);
  const PFEIL_ABSTAND = 10, PFEIL_B = 14, PFEIL_H = 28;
  const segmente = [];
  if (d.rest) segmente.push({ wert: d.rest, slot: '00:00', icon: 'timer', farbe: farbe.ink });
  // rpm wie auf dem Fahrbildschirm: im Bereich eingefärbt, nach 5 s daneben
  // gedämpft — dazu (nur hier) ein schmaler Pfeil, was zu tun ist: ↑ schneller
  // treten, ↓ langsamer. Sein Platz ist immer reserviert, nichts springt.
  segmente.push({ wert: String(d.rpm || '–'), slot: '000', icon: 'rotate', pfeil: d.rpmPfeil || 0, pfeilPlatz: true,
    farbe: d.rpmLage === 'drin' ? farbe.z2 : d.rpmLage === 'daneben' ? farbe.ink3 : farbe.ink });
  if (d.hr) segmente.push({ wert: String(d.hr), slot: '000', icon: 'herzpuls', farbe: d.hrUeber ? farbe.hr : farbe.ink });
  c.textAlign = 'left';
  c.font = WERT_F;
  for (const s of segmente) {
    s.zahlB = c.measureText(s.slot).width;
    s.wb = ICON + ICON_ABSTAND + s.zahlB + (s.pfeilPlatz ? PFEIL_ABSTAND + PFEIL_B : 0);
  }
  const gesamt = segmente.reduce((a, s) => a + s.wb, 0) + LUECKE * (segmente.length - 1);
  let x = (w - gesamt) / 2;
  for (const s of segmente) {
    zeichneIcon(c, s.icon, x, 246 - 32, ICON, farbe.ink2);
    c.fillStyle = s.farbe;
    c.font = WERT_F;
    const slotB = s.zahlB;
    const istB = c.measureText(s.wert).width;
    c.fillText(s.wert, x + ICON + ICON_ABSTAND + (slotB - istB) / 2, 246);
    if (s.pfeil) zeichnePfeil(c, x + ICON + ICON_ABSTAND + slotB + PFEIL_ABSTAND + PFEIL_B / 2, 246 - 16,
      PFEIL_B, PFEIL_H, s.pfeil, s.farbe);
    x += s.wb + LUECKE;
  }
}

// Schmaler Pfeil um die Mitte (mx, my): richtung +1 nach oben, −1 nach unten
function zeichnePfeil(c, mx, my, breite, hoehe, richtung, farbe) {
  const spitze = my - richtung * hoehe / 2, ende = my + richtung * hoehe / 2;
  const kopf = richtung * breite * 0.6;
  c.save();
  c.strokeStyle = farbe;
  c.lineWidth = 3;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.beginPath();
  c.moveTo(mx, ende); c.lineTo(mx, spitze);
  c.moveTo(mx - breite / 2, spitze + kopf); c.lineTo(mx, spitze); c.lineTo(mx + breite / 2, spitze + kopf);
  c.stroke();
  c.restore();
}
