// Gemeinsame Helfer der Werkzeuge: Skript-Erkennung und Kommentare entfernen.

import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Läuft diese Datei als Skript (nicht als Import)? import.meta.url ist
// prozentkodiert und symlink-aufgelöst, process.argv[1] nicht: ein roher
// Vergleich träfe unter Pfaden mit Leerzeichen nie, die Prüfung täte still nichts
export function istHauptmodul(url) {
  try { return url === pathToFileURL(realpathSync(process.argv[1])).href; }
  catch { return false; }
}

const leeren = s => s.replace(/[^\n]/g, ' ');

// Vor diesen Wörtern beginnt mit / eine Regex, keine Division
const VOR_REGEX = /(?:^|[^\w$.])(?:return|typeof|case|in|of|delete|void|throw|new|else|do|yield|await)$/;

function regexErlaubt(bisher) {
  const vor = bisher.trimEnd();
  if (!vor) return true;
  const letztes = vor.at(-1);
  if (/[\w$]/.test(letztes)) return VOR_REGEX.test(vor.slice(-12));
  return !/[)\]}'"`]/.test(letztes);
}

// JS: Kommentare durch Leerzeichen ersetzen, Zeilennummern bleiben. Stringsicher
// (auch Template-Strings mit ${…} und Regex-Literale): https://x bleibt Code
export function jsOhneKommentare(t) {
  let aus = '', i = 0;
  const ebenen = [];                 // offene ${…}: Klammertiefe je Ebene
  const templateText = () => {
    while (i < t.length) {
      const c = t[i];
      if (c === '\\') { aus += t.slice(i, i + 2); i += 2; continue; }
      if (c === '`') { aus += c; i++; return; }
      if (c === '$' && t[i + 1] === '{') { aus += '${'; i += 2; ebenen.push(0); return; }
      aus += c; i++;
    }
  };
  while (i < t.length) {
    const c = t[i], n = t[i + 1];
    if (c === '/' && (n === '/' || n === '*')) {
      const ende = n === '/' ? (t.indexOf('\n', i) + 1 || t.length + 1) - 1 : (t.indexOf('*/', i + 2) + 1 || t.length) + 1;
      aus += leeren(t.slice(i, ende));
      i = ende;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < t.length && t[j] !== c && t[j] !== '\n') j += t[j] === '\\' ? 2 : 1;
      aus += t.slice(i, j + 1);
      i = j + 1;
    } else if (c === '`') {
      aus += c; i++;
      templateText();
    } else if (c === '}' && ebenen.length && ebenen.at(-1) === 0) {
      ebenen.pop();
      aus += c; i++;
      templateText();
    } else if (c === '/' && regexErlaubt(aus)) {
      let j = i + 1, klasse = false;
      while (j < t.length && t[j] !== '\n' && (klasse || t[j] !== '/')) {
        if (t[j] === '\\') j++;
        else if (t[j] === '[') klasse = true;
        else if (t[j] === ']') klasse = false;
        j++;
      }
      aus += t.slice(i, j + 1);
      i = j + 1;
    } else {
      if (ebenen.length && c === '{') ebenen[ebenen.length - 1]++;
      if (ebenen.length && c === '}') ebenen[ebenen.length - 1]--;
      aus += c; i++;
    }
  }
  return aus;
}

// CSS: Kommentare leeren
export const cssOhneKommentare = t => t.replace(/\/\*[\s\S]*?\*\//g, leeren);
// HTML, SVG, XML: Kommentare leeren
export const htmlOhneKommentare = t => t.replace(/<!--[\s\S]*?-->/g, leeren);
