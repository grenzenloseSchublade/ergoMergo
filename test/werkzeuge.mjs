#!/usr/bin/env node
// Prüft die Prüfwerkzeuge selbst, in einer Kopie des Repos unter einem Pfad mit
// Leerzeichen und Umlaut (ein stilles „nichts geprüft" wäre der schlimmste Fehler):
//   · tools/release.mjs: Versionsfolge, Drift, doppelte SHELL-Einträge
//   · tools/stil-check.mjs und tools/datenschutz-check.mjs schlagen bei eingebauten
//     Verstößen an, Kommentare zählen nicht; auch über einen Symlink
//   · tools/auslieferung.mjs kopiert über Symlink und Sonderzeichen-Pfad
//   · test/lib.mjs: CDP-Frist, toter Chrome, Profil und Prozess werden aufgeräumt
// Aufruf: node test/werkzeuge.mjs     Exit 1 bei Abweichung.

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { WURZEL, browser, sleep } from './lib.mjs';
import { jsOhneKommentare, cssOhneKommentare } from '../tools/quelltext.mjs';

const abweichungen = [];
let schritte = 0;
const soll = (was, ok, info = '') => { schritte++; if (!ok) abweichungen.push(`${was}${info ? ': ' + info : ''}`); };

const tmp = mkdtempSync(join(tmpdir(), 'ergomergo-werkzeuge-'));
const kopie = join(tmp, 'mit Leerzeichen ä', 'repo');
cpSync(WURZEL, kopie, { recursive: true, filter: q => !['.git', '.claude', 'node_modules'].includes(basename(q)) });
const link = join(tmp, 'verweis');
symlinkSync(kopie, link);

const lauf = (skript, args = [], cwd = kopie) => spawnSync('node', [skript, ...args], { cwd, encoding: 'utf8' });
const pfad = p => join(kopie, p);
const lies = p => readFileSync(pfad(p), 'utf8');
// Datei für die Dauer eines Aufrufs ändern
const mit = (p, aendern, f) => {
  const vorher = lies(p);
  writeFileSync(pfad(p), aendern(vorher));
  try { return f(); } finally { writeFileSync(pfad(p), vorher); }
};
const dazu = (p, text, f) => mit(p, t => `${t}\n${text}\n`, f);

const RELEASE = 'tools/release.mjs', STIL = 'tools/stil-check.mjs', SCHUTZ = 'tools/datenschutz-check.mjs';
const SW = /(const VERSION = ')v[\d.]+(')/, APP = /(export const APP_VERSION = ')v[\d.]+(')/;
const stempel = () => [lies('sw.js').match(SW)[0].match(/v[\d.]+/)[0], lies('js/version.js').match(APP)[0].match(/v[\d.]+/)[0]];
// Stempel für die Dauer eines Aufrufs setzen
const mitStempeln = (sw, app, f) => mit('sw.js', t => t.replace(SW, `$1${sw}$2`),
  () => mit('js/version.js', t => t.replace(APP, `$1${app}$2`), f));

try {
  // --- release.mjs ---
  soll('release --check: Ausgangsstand ok', lauf(RELEASE, ['--check']).status === 0, lauf(RELEASE, ['--check']).stderr);
  const [aktuell] = stempel();
  const gleich = lauf(RELEASE, [aktuell]);
  soll('release: gleiche Version abgelehnt', gleich.status === 1 && /nicht höher/.test(gleich.stderr), gleich.stderr);
  soll('release: niedrigere Version abgelehnt', lauf(RELEASE, ['v1.0']).status === 1);
  soll('… Stempel unverändert', stempel().join() === `${aktuell},${aktuell}`, stempel().join());
  mitStempeln('v3.9', 'v3.9', () => {
    soll('release: numerisch verglichen (v3.10 > v3.9)', lauf(RELEASE, ['v3.10']).status === 0 && stempel().join() === 'v3.10,v3.10', stempel().join());
  });
  mitStempeln('v3.5', 'v3.5', () => {
    soll('release: v3.5.0 ist nicht höher als v3.5', lauf(RELEASE, ['v3.5.0']).status === 1);
    soll('release: ohne Angabe die nächste', lauf(RELEASE).status === 0 && stempel().join() === 'v3.6,v3.6', stempel().join());
  });
  mitStempeln('v3.5', 'v3.5', () => {
    soll('release: Rückstufung nur ausdrücklich', lauf(RELEASE, ['v1.0', '--rueckstufen']).status === 0 && stempel().join() === 'v1.0,v1.0', stempel().join());
  });
  mitStempeln('v1.0', 'v9.9', () => {
    soll('release --check: Drift erkannt', lauf(RELEASE, ['--check']).status === 1);
    soll('release: Drift zählt vom höheren Stempel hoch', lauf(RELEASE).status === 0 && stempel().join() === 'v9.10,v9.10', stempel().join());
  });
  mitStempeln('v9.9', 'v1.0', () => {
    soll('release: Drift, Angabe unter dem höheren Stempel abgelehnt', lauf(RELEASE, ['v5.0']).status === 1);
  });
  mit('sw.js', t => t.replace("const SHELL = [", "const SHELL = [\n  'js/main.js', 'js/main.js',"), () => {
    const r = lauf(RELEASE, ['--check']);
    soll('release --check: doppelter SHELL-Eintrag erkannt', r.status === 1 && /doppelte/.test(r.stderr), r.stderr);
  });

  // --- stil-check.mjs ---
  soll('Stil: Ausgangsstand ok', lauf(STIL).status === 0, lauf(STIL).stderr);
  for (const [was, css] of [['px-Abstand', '.x { gap: 5px; }'], ['em-Abstand', '.x { padding: 1em; }'], ['rem-Abstand', '.x { margin: 1rem; }'],
    ['px-Schrift', '.x { font-size: 14px; }'], ['em-Schrift', '.x { font-size: .9em; }'], ['benannte Farbe', '.x { color: red; }'],
    ['benannte Farbe im Kurzwert', '.x { border: 1px solid white; }'], ['color-mix ohne Token', '.x { background: color-mix(in srgb, transparent, canvas); }'],
    ['Radius-Langform', '.x { border-top-left-radius: 3px; }'], ['mehrzeiliger Wert', '.x {\n  padding:\n    5px;\n}']]) {
    dazu('css/app.css', css, () => {
      const r = lauf(STIL);
      soll(`Stil meldet ${was}`, r.status === 1, r.stdout);
    });
  }
  for (const [was, css] of [['Kommentar', '/* .x { gap: 5px; color: red; } */'], ['Token', '.x { gap: var(--abstand-1); color: var(--ink); }'], ['transparent', '.x { background: transparent; }']])
    dazu('css/app.css', css, () => soll(`Stil lässt ${was} durch`, lauf(STIL).status === 0, lauf(STIL).stderr));
  dazu('js/format.js', 'const nachUrl = ["https://x", "#ff0000"];', () => soll('Stil: Farbe hinter // im String erkannt', lauf(STIL).status === 1));
  dazu('js/format.js', '// #ff0000', () => soll('Stil: Farbe im Kommentar zählt nicht', lauf(STIL).status === 0, lauf(STIL).stderr));

  // --- datenschutz-check.mjs ---
  soll('Datenschutz: Ausgangsstand ok', lauf(SCHUTZ).status === 0, lauf(SCHUTZ).stderr);
  for (const senke of ["location = 'x';", "location.search = 'x';", "location.hash = 'x';", "a.href = '//host.example';", "s.src = '//host.example';",
    's.src = u;', 'a.href = u;', 'import(u);', "/* k */ fetch('x');", "/* k\n*/ sendBeacon('x');", "`${''}`; fetch('x');", "const u = 'https://host.example';"]) {
    dazu('js/format.js', senke, () => {
      const r = lauf(SCHUTZ);
      soll(`Datenschutz meldet: ${senke}`, r.status === 1, r.stdout);
    });
  }
  for (const zeile of ['<script src="//host.example/x.js"></script>', '<!-- k --> <script src="/x.js"></script>', '<iframe src="/x"></iframe>']) {
    mit('index.html', t => t.replace('</body>', `${zeile}\n</body>`), () => {
      const r = lauf(SCHUTZ);
      soll(`Datenschutz meldet: ${zeile}`, r.status === 1, r.stdout);
    });
  }
  mit('js/ansagen.js', t => t.replace('const p = fetch(new URL(`${name}.ogg`, BASE))', "fetch('https://host.example'); const p = fetch(new URL(`${name}.ogg`, BASE))"), () => {
    const r = lauf(SCHUTZ);
    soll('Datenschutz: zweite Stelle auf freigegebener Zeile', r.status === 1 && /3 Netz/.test(r.stderr), r.stderr);
  });
  for (const k of ["// fetch('x')", "/* location = 'x' */", "const v = a == location;", "if (s.src === x) y();", "if (location == x) y();"])
    dazu('js/format.js', k, () => soll(`Datenschutz lässt durch: ${k}`, lauf(SCHUTZ).status === 0, lauf(SCHUTZ).stderr));

  // --- Sonderzeichen-Pfad und Symlink: die Prüfungen laufen wirklich ---
  dazu('css/app.css', '.x { gap: 5px; }', () => {
    soll('Stil läuft unter Pfad mit Leerzeichen', lauf(STIL).status === 1);
    soll('Stil läuft über Symlink', lauf(join(link, STIL), [], link).status === 1);
  });
  dazu('js/format.js', "fetch('x');", () => {
    soll('Datenschutz läuft unter Pfad mit Leerzeichen', lauf(SCHUTZ).status === 1);
    soll('Datenschutz läuft über Symlink', lauf(join(link, SCHUTZ), [], link).status === 1);
  });
  soll('Auslieferung: ohne Ziel Exit 1', lauf('tools/auslieferung.mjs').status === 1);
  soll('Auslieferung: über Symlink ohne Ziel Exit 1', lauf(join(link, 'tools/auslieferung.mjs'), [], link).status === 1);
  const ziel = join(tmp, 'site');
  const r = lauf(join(link, 'tools/auslieferung.mjs'), [ziel], link);
  soll('Auslieferung kopiert', r.status === 0 && existsSync(join(ziel, 'js/main.js')), r.stderr);

  // --- quelltext.mjs: Kommentare weg, Strings und Regex bleiben, Zeilen gleich ---
  for (const [ein, aus] of [
    ['a = "https://x"; // b', 'a = "https://x";     '],
    ["a = 'it\\'s //x'; /* b */ c", "a = 'it\\'s //x';         c"],
    ['a = `x//${b /* c */}//y`; // d', 'a = `x//${b        }//y`;     '],
    ['a = `${`//${1}`}//`;', 'a = `${`//${1}`}//`;'],
    ['a = /\\/\\/x/.test(b); // c', 'a = /\\/\\/x/.test(b);     '],
    ['a = /[/*]/; b /* c */', 'a = /[/*]/; b        '],
    ['a = b / 2; // c / d', 'a = b / 2;         '],
    ['return /x/; // y', 'return /x/;     '],
    ['/* a\nb */ c', '    \n     c'],
  ]) soll(`Kommentar: ${ein}`, jsOhneKommentare(ein) === aus, JSON.stringify(jsOhneKommentare(ein)));
  soll('Kommentar in CSS', cssOhneKommentare('a{/* b\nc */d:e}') === 'a{    \n    d:e}', JSON.stringify(cssOhneKommentare('a{/* b\nc */d:e}')));
  // Am echten Code: dieselbe Länge und weiterhin gültiges JavaScript
  const sammle = d => readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? sammle(join(d, e.name)) : e.name.endsWith('.js') ? [join(d, e.name)] : []);
  const pruefdatei = join(tmp, 'pruefe.mjs');
  for (const datei of sammle(join(WURZEL, 'js'))) {
    const t = readFileSync(datei, 'utf8'), o = jsOhneKommentare(t);
    writeFileSync(pruefdatei, o);
    const c = spawnSync('node', ['--check', pruefdatei], { encoding: 'utf8' });
    soll(`Kommentare entfernt, Code intakt: ${basename(datei)}`, o.length === t.length && c.status === 0, c.stderr.slice(0, 200));
  }

  // --- test/lib.mjs ---
  const b = await browser({ cdpFrist: 800 });
  const frist = await b.cdp('Runtime.evaluate', { expression: 'new Promise(() => {})', awaitPromise: true }).then(() => null, e => e.message);
  soll('CDP: Frist greift bei hängender Seiten-Promise', /keine Antwort nach 0.8 s/.test(frist ?? ''), frist);
  const offen = b.cdp('Runtime.evaluate', { expression: 'new Promise(() => {})', awaitPromise: true }).then(() => null, e => e.message);
  b.proc.kill('SIGKILL');
  const tot = await offen;
  soll('CDP: toter Chrome lehnt offene Aufrufe ab', /geschlossen/.test(tot ?? ''), tot);
  await sleep(50);
  const danach = await b.ev('1').then(() => null, e => e.message);
  soll('CDP: Aufruf nach dem Tod lehnt sofort ab', /geschlossen/.test(danach ?? ''), danach);
  await b.schliesse();
  soll('Profil nach schliesse() gelöscht', !existsSync(b.profil), b.profil);
  // Test ruft process.exit() ohne schliesse(): Exit-Handler räumt Chrome und Profil ab
  const kind = spawnSync('node', ['--input-type=module', '-e',
    `import { browser } from ${JSON.stringify(pathToFileURL(join(WURZEL, 'test/lib.mjs')).href)};
     const b = await browser(); console.log(b.proc.pid, b.profil); process.exit(0);`], { encoding: 'utf8' });
  const [pid, profil] = kind.stdout.trim().split(' ');
  await sleep(300);
  soll('Exit ohne schliesse(): Profil gelöscht', profil && !existsSync(profil), kind.stdout + kind.stderr);
  let lebt = false;
  try { process.kill(Number(pid), 0); lebt = true; } catch { /* beendet */ }
  soll('Exit ohne schliesse(): Chrome beendet', !lebt, pid);
} catch (e) {
  abweichungen.push('Testfehler: ' + e.message);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(abweichungen.length ? `${abweichungen.length} Abweichungen bei ${schritte} Prüfungen:\n  ${abweichungen.join('\n  ')}`
  : `ok — ${schritte} Prüfungen der Werkzeuge bestanden`);
process.exit(abweichungen.length ? 1 : 0);
