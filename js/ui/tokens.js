// Design-Tokens (css/tokens.css) für Canvas-Zeichnungen. Canvas kennt kein
// var(--…) — Graph, LED-Zeile und Bild-in-Bild lesen Farben und Schrift
// deshalb hier aus dem CSS. Feste Farben oder Schriften im JS gibt es nicht
// (tools/release.mjs --check meldet sie).
export function tokenLeser(el = document.documentElement) {
  const style = getComputedStyle(el);
  return name => style.getPropertyValue(name).trim();
}

// Schriftfamilie für Canvas-Texte (--schrift) — einmal gelesen, ändert sich nie
let schrift = null;
export const canvasSchrift = (px, gewicht = 400) => `${gewicht} ${px}px ${schrift ??= tokenLeser()('--schrift')}`;
