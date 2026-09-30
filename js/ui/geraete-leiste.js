// Geräte-Leiste auf dem Home: reiner Renderer über den GeraeteManager.
// Icons: Lucide (lucide.dev, MIT) — inline, kein CDN.

import { geraeteManager, eintraegeVon } from '../ble/geraete.js';
import { getSettings } from '../storage.js';
import { esc } from '../format.js';
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
    btn.dataset.zustand = status;
    const name = eintraege.length === 1 ? (eintraege[0].name ?? label)
      : eintraege.length === 2 ? `${label} (2 Pads)` : label;
    const anz = geraeteManager.clients(rolle).length;
    btn.innerHTML = `${GL_ICONS[rolle]}<i class="dot"></i>${status === 'fehlt' ? `+ ${label}` : esc(name)}${eintraege.length === 2 && status === 'verbunden' && anz < 2 ? ' · 1/2' : ''}`;
    btn.title = { fehlt: `${label} koppeln`, gemerkt: `${name} verbinden`, verbindet: 'verbindet …', verbunden: `${name} trennen` }[status];
    btn.setAttribute('aria-label', `${label}: ${{ fehlt: 'nicht gekoppelt', gemerkt: 'nicht verbunden', verbindet: 'verbindet', verbunden: 'verbunden' }[status]}`);
    btn.onclick = async () => {
      if (status === 'verbindet') return;
      if (status === 'verbunden') {
        geraeteManager.trenne(rolle);
        toast(`${label} getrennt`);
        return;
      }
      await verbindeMitRueckmeldung(rolle, label);
    };
    frag.append(btn);
    // Lenker mit nur einem gemerkten Pad: zweites direkt anbieten
    if (rolle === 'controller' && eintraege.length === 1 && status !== 'verbindet') {
      const pad2 = document.createElement('button');
      pad2.type = 'button';
      pad2.className = 'zusatz';
      pad2.dataset.zustand = 'fehlt';
      pad2.textContent = '+ 2. Pad';
      pad2.onclick = () => koppelMitRueckmeldung('controller', 'Zweites Pad');
      frag.append(pad2);
    }
  }
  wrap.replaceChildren(frag);
}
geraeteManager.addEventListener('change', zeichneGeraeteLeiste);

// Einheitliche Texte zum Ergebnis von geraeteManager.verbindeOderKoppel —
// Home-Leiste, Fahrbildschirm, Lern-Modus und Fahrtstart sagen dasselbe
export function geraeteHinweis(label, { ergebnis, grund }) {
  if (ergebnis === 'schlaeft') return `${label} schläft — Gerät wecken (kurz bewegen/Pedal drehen) und erneut tippen`;
  if (grund === 'nichtAutorisiert') return `${label}: Berechtigung abgelaufen — bitte neu wählen`;
  if (grund === 'keinMerken') return `${label}: Schnellverbinden braucht ein Chrome-Flag — Hinweis in den Einstellungen`;
  return null;
}

// Verbinden (gemerkt) oder koppeln (Chooser) mit Toast-Rückmeldung
async function verbindeMitRueckmeldung(rolle, label, optionen = {}) {
  try {
    const r = await geraeteManager.verbindeOderKoppel(rolle, {
      ...optionen,
      vorAuswahl: grund => { const t = geraeteHinweis(label, { grund }); if (t) toast(t); },
    });
    if (r.ergebnis === 'gekoppelt') toastOk(`${label} gekoppelt & verbunden`);
    else if (r.ergebnis === 'schlaeft') toastErr(geraeteHinweis(label, r));
    return r;
  } catch (err) {
    toastErr(`${label}: ${err.message}`);
    return { ergebnis: 'fehler', grund: null };
  }
}

// Weiteres Gerät über den Chooser koppeln (z. B. zweites Lenker-Pad)
export async function koppelMitRueckmeldung(rolle, label) {
  return verbindeMitRueckmeldung(rolle, label, { auswahl: true });
}
