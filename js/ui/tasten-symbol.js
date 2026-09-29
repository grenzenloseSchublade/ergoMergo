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
    case 'schalten':                                 // klein und orange wie am Lenkerende
      return `<span class="ts ts-pill ts-klein ts-orange-rand">${svgIcon(t.symbol)}<span>${seite}</span></span>`;
    case 'zusatz':                                   // kleiner Knopf am Bremshebel
      return `<span class="ts ts-pill ts-klein">${svgIcon(t.symbol)}<span>${seite}</span></span>`;
    case 'paddle':                                   // großer Hebel
      return `<span class="ts ts-orange-rand ts-paddle"><span>${t.richtung > 0 ? '+' : '−'}</span><span>${seite}</span></span>`;
    default:                                         // unbekannt/ungeprüft: Bit-Nummer
      return `<span class="ts ts-pill">${bit}</span>`;
  }
}
