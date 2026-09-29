// Kleines Symbol je Zwift-Ride-Taste, dem Lenker nachempfunden — für
// Belegungsanzeige und Lern-Modus. Form und Farbe kommen aus der Gruppe
// der Tastentabelle (zwift-ride-tasten.json), das Icon aus deren „symbol".

import { svgIcon } from './icons.js';
import { tasteInfo } from '../ble/zwift-controller.js';

const FARBKLASSE = { grün: 'ts-gruen', magenta: 'ts-magenta', blau: 'ts-blau', orange: 'ts-orange' };

// Farbe folgt der Taste am Lenker (Tabellenfeld farbe): Rundtasten gefüllt,
// alle anderen orange umrandet, wenn sie am Lenker orange sind
export function tastenSymbol(bit) {
  const t = tasteInfo(bit);
  const seite = t?.seite === 'links' ? 'L' : 'R';
  const rand = t?.farbe === 'orange' ? ' ts-orange-rand' : '';
  const mitSeite = cls => `<span class="ts ${cls}${rand}">${svgIcon(t.symbol)}<span>${seite}</span></span>`;
  switch (t?.gruppe) {
    case 'steuerkreuz':
      return `<span class="ts">${svgIcon(t.symbol)}</span>`;
    case 'aktion':                                   // farbige Rundtaste wie am Lenker
      return `<span class="ts ts-rund ${FARBKLASSE[t.farbe] ?? ''}">${t.label}</span>`;
    case 'schalten':                                 // kleine Tasten an der Hebel-Außenseite
    case 'zusatz':                                   // Drop-Taste: kleiner Knopf darunter
    case 'system':                                   // Ein/Aus
      return mitSeite('ts-pill ts-klein');
    case 'paddle':                                   // große Fläche vorne am Hebel, Pfeil = Druckrichtung
      return mitSeite('ts-paddle');
    default:                                         // unbekannt: Bit-Nummer
      return `<span class="ts ts-pill">${bit}</span>`;
  }
}
