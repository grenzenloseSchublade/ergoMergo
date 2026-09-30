#!/usr/bin/env node
// Stil-Prüfung: Farben, Schriftgrößen, Radien und Abstände kommen nur aus
// css/tokens.css (Regeln: docs/stil.md). Ohne diese Prüfung läuft ein
// Design-System nach wenigen Änderungen wieder auseinander — sie meldet
// jeden festen Wert mit Datei und Zeile. Läuft in `tools/release.mjs`
// (Bump und --check) und einzeln: node tools/stil-check.mjs

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const TOKENS = 'css/tokens.css';
const FARBE = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/;
const ABSTAND_EIGENSCHAFT = /^(?:gap|row-gap|column-gap|padding(?:-[a-z]+)*|margin(?:-[a-z]+)*)$/;

// Kommentare durch Leerzeichen ersetzen — Zeilennummern bleiben gleich
const ohneKommentare = (text, re) => text.replace(re, m => m.replace(/[^\n]/g, ' '));

function dateien(dir, re) {
  const liste = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) liste.push(...dateien(p, re));
    else if (re.test(e.name)) liste.push(p);
  }
  return liste;
}

export function pruefeStil() {
  const befunde = [];
  const melde = (datei, nr, text) => befunde.push(`${datei}:${nr}  ${text}`);

  for (const datei of dateien('css', /\.css$/)) {
    if (datei === TOKENS) continue;
    const zeilen = ohneKommentare(readFileSync(datei, 'utf8'), /\/\*[\s\S]*?\*\//g).split('\n');
    zeilen.forEach((zeile, i) => {
      const nr = i + 1;
      if (FARBE.test(zeile)) melde(datei, nr, 'feste Farbe — Token aus tokens.css verwenden');
      for (const [, eig, wert] of zeile.matchAll(/([a-z-]+)\s*:\s*([^;{}]+)/g)) {
        if (eig === 'font-size' && /(?<![\w-])\d*\.?\d+(?:rem|px)\b/.test(wert.replace(/clamp\([^)]*\)/g, '')))
          melde(datei, nr, `font-size ${wert.trim()} — Stufe --text-* verwenden (clamp() nur für Fahrwerte)`);
        if (eig === 'border-radius' && wert.split(/\s+/).some(t => t && !/^(0|50%|var\(--radius-[a-z]+\))$/.test(t)))
          melde(datei, nr, `border-radius ${wert.trim()} — --radius-* verwenden`);
        if (ABSTAND_EIGENSCHAFT.test(eig) && /(?<![\w-])\d*\.?\d+rem\b/.test(wert))
          melde(datei, nr, `${eig} ${wert.trim()} — --abstand-* verwenden`);
      }
    });
  }

  for (const datei of dateien('js', /\.js$/)) {
    const zeilen = ohneKommentare(readFileSync(datei, 'utf8'), /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g).split('\n');
    zeilen.forEach((zeile, i) => {
      if (FARBE.test(zeile)) melde(datei, i + 1, 'feste Farbe — tokenLeser() aus js/ui/tokens.js verwenden');
      if (/system-ui|sans-serif/.test(zeile)) melde(datei, i + 1, 'feste Schrift — canvasSchrift() verwenden');
    });
  }

  readFileSync('index.html', 'utf8').split('\n').forEach((zeile, i) => {
    if (/\sstyle="/.test(zeile)) melde('index.html', i + 1, 'Inline-Stil — Regel in app.css anlegen');
  });
  return befunde;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const befunde = pruefeStil();
  if (befunde.length) {
    console.error(`Stil-Prüfung: ${befunde.length} feste Werte außerhalb von ${TOKENS}\n  ${befunde.join('\n  ')}`);
    process.exit(1);
  }
  console.log('Stil-Prüfung ok — alle Werte aus tokens.css');
}
