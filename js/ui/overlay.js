// Vollbild-Overlay für Graphen: beliebige Zeichenfunktion auf großem Canvas,
// Tap irgendwo schließt. Für Live-Ansichten (Fahrbildschirm) kann der
// Aufrufer pro Tick neu zeichnen lassen und den Titel aktualisieren.

let aktuelleZeichnung = null;

export function zeigeGraphOverlay(zeichne, titel = '') {
  const dlg = document.querySelector('#dlg-graph');
  const canvas = document.querySelector('#graph-big');
  document.querySelector('#graph-title').innerHTML = titel;
  aktuelleZeichnung = zeichne;
  dlg.onclick = () => dlg.close();
  dlg.addEventListener('close', () => { aktuelleZeichnung = null; }, { once: true });
  dlg.showModal();
  zeichne(canvas);       // nach showModal: Canvas braucht sein Layout
}

export function graphOverlayOffen() {
  return document.querySelector('#dlg-graph')?.open === true && !!aktuelleZeichnung;
}

export function redrawGraphOverlay() {
  if (!graphOverlayOffen()) return;
  aktuelleZeichnung(document.querySelector('#graph-big'));
}

export function setzeGraphOverlayTitel(html) {
  if (!graphOverlayOffen()) return;
  document.querySelector('#graph-title').innerHTML = html;
}

export function schliesseGraphOverlay() {
  const dlg = document.querySelector('#dlg-graph');
  if (dlg?.open) dlg.close();
}
