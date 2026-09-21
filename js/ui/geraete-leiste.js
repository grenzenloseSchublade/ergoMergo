// Geräte-Leiste auf dem Home: reiner Renderer über den GeraeteManager.
// Icons: Lucide (lucide.dev, MIT) — inline, kein CDN.

import { geraeteManager, eintraegeVon } from '../ble/geraete.js';
import { getSettings } from '../storage.js';
import { toast, toastOk, toastErr } from './toast.js';
import { logError } from '../logger.js';

const $ = s => document.querySelector(s);

export const GL_ICONS = {
  trainer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18.5" cy="17.5" r="3.5"/><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="15" cy="5" r="1"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/></svg>',
  hr: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/><path d="M3.22 12H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27"/></svg>',
  controller: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="6" x2="10" y1="11" y2="11"/><line x1="8" x2="8" y1="9" y2="13"/><line x1="15" x2="15.01" y1="12" y2="12"/><line x1="18" x2="18.01" y1="10" y2="10"/><path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z"/></svg>',
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
        } else {
          const n = await geraeteManager.verbinde(rolle);
          if (!n) toastErr(`${label} nicht erreichbar — Gerät wach?`);
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
