// Lenkeransicht der Zwift-Ride-Tasten: je Griffzone eine Zeile, in der Mitte
// ein kleines Seitenansichts-Piktogramm (Griff + Hebel) mit der Zone orange
// hervorgehoben, links/rechts die Tastensymbole der jeweiligen Lenkerseite.
// Belegte Tasten tragen die Aktion als Marke. Zone und Anordnung kommen aus
// der Tastentabelle (Felder zone/raster), die Symbole aus tasten-symbol.js.

import { alleTasten } from '../ble/zwift-controller.js';
import { tastenSymbol } from './tasten-symbol.js';
import { CONTROLLER_AKTIONEN, istBelegt } from './controller-aktionen.js';

const ZONEN = [
  ['oben', 'Griff oben'],
  ['vorne', 'Hebel vorne'],
  ['aussen', 'Hebel außen'],
  ['unten', 'Außen unten'],
];

const MARKE = Object.fromEntries(CONTROLLER_AKTIONEN.map(a => [a.key, a.marke]));

// Seitenansicht eines Griffs von außen, vorne = links: Griffkörper auf dem
// Lenker, davor der Hebel. Der Rennradlenker kommt vom Fahrer (rechts),
// biegt unter dem Griff nach vorne-unten und läuft unten zurück (Unterlenker).
// Eigene Zeichnung.
const HEBEL = 'M10.5 18 L20.5 20 L15.8 43 C15.2 46.2 11 46.6 9.8 44 L7.8 38.5 Z';
const UMRISS = `
  <path class="lk-lenker" d="M47 13 L30 13 C23 13 21 21 21 28 C21 36 25 41 33 41 L47 41"/>
  <path class="lk-form" d="M9 14 C9 9 12 6 16 6 L30 7.5 C33 8 35 10 35 13 L35 17 C35 20 33 21 30 21 L16 21 C12 21 9 18 9 14 Z"/>
  <path class="lk-form" d="${HEBEL}"/>`;
const HERVOR = {
  oben: '<ellipse class="lk-an" cx="22" cy="6.6" rx="7" ry="2.4"/>',
  // Paddle: die ganze Vorderkante des Hebels
  vorne: '<path class="lk-an-linie" d="M10.3 19.5 L7.9 38.3"/>',
  // Schalttasten übereinander auf der Außenseite
  aussen: '<rect class="lk-an" x="13.6" y="23.5" width="3.8" height="4.6" rx="1.1"/><rect class="lk-an" x="12.6" y="29.6" width="3.8" height="4.6" rx="1.1"/>',
  // Drop-Taste: kleiner runder Knopf unterhalb der Schalttasten
  unten: '<circle class="lk-an" cx="13" cy="38.6" r="2.1"/>',
};
const piktogramm = zone =>
  `<svg class="lk-pikto" viewBox="0 0 48 48" aria-hidden="true">${UMRISS}${HERVOR[zone]}</svg>`;

// map: { aktion → bit }, blink: Bit, das gerade gedrückt wurde (Lern-Modus)
export function lenkerKarte(map = {}, { blink = null } = {}) {
  const aktionJeBit = new Map(CONTROLLER_AKTIONEN
    .filter(a => istBelegt(map, a.key)).map(a => [map[a.key], a.key]));
  // Ein/Aus ist ungeprüft und für ergoMergo nicht belegbar — nicht zeigen
  const tasten = alleTasten().filter(t => t.gruppe !== 'system');

  const taste = t => {
    const aktion = aktionJeBit.get(t.bit);
    const pos = t.raster ? ` style="grid-row:${t.raster[0] + 1};grid-column:${t.raster[1] + 1}"` : '';
    const cls = ['lk-taste', aktion ? 'belegt' : '', t.bit === blink ? 'blink' : ''].filter(Boolean).join(' ');
    return `<span class="${cls}"${pos}>${tastenSymbol(t.bit)}` +
      (aktion ? `<b class="lk-marke">${MARKE[aktion]}</b>` : '') + '</span>';
  };
  const gruppe = (seite, zone) => {
    const liste = tasten.filter(t => t.seite === seite && t.zone === zone);
    const raster = liste.some(t => t.raster);
    return `<div class="lk-gruppe lk-${seite}${raster ? ' lk-raster' : ''}">${liste.map(taste).join('')}</div>`;
  };

  // Legende: nur Aktionen, die belegt sind — erklärt die Marken an den Tasten
  const legende = CONTROLLER_AKTIONEN.filter(a => istBelegt(map, a.key))
    .map(a => `<span><b class="lk-marke">${a.marke}</b>${a.kurz}</span>`).join('');

  return `<div class="lk-karte">
    <span class="lk-kopf">Links</span><span></span><span class="lk-kopf">Rechts</span>
    ${ZONEN.map(([zone, name]) => `
      ${gruppe('links', zone)}
      <div class="lk-zone">${piktogramm(zone)}<small>${name}</small></div>
      ${gruppe('rechts', zone)}`).join('')}
    ${legende ? `<div class="lk-legende">${legende}</div>` : ''}
  </div>`;
}
