// Vollbild-Overlay für Graphen: beliebige Zeichenfunktion auf großem Canvas,
// Tap irgendwo schließt.

export function zeigeGraphOverlay(zeichne) {
  const dlg = document.querySelector('#dlg-graph');
  const canvas = document.querySelector('#graph-big');
  dlg.onclick = () => dlg.close();
  dlg.showModal();
  zeichne(canvas);       // nach showModal: Canvas braucht sein Layout
}
