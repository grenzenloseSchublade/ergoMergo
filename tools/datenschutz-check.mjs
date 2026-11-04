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
import { istHauptmodul, jsOhneKommentare, cssOhneKommentare, htmlOhneKommentare } from './quelltext.mjs';

export const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self'; media-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; base-uri 'none'; form-action 'self'; object-src 'none'";

// Alles, was Daten bewegen könnte: Netz-APIs, Navigation, Nachladen, Vorabladen,
// externe und protokollrelative URLs, Sprachdienst, Cookies
const SENKE = /fetch\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|RTCPeerConnection|new Image\(|window\.open|\blocation\s*=(?!=)|location\.(?:(?:search|pathname|hash|host|hostname|port|protocol)\s*=(?!=)|assign|replace)|\.(?:src|href)\s*=(?!=)|\bimport\(|<script\b|<iframe\b|rel="(?:preconnect|dns-prefetch|prefetch|prerender|preload)"|<form\b|speechSynthesis\.speak|@import|url\(|https?:\/\/|["'`]\/\/[a-z0-9]|importScripts|navigator\.share|document\.cookie/g;

// Freigabeliste: Datei, Muster der Zeile, Begründung (= Datenfluss-Register)
export const FREIGABEN = [
  { datei: 'js/version.js', muster: /fetch\(`sw\.js\?_=/, ziel: 'eigene Adresse', grund: 'Update-Prüfung: lädt nur sw.js (ohne Nutzdaten) beim Start, beim Zurückkehren und alle 10 min — nicht während der Fahrt' },
  { datei: 'index.html', muster: /<script type="module" src="js\/main\.js"><\/script>/, ziel: 'eigene Adresse', grund: 'Einstieg der App, eigene Datei' },
  { datei: 'index.html', muster: /<script type="application\/ld\+json">/, ziel: '—', grund: 'Metadaten für Suchmaschinen — der Browser führt das nicht aus' },
  { datei: 'docs/stil.html', muster: /<script type="module">/, ziel: 'eigene Adresse', grund: 'Style Guide: eingebettetes Skript ohne Quelle von außen' },
  { datei: 'js/version.js', muster: /await import\('\.\/(?:logger|navigation)\.js'\)/, ziel: 'eigene Adresse', grund: 'eigene Module, erst bei Bedarf geladen (Update-Prüfung)' },
  { datei: 'js/ansagen.js', muster: /fetch\(new URL\(`\$\{name\}\.ogg`, BASE\)\)/, ziel: 'eigene Adresse', grund: 'Sprach-Bausteine (audio/*.ogg), meist aus dem Offline-Speicher' },
  { datei: 'sw.js', muster: /hit \?\? fetch\(e\.request\)/, ziel: 'eigene Adresse', grund: 'Service Worker: was nicht im Offline-Speicher liegt, kommt vom Server der App' },
  { datei: 'js/signals.js', muster: /speechSynthesis\.speak\(u\)/, ziel: 'Gerät', grund: 'Sprachansage-Rückfall — nur mit lokaler Stimme (localService), sonst stumm' },
  { datei: 'js/main.js', muster: /location\.replace\(`\$\{location\.pathname\}\?demo=/, ziel: 'eigene Adresse', grund: 'Navigation innerhalb der App (Demo)' },
  { datei: 'js/demo.js', muster: /location\.replace\((?:location\.pathname\)|`\$\{location\.pathname\}\?demo=fahrten)/, ziel: 'eigene Adresse', grund: 'Navigation innerhalb der App (Demo)' },
  { datei: 'index.html', muster: /<a href="https:\/\/github\.com\/grenzenloseSchublade\/ergoMergo\/blob\/main\/docs\/sicherheit\.md"/, ziel: 'GitHub (nur auf Tipp)', grund: 'Link zum Prüfbericht — öffnet sich nur, wenn du ihn antippst; überträgt keine Daten' },
  { datei: 'js/ui/settings.js', muster: /location\.replace\(location\.pathname\)/, ziel: 'eigene Adresse', grund: 'Neustart der App nach „Alle Daten löschen"' },
  { datei: 'index.html', muster: /<form method="dialog">/, ziel: '—', grund: 'Dialog-Formulare, senden nichts (method="dialog")' },
  { datei: 'index.html', muster: /rel="canonical"|property="og:(?:url|image)"|"@context": "https:\/\/schema\.org"|"url": "https:\/\/grenzenloseschublade/, ziel: '—', grund: 'Metadaten für Suchmaschinen/Vorschauen — lädt der Browser nicht' },
  { datei: 'js/export.js', muster: /a\.href = URL\.createObjectURL\(new Blob\(/, ziel: 'Gerät', grund: 'Datei-Download (Sicherung, TCX, Log) aus dem Speicher, keine Anfrage' },
  { datei: 'js/export.js', muster: /xmlns(?::ns3)?="http:\/\/www\.garmin\.com\/xmlschemas\//, ziel: '—', grund: 'XML-Namensraum im TCX-Export (Text, keine Anfrage)' },
  { datei: 'js/ble/zwift-ride-tasten.json', muster: /^\s*"https:\/\//, ziel: '—', grund: 'Quellenangaben der Tastentabelle (Text, keine Anfrage)' },
  { datei: 'sitemap.xml', muster: /xmlns="http:\/\/www\.sitemaps\.org|<loc>https:\/\/grenzenloseschublade/, ziel: '—', grund: 'Sitemap für Suchmaschinen' },
  { datei: 'robots.txt', muster: /^Sitemap: https:\/\/grenzenloseschublade/, ziel: '—', grund: 'Verweis auf die Sitemap' },
  { datei: 'icons/icon.svg', muster: /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/, ziel: '—', grund: 'SVG-Namensraum (Text, keine Anfrage)' },
  { datei: 'docs/stil.html', muster: /fetch\('\.\.\/css\/tokens\.css'\)/, ziel: 'eigene Adresse', grund: 'Style Guide liest die eigenen Design-Tokens' },
];

const TEXT = new Set(['.js', '.mjs', '.html', '.css', '.json', '.webmanifest', '.txt', '.xml', '.svg']);
// Kommentare zählen nicht — gezielt entfernt, nicht zeilenweise übersprungen:
// Code hinter einem Kommentar-Anfang bleibt so sichtbar
const OHNE_KOMMENTARE = { '.js': jsOhneKommentare, '.mjs': jsOhneKommentare, '.css': cssOhneKommentare,
  '.html': htmlOhneKommentare, '.svg': htmlOhneKommentare, '.xml': htmlOhneKommentare };

export function pruefeDatenschutz() {
  const befunde = [], treffer = [];
  for (const datei of ausgelieferteDateien()) {
    if (!TEXT.has(extname(datei))) continue;
    const roh = readFileSync(join(WURZEL, datei), 'utf8');
    (OHNE_KOMMENTARE[extname(datei)]?.(roh) ?? roh).split('\n').forEach((zeile, i) => {
      const senken = zeile.match(SENKE)?.length ?? 0;
      if (!senken) return;
      const f = FREIGABEN.find(f => f.datei === datei && f.muster.test(zeile));
      // Eine Freigabe gilt für genau eine Stelle — eine zweite auf derselben Zeile fiele sonst durch
      if (f && senken <= (f.stellen ?? 1)) treffer.push({ ...f, zeile: i + 1 });
      else if (f) befunde.push(`${datei}:${i + 1}  ${senken} Netz-/Navigationsstellen auf einer freigegebenen Zeile: ${zeile.trim().slice(0, 120)}`);
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

if (istHauptmodul(import.meta.url)) {
  const { befunde, treffer } = pruefeDatenschutz();
  if (process.argv.includes('--register'))
    for (const t of treffer) console.log(`${t.datei}:${t.zeile} · ${t.ziel} · ${t.grund}`);
  if (befunde.length) {
    console.error(`Datenschutz-Check: ${befunde.length} Befunde\n  ${befunde.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`Datenschutz-Check ok — ${treffer.length} Stellen, alle freigegeben; CSP wie freigegeben; keine Abhängigkeiten`);
}
