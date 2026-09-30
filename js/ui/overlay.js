// Vollbild-Overlay für Graphen: beliebige Zeichenfunktion auf großem Canvas,
// Tap irgendwo schließt, Zurück-Taste ebenso (History-Eintrag über
// oeffneModal). Genutzt von Programm-Vorschau und Detailansicht.

import { beobachte } from './chart.js';
import { oeffneModal } from '../navigation.js';

// titel fett, zusatz grau dahinter — beides als Text, nie als HTML
// (Titel sind oft Programmnamen aus importierten .zwo-Dateien)
export function zeigeGraphOverlay(zeichne, titel = '', zusatz = '') {
  const dlg = document.querySelector('#dlg-graph');
  const canvas = document.querySelector('#graph-big');
  const grau = document.createElement('span');
  grau.textContent = zusatz ? ` · ${zusatz}` : '';
  document.querySelector('#graph-title').replaceChildren(titel, grau);
  dlg.onclick = () => dlg.close();
  oeffneModal(dlg, 'graph');
  zeichne(canvas);       // nach showModal: Canvas braucht sein Layout
  // Drehen/Größenänderung: neu zeichnen, sonst streckt der Browser das alte Bild
  const abmelden = beobachte(canvas, zeichne);
  dlg.addEventListener('close', abmelden, { once: true });
}
