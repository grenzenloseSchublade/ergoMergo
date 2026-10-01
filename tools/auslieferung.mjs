#!/usr/bin/env node
// Was öffentlich ausgeliefert wird — EINE Liste für den Deploy
// (.github/workflows/pages.yml) und den Datenschutz-Check. Tests, Werkzeuge
// und Doku-Rohdateien bleiben im Repo, landen aber nicht auf der Website.
// Aufruf: node tools/auslieferung.mjs <zielordner>   kopiert die Dateien dorthin

import { cpSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const WURZEL = fileURLToPath(new URL('..', import.meta.url));
export const AUSLIEFERUNG = [
  'index.html', 'sw.js', 'manifest.webmanifest', 'robots.txt', 'sitemap.xml',
  'js', 'css', 'icons', 'audio',
  'docs/img',          // og:image und README-Bilder
  'docs/stil.html',    // lebendiger Style Guide (README verlinkt ihn)
];

// Alle ausgelieferten Dateien (relativ zur Wurzel)
export function ausgelieferteDateien() {
  const liste = [];
  const sammle = p => statSync(join(WURZEL, p)).isDirectory()
    ? readdirSync(join(WURZEL, p)).forEach(n => sammle(join(p, n)))
    : liste.push(p);
  AUSLIEFERUNG.forEach(sammle);
  return liste;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const ziel = process.argv[2];
  if (!ziel) { console.error('Aufruf: node tools/auslieferung.mjs <zielordner>'); process.exit(1); }
  for (const p of ausgelieferteDateien()) {
    mkdirSync(join(ziel, dirname(p)), { recursive: true });
    cpSync(join(WURZEL, p), join(ziel, p));
  }
  console.log(`${ausgelieferteDateien().length} Dateien nach ${ziel}`);
}
