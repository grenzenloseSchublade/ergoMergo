// Vollbild-Overlay für Graphen: beliebige Zeichenfunktion auf großem Canvas,
// Tap irgendwo schließt. Genutzt von Programm-Vorschau und Detailansicht.

export function zeigeGraphOverlay(zeichne, titel = '') {
  const dlg = document.querySelector('#dlg-graph');
  const canvas = document.querySelector('#graph-big');
  document.querySelector('#graph-title').innerHTML = titel;
  dlg.onclick = () => dlg.close();
  dlg.showModal();
  zeichne(canvas);       // nach showModal: Canvas braucht sein Layout
}
