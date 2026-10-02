#!/usr/bin/env node
// Layout-Prüfung des Fahrbildschirms in allen Ausrichtungen und Fokus-Modi:
//   · Bedienleiste (−10/+10/STOPP/Beenden) vollständig im Bild
//   · nichts ragt über den Rand
//   · Status, Nebenwerte, Chips, Demo mittig
//   · nichts springt, wenn etwas passiert (Meldung, Menü, STOPP, Skip, 3-stellige Werte …)
//   · Panel „⋯" überdeckt die Bedienleiste nie; Tipp daneben schließt nur
//   · Blatt „Tastenbelegung" (aus dem Panel) ebenso: nie über der Bedienleiste;
//     passt als Lenker und als Liste ohne Scrollen, Umschalten verschiebt nichts
//   · Lern-Modus „Tasten zuordnen" (nachgebildeter Lenker): passt in jedem
//     Schritt ohne Scrollen, Höhe und Knöpfe bleiben stehen, Zeilen einzeilig
// Aufruf: node test/layout.mjs [breitexhöhe …]     (ohne Angabe: alle Standardgrößen)
// Ausgabe: Befunde je Größe, Exit 1 bei Befunden.

import { server, browser, sleep } from './lib.mjs';

const GROESSEN = process.argv.slice(2).length
  ? process.argv.slice(2).map(a => a.split('x').map(Number))
  : [[360, 640], [360, 560], [412, 915], [780, 360], [900, 412]];
const WERTE = ['.ride-kopf', '#btn-trainer', '#btn-hr', '#btn-click', '#m-demo', '#btn-mehr', '#m-watt', '#m-target',
  '#m-time', '#m-total', '.row-secondary', '#m-status', '.row-actions', '#live-chart', '#btn-minus', '#btn-plus', '#btn-stop', '#btn-end'];

async function pruefe(srv, [breite, hoehe]) {
  const b = await browser({ breite, hoehe });
  const befunde = [];
  try {
    await b.geh(srv.url, 1000);
    await b.ev(`import('./js/storage.js').then(m => m.setSetting('ftp', 200))`);
    await b.geh(srv.url + '?demo=programm', 3000);

    const lage = () => b.ev(`(() => { const o = {}; for (const s of ${JSON.stringify(WERTE)}) { const e = document.querySelector(s);
      if (!e) continue; const r = e.getBoundingClientRect(); o[s] = [r.left, r.top, r.width, r.height].map(v => Math.round(v * 2) / 2); } return o; })()`);
    const vergleiche = (was, a, c) => {
      for (const s of WERTE) {
        const x = a[s], y = c[s];
        if (x && y && x.some((v, i) => Math.abs(v - y[i]) > 0.5)) befunde.push(`springt bei ${was}: ${s} ${x.join('/')} → ${y.join('/')}`);
      }
    };
    const fokus = async f => {
      await b.ev(`document.querySelector('.ride-grid').classList.remove('fokus-werte','fokus-graph')`);
      if (f === 'werte') await b.ev(`document.querySelector('.metrics').click()`);
      if (f === 'graph') await b.ev(`(() => { const c = document.querySelector('#live-chart'), r = c.getBoundingClientRect();
        c.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 })); })()`);
      await sleep(400);
    };

    for (const modus of ['normal', 'werte', 'graph']) {
      await fokus(modus);
      // Bedienleiste im Bild, nichts über den Rand
      const rand = await b.ev(`(() => { const out = [];
        for (const e of document.querySelectorAll('#screen-ride *')) { if (!e.offsetParent) continue; const r = e.getBoundingClientRect();
          if (r.width && (r.right > innerWidth + .5 || r.bottom > innerHeight + .5)) out.push((e.id || e.className || e.tagName) + ' bis ' + Math.round(r.right) + '/' + Math.round(r.bottom)); }
        return out.slice(0, 4); })()`);
      if (rand.length) befunde.push(`${modus}: ragt über den Rand — ${rand.join(', ')}`);
      // Zentrierung gegen die Werte-Spalte (Chips gegen den Graphen, Demo gegen die Kopfzeile)
      const mitte = await b.ev(`(() => { const m = s => { const e = document.querySelector(s); if (!e?.offsetParent) return null;
        const r = e.getBoundingClientRect(); return r.width ? (r.left + r.right) / 2 : null; };
        return { basis: m('.metrics'), status: m('#m-status'), nebenwerte: m('.row-secondary'), chips: m('.row-actions'), demo: m('#m-demo'), kopf: m('.ride-kopf'), graph: m('#live-chart') }; })()`);
      for (const k of ['status', 'nebenwerte', 'chips', 'demo']) {
        const bezug = k === 'demo' ? mitte.kopf : k === 'chips' ? mitte.graph : mitte.basis;
        if (mitte[k] !== null && bezug !== null && Math.abs(mitte[k] - bezug) > 2) befunde.push(`${modus}: ${k} ${Math.round(mitte[k] - bezug)} px neben der Mitte`);
      }
      // Ereignisse dürfen nichts verschieben
      const ereignisse = [
        ['Trainer getrennt', `__ftms.connected = false; __ftms.dispatchEvent(new Event('disconnected'))`, `__ftms.connected = true; __ftms.dispatchEvent(new Event('reconnected'))`],
        ['Menü', `document.querySelector('#btn-mehr').click()`, `document.querySelector('#btn-mehr').click()`],
        ['Geräte-Symbol', `document.querySelector('#btn-hr').click()`, ''],
        ['STOPP', `document.querySelector('#btn-stop').click()`, ''],
        ...(modus !== 'werte' ? [['Skip', `document.querySelector('#btn-skip').click()`, ''], ['+30 s', `document.querySelector('#btn-ext').click()`, '']] : []),
        ['Beenden armiert', `document.querySelector('#btn-end').click()`, `{ const e = document.querySelector('#btn-end'); e.textContent = 'Beenden'; e.classList.remove('armiert'); }`],
        ['3-stellige Werte', `for (const [s, t] of [['#m-rpm','105'],['#m-hr','172'],['#m-kj','999'],['#m-km','99,9'],['#m-watt','888'],['#m-target','400']]) document.querySelector(s).textContent = t`, ''],
      ];
      for (const [was, an, aus] of ereignisse) {
        const vor = await lage();
        await b.ev(an); await sleep(450);
        vergleiche(`${modus} · ${was}`, vor, await lage());
        if (was === 'STOPP') { await sleep(3200); vergleiche(`${modus} · STOPP → WEITER`, vor, await lage()); await b.ev(`document.querySelector('#btn-stop').click()`); await sleep(400); }
        if (aus) { await b.ev(aus); await sleep(450); }
      }
    }

    // Panel „⋯": nie über der Bedienleiste, passt ohne Scrollen
    await fokus('normal');
    await b.klick('#btn-mehr', 500);
    const panel = await b.ev(`(() => { const d = document.querySelector('#dlg-fahrt-optionen'), r = d.getBoundingClientRect();
      const deckt = [...document.querySelectorAll('.controls .ctl')].filter(k => { const q = k.getBoundingClientRect();
        return !(r.right <= q.left || r.left >= q.right || r.bottom <= q.top || r.top >= q.bottom); }).map(k => k.id);
      return { deckt, scrollt: d.scrollHeight > d.clientHeight + 1, unten: Math.round(r.bottom) }; })()`);
    if (panel.deckt.length) befunde.push(`Panel überdeckt ${panel.deckt.join(', ')} (Unterkante ${panel.unten})`);
    if (panel.scrollt && hoehe >= 640) befunde.push('Panel muss scrollen');   // auf sehr kleinen Schirmen erlaubt
    // Hinweiszeile: im Normalzustand kein Loch zwischen „Geräte" und „Töne";
    // eine echte Rückmeldung (Tipp auf „Trainer") verschiebt nichts, lässt das
    // Panel nicht wachsen und überdeckt keine Zeile
    const panelLage = () => b.ev(`(() => { const d = document.querySelector('#dlg-fahrt-optionen'), q = e => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom].map(Math.round); };
      const h = document.querySelector('#fo-hinweis'), t = document.querySelector('.fo-toene > .gruppe-titel');
      return { panel: q(d), zeilen: [...d.querySelectorAll('.fo-zeile, .schalter-zeile')].map(q), hinweis: q(h), text: h.textContent,
        titel: q(t), belegung: q(document.querySelector('#fo-belegung')), scrollt: d.scrollHeight > d.clientHeight + 1 }; })()`);
    const leer = await panelLage();
    const gestapelt = leer.titel[1] > leer.belegung[3];
    if (gestapelt && leer.titel[1] - leer.belegung[3] > 13) befunde.push(`Lücke zwischen Geräte und Töne: ${leer.titel[1] - leer.belegung[3]} px`);
    await b.klick('#dlg-fahrt-optionen [data-geraet="trainer"]', 400);
    const mit = await panelLage();
    if (!mit.text) befunde.push('Tipp auf „Trainer" zeigt keine Rückmeldung im Panel');
    if (JSON.stringify(mit.panel) !== JSON.stringify(leer.panel) || JSON.stringify(mit.zeilen) !== JSON.stringify(leer.zeilen))
      befunde.push('Rückmeldung im Panel verschiebt etwas');
    if (mit.scrollt && !leer.scrollt) befunde.push('Rückmeldung im Panel erzwingt Scrollen');
    const [hl, ht, hr, hb] = mit.hinweis;
    if (mit.zeilen.some(([l, t, r, u]) => !(hr <= l || hl >= r || hb <= t || ht >= u))) befunde.push('Rückmeldung überdeckt eine Zeile im Panel');
    // Tipp daneben (echte Touch-Geste auf den Graphen, wo das Panel ihn nicht verdeckt) schließt nur
    const punkt = await b.ev(`(() => { const el = document.querySelector('#live-chart'), r = el.getBoundingClientRect();
      for (let y = r.top + r.height * .5; y < r.bottom - 2; y += 4) for (let x = r.left + r.width * .2; x < r.right - r.width * .1; x += 6)
        if (el.contains(document.elementFromPoint(x, y))) return [x, y]; return null; })()`);
    if (punkt) {
      await b.cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      for (const type of ['touchStart', 'touchEnd'])
        await b.cdp('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: punkt[0], y: punkt[1] }] });
      await sleep(400);
      const z = await b.ev(`({ offen: document.querySelector('#dlg-fahrt-optionen').open, fokus: document.querySelector('.ride-grid').className })`);
      if (z.offen) befunde.push('Tipp neben das Panel schließt es nicht');
      if (z.fokus.includes('fokus')) befunde.push('Tipp neben das Panel wirkt zusätzlich (Fokus gewechselt)');
    } else if (await b.ev(`document.querySelector('#dlg-fahrt-optionen').open`)) await b.klick('#btn-mehr');

    // Blatt „Tastenbelegung": aus dem Panel, nie über der Bedienleiste, Kopfzeile bleibt frei
    await b.klick('#btn-mehr', 500);
    await b.klick('#fo-belegung', 800);
    const blatt = await b.ev(`(() => { const d = document.querySelector('#dlg-belegung'), r = d.getBoundingClientRect();
      const deckt = [...document.querySelectorAll('.controls .ctl, .ride-kopf button')].filter(k => { const q = k.getBoundingClientRect();
        return q.width && !(r.right <= q.left || r.left >= q.right || r.bottom <= q.top || r.top >= q.bottom); }).map(k => k.id || k.className);
      return { offen: d.open, deckt, rand: r.right > innerWidth + .5 || r.bottom > innerHeight + .5 }; })()`);
    if (!blatt.offen) befunde.push('Blatt „Tastenbelegung" öffnet nicht');
    if (blatt.deckt.length) befunde.push(`Blatt überdeckt ${blatt.deckt.join(', ')}`);
    if (blatt.rand) befunde.push('Blatt ragt über den Rand');
    // Lenker und Liste: ohne Scrollen; der Umschalter verschiebt weder das
    // Blatt noch sich selbst
    const blattLage = () => b.ev(`(() => { const d = document.querySelector('#dlg-belegung'), u = d.querySelector('.belegung-umschalter');
      const q = e => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map(Math.round).join('/'); };
      // Umschalter: „Als Liste ›"/„Als Lenker ›" ist verschieden breit — die bündige Kante (hochkant rechts, quer links) und die Höhe bleiben
      const k = u.getBoundingClientRect(), kante = matchMedia('(orientation: landscape) and (max-height: 620px)').matches ? k.left : k.right;
      return { scrollt: d.scrollHeight > d.clientHeight + 1, hoehe: d.scrollHeight + '/' + d.clientHeight, blatt: q(d),
        knopf: [kante, k.top, k.height].map(Math.round).join('/') }; })()`);
    if (blatt.offen) {
      const karte = await blattLage();
      if (karte.scrollt) befunde.push(`Blatt (Lenker) muss scrollen: ${karte.hoehe}`);
      await b.klick('#dlg-belegung .belegung-umschalter', 300);
      const liste = await blattLage();
      if (liste.scrollt) befunde.push(`Blatt (Liste) muss scrollen: ${liste.hoehe}`);
      if (liste.blatt !== karte.blatt || liste.knopf !== karte.knopf) befunde.push(`Umschalten Lenker ↔ Liste verschiebt: ${karte.blatt} ${karte.knopf} → ${liste.blatt} ${liste.knopf}`);
      await b.klick('#dlg-belegung .belegung-umschalter', 300);
      await b.ev('history.back()'); await sleep(500);
    }

    // Lern-Modus mit nachgebildetem Lenker (Tasten als 'button'-Ereignis):
    // jeder Schritt ohne Scrollen, gleiche Höhe, Knöpfe im Bild, Zeilen einzeilig
    await b.geh(srv.url, 1500);
    await b.ev(`(async () => { const { geraeteManager: g } = await import('./js/ble/geraete.js');
      const pad = Object.assign(new EventTarget(), { deviceName: 'Zwift Ride' }), orig = g.clients.bind(g);
      g.clients = r => r === 'controller' ? [pad] : orig(r);
      g.verbindeOderKoppel = async () => ({ ergebnis: 'verbunden' });
      window.__taste = bit => pad.dispatchEvent(new CustomEvent('button', { detail: bit })); })()`);
    await b.klick('#btn-settings', 700);
    await b.klick('#btn-map-lernen', 900);
    const lern = () => b.ev(`(() => { const d = document.querySelector('#dlg-mapping'), r = d.getBoundingClientRect();
      const knoepfe = [...d.querySelectorAll('.dlg-actions button')].filter(k => !k.hidden).map(k => k.getBoundingClientRect());
      const zeilen = ['#map-kicker', '#map-schritt', '#map-status'].filter(s => { const e = document.querySelector(s);
        return e.scrollWidth > e.clientWidth + 1 || e.getBoundingClientRect().height > parseFloat(getComputedStyle(e).lineHeight) * 1.5; });
      return { offen: d.open, scrollt: d.scrollHeight > d.clientHeight + 1, hoehe: Math.round(r.height), top: Math.round(r.top), masse: d.scrollHeight + '/' + d.clientHeight,
        knoepfe: knoepfe.every(k => k.bottom <= innerHeight + .5 && k.bottom <= r.bottom + .5), knopfZeile: [...new Set(knoepfe.map(k => Math.round(k.top)))].length, zeilen,
        text: document.querySelector('#map-schritt').textContent + ' · ' + document.querySelector('#map-status').textContent }; })()`);
    const ablauf = [
      ['Schritt 1 ohne Taste', null],
      ['Schritt 1, erste Taste', '__taste(26)'], ['Schritt 1, zweite Taste', '__taste(25)'],
      ['Schritt 2', `document.querySelector('#btn-map-weiter').click()`], ['Schritt 2, schon belegt', '__taste(26)'],
      ['Schritt 2, zwei Tasten', '__taste(27); __taste(24)'], ['Schritt 2, Taste entfernt', '__taste(24)'],
      ['Schritt 3', `document.querySelector('#btn-map-weiter').click()`], ['Schritt 3, Taste', '__taste(2)'],
      ['Schritt 4', `document.querySelector('#btn-map-weiter').click()`], ['Schritt 5', `document.querySelector('#btn-map-skip').click()`],
      ['Schritt 5, Taste', '__taste(5)'],
    ];
    let erst = null;
    for (const [was, aktion] of ablauf) {
      if (aktion) { await b.ev(aktion); await sleep(250); }
      const z = await lern();
      if (!z.offen) { befunde.push(`Lern-Modus bei „${was}" nicht offen`); break; }
      erst ??= z;
      if (z.scrollt) befunde.push(`Lern-Modus muss scrollen (${was}): ${z.masse}`);
      if (z.hoehe !== erst.hoehe || z.top !== erst.top) befunde.push(`Lern-Modus springt (${was}): Höhe ${erst.hoehe} → ${z.hoehe}, oben ${erst.top} → ${z.top}`);
      if (!z.knoepfe) befunde.push(`Lern-Modus: Knöpfe nicht im Bild (${was})`);
      if (z.knopfZeile > 1) befunde.push(`Lern-Modus: Knöpfe in ${z.knopfZeile} Zeilen (${was})`);
      if (z.zeilen.length) befunde.push(`Lern-Modus: ${z.zeilen.join(', ')} nicht einzeilig (${was}: ${z.text})`);
    }
    await b.klick('#btn-map-abbruch', 400);
  } catch (e) {
    befunde.push('Testfehler: ' + e.message);
  } finally {
    befunde.push(...b.fehler.map(f => 'JS-Fehler: ' + f));
    b.schliesse();
  }
  return [...new Set(befunde)];
}

const srv = await server();
let summe = 0;
for (const g of GROESSEN) {
  const befunde = await pruefe(srv, g);
  summe += befunde.length;
  console.log(`${g.join('×').padEnd(8)} ${befunde.length ? befunde.length + ' Befunde' : 'ok'}`);
  for (const f of befunde) console.log('   ' + f);
}
srv.schliesse();
process.exit(summe ? 1 : 0);
