// Vollbild-Overlay für Graphen: beliebige Zeichenfunktion auf großem Canvas,
// Tap irgendwo schließt. Genutzt von Programm-Vorschau und Detailansicht.

// titel fett, zusatz grau dahinter — beides als Text, nie als HTML
// (Titel sind oft Programmnamen aus importierten .zwo-Dateien)
export function zeigeGraphOverlay(zeichne, titel = '', zusatz = '') {
  const dlg = document.querySelector('#dlg-graph');
  const canvas = document.querySelector('#graph-big');
  const grau = document.createElement('span');
  grau.textContent = zusatz ? ` · ${zusatz}` : '';
  document.querySelector('#graph-title').replaceChildren(titel, grau);
  // Drehen/Größenänderung: neu zeichnen, sonst streckt der Browser das alte
  // Bild auf die neue Canvas-Größe
  const neu = () => zeichne(canvas);
  addEventListener('resize', neu);
  dlg.addEventListener('close', () => removeEventListener('resize', neu), { once: true });
  dlg.onclick = () => dlg.close();
  dlg.showModal();
  zeichne(canvas);       // nach showModal: Canvas braucht sein Layout
}
