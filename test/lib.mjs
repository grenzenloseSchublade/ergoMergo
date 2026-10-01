// Gemeinsame Helfer der Browser-Tests: statischer Server fürs Repo, Chrome
// headless über das DevTools-Protokoll (CDP), kleine Warte- und Klickhilfen.
// Keine Abhängigkeiten — nur Node ≥ 22 und ein Chrome/Chromium.
//   Chrome: $CHROME, sonst Playwrights chrome-headless-shell, sonst google-chrome

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readdirSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, extname, resolve, sep } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

export const WURZEL = fileURLToPath(new URL('..', import.meta.url));
export const sleep = ms => new Promise(r => setTimeout(r, ms));

const TYPEN = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ogg': 'audio/ogg', '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain', '.xml': 'text/xml' };

// Statischer Server auf freiem Port; liefert { url, schliesse }
export async function server() {
  const srv = createServer(async (req, res) => {
    try {
      let pfad = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (pfad.endsWith('/')) pfad += 'index.html';
      // nie aus dem Repo heraus (z. B. /..%2F..%2Fetc/passwd)
      const datei = resolve(WURZEL, '.' + pfad);
      if (!datei.startsWith(resolve(WURZEL) + sep)) throw new Error('außerhalb');
      const daten = await readFile(datei);
      res.writeHead(200, { 'content-type': TYPEN[extname(pfad)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(daten);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${srv.address().port}/`, schliesse: () => srv.close() };
}

function chromePfad() {
  if (process.env.CHROME) return process.env.CHROME;
  const pw = join(homedir(), '.cache/ms-playwright');
  if (existsSync(pw))
    for (const d of readdirSync(pw).filter(d => d.startsWith('chromium_headless_shell-')).sort().reverse()) {
      const p = join(pw, d, 'chrome-headless-shell-linux64/chrome-headless-shell');
      if (existsSync(p)) return p;
    }
  return 'google-chrome';
}

// Frisches Chrome-Profil, eine Seite, CDP-Helfer. breite/hoehe = Viewport.
// swUmgehen: false lässt den Service Worker arbeiten (Netz-Mitschnitt inkl. SW)
export async function browser({ breite = 412, hoehe = 915, dpr = 1, bewegung = true, swUmgehen = true } = {}) {
  const profil = mkdtempSync(join(tmpdir(), 'ergomergo-test-'));
  const args = ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profil}`, '--no-sandbox', 'about:blank'];
  if (!bewegung) args.splice(3, 0, '--force-prefers-reduced-motion');
  const proc = spawn(chromePfad(), args, { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsUrl = await new Promise((ok, fehl) => {
    let puffer = '';
    const t = setTimeout(() => fehl(new Error('Chrome startet nicht (CHROME setzen?)')), 15000);
    proc.stderr.on('data', d => {
      puffer += d;
      const m = puffer.match(/DevTools listening on (ws:\S+)/);
      if (m) { clearTimeout(t); ok(m[1]); }
    });
    proc.on('error', fehl);
  });
  const port = new URL(wsUrl).port;
  const seite = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page');
  const ws = new WebSocket(seite.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id = 0;
  const offen = new Map();
  const fehler = [];
  const zuhoerer = new Set();                 // rohe CDP-Ereignisse (auch aus angehängten Sitzungen, z. B. SW)
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    offen.get(m.id)?.(m);
    for (const f of zuhoerer) f(m);
    if (m.method === 'Runtime.exceptionThrown')
      fehler.push((m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).slice(0, 300));
  };
  const cdp = (method, params = {}, sessionId) => new Promise(r => { const i = ++id; offen.set(i, r); ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) })); });
  const ev = async expr => {
    const m = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (m.result?.exceptionDetails) fehler.push('Auswertung: ' + JSON.stringify(m.result.exceptionDetails).slice(0, 300));
    return m.result?.result?.value;
  };
  await cdp('Runtime.enable'); await cdp('Page.enable'); await cdp('Network.enable');
  await cdp('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp('Network.setBypassServiceWorker', { bypass: swUmgehen });
  const groesse = (w, h) => cdp('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dpr, mobile: true });
  await groesse(breite, hoehe);
  // Headless hat kein Web Bluetooth; ohne Attrappe zeigt die App den Browser-Hinweis.
  // __ftms: der (Demo-)Trainer, um Trennungen simulieren zu können.
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `
    if (!navigator.bluetooth) Object.defineProperty(navigator, 'bluetooth', { value: Object.assign(new EventTarget(), {
      getAvailability: async () => true, getDevices: async () => [],
      requestDevice: async () => { throw new DOMException('abgebrochen', 'NotFoundError'); } }) });
    // Jeder CSP-Verstoß wird zum Testfehler (Runtime.exceptionThrown)
    document.addEventListener('securitypolicyviolation', e => { setTimeout(() => { throw new Error('CSP-Verstoß: ' + e.violatedDirective + ' ' + e.blockedURI); }); });
    const orig = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (typ, ...r) { if (typ === 'reconnectfehler') window.__ftms = this; return orig.call(this, typ, ...r); };` });
  return {
    cdp, ev, fehler, groesse,
    hoere: f => { zuhoerer.add(f); return () => zuhoerer.delete(f); },
    geh: async (url, ms = 2500) => { await cdp('Page.navigate', { url }); await sleep(ms); },
    klick: async (sel, ms = 450) => { await ev(`document.querySelector(${JSON.stringify(sel)}).click()`); await sleep(ms); },
    bild: async () => Buffer.from((await cdp('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'),
    // Profil erst löschen, wenn Chrome beendet ist (sonst schreibt es noch hinein)
    schliesse: () => {
      ws.close();
      proc.once('exit', () => { try { rmSync(profil, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* tmp räumt das System */ } });
      proc.kill();
    },
  };
}

// Beispiel-Historie in die IndexedDB der Seite schreiben (Home mit Daten)
export const historieAnlegen = b => b.ev(`(async () => { const d = await import('./js/demo.js'), st = await import('./js/storage.js');
  const h = await d.beispielHistorie();
  for (const s of h.sessions) { await st.saveSession(s); const x = h.daten.get(s.id); await st.saveSamples(s.id, x.samples, x.count); } })()`);
