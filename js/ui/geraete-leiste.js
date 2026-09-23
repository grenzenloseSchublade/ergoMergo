// Geräte-Leiste auf dem Home: reiner Renderer über den GeraeteManager.
// Icons: Lucide (lucide.dev, MIT) — inline, kein CDN.

import { geraeteManager, eintraegeVon, kannMerken } from '../ble/geraete.js';
import { getSettings } from '../storage.js';
import { toast, toastOk, toastErr } from './toast.js';
import { logError } from '../logger.js';
import { svgIcon } from './icons.js';

const $ = s => document.querySelector(s);

export const GL_ICONS = {
  trainer: svgIcon('bike'),
  hr: svgIcon('herzpuls'),
  controller: svgIcon('gamepad'),
};
export const GL_ROLLEN = [['trainer', 'Trainer'], ['hr', 'Herzgurt'], ['controller', 'Lenker']];

let glKette = Promise.resolve();
export function zeichneGeraeteLeiste() {
  // Serialisiert + atomar (Fragment): parallele Aufrufe (Boot, goHome,
  // change-Events) dürfen die Leiste nicht doppelt befüllen
  glKette = glKette.then(zeichneGeraeteLeisteInner).catch(err => logError('app', 'Geräteleiste', err.message));
  return glKette;
}

async function zeichneGeraeteLeisteInner() {
  const wrap = $('#geraete-leiste');
  if (!wrap) return;
  const geraete = (await getSettings()).geraete;
  const frag = document.createDocumentFragment();
  for (const [rolle, label] of GL_ROLLEN) {
    const eintraege = eintraegeVon(geraete, rolle);
    const status = await geraeteManager.status(rolle);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = status;
    const name = eintraege.length === 1 ? (eintraege[0].name ?? label)
      : eintraege.length === 2 ? `${label} (2 Pads)` : label;
    const anz = geraeteManager.clients(rolle).length;
    btn.innerHTML = `${GL_ICONS[rolle]}<i class="dot"></i>${status === 'fehlt' ? `+ ${label}` : name}${eintraege.length === 2 && status === 'verbunden' && anz < 2 ? ' · 1/2' : ''}`;
    btn.title = { fehlt: `${label} koppeln`, gemerkt: `${name} verbinden`, verbindet: 'verbindet …', verbunden: `${name} trennen` }[status];
    btn.onclick = async () => {
      try {
        if (status === 'verbunden') { geraeteManager.trenne(rolle); return; }
        if (status === 'verbindet') return;
        if (status === 'fehlt') {
          await geraeteManager.koppel(rolle);
          toastOk(`${label} gekoppelt & verbunden`);
          if (rolle === 'controller') toast('Tipp: linkes und rechtes Pad sind eigene Geräte — die andere Seite über „+ 2. Pad" koppeln');
        } else if ((await geraeteManager.autorisiert(rolle)).length === 0) {
          // verbinde() kann nur scheitern; die Geste ist noch frisch → direkt
          // der Chooser. Grund unterscheiden: ohne getDevices (Chrome-Flag)
          // kann sich die App keine Berechtigung merken — sonst ist sie
          // schlicht abgelaufen.
          toast(kannMerken()
            ? `${label}: Berechtigung abgelaufen — bitte neu wählen`
            : `${label}: Schnellverbinden braucht ein Chrome-Flag — Hinweis in den Einstellungen`);
          await geraeteManager.koppel(rolle);
          toastOk(`${label} neu gekoppelt & verbunden`);
        } else {
          const n = await geraeteManager.verbinde(rolle);
          if (!n) toastErr(`${label} schläft — Gerät wecken (kurz bewegen/Pedal drehen) und erneut tippen`);
        }
      } catch (err) {
        if (err.name !== 'NotFoundError') toastErr(`${label}: ${err.message}`);
      }
    };
    frag.append(btn);
    // Lenker mit nur einem gemerkten Pad: zweites direkt anbieten
    if (rolle === 'controller' && eintraege.length === 1 && status !== 'verbindet') {
      const pad2 = document.createElement('button');
      pad2.type = 'button';
      pad2.className = 'zusatz fehlt';
      pad2.textContent = '+ 2. Pad';
      pad2.onclick = async () => {
        try {
          await geraeteManager.koppel('controller');
          toastOk('Zweites Pad gekoppelt & verbunden');
        } catch (err) {
          if (err.name !== 'NotFoundError') toastErr('Koppeln fehlgeschlagen: ' + err.message);
        }
      };
      frag.append(pad2);
    }
  }
  wrap.replaceChildren(frag);
}
geraeteManager.addEventListener('change', zeichneGeraeteLeiste);
