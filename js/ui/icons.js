// Lucide-Icons (lucide.dev, MIT) als zentrale Pfaddaten-Quelle.
// svgIcon() erzeugt Markup für den DOM, zeichneIcon() zeichnet dieselben
// Pfade als Path2D auf einen Canvas (PiP) — eine Definition, überall gleich.

const ICONS = {
  bike: ['M18.5 17.5m-3.5 0a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0',
         'M5.5 17.5m-3.5 0a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0',
         'M15 5m-1 0a1 1 0 1 0 2 0a1 1 0 1 0-2 0',
         'M12 17.5V14l-3-3 4-3 2 3h2'],
  herzpuls: ['M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z',
             'M3.22 12H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27'],
  gamepad: ['M6 11h4', 'M8 9v4', 'M15 12h.01', 'M18 10h.01',
            'M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z'],
  rotate: ['M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8', 'M21 3v5h-5'],
  blitz: ['M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z'],
  timer: ['M10 2h4', 'M12 14l3-3', 'M12 14m-8 0a8 8 0 1 0 16 0a8 8 0 1 0-16 0'],
  copy: ['M10 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z',
         'M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2'],
  // Lucide „speech": Kopf mit Schallbögen (Sprachansagen)
  sprache: ['M8.8 20v-4.1l1.9.2a2.3 2.3 0 0 0 2.164-2.1V8.3A5.37 5.37 0 0 0 2 8.25c0 2.8.656 3.054 1 4.55a5.77 5.77 0 0 1 .029 2.758L2 20',
            'M19.8 17.8a7.5 7.5 0 0 0 .003-10.603', 'M17 15a3.5 3.5 0 0 0-.025-4.975'],
  // Lucide „route": Strecke (Distanz)
  route: ['M6 19m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0',
          'M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15',
          'M18 5m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0'],
  // Tastensymbole des Zwift-Lenkers: Lucide chevron-* (Pfeiltasten),
  // arrow-up/-down (Schalttasten), circle-dot (Drop-Taste)
  pfeilLinks: ['m15 18-6-6 6-6'],
  pfeilHoch: ['m18 15-6-6-6 6'],
  pfeilRechts: ['m9 18 6-6-6-6'],
  pfeilRunter: ['m6 9 6 6 6-6'],
  schaltenHoch: ['m5 12 7-7 7 7', 'M12 19V5'],
  schaltenRunter: ['M12 5v14', 'm19 12-7 7-7-7'],
  knopf: ['M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0-2 0', 'M12 12m-10 0a10 10 0 1 0 20 0a10 10 0 1 0-20 0'],
  schiebenLinks: ['m12 19-7-7 7-7', 'M19 12H5'],       // Lucide arrow-left: Paddle-Richtung
  schiebenRechts: ['M5 12h14', 'm12 5 7 7-7 7'],      // Lucide arrow-right
  power: ['M12 2v10', 'M18.4 6.6a9 9 0 1 1-12.77.04'],  // Lucide power: Ein/Aus
  // Optionen der Fahrt: „⋯"-Chip (Lucide ellipsis) und die Zeilen im Panel
  // (Lucide volume-2, picture-in-picture-2) — vorher Inline-SVG in den Chips
  mehr: ['M5 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0-2 0', 'M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0-2 0',
         'M19 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0-2 0'],
  ton: ['M11 5 6 9H2v6h4l5 4V5z', 'M15.54 8.46a5 5 0 0 1 0 7.07', 'M19.07 4.93a10 10 0 0 1 0 14.14'],
  pip: ['M21 9V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10c0 1.1.9 2 2 2h4',
        'M14 13h6a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-6a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2z'],
  // Lucide „dices": Fartlek neu würfeln
  schloss: ['M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z', 'M7 11V7a5 5 0 0 1 10 0v4'],
  wuerfel: ['M4 10h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z',
            'm17.92 14 3.5-3.5a2.24 2.24 0 0 0 0-3l-5-4.92a2.24 2.24 0 0 0-3 0L10 6',
            'M6 18h.01', 'M10 14h.01', 'M15 6h.01', 'M18 9h.01'],
};

// SVG-Markup (24er-ViewBox, currentColor-Stroke) für den DOM
export function svgIcon(name, cls = '') {
  const pfade = ICONS[name];
  if (!pfade) return '';
  return `<svg${cls ? ` class="${cls}"` : ''} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${pfade.map(d => `<path d="${d}"/>`).join('')}</svg>`;
}

// Dieselben Pfade auf einen Canvas zeichnen (x/y = linke obere Ecke)
const path2dCache = new Map();
export function zeichneIcon(ctx, name, x, y, groesse, farbe) {
  const pfade = ICONS[name];
  if (!pfade) return;
  let p2d = path2dCache.get(name);
  if (!p2d) {
    p2d = pfade.map(d => new Path2D(d));
    path2dCache.set(name, p2d);
  }
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(groesse / 24, groesse / 24);
  ctx.strokeStyle = farbe;
  ctx.lineWidth = 2;
  ctx.lineCap = ctx.lineJoin = 'round';
  ctx.fillStyle = 'none';
  for (const p of p2d) ctx.stroke(p);
  ctx.restore();
}

// <i data-icon="…">-Platzhalter im Markup durch SVGs ersetzen (Boot)
export function montiereIcons(root = document) {
  for (const el of root.querySelectorAll('[data-icon]')) {
    el.innerHTML = svgIcon(el.dataset.icon);
  }
}
