#!/usr/bin/env node
// Datenschutz-Check (statisch, Katalog docs/sicherheit.md):
//   NET-04  jede Stelle im ausgelieferten Code, die etwas laden, senden oder
//           navigieren könnte, steht mit Begründung in der Freigabeliste —
//           eine neue Stelle lässt den Check (und damit das Release) scheitern
//   CSP-01  index.html trägt genau die freigegebene Content-Security-Policy
//   DEP-01  keine Laufzeit-Abhängigkeiten (package.json ohne dependencies)
// Aufruf: node tools/datenschutz-check.mjs [--register]   (--register: Datenfluss-Register ausgeben)

import { readFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { WURZEL, ausgelieferteDateien } from './auslieferung.mjs';

export const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self'; media-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; base-uri 'none'; form-action 'self'; object-src 'none'";

// Alles, was Daten bewegen könnte: Netz-APIs, Navigation, Vorabladen, externe URLs, Sprachdienst, Cookies
const SENKE = /fetch\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|RTCPeerConnection|new Image\(|window\.open|location\.(?:href\s*=|assign|replace)|rel="(?:preconnect|dns-prefetch|prefetch|prerender|preload)"|<form\b|speechSynthesis\.speak|@import|url\(|https?:\/\/|importScripts|navigator\.share|document\.cookie/;

// Freigabeliste: Datei, Muster der Zeile, Begründung (= Datenfluss-Register)
export const FREIGABEN = [
  { datei: 'js/version.js', muster: /fetch\(`sw\.js\?_=/, ziel: 'eigene Adresse', grund: 'Update-Prüfung: lädt nur sw.js (ohne Nutzdaten) beim Start, beim Zurückkehren und alle 10 min — nicht während der Fahrt' },
  { datei: 'js/ansagen.js', muster: /fetch\(new URL\(`\$\{name\}\.ogg`, BASE\)\)/, ziel: 'eigene Adresse', grund: 'Sprach-Bausteine (audio/*.ogg), meist aus dem Offline-Speicher' },
  { datei: 'sw.js', muster: /hit \?\? fetch\(e\.request\)/, ziel: 'eigene Adresse', grund: 'Service Worker: was nicht im Offline-Speicher liegt, kommt vom Server der App' },
  { datei: 'js/signals.js', muster: /speechSynthesis\.speak\(u\)/, ziel: 'Gerät', grund: 'Sprachansage-Rückfall — nur mit lokaler Stimme (localService), sonst stumm' },
  { datei: 'js/main.js', muster: /location\.replace\(`\$\{location\.pathname\}\?demo=/, ziel: 'eigene Adresse', grund: 'Navigation innerhalb der App (Demo)' },
  { datei: 'js/demo.js', muster: /location\.replace\((?:location\.pathname\)|`\$\{location\.pathname\}\?demo=fahrten)/, ziel: 'eigene Adresse', grund: 'Navigation innerhalb der App (Demo)' },
  { datei: 'index.html', muster: /<form method="dialog">/, ziel: '—', grund: 'Dialog-Formulare, senden nichts (method="dialog")' },
  { datei: 'index.html', muster: /rel="canonical"|property="og:(?:url|image)"|"@context": "https:\/\/schema\.org"|"url": "https:\/\/grenzenloseschublade/, ziel: '—', grund: 'Metadaten für Suchmaschinen/Vorschauen — lädt der Browser nicht' },
  { datei: 'js/export.js', muster: /xmlns(?::ns3)?="http:\/\/www\.garmin\.com\/xmlschemas\//, ziel: '—', grund: 'XML-Namensraum im TCX-Export (Text, keine Anfrage)' },
  { datei: 'js/ble/zwift-ride-tasten.json', muster: /^\s*"https:\/\//, ziel: '—', grund: 'Quellenangaben der Tastentabelle (Text, keine Anfrage)' },
  { datei: 'sitemap.xml', muster: /xmlns="http:\/\/www\.sitemaps\.org|<loc>https:\/\/grenzenloseschublade/, ziel: '—', grund: 'Sitemap für Suchmaschinen' },
  { datei: 'robots.txt', muster: /^Sitemap: https:\/\/grenzenloseschublade/, ziel: '—', grund: 'Verweis auf die Sitemap' },
  { datei: 'icons/icon.svg', muster: /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/, ziel: '—', grund: 'SVG-Namensraum (Text, keine Anfrage)' },
  { datei: 'docs/stil.html', muster: /fetch\('\.\.\/css\/tokens\.css'\)/, ziel: 'eigene Adresse', grund: 'Style Guide liest die eigenen Design-Tokens' },
];

const TEXT = new Set(['.js', '.mjs', '.html', '.css', '.json', '.webmanifest', '.txt', '.xml', '.svg']);

export function pruefeDatenschutz() {
  const befunde = [], treffer = [];
  for (const datei of ausgelieferteDateien()) {
    if (!TEXT.has(extname(datei))) continue;
    readFileSync(join(WURZEL, datei), 'utf8').split('\n').forEach((zeile, i) => {
      if (/^\s*(\/\/|\*|<!--)/.test(zeile) || !SENKE.test(zeile)) return;   // Kommentare zählen nicht
      const f = FREIGABEN.find(f => f.datei === datei && f.muster.test(zeile));
      if (f) treffer.push({ ...f, zeile: i + 1 });
      else befunde.push(`${datei}:${i + 1}  nicht freigegebene Netz-/Navigationsstelle: ${zeile.trim().slice(0, 120)}`);
    });
  }
  // Jede Freigabe muss noch gebraucht werden (veraltete Einträge fallen auf)
  for (const f of FREIGABEN) if (!treffer.some(t => t === f || (t.datei === f.datei && t.muster === f.muster)))
    befunde.push(`Freigabe ohne Treffer (veraltet?): ${f.datei} ${f.muster}`);
  const html = readFileSync(join(WURZEL, 'index.html'), 'utf8');
  if (!html.includes(`<meta http-equiv="Content-Security-Policy" content="${CSP}">`))
    befunde.push('index.html: Content-Security-Policy fehlt oder weicht von der freigegebenen ab');
  const pkg = JSON.parse(readFileSync(join(WURZEL, 'package.json'), 'utf8'));
  if (pkg.dependencies && Object.keys(pkg.dependencies).length) befunde.push('package.json: Laufzeit-Abhängigkeiten vorhanden');
  return { befunde, treffer };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { befunde, treffer } = pruefeDatenschutz();
  if (process.argv.includes('--register'))
    for (const t of treffer) console.log(`${t.datei}:${t.zeile} · ${t.ziel} · ${t.grund}`);
  if (befunde.length) {
    console.error(`Datenschutz-Check: ${befunde.length} Befunde\n  ${befunde.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`Datenschutz-Check ok — ${treffer.length} Stellen, alle freigegeben; CSP wie freigegeben; keine Abhängigkeiten`);
}
