// Kleines Symbol je Zwift-Ride-Taste, dem Lenker nachempfunden — für
// Belegungsanzeige und Lern-Modus. Form und Farbe kommen aus der Gruppe
// der Tastentabelle (zwift-ride-tasten.json), das Icon aus deren „symbol".

import { svgIcon } from './icons.js';
import { tasteInfo } from '../ble/zwift-controller.js';

const FARBKLASSE = { grün: 'ts-gruen', magenta: 'ts-magenta', blau: 'ts-blau', orange: 'ts-orange' };

export function tastenSymbol(bit) {
  const t = tasteInfo(bit);
  const seite = t?.seite === 'links' ? 'L' : 'R';
  switch (t?.gruppe) {
    case 'steuerkreuz':
      return `<span class="ts">${svgIcon(t.symbol)}</span>`;
    case 'aktion':                                   // farbige Rundtaste wie am Lenker
      return `<span class="ts ts-rund ${FARBKLASSE[t.farbe] ?? ''}">${t.label}</span>`;
    case 'schalten':
    case 'zusatz':
      return `<span class="ts ts-pill">${svgIcon(t.symbol)}${seite}</span>`;
    case 'paddle':
      return `<span class="ts ts-pill ts-paddle">${t.richtung > 0 ? '+' : '−'}${seite}</span>`;
    default:                                         // unbekannt/ungeprüft: Bit-Nummer
      return `<span class="ts ts-pill">${bit}</span>`;
  }
}
