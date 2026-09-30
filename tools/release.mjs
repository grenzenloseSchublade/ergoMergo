#!/usr/bin/env node
// Release-Version zentral hochzählen. VERSION (sw.js) und APP_VERSION
// (js/version.js) sind bewusst ZWEI physische Stempel: die Update-Erkennung
// des Browsers braucht die Byte-Änderung im sw.js selbst, der Konsistenz-
// Check beim Installieren den Stempel in der ausgelieferten Shell. Laufen
// sie auseinander, bricht jede Service-Worker-Installation ab (passiert bei
// v50). Dieses Skript ist deshalb die einzige Stelle, die beide setzt.
//
// Aufruf:
//   node tools/release.mjs           nächste Version (v1.0 → v1.1)
//   node tools/release.mjs v2.0      explizite Version
//   node tools/release.mjs --check   nur prüfen: Stempel gleich, Offline-Shell vollständig,
//                                    Stil nur aus css/tokens.css (tools/stil-check.mjs)
//
// Vor jedem Bump und bei --check wird die SHELL-Liste in sw.js gegen die
// Dateien in js/, css/, icons/ und audio/ abgeglichen: ein vergessenes Modul
// hieße offline beim zweiten Start weißer Bildschirm (passierte bei
// backup.js/zwo.js).

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pruefeStil } from './stil-check.mjs';

const DATEIEN = {
  'sw.js':         /(const VERSION = ')v[\d.]+(')/,
  'js/version.js': /(export const APP_VERSION = ')v[\d.]+(')/,
};

const lies = pfad => {
  const text = readFileSync(pfad, 'utf8');
  const v = text.match(DATEIEN[pfad].source.replace('v[\\d.]+', '(v[\\d.]+)'))?.[2];
  if (!v) { console.error(`${pfad}: Versionsstempel nicht gefunden`); process.exit(1); }
  return { text, v };
};

const sw = lies('sw.js');
const shell = lies('js/version.js');

// Alle auszuliefernden Dateien gegen die SHELL-Liste — fehlende und verwaiste Einträge
function pruefeShell(swText) {
  const shell = new Set([...swText.match(/const SHELL = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map(m => m[1]));
  const dateien = [];
  const sammle = (dir, re) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) sammle(p, re);
      else if (re.test(e.name)) dateien.push(p);
    }
  };
  sammle('js', /\.(js|json)$/);
  sammle('css', /\.css$/);
  sammle('icons', /\.(png|svg)$/);
  sammle('audio', /\.ogg$/);
  const fehlend = dateien.filter(d => !shell.has(d));
  const verwaist = [...shell].filter(u => u !== '.' && !u.includes('.webmanifest') && u !== 'index.html'
    && !dateien.includes(u));
  if (fehlend.length || verwaist.length) {
    if (fehlend.length) console.error(`sw.js SHELL fehlt: ${fehlend.join(', ')}`);
    if (verwaist.length) console.error(`sw.js SHELL verweist auf nicht vorhandene Dateien: ${verwaist.join(', ')}`);
    process.exit(1);
  }
}
pruefeShell(sw.text);

// Design-System: feste Farben/Größen außerhalb von css/tokens.css blockieren das Release
const stil = pruefeStil();
if (stil.length) {
  console.error(`Stil-Prüfung: ${stil.length} feste Werte außerhalb von css/tokens.css (node tools/stil-check.mjs)\n  ${stil.join('\n  ')}`);
  process.exit(1);
}

if (process.argv[2] === '--check') {
  if (sw.v !== shell.v) {
    console.error(`Versions-Drift: sw.js=${sw.v}, js/version.js=${shell.v}`);
    process.exit(1);
  }
  console.log(`ok — beide auf ${sw.v}, Offline-Shell vollständig, Stil nur aus Tokens`);
  process.exit(0);
}

if (sw.v !== shell.v)
  console.warn(`Achtung: Stempel waren auseinander (sw.js=${sw.v}, js/version.js=${shell.v}) — werden vereinheitlicht`);

// Auto-Bump: letzte Stelle hochzählen (v1.0 → v1.1, v1.0.2 → v1.0.3)
const hoch = v => {
  const teile = v.slice(1).split('.');
  teile[teile.length - 1] = String(Number(teile[teile.length - 1]) + 1);
  return `v${teile.join('.')}`;
};
const neu = process.argv[2] ?? hoch(sw.v);
if (!/^v\d+(\.\d+){0,2}$/.test(neu)) { console.error(`ungültige Version: ${neu} (erwartet z. B. v1.1)`); process.exit(1); }

for (const [pfad, muster] of Object.entries(DATEIEN))
  writeFileSync(pfad, lies(pfad).text.replace(muster, `$1${neu}$2`));

console.log(`${sw.v} → ${neu} (sw.js + js/version.js) — jetzt committen, z. B. "…; Release ${neu}"`);
