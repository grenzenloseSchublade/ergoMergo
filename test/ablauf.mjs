#!/usr/bin/env node
// Ablauf-Prüfung: Navigation (Zurück-Taste, Dialoge, Overlay), Einstellungen,
// Fahrt (Halten, Not-Stopp mit Sperre, Fokus, Doppel-Zurück), Programm
// (Skip, +30 s, zweistufiges Beenden) und die Demo-Wege — mit Sollwerten.
// Aufruf: node test/ablauf.mjs     Exit 1, wenn ein Schritt abweicht.

import { server, browser, sleep, historieAnlegen } from './lib.mjs';

const srv = await server();
const b = await browser({ breite: 412, hoehe: 900 });
const abweichungen = [];
let schritte = 0;
const soll = (was, ist, erwartet) => {
  schritte++;
  const ok = typeof erwartet === 'function' ? erwartet(ist) : ist === erwartet;
  if (!ok) abweichungen.push(`${was}: ist ${JSON.stringify(ist)}, erwartet ${typeof erwartet === 'function' ? erwartet.toString() : JSON.stringify(erwartet)}`);
};
const bildschirm = () => b.ev(`['home','fahrten','detail','ride'].filter(k => !document.querySelector('#screen-' + k).hidden).join()`);
const suche = () => b.ev('location.search');
const ftp = () => b.ev(`import('./js/storage.js').then(m => m.getSettings()).then(s => s.ftp)`);
const zurueck = (ms = 800) => b.ev('history.back()').then(() => sleep(ms));
// Echter Tipp oben an den Bildschirmrand — neben jedes Blatt und jeden Dialog
// (Light Dismiss über closedby="any" braucht echte Zeigerereignisse)
const tippDaneben = async (br, ms = 600) => {
  for (const type of ['mousePressed', 'mouseReleased'])
    await br.cdp('Input.dispatchMouseEvent', { type, x: 200, y: 5, button: 'left', clickCount: 1 });
  await sleep(ms);
};
const offen = (br, id) => br.ev(`document.querySelector('#${id}').open`);
// „Heute fahren ›" → Startdialog → Tipp daneben (= Abbrechen): Woche wieder wie vorher
async function heuteFahrenAbbrechen(br, streifenVorher) {
  await br.klick('#plan-starten', 1000);
  soll('Startdialog für die verschobene Einheit', await offen(br, 'dlg-start'), true);
  await tippDaneben(br, 1000);
  soll('Tipp neben den Startdialog schließt ihn', await offen(br, 'dlg-start'), false);
  soll('… und nimmt die Verschiebung zurück', await br.ev(`[...document.querySelectorAll('.plan-tag')].map(l => l.title).join('|')`), streifenVorher);
}

try {
  // --- Navigation mit Fahrten-Historie ---
  await b.geh(srv.url, 1500);
  await b.ev(`import('./js/storage.js').then(m => m.setSetting('ftp', 200))`);
  await historieAnlegen(b);
  await b.geh(srv.url, 2000);
  soll('Start', await bildschirm(), 'home');
  await b.klick('#btn-alle-fahrten', 800);
  soll('Alle Fahrten', await bildschirm(), 'fahrten');
  await b.klick('#fahrten-monate li:not(.woche)', 800);
  soll('Fahrt öffnen', await bildschirm(), 'detail');
  await b.klick('#btn-back', 800);
  soll('Zurück-Knopf', await bildschirm(), 'fahrten');
  await zurueck();
  soll('Handy-Zurück', await bildschirm(), 'home');
  await b.klick('#session-list li', 800);
  soll('Fahrt von Home', await bildschirm(), 'detail');
  await zurueck();
  soll('Zurück zu Home', await bildschirm(), 'home');
  await b.klick('#session-list li', 600);
  await b.klick('#detail-chart', 400);
  soll('Graph-Overlay offen', await b.ev(`document.querySelector('#dlg-graph').open`), true);
  await zurueck(500);
  soll('Zurück schließt Overlay', await b.ev(`document.querySelector('#dlg-graph').open`), false);
  soll('… und bleibt in der Fahrt', await bildschirm(), 'detail');
  await b.klick('#btn-back', 700);

  // --- Einstellungen: Zurück verwirft, Speichern übernimmt ---
  await b.klick('#btn-settings', 700);
  await b.ev(`document.querySelector('#set-ftp').value = 248`);
  await zurueck(700);
  soll('Zurück schließt Einstellungen', await b.ev(`document.querySelector('#dlg-settings').open`), false);
  soll('… ohne zu speichern', await ftp(), 200);
  await b.klick('#btn-settings', 700);
  await b.ev(`document.querySelector('#set-ftp').value = 248; document.querySelector('#dlg-settings button.primary').click()`);
  await sleep(800);
  soll('Speichern übernimmt FTP 248', await ftp(), 248);
  await b.klick('#btn-settings', 600);
  soll('returnValue beim Öffnen leer', await b.ev(`document.querySelector('#dlg-settings').returnValue`), '');
  await zurueck(600);
  soll('FTP bleibt 248', await ftp(), 248);
  // Eingaben gehen nicht durch einen Fehltipp verloren: Einstellungen bleiben offen
  await b.klick('#btn-settings', 600);
  await tippDaneben(b);
  soll('Tipp neben die Einstellungen schließt sie nicht', await offen(b, 'dlg-settings'), true);
  // „Deine Daten" aus den Einstellungen: Blatt darüber, Tipp daneben schließt nur das Blatt
  await b.klick('#btn-daten-mehr', 600);
  soll('Daten-Blatt über den Einstellungen', await offen(b, 'dlg-daten'), true);
  await tippDaneben(b);
  soll('Tipp daneben schließt nur das Blatt', [await offen(b, 'dlg-daten'), await offen(b, 'dlg-settings')].join(), 'false,true');
  await zurueck(600);
  soll('Zurück schließt dann die Einstellungen', await offen(b, 'dlg-settings'), false);
  // … und aus der Statuszeile
  await b.klick('#btn-daten', 600);
  soll('Daten-Blatt aus der Statuszeile', await b.ev(`document.querySelector('#daten-speicher-titel').textContent`), t => /dauerhaft gespeichert$/.test(t));
  await tippDaneben(b);
  soll('Tipp neben das Daten-Blatt schließt es', await offen(b, 'dlg-daten'), false);
  soll('… ohne History-Rest', await b.ev('history.state?.dialog ?? null'), null);

  // --- Trainingsplan: anlegen, heutige Einheit, Start vorbelegt, ändern, beenden ---
  soll('Ohne Plan: Anlegen-Knopf', await b.ev(`!document.querySelector('#plan-anlegen').hidden`), true);
  await b.klick('#plan-anlegen', 700);
  // heute + drei Tage später wählen (Wochentag-unabhängig; ≥ 48 h Abstand)
  await b.ev(`(() => { const heute = (new Date().getDay() + 6) % 7, tage = [heute, (heute + 3) % 7].map(String);
    for (const i of document.querySelectorAll('#plan-tage input')) i.checked = tage.includes(i.value);
    document.querySelector('.plan-form').dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(200);
  soll('Vorschau zeigt zwei Einheiten', await b.ev(`document.querySelectorAll('#plan-vorschau li').length`), n => n >= 1 && n <= 2);
  await b.ev(`document.querySelector('#plan-ok').click()`); await sleep(1200);
  soll('Plan-Karte sichtbar', await b.ev(`!document.querySelector('#plan-karte').hidden && document.querySelector('#plan-anlegen').hidden`), true);
  soll('Heute steht eine Einheit an', await b.ev(`document.querySelector('#plan-titel').textContent`), t => t.startsWith('Heute: '));
  soll('Wochenstreifen hat 7 Tage', await b.ev(`document.querySelectorAll('#plan-woche li').length`), 7);
  const planTitel = await b.ev(`document.querySelector('#plan-titel').textContent`);
  await b.klick('#plan-heute', 800);
  soll('Startdialog aus dem Plan', await b.ev(`document.querySelector('#dlg-start').open`), true);
  soll('… mit Namen der Einheit', await b.ev(`document.querySelector('#dlg-title').textContent`), t => t.length > 0 && planTitel.includes(t));
  await b.ev(`document.querySelector('#dlg-start').close()`); await sleep(400);
  // Tippflächen (docs/stil.md): alles Tippbare ≥ 44 px; Ausnahme 7-Spalten-Reihen (Breite)
  const tippflaechen = () => b.ev(`[...document.querySelectorAll('button, summary, label:has(input)')]
    .filter(e => e.offsetParent && !e.closest('[hidden]'))
    .map(e => ({ e, r: e.getBoundingClientRect() }))
    .filter(({ e, r }) => r.height < 43.5 || (r.width < 43.5 && !e.closest('.plan-woche, .tag-wahl')))
    .map(({ e, r }) => (e.id || e.className || e.tagName) + ' ' + Math.round(r.width) + '×' + Math.round(r.height))`);
  soll('Tippflächen auf Home', await tippflaechen(), l => l.length === 0);

  // Kalender: anderen Tag wählen zeigt dessen Einheit, heute wieder wählen
  const titelHeute = await b.ev(`document.querySelector('#plan-titel').textContent`);
  await b.ev(`document.querySelector('.plan-tag:not(.heute) button').click()`); await sleep(600);
  soll('Tag wählen zeigt diesen Tag', await b.ev(`document.querySelector('#plan-titel').textContent`), t => t !== titelHeute && !t.startsWith('Heute'));
  soll('… und ist markiert', await b.ev(`document.querySelectorAll('.plan-tag.gewaehlt').length`), 1);
  await b.ev(`document.querySelector('.plan-tag.heute button').click()`); await sleep(600);
  soll('Heute wieder gewählt', await b.ev(`document.querySelector('#plan-titel').textContent`), titelHeute);
  soll('Knöpfe Starten und Ändern', await b.ev(`document.querySelector('#plan-starten').textContent + '|' + !document.querySelector('#plan-aendern').hidden`), 'Starten ›|true');

  // Späterer Tag: „Heute fahren ›" öffnet den Startdialog; Abbrechen nimmt die Verschiebung zurück
  const streifenVorher = await b.ev(`[...document.querySelectorAll('.plan-tag')].map(l => l.title).join('|')`);
  await b.ev(`[...document.querySelectorAll('.plan-tag:not(.heute) button')].find(x => !x.closest('[data-status="frei"]')).click()`); await sleep(600);
  soll('Späterer Tag: Heute fahren', await b.ev(`document.querySelector('#plan-starten').textContent`), 'Heute fahren ›');
  // Mit den Beispieldaten (gestern hart gefahren) ist heute gesperrt — dann muss der Grund dastehen
  if (await b.ev(`document.querySelector('#plan-starten').disabled`))
    soll('Gesperrt mit Grund', await b.ev(`document.querySelector('#plan-sub').textContent`), t => t.startsWith('Heute nicht möglich'));
  else await heuteFahrenAbbrechen(b, streifenVorher);
  await b.ev(`document.querySelector('.plan-tag.heute button').click()`); await sleep(600);

  // Blatt „Einheit ändern" über „Ändern": heutige Einheit auslassen, rückgängig machen
  await b.klick('#plan-aendern', 600);
  soll('Blatt für heute offen', await b.ev(`document.querySelector('#dlg-einheit').open`), true);
  soll('Tippflächen im Blatt', await tippflaechen(), l => l.length === 0);
  await b.ev(`[...document.querySelectorAll('#ein-aktionen button')].find(x => x.textContent.startsWith('Auslassen')).click()`); await sleep(900);
  soll('Heute ausgelassen', await b.ev(`document.querySelector('.plan-tag.heute').dataset.status`), 'ausgelassen');
  soll('Rückgängig angeboten', await b.ev(`!!document.querySelector('.toast.mit-aktion .toast-aktion')`), true);
  await b.ev(`document.querySelector('.toast-aktion').click()`); await sleep(900);
  soll('Rückgängig stellt her', await b.ev(`document.querySelector('.plan-tag.heute').dataset.status`), 'geplant');
  await b.klick('#plan-aendern', 600);
  await tippDaneben(b);
  soll('Tipp neben das Blatt schließt es', await offen(b, 'dlg-einheit'), false);
  // Freie Fahrt an einem Plantag gilt als Ersatz für die offene Einheit
  soll('Freie Fahrt heute = Ersatz', await b.ev(`import('./js/ui/plan-ui.js').then(m => m.planErsatzHeute()).then(i => !!i?.ersatz && i.statt.length > 0)`), true);
  soll('Kopf zeigt die Plan-Länge', await b.ev(`document.querySelector('#plan-kicker').textContent`), t => /Woche 1 von 8/.test(t));
  // Pausieren und Fortsetzen
  await b.klick('#btn-plan', 700);
  await b.ev(`document.querySelector('#plan-pausieren').click()`); await sleep(1000);
  soll('Plan pausiert', await b.ev(`document.querySelector('#plan-kicker').textContent`), t => t.includes('pausiert'));
  soll('… ohne Wochenstreifen', await b.ev(`document.querySelector('#plan-woche').hidden`), true);
  await b.klick('#plan-aktion', 1000);
  soll('Fortsetzen', await b.ev(`document.querySelector('#plan-kicker').textContent`), t => !t.includes('pausiert') && t.includes('Woche'));
  await b.klick('#btn-plan', 700);
  soll('Ändern-Dialog', await b.ev(`document.querySelector('#plan-ok').textContent + '|' + !document.querySelector('#plan-beenden').hidden`), 'Übernehmen|true');
  await b.ev(`window.confirm = () => true; document.querySelector('#plan-beenden').click()`); await sleep(1000);
  soll('Plan beendet', await b.ev(`document.querySelector('#plan-karte').hidden && !document.querySelector('#plan-anlegen').hidden`), true);

  // --- Freie Demo-Fahrt: Halten, Not-Stopp, Sperre, Fokus, Doppel-Zurück ---
  await b.ev(`import('./js/storage.js').then(async m => { await m.setSetting('ftp', 200); await m.setSetting('wattSchritt', 10); })`);
  await b.geh(srv.url + '?demo', 2500);
  const ziel = () => b.ev(`+document.querySelector('#m-target').textContent`);
  const stopp = () => b.ev(`document.querySelector('#btn-stop').textContent.trim()`);
  const druck = (sel, pid, typ) => b.ev(`document.querySelector('${sel}').dispatchEvent(new PointerEvent('${typ}', { bubbles: true, pointerId: ${pid}, isPrimary: ${pid === 1} }))`);
  soll('Fahrt läuft', await bildschirm(), 'ride');
  await druck('#btn-plus', 1, 'pointerdown'); await druck('#btn-minus', 2, 'pointerdown');
  await sleep(1300);
  await druck('#btn-plus', 1, 'pointerup'); await druck('#btn-minus', 2, 'pointerup');
  const z1 = await ziel(); await sleep(1500);
  soll('Zwei Finger losgelassen: Ziel steht', await ziel(), z1);
  await druck('#btn-plus', 1, 'pointerdown'); await sleep(700);
  await b.klick('#btn-stop', 1500);
  soll('STOPP während Halten', await stopp(), 'GESTOPPT');
  await druck('#btn-plus', 1, 'pointerup');
  const zGestoppt = await ziel();
  await druck('#btn-plus', 3, 'pointerdown'); await druck('#btn-plus', 3, 'pointerup'); await sleep(300);
  soll('± in der Sperre wirkt nicht', await ziel(), zGestoppt);
  await sleep(3000);
  soll('Nach der Sperre: WEITER', await stopp(), 'WEITER');
  await druck('#btn-plus', 4, 'pointerdown'); await druck('#btn-plus', 4, 'pointerup'); await sleep(400);
  soll('± nach der Sperre fährt weiter', await stopp(), 'STOPP');
  await b.klick('.metrics', 300);
  soll('Tipp auf Werte: Werte-Fokus', await b.ev(`document.querySelector('.ride-grid').className`), v => v.includes('fokus-werte'));
  await b.ev(`(() => { const c = document.querySelector('#live-chart'), r = c.getBoundingClientRect();
    c.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 })); })()`);
  await sleep(300);
  soll('Tipp auf Graph: Graph-Fokus', await b.ev(`document.querySelector('.ride-grid').className`), v => v.includes('fokus-graph'));
  await zurueck(600);
  soll('1× Zurück beendet nicht', await bildschirm(), 'ride');
  await zurueck(2500);
  soll('2× Zurück beendet', await bildschirm(), 'home');

  // --- Programm: Skip, +30 s, zweistufiges Beenden ---
  await b.geh(srv.url + '?demo=programm', 2500);
  const zeit = () => b.ev(`document.querySelector('#m-time').textContent`);
  const vorSkip = await zeit();
  await b.klick('#btn-skip', 400);
  soll('Skip wechselt den Block', await zeit(), v => v !== vorSkip);
  const vorExt = await zeit();
  await b.klick('#btn-ext', 300);
  const sek = t => t.split(':').reduce((a, x) => a * 60 + +x, 0);
  soll('+30 s verlängert', sek(await zeit()) - sek(vorExt), d => d >= 28 && d <= 31);
  await b.klick('#btn-end', 200);
  soll('Beenden 1×: Rückfrage', await b.ev(`document.querySelector('#btn-end').textContent.trim()`), 'Sicher?');
  await b.klick('#btn-end', 2500);
  soll('Beenden 2×: Home', await bildschirm(), 'home');

  // --- Demo-Wege: Beispielfahrten hin und zurück ---
  await b.geh(srv.url + '?demo=programm', 2500);
  await b.klick('#btn-demo-beispiel', 3000);
  soll('Planfahrten markiert', await b.ev(`document.querySelectorAll('#fahrten-monate .plan-marke').length`), n => n > 0);
  soll('Wochenkopf nennt Planfahrten', await b.ev(`[...document.querySelectorAll('.w-summe')].some(x => x.textContent.includes('im Plan'))`), true);
  soll('Demo-Fahrt → Beispielfahrten', [await bildschirm(), await suche()].join(' '), 'fahrten ?demo=fahrten&von=programm');
  await b.ev(`[...document.querySelectorAll('#fahrten-monate li:not(.woche)')].find(li => li.querySelector('.plan-marke')).click()`); await sleep(800);
  soll('Beispielfahrt öffnen', await bildschirm(), 'detail');
  soll('… mit Demo-Hinweis', await b.ev(`!document.querySelector('#d-demo').hidden`), true);
  soll('Detail zeigt Plan', await b.ev(`!document.querySelector('#d-plan').hidden && document.querySelector('#d-plan-text').textContent`), t => typeof t === 'string' && t.startsWith('Trainingsplan · Woche'));
  await zurueck();
  soll('Zurück zur Liste', await bildschirm(), 'fahrten');
  await zurueck(3000);
  soll('Zurück in die Demo-Fahrt', [await bildschirm(), await suche()].join(' '), 'ride ?demo=programm');
  await b.klick('#btn-demo-beispiel', 3000);
  await b.klick('#btn-back-fahrten', 3000);
  soll('Zurück-Knopf in die Demo-Fahrt', await bildschirm(), 'ride');
  await b.geh(srv.url, 2000);
  await b.klick('#btn-demo-fahrt', 1500);
  soll('Home → Beispielfahrten', await bildschirm(), 'fahrten');
  await zurueck(1000);
  soll('… Zurück nach Home', await bildschirm(), 'home');
  await b.klick('#btn-demo-fahrt', 1500);
  await b.klick('#btn-demo-zur-fahrt', 3000);
  soll('Beispielfahrten → Demo-Fahrt', [await bildschirm(), await suche()].join(' '), 'ride ?demo=vo2max');
  // Zweiter Durchlauf ohne Beispieldaten: „Heute fahren ›" ist frei → Startdialog, Abbrechen nimmt zurück
  const b2 = await browser({ breite: 412, hoehe: 900 });
  try {
    await b2.geh(srv.url, 1500);
    await b2.ev(`import('./js/storage.js').then(m => m.setSetting('ftp', 220))`);
    await b2.geh(srv.url, 1500);
    await b2.klick('#plan-anlegen', 700);
    await b2.ev(`(() => { const heute = (new Date().getDay() + 6) % 7, tage = [heute, (heute + 3) % 7].map(String);
      for (const i of document.querySelectorAll('#plan-tage input')) i.checked = tage.includes(i.value);
      document.querySelector('.plan-form').dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await b2.ev(`document.querySelector('#plan-ok').click()`); await sleep(1200);
    const vorher = await b2.ev(`[...document.querySelectorAll('.plan-tag')].map(l => l.title).join('|')`);
    await b2.ev(`[...document.querySelectorAll('.plan-tag:not(.heute) button')].find(x => !x.closest('[data-status="frei"]')).click()`); await sleep(600);
    soll('Ohne Vorbelastung: Heute fahren frei', await b2.ev(`!document.querySelector('#plan-starten').disabled`), true);
    await heuteFahrenAbbrechen(b2, vorher);
  } finally {
    abweichungen.push(...b2.fehler.map(f => 'JS-Fehler (2): ' + f));
    b2.schliesse();
  }
} catch (e) {
  abweichungen.push('Testfehler: ' + e.message);
} finally {
  abweichungen.push(...b.fehler.map(f => 'JS-Fehler: ' + f));
  b.schliesse();
  srv.schliesse();
}

console.log(abweichungen.length ? `${abweichungen.length} Abweichungen bei ${schritte} Schritten:\n  ${abweichungen.join('\n  ')}` : `ok — ${schritte} Schritte wie erwartet`);
process.exit(abweichungen.length ? 1 : 0);
