#!/usr/bin/env node
// Stil-Prüfung: Farben, Schriftgrößen, Radien und Abstände kommen nur aus
// css/tokens.css (Regeln: docs/stil.md). Ohne diese Prüfung läuft ein
// Design-System nach wenigen Änderungen wieder auseinander — sie meldet
// jeden festen Wert mit Datei und Zeile. Läuft in `tools/release.mjs`
// (Bump und --check) und einzeln: node tools/stil-check.mjs

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { istHauptmodul, jsOhneKommentare, cssOhneKommentare } from './quelltext.mjs';

const TOKENS = 'css/tokens.css';
const FARBE = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/;
const ABSTAND_EIGENSCHAFT = /^(?:gap|row-gap|column-gap|padding(?:-[a-z]+)*|margin(?:-[a-z]+)*)$/;
const RADIUS_EIGENSCHAFT = /^border(?:-[a-z]+){0,2}-radius$/;
const FARB_EIGENSCHAFT = /^(?:color|background(?:-color)?|border(?:-[a-z]+)*-color|border(?:-[a-z]+)*|outline(?:-color)?|fill|stroke|box-shadow|text-shadow|caret-color|accent-color|text-decoration(?:-color)?|--[a-z-]+)$/;
const LAENGE = /(?<![\w-])\d*\.?\d+(?:rem|px|em)\b/;
// CSS-Farbnamen. Bewusst nicht: transparent, currentColor (keine festen Werte)
const FARBNAME = new RegExp(`(?<![\\w-])(?:${('aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood '
  + 'cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki '
  + 'darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet '
  + 'deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow '
  + 'grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow '
  + 'lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen '
  + 'linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise '
  + 'mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen '
  + 'paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown '
  + 'seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white '
  + 'whitesmoke yellow yellowgreen').split(' ').join('|')})(?![\\w-])`, 'i');

// Begründete Ausnahmen: Datei, Eigenschaft, Muster im Wert, Grund. Neue Einträge
// nur mit Grund; jeder muss noch gebraucht werden. altbestand: schon vorhanden,
// als die Prüfung schärfer wurde — beim nächsten Griff in die Stelle beheben
const AUSNAHMEN = [
  { datei: 'css/app.css', eig: 'mask-image', muster: /^linear-gradient\(to right, transparent, black/, grund: 'Maske: „black" ist die Deckkraft, keine Farbe' },
  { datei: 'css/app.css', eig: 'gap', muster: /^3px$/, altbestand: true, grund: 'außerhalb des 4-px-Rasters' },
  { datei: 'css/app.css', eig: 'font-size', muster: /^\.78em$/, altbestand: true, grund: 'relative Größe statt --text-*' },
];

export function dateien(dir, re) {
  const liste = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) liste.push(...dateien(p, re));
    else if (re.test(e.name)) liste.push(p);
  }
  return liste;
}

// Token-Verweise zählen nicht, ein fester Rückfallwert darin schon
const ohneVar = wert => wert.replace(/var\(--[a-z0-9-]+\)/g, ' ');

export function pruefeStil() {
  const befunde = [];
  const melde = (datei, nr, text) => befunde.push(`${datei}:${nr}  ${text}`);
  const genutzt = new Set();
  const ausnahme = (datei, eig, wert) => {
    const a = AUSNAHMEN.find(a => a.datei === datei && a.eig === eig && a.muster.test(wert));
    if (a) genutzt.add(a);
    return !!a;
  };

  for (const datei of dateien('css', /\.css$/)) {
    if (datei === TOKENS) continue;
    const text = cssOhneKommentare(readFileSync(datei, 'utf8'));
    text.split('\n').forEach((zeile, i) => {
      if (FARBE.test(zeile)) melde(datei, i + 1, 'feste Farbe — Token aus tokens.css verwenden');
    });
    // Deklarationen statt Zeilen: auch über mehrere Zeilen verteilte Werte zählen
    for (const m of text.matchAll(/(?<![\w-])(--[a-z0-9-]+|[a-z-]+)\s*:\s*([^;{}]+)(?=[;}])/g)) {
      const [, eig, roh] = m;
      const wert = roh.trim().replace(/\s+/g, ' ');
      if (ausnahme(datei, eig, wert)) continue;
      const nr = text.slice(0, m.index).split('\n').length;
      if (eig === 'font-size' && LAENGE.test(wert.replace(/clamp\([^)]*\)/g, '')))
        melde(datei, nr, `font-size ${wert} — Stufe --text-* verwenden (clamp() nur für Fahrwerte)`);
      if (RADIUS_EIGENSCHAFT.test(eig) && wert.split(/\s+/).some(t => t && !/^(0|50%|var\(--radius-[a-z]+\))$/.test(t)))
        melde(datei, nr, `${eig} ${wert} — --radius-* verwenden`);
      if (ABSTAND_EIGENSCHAFT.test(eig) && LAENGE.test(ohneVar(wert)))
        melde(datei, nr, `${eig} ${wert} — --abstand-* verwenden`);
      if (FARB_EIGENSCHAFT.test(eig) && FARBNAME.test(ohneVar(wert)))
        melde(datei, nr, `${eig} ${wert} — benannte Farbe, Token verwenden`);
      if (/color-mix\(/.test(wert) && !/var\(/.test(wert))
        melde(datei, nr, `${eig} ${wert} — color-mix nur mit Tokens`);
    }
  }

  for (const datei of dateien('js', /\.js$/)) {
    const zeilen = jsOhneKommentare(readFileSync(datei, 'utf8')).split('\n');
    zeilen.forEach((zeile, i) => {
      if (FARBE.test(zeile)) melde(datei, i + 1, 'feste Farbe — tokenLeser() aus js/ui/tokens.js verwenden');
      if (/system-ui|sans-serif/.test(zeile)) melde(datei, i + 1, 'feste Schrift — canvasSchrift() verwenden');
    });
  }

  readFileSync('index.html', 'utf8').split('\n').forEach((zeile, i) => {
    if (/\sstyle="/.test(zeile)) melde('index.html', i + 1, 'Inline-Stil — Regel in app.css anlegen');
  });
  for (const a of AUSNAHMEN) if (!a.altbestand && !genutzt.has(a)) befunde.push(`Ausnahme ohne Treffer (veraltet?): ${a.datei} ${a.eig}`);
  return befunde;
}

if (istHauptmodul(import.meta.url)) {
  const befunde = pruefeStil();
  if (befunde.length) {
    console.error(`Stil-Prüfung: ${befunde.length} feste Werte außerhalb von ${TOKENS}\n  ${befunde.join('\n  ')}`);
    process.exit(1);
  }
  console.log('Stil-Prüfung ok — alle Werte aus tokens.css');
}
