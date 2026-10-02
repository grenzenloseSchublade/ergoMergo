#!/usr/bin/env node
// Ablauf-Prüfung: Navigation (Zurück-Taste, Dialoge, Overlay), Einstellungen
// (inkl. Pulsgrenze), Fahrt (Pulsgrenze mit Hysterese, Halten, Not-Stopp mit
// Sperre, Blatt „Tastenbelegung", Fokus, Doppel-Zurück), Zwift-Ride-Paddles
// ohne Hardware (Fake-GATT), Programm
// (Skip, +30 s, zweistufiges Beenden), die Demo-Wege, Bildschirm wach
// halten (Hinweis, gebremste Neuanforderung), der Auftakt (Pegel,
// Bandanteile, Abbruch beim Fahrtende), Audio Session und Diagnose-Log
// am Fahrtende — mit Sollwerten.
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
// Plan-Tests hängen am heutigen Wochentag: der zweite Plantag liegt möglichst
// NACH heute in derselben Woche (Mo–So) — drei Tage später, ab Freitag der
// Sonntag; nur sonntags gibt es keinen späteren Tag
const ZWEITER_PLANTAG = 'heute <= 3 ? heute + 3 : heute < 6 ? 6 : 2';
// Ersten geplanten Tag nach heute im Wochenstreifen wählen; false, wenn es keinen gibt
const spaeterenTagWaehlen = br => br.ev(`(() => { const tage = [...document.querySelectorAll('.plan-tag')];
  const ziel = tage.slice(tage.findIndex(l => l.classList.contains('heute')) + 1).find(l => l.dataset.status !== 'frei');
  ziel?.querySelector('button').click(); return !!ziel; })()`);
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
  // Pulsgrenze: leer = aus, Zahl wird gespeichert; darunter der höchste Puls
  // aus den Fahrten (Beispiel-Historie) nur als Hinweis, nicht übernommen
  const pulsGrenze = () => b.ev(`import('./js/storage.js').then(m => m.getSettings()).then(s => s.pulsGrenze)`);
  await b.klick('#btn-settings', 600);
  soll('Pulsgrenze aus: Feld leer', await b.ev(`document.querySelector('#set-puls').value`), '');
  const hrMaxHistorie = await b.ev(`import('./js/storage.js').then(m => m.listSessions()).then(l => Math.max(...l.map(s => s.hrMax || 0)))`);
  soll('Hinweis mit höchstem gemessenem Puls', await b.ev(`document.querySelector('#puls-hinweis').textContent`),
    t => t.includes('Ab diesem Puls') && t.includes(`Dein höchster gemessener Wert: ${hrMaxHistorie} bpm`));
  await b.ev(`document.querySelector('#set-puls').value = 165; document.querySelector('#dlg-settings button.primary').click()`);
  await sleep(800);
  soll('Speichern übernimmt Pulsgrenze 165', await pulsGrenze(), 165);
  await b.klick('#btn-settings', 600);
  soll('… und zeigt sie wieder an', await b.ev(`document.querySelector('#set-puls').value`), '165');
  await b.ev(`document.querySelector('#set-puls').value = ''; document.querySelector('#dlg-settings button.primary').click()`);
  await sleep(800);
  soll('Leeres Feld schaltet die Pulsgrenze aus', await pulsGrenze(), 0);
  soll('Schema: 0 = aus, sonst 100–220', await b.ev(`import('./js/storage.js').then(m => [0, 50, 165.4, 999, -5, 'x'].map(v => m.pruefeEinstellung('pulsGrenze', v) ?? null))`),
    l => JSON.stringify(l) === JSON.stringify([0, 100, 165, 220, 0, null]));
  soll('Hysterese: ab Grenze an, erst 3 bpm darunter aus', await b.ev(`import('./js/metrics.js').then(m => {
    let an = false; return [150, 159, 160, 158, 157, 158, 0, 160].map(hr => (an = m.ueberPulsGrenze(hr, 160, an)) ? 1 : 0).join(''); })`), '00110001');
  soll('Pulsgrenze aus färbt nie', await b.ev(`import('./js/metrics.js').then(m => m.ueberPulsGrenze(200, 0, true))`), false);
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
  await b.ev(`(() => { const heute = (new Date().getDay() + 6) % 7, tage = [heute, ${ZWEITER_PLANTAG}].map(String);
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
  // Nichts springt (docs/stil.md): jeder Tag — frei oder mit Einheit — gibt der Karte dieselbe Höhe
  const kartenHoehen = new Set();
  for (let i = 0; i < 7; i++) {
    await b.ev(`document.querySelectorAll('.plan-tag button')[${i}].click()`); await sleep(300);
    kartenHoehen.add(await b.ev(`Math.round(document.querySelector('#plan-karte').getBoundingClientRect().height)`));
  }
  soll('Karte springt beim Tageswechsel nicht', [...kartenHoehen], l => l.length === 1);
  await b.ev(`document.querySelector('.plan-tag.heute button').click()`); await sleep(600);
  soll('Knöpfe Starten und Ändern', await b.ev(`document.querySelector('#plan-starten').textContent + '|' + !document.querySelector('#plan-aendern').hidden`), 'Starten ›|true');

  // Späterer Tag: „Heute fahren ›" öffnet den Startdialog; Abbrechen nimmt die Verschiebung zurück
  const streifenVorher = await b.ev(`[...document.querySelectorAll('.plan-tag')].map(l => l.title).join('|')`);
  if (!await spaeterenTagWaehlen(b)) console.log('  (Späterer Tag: übersprungen — sonntags gibt es keinen späteren Plantag)');
  else {
    await sleep(600);
    soll('Späterer Tag: Heute fahren', await b.ev(`document.querySelector('#plan-starten').textContent`), 'Heute fahren ›');
    // Mit den Beispieldaten (gestern hart gefahren) ist heute gesperrt — dann muss der Grund dastehen
    if (await b.ev(`document.querySelector('#plan-starten').disabled`))
      soll('Gesperrt mit Grund', await b.ev(`document.querySelector('#plan-sub').textContent`), t => t.startsWith('Heute nicht möglich'));
    else await heuteFahrenAbbrechen(b, streifenVorher);
  }
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
  // Pulsgrenze unter dem Demo-Puls (~130–140): nur die Zahl in --hr-line, Symbol neutral
  await b.ev(`import('./js/storage.js').then(async m => { await m.setSetting('ftp', 200); await m.setSetting('wattSchritt', 10); await m.setSetting('pulsGrenze', 100); })`);
  await b.geh(srv.url + '?demo', 2500);
  const farbeVon = sel => b.ev(`getComputedStyle(document.querySelector('${sel}')).color`);
  const tokenFarbe = t => b.ev(`(() => { const e = document.createElement('i'); e.style.color = 'var(${t})'; document.body.append(e); const c = getComputedStyle(e).color; e.remove(); return c; })()`);
  soll('Puls über der Grenze: Zahl in --hr-line', await farbeVon('#m-hr'), await tokenFarbe('--hr-line'));
  soll('… Herzsymbol neutral wie die anderen Symbole', await b.ev(`(() => { const s = [...document.querySelectorAll('.row-secondary .si')].map(e => getComputedStyle(e).color); return new Set(s).size; })()`), 1);
  // Bild-in-Bild: Puls-Zahl nur mit hrUeber in --hr-line (Pixel unten rechts), Symbol nie
  soll('Bild-in-Bild: Puls nur über der Grenze rot', await b.ev(`Promise.all([import('./js/ui/pip.js'), import('./js/ui/tokens.js')]).then(([p, t]) => {
    const hr = t.tokenLeser()('--hr-line'), probe = document.createElement('canvas').getContext('2d');
    probe.fillStyle = hr; probe.fillRect(0, 0, 1, 1); const [r, g, bl] = probe.getImageData(0, 0, 1, 1).data;
    return [false, true].map(hrUeber => { const c = document.createElement('canvas'); c.width = 480; c.height = 270;
      p.zeichnePipBild(c, { watt: 180, ziel: 180, naechstes: null, gestoppt: false, rest: '1:00', rpm: 90, rpmLage: '', rpmPfeil: 0, hr: 168, hrUeber, farbe: '' });
      const d = c.getContext('2d').getImageData(240, 200, 240, 70).data; let n = 0;
      for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - r) < 8 && Math.abs(d[i + 1] - g) < 8 && Math.abs(d[i + 2] - bl) < 8) n++;
      return n > 20; }).join(); })`), 'false,true');
  await b.ev(`import('./js/storage.js').then(m => m.setSetting('pulsGrenze', 0))`);
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

  // Blatt „Tastenbelegung" aus dem Panel: nur ansehen, gespeicherte Belegung
  // auch ohne Lenker; Lenker-Tasten wirken weiter; Esc, Tipp daneben, Zurück schließen
  const belegungOeffnen = async () => { await b.klick('#btn-mehr', 500); await b.klick('#fo-belegung', 800); };
  // Eigenes Tasten-Symbol, nicht der Kreis der Drop-Taste und nicht „Lenker" (gamepad)
  soll('Zeile Tastenbelegung mit Tasten-Symbol', await b.ev(`(() => { const i = document.querySelector('#fo-belegung .opt-icon');
    return i.dataset.icon + ':' + i.querySelectorAll('svg path').length; })()`), 'tasten:9');
  await belegungOeffnen();
  soll('Blatt Tastenbelegung offen, Panel zu', [await offen(b, 'dlg-belegung'), await offen(b, 'dlg-fahrt-optionen')].join(), 'true,false');
  soll('… mit eigenem History-Eintrag', await b.ev('history.state?.dialog ?? null'), 'belegung');
  // Standardbelegung (beide Paddles außen = +, innen = −, Pfeile Block
  // vor/zurück, B = STOPP): Mehrfachbelegung — jede Paddle-Richtung für sich
  soll('… zeigt die gespeicherte Belegung ohne Lenker', await b.ev(`[...document.querySelectorAll('#belegung-blatt-liste li')].map(li => li.firstChild.textContent).join('|')`),
    'Watt hoch (+)|Watt runter (−)|Block vor (⏭)|Block zurück (⏮)|STOPP / WEITER');
  soll('… je Aktion alle Tasten', await b.ev(`[...document.querySelectorAll('#belegung-blatt-liste li')].slice(0, 2).map(li => [...li.querySelectorAll('small')].map(e => e.textContent).join('+')).join('|')`),
    'Paddle rechts außen+Paddle links außen|Paddle rechts innen+Paddle links innen');
  soll('… und die Lenkeransicht mit Marke an jeder Taste', await b.ev(`[...document.querySelectorAll('#belegung-blatt-karte .lk-taste.belegt')].map(t => t.querySelector('.lk-marke').textContent).join('')`), '⏮⏭■+−−+');
  soll('… Paddles je Richtung, übereinander', await b.ev(`[...document.querySelectorAll('#belegung-blatt-karte .lk-stapel .ts-paddle')].map(e => e.querySelectorAll('svg').length).join()`), '1,1,1,1');
  soll('… nur Griffzonen mit belegten Tasten', await b.ev(`[...document.querySelectorAll('#belegung-blatt-karte .lk-zone small')].map(e => e.textContent).join('|')`), 'Griff oben|Hebel vorne');
  // Umschalter Lenker ↔ Liste: immer nur eine Ansicht sichtbar, die andere hält ihren Platz
  const ansicht = () => b.ev(`(() => { const a = document.querySelector('#belegung-blatt-ansicht');
    return [a.dataset.ansicht, ...[...a.children].map(e => getComputedStyle(e).visibility), document.querySelector('#dlg-belegung .belegung-umschalter').textContent].join(); })()`);
  soll('… zeigt den Lenker, Liste verdeckt', await ansicht(), 'karte,visible,hidden,Als Liste ›');
  await b.klick('#dlg-belegung .belegung-umschalter', 300);
  soll('„Als Liste ›" zeigt die Liste statt des Lenkers', await ansicht(), 'liste,hidden,visible,Als Lenker ›');
  await b.klick('#dlg-belegung .belegung-umschalter', 300);
  soll('„Als Lenker ›" wieder zurück', await ansicht(), 'karte,visible,hidden,Als Liste ›');
  soll('Tippflächen im Blatt', await b.ev(`[...document.querySelectorAll('#dlg-belegung button, #dlg-belegung summary')]
    .map(e => e.getBoundingClientRect()).filter(r => r.height < 43.5 || r.width < 43.5).length`), 0);
  // Attrappe eines verbundenen Lenkers: STOPP und + am Lenker wirken bei offenem Blatt
  await b.ev(`import('./js/ble/geraete.js').then(({ geraeteManager: g }) => {
    const pad = Object.assign(new EventTarget(), { deviceName: 'Test-Pad', device: { gatt: { connected: true } } });
    const orig = g.clients.bind(g);
    window.__pad = pad; g.clients = r => r === 'controller' ? [pad] : orig(r);
    g.dispatchEvent(new Event('change')); })`);
  await sleep(300);
  await b.ev(`__pad.dispatchEvent(new Event('stopp'))`); await sleep(300);
  soll('Lenker-STOPP bei offenem Blatt', [await stopp(), await offen(b, 'dlg-belegung')].join(), 'GESTOPPT,true');
  await sleep(3200);
  await b.ev(`__pad.dispatchEvent(new Event('plus'))`); await sleep(400);
  soll('Lenker-+ nach der Sperre fährt weiter', [await stopp(), await offen(b, 'dlg-belegung')].join(), 'STOPP,true');
  await b.ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`); await sleep(500);
  soll('Esc schließt das Blatt', await offen(b, 'dlg-belegung'), false);
  soll('… ohne History-Rest', await b.ev('history.state?.dialog ?? null'), null);
  await belegungOeffnen();
  await tippDaneben(b);
  soll('Tipp daneben schließt das Blatt', await offen(b, 'dlg-belegung'), false);
  soll('… und öffnet nichts anderes', [await offen(b, 'dlg-fahrt-optionen'), await b.ev(`document.querySelector('.ride-grid').className.includes('fokus')`)].join(), 'false,false');
  await belegungOeffnen();
  await zurueck(600);
  soll('Zurück schließt das Blatt', await offen(b, 'dlg-belegung'), false);
  soll('… und bleibt in der Fahrt', [await bildschirm(), await b.ev('history.state?.screen ?? null')].join(), 'ride,ride');
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

  // --- Zwift Ride ohne Hardware (Fake-GATT, 0x23-Pakete). Standard: beide
  // Paddles außen = Watt hoch, innen = Watt runter (je Richtung eine Taste,
  // Kippen = loslassen + neu drücken); eine alte Belegung mit EINER Richtung
  // wirkt beidseitig (Kippen löst dort nicht doppelt aus); Halten wiederholt;
  // zwei Pads, die dasselbe melden, lösen einmal aus ---
  // Fake-Lenker: window.__fakeRide(map, pads) → { c, paket(ort, wert, bitmap) }
  // — bitmap invertiert (gedrückt = 0), Ort 1 = rechts, 0 = links, Vorzeichen = Richtung
  const FAKE_RIDE = `window.__fakeRide = async (map, pads = 1, halten = {}) => {
    const { ZwiftController } = await import('./js/ble/zwift-controller.js');
    const varint = v => { const o = []; while (v >= 128) { o.push((v & 127) | 128); v = Math.floor(v / 128); } o.push(v); return o; };
    const kanaele = [], controller = [];
    for (let n = 0; n < pads; n++) {
      const ch = (uuid, properties) => Object.assign(new EventTarget(), { uuid, properties,
        startNotifications: async () => {}, writeValueWithResponse: async () => {} });
      const asyncCh = ch('00000002-19ca-4651-86e5-fa29dcdd09d1', { notify: true });
      const chars = [asyncCh, ch('00000003-19ca-4651-86e5-fa29dcdd09d1', { write: true })];
      const device = Object.assign(new EventTarget(), { name: 'Zwift Ride', id: 'pad' + n, gatt: { disconnect() {},
        connect: async () => ({ getPrimaryService: async () => ({ uuid: 'test', getCharacteristics: async () => chars }) }) } });
      const c = new ZwiftController(map, halten);
      await c.connect(device);
      kanaele.push(asyncCh); controller.push(c);
    }
    // Feld 1 = Bitmap, Feld 3 = Paddle {Ort, Wert als sint32}; jedes Pad bekommt dasselbe Paket
    const paket = (ort, wert, bitmap = 0xffffffff) => {
      const p = [0x08, ...varint(ort), 0x10, ...varint(wert >= 0 ? 2 * wert : -2 * wert - 1)];
      for (const k of kanaele) {
        k.value = new DataView(new Uint8Array([0x23, 0x08, ...varint(bitmap >>> 0), 0x1a, p.length, ...p]).buffer);
        k.dispatchEvent(new Event('characteristicvaluechanged'));
      }
    };
    return { c: controller[0], controller, paket };
  };`;
  // folge: [Ort, Wert, Wartezeit ms, gedrückte Bits (optional)]
  const ride = (map, folge, { pads = 1 } = {}) => b.ev(`(async () => {
    ${FAKE_RIDE}
    const { controller, paket } = await __fakeRide(${JSON.stringify(map)}, ${pads}, { tempo: 'flott' });
    const log = [];
    for (const c of controller)
      for (const a of ['plus', 'minus', 'skip', 'prev', 'stopp']) c.addEventListener(a, e => log.push(a + (e.detail?.wiederholung ? '*' : '')));
    for (const [ort, wert, ms, bits = []] of ${JSON.stringify(folge)}) {
      paket(ort, wert, bits.reduce((m, bit) => m & ~(1 << bit), 0xffffffff));
      await new Promise(r => setTimeout(r, ms));
    }
    for (const c of controller) c.disconnect({ gatt: false });
    return log.join(' ');
  })()`);
  soll('Ride (Standard): rechtes Paddle außen = Watt hoch, innen = Watt runter', await ride({}, [[1, 80, 80], [1, 0, 80], [1, -80, 80], [1, 0, 80]]), 'plus minus');
  soll('Ride (Standard): linkes Paddle außen = Watt hoch, innen = Watt runter', await ride({}, [[0, -80, 80], [0, 0, 80], [0, 80, 80], [0, 0, 80]]), 'plus minus');
  soll('Ride (Standard): Halten innen wiederholt (flott: 400 ms, dann 150 ms)', await ride({}, [[1, -90, 620], [1, 0, 100]]), 'minus minus* minus*');
  soll('Ride (Standard): Kippen außen → innen in einem Zug = loslassen + neu drücken', await ride({}, [[1, 90, 80], [1, -90, 80], [1, -30, 60], [1, 0, 100]]), 'plus minus');
  soll('… auch links (innen → außen)', await ride({}, [[0, 90, 80], [0, -90, 80], [0, -30, 60], [0, 0, 100]]), 'minus plus');
  soll('… und beendet das Halten der alten Richtung', await ride({}, [[1, 90, 620], [1, -90, 120], [1, 0, 100]]), 'plus plus* plus* minus');
  soll('Ride (Standard): zwei Pads melden dasselbe → je Druck einmal', await ride({}, [[1, 80, 80], [1, 0, 80], [0, 80, 80], [0, 0, 80]], { pads: 2 }), 'plus minus');
  soll('Ride: alte Belegung {plus: 26, minus: 25} wirkt beidseitig', await ride({ plus: 26, minus: 25 }, [[1, -80, 80], [1, 0, 80], [0, 80, 80], [0, 0, 80]]), 'plus minus');
  soll('Ride: … Kippen löst dort nicht doppelt aus', await ride({ plus: 26, minus: 25 }, [[1, 90, 80], [1, -90, 80], [1, -30, 60], [1, 0, 100]]), 'plus');
  soll('Ride: Liste mit Taste und Paddle-Richtung, freie Gegenrichtung wirkt mit', await ride({ plus: [4, 26], minus: [25, 27] },
    [[0, 0, 80, [4]], [0, 0, 80], [0, 80, 80], [0, 0, 80], [1, -80, 80], [1, 0, 80]]), 'plus minus minus');

  // --- Lern-Modus „Tasten zuordnen" mit Fake-Lenker: je Aktion mehrere
  // Tasten, sofort sichtbar; nochmal drücken nimmt heraus; Ein/Aus und Tasten
  // früherer Schritte abgewiesen; „Weiter" erst ab einer Taste; gespeichert
  // als Liste bzw. Einzelbit; danach wirkt die Belegung am Lenker ---
  await b.geh(srv.url, 1500);
  await b.ev(`(async () => { ${FAKE_RIDE}
    const { c, paket } = await __fakeRide({});
    const { geraeteManager: g } = await import('./js/ble/geraete.js');
    const orig = g.clients.bind(g);
    g.clients = r => r === 'controller' ? [c] : orig(r);
    g.verbindeOderKoppel = async () => ({ ergebnis: 'verbunden' });
    window.__paket = paket; })()`);
  // Paddle drücken und loslassen bzw. Taste (Bit) drücken und loslassen
  const paddle = async (ort, wert) => { await b.ev(`__paket(${ort}, ${wert})`); await sleep(100); await b.ev(`__paket(${ort}, 0)`); await sleep(100); };
  const taste = async bit => { await b.ev(`__paket(0, 0, ~(1 << ${bit}))`); await sleep(100); await b.ev(`__paket(0, 0)`); await sleep(100); };
  // Gewählte Tasten des Schritts = Tasten mit seiner Marke in der Lenkeransicht (Reihenfolge der Ansicht: links vor rechts)
  const gewaehlt = () => b.ev(`import('./js/ble/zwift-controller.js').then(({ tastenName }) => {
    const marke = document.querySelector('#map-schritt .lk-marke').textContent;
    return [...document.querySelectorAll('#map-karte .lk-taste')].filter(t => t.querySelector('.lk-marke')?.textContent === marke)
      .map(t => tastenName(Number(t.dataset.bit))).join('+'); })`);
  const schritt = () => b.ev(`document.querySelector('#map-kicker').textContent + ' ' + document.querySelector('#map-schritt').textContent`);
  const knoepfe = () => b.ev(`['#btn-map-weiter', '#btn-map-skip'].map(id => document.querySelector(id).hidden ? '-' : document.querySelector(id).textContent).join('|')`);
  const status = () => b.ev(`document.querySelector('#map-status').textContent`);
  await b.klick('#btn-settings', 700);
  await b.klick('#btn-map-lernen', 700);
  soll('Lern-Modus offen, erster Schritt Watt hoch', [await offen(b, 'dlg-mapping'), await schritt()].join(' '), 'true Schritt 1 von 5 +Watt hoch');
  soll('… Lenkeransicht mit allen Griffzonen', await b.ev(`document.querySelectorAll('#map-karte .lk-zone').length`), 4);
  soll('… ohne Taste nur „Ohne Belegung weiter"', await knoepfe(), '-|Ohne Belegung weiter');
  await paddle(1, 80);
  soll('Erste Taste sofort angezeigt, „Weiter" erscheint', [await gewaehlt(), await knoepfe()].join(' / '), 'Paddle rechts außen / Weiter|-');
  soll('… nur die gedrückte Richtung trägt die Marke', await b.ev(`['26', '27'].map(bit => document.querySelector('#map-karte .lk-taste[data-bit="' + bit + '"] .lk-marke')?.textContent ?? '·').join('')`), '+·');
  await paddle(0, -80);
  soll('Zweite Taste dazu', await gewaehlt(), 'Paddle links außen+Paddle rechts außen');
  soll('… Hinweis für die nächste', await status(), 'Weitere Taste oder Weiter · erneut drücken entfernt');
  await taste(11);
  soll('Ein/Aus wird ignoriert', [await gewaehlt(), await status()].join(' / '), g => g.startsWith('Paddle links außen+Paddle rechts außen / Ein/Aus'));
  await paddle(0, -80);
  soll('Nochmal drücken nimmt die Taste heraus', [await gewaehlt(), await status()].join(' / '), 'Paddle rechts außen / Paddle links außen entfernt');
  await paddle(0, -80);
  soll('… und wieder hinein', await gewaehlt(), 'Paddle links außen+Paddle rechts außen');
  soll('Tippflächen im Lern-Modus', await b.ev(`[...document.querySelectorAll('#dlg-mapping button')].filter(e => !e.hidden)
    .map(e => e.getBoundingClientRect()).filter(r => r.height < 43.5 || r.width < 43.5).length`), 0);
  await b.klick('#btn-map-weiter', 300);
  soll('Weiter: nächste Aktion, Auswahl leer', [await schritt(), await gewaehlt(), await knoepfe()].join(' / '),
    'Schritt 2 von 5 −Watt runter /  / -|Ohne Belegung weiter');
  await paddle(1, 80);
  soll('Taste einer früheren Aktion abgewiesen', [await gewaehlt(), await status()].join(' / '), ' / Schon für „Watt hoch“ belegt — andere Taste');
  await paddle(1, -80); await paddle(0, 80);
  soll('Gegenrichtungen für Watt runter frei', await gewaehlt(), 'Paddle links innen+Paddle rechts innen');
  soll('Lenkeransicht im Lern-Modus: außen +, innen −', await b.ev(`[...document.querySelectorAll('#map-karte .lk-stapel .lk-taste')].map(t => t.querySelector('.lk-marke')?.textContent ?? '·').join('')`), '+−−+');
  await b.klick('#btn-map-weiter', 300);
  await taste(2);
  await b.klick('#btn-map-weiter', 300);
  await b.klick('#btn-map-skip', 300);
  await taste(5);
  soll('Letzter Schritt: „Fertig"', [await schritt(), await knoepfe()].join(' / '), 'Schritt 5 von 5 ■STOPP / Fertig|-');
  await b.klick('#btn-map-weiter', 800);
  soll('Fertig schließt den Lern-Modus', await offen(b, 'dlg-mapping'), false);
  soll('Gespeichert: Listen, Einzelbits, unbelegt', JSON.stringify(await b.ev(`import('./js/storage.js').then(m => m.getSettings()).then(s => s.controllerMap)`)),
    '{"plus":[26,25],"minus":[27,24],"skip":2,"prev":null,"stopp":5}');
  soll('Belegungsliste zeigt alle Tasten', await b.ev(`[...document.querySelectorAll('#ctrl-map-anzeige li')].map(li => [...li.querySelectorAll('small')].map(e => e.textContent).join('+')).join('|')`),
    'Paddle rechts außen+Paddle links außen|Paddle rechts innen+Paddle links innen|Pfeil rechts|B (magenta)');
  // Die gelernte Belegung am Lenker: beide Paddles außen +, innen −; Block zurück unbelegt
  soll('Gelernte Belegung wirkt am Lenker', await ride(JSON.parse(await b.ev(`import('./js/storage.js').then(m => m.getSettings()).then(s => JSON.stringify(s.controllerMap))`)),
    [[0, -80, 80], [0, 0, 80], [0, 80, 80], [0, 0, 80], [1, 80, 80], [1, -80, 80], [1, 0, 80], [0, 0, 80, [0]], [0, 0, 80]]), 'plus minus plus minus');
  await zurueck(600);

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
  // --- Bildschirm wach halten (main.js): verweigert → einmal ein leiser
  // Hinweis in der LED-Zeile; vom System entzogen → höchstens alle 5 s neu
  // angefordert. Ein Spion merkt sich jede gewährte Sperre.
  const ledText = () => b.ev(`document.querySelector('#m-status .sr-text')?.textContent ?? ''`);
  const spion = (await b.cdp('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__wl = [];
    const wlOrig = navigator.wakeLock.request.bind(navigator.wakeLock);
    navigator.wakeLock.request = t => wlOrig(t).then(l => { __wl.push(l); return l; });` })).result.identifier;
  await b.cdp('Browser.resetPermissions');          // headless verweigert dann wie im Energiesparmodus
  await b.geh(srv.url + '?demo', 2000);
  soll('Wake Lock verweigert: Hinweis in der LED-Zeile', await ledText(), 'Bildschirm bleibt nicht an — Energiesparmodus aus?');
  await b.cdp('Browser.grantPermissions', { permissions: ['wakeLockScreen'] });
  await b.geh(srv.url + '?demo', 2000);
  soll('Wake Lock gewährt: kein Hinweis', [await ledText(), await b.ev('__wl.length')].join('|'), v => !v.includes('Bildschirm') && v.endsWith('|1'));
  await b.ev('__wl[0].release()');                  // wie ein Entzug durchs System
  await sleep(300);
  soll('Entzogen: nicht sofort erneut (5-s-Bremse)', await b.ev('__wl.length'), 1);
  await sleep(4700);
  soll('… aber nach höchstens 5 s', await b.ev('__wl.length + " " + !__wl.at(-1).released'), '2 true');
  await b.cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier: spion });

  // --- Auftakt (signals.js): dieselbe Synthese offline gerendert — der vom
  // Nutzer gewählte Klang („wuchtig"): laut, aber ohne Übersteuern; bewusst
  // basslastig, ein hörbarer Rest (Obertöne, Metall, Knall) muss aber über
  // 150 Hz liegen, sonst bliebe am Handy-Lautsprecher nichts. Dazu live: Fahrtende mitten im
  // Auftakt bricht ihn ab, der Context schläft wieder.
  await b.geh(srv.url, 1500);
  const klang = await b.ev(`(async () => {
    const { auftaktSynth } = await import('./js/signals.js');
    const SR = 48000, c = new OfflineAudioContext(2, SR * 6, SR);
    auftaktSynth(c, c.destination, 0.05);
    const buf = await c.startRendering(), L = buf.getChannelData(0), R = buf.getChannelData(1);
    let spitze = 0;
    for (let i = 0; i < L.length; i++) spitze = Math.max(spitze, Math.abs(L[i]), Math.abs(R[i]));
    // Spektrum der Mono-Summe (Radix-2-FFT, Nullauffüllung)
    let N = 1; while (N < L.length) N <<= 1;
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < L.length; i++) re[i] = (L[i] + R[i]) / 2;
    for (let i = 1, j = 0; i < N; i++) {
      let bit = N >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit;
      if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
    }
    for (let len = 2; len <= N; len <<= 1) for (let i = 0; i < N; i += len) for (let k = 0; k < len / 2; k++) {
      const w = -2 * Math.PI * k / len, co = Math.cos(w), si = Math.sin(w), a = i + k, z = a + len / 2;
      const tr = re[z] * co - im[z] * si, ti = re[z] * si + im[z] * co;
      re[z] = re[a] - tr; im[z] = im[a] - ti; re[a] += tr; im[a] += ti;
    }
    let summe = 0, tief = 0, mitte = 0;
    for (let k = 1; k < N / 2; k++) {
      const f = k * SR / N, p = re[k] ** 2 + im[k] ** 2;
      summe += p; if (f < 150) tief += p; else if (f <= 3000) mitte += p;
    }
    return { spitzeDb: 20 * Math.log10(spitze), tief: tief / summe, mitte: mitte / summe };
  })()`);
  soll('Auftakt: Spitze zwischen −4 und −1 dBFS (laut, nicht übersteuert)', +klang.spitzeDb.toFixed(1), x => x >= -4 && x <= -1);
  soll('Auftakt: 150–3000 Hz ≥ 5 % der Energie', +klang.mitte.toFixed(3), x => x >= 0.05);
  soll('Auftakt: unter 150 Hz ≤ 95 % der Energie', +klang.tief.toFixed(3), x => x <= 0.95);
  // Live: echte Geste entsperrt den Context (initAudio), dann Auftakt und
  // sofort Fahrtende (audioSchlafen)
  // Audio Session API (nachgebildet, Chrome hat sie noch nicht): initAudio
  // setzt 'ambient' — mischen statt YouTube & Co. anzuhalten
  await b.ev(`Object.defineProperty(navigator, 'audioSession', { configurable: true, value: { type: 'auto' } })`);
  await b.ev(`import('./js/signals.js').then(m => document.addEventListener('pointerdown', () => m.initAudio(), { once: true }))`);
  await tippDaneben(b, 2500);           // initAudio: wach → nach 1,5 s wieder schlafen
  soll('Audio Session: mischt mit anderer Wiedergabe', await b.ev('navigator.audioSession.type'), 'ambient');
  const abbruch = await b.ev(`(async () => {
    const m = await import('./js/signals.js'), c = m.audioCtx();
    const p = m.auftakt(); await p;
    const vorher = c.state;
    m.audioSchlafen();
    const t0 = performance.now(); await m.auftaktVorbei(); const wartet = performance.now() - t0;
    await new Promise(r => setTimeout(r, 600));
    const nachher = c.state;
    await m.tick();                     // nächster Ton: weckt, danach wieder Schlaf
    await new Promise(r => setTimeout(r, 2200));
    return { vorher, wartet: Math.round(wartet), nachher, nachTick: c.state };
  })()`);
  soll('Auftakt weckt den Context', abbruch.vorher, 'running');
  soll('Fahrtende: Auftakt sofort vorbei', abbruch.wartet, ms => ms < 50);
  soll('Fahrtende: Context schläft', abbruch.nachher, 'suspended');
  soll('… und nach dem nächsten Ton wieder', abbruch.nachTick, 'suspended');
  // Diagnose-Log (state.js): Reconnect mit Fahrzustand und Ziel, Fahrtende
  // mit dem Ausgang des 0-W-Writes — bestätigt oder mit Grund
  const p6 = await b.ev(`(async () => {
    const { Session } = await import('./js/state.js'), lg = await import('./js/logger.js'), st = await import('./js/storage.js');
    const fall = async art => {
      const f = Object.assign(new EventTarget(), { connected: art !== 'getrennt', busy: false,
        setTargetPower: async () => { if (art === 'fehler') throw new Error('Keine Antwort auf 0x5'); } });
      const s = new Session(f, { startWatt: 120, maxWatt: 600 });
      s.save = async () => {};
      if (art === 'ok') { s.setTarget(185, { instant: true }); f.dispatchEvent(new Event('reconnected')); }
      await s.finish();
    };
    for (const art of ['ok', 'getrennt', 'fehler']) await fall(art);
    await lg.flushJetzt();
    return (await st.getLogs()).filter(e => e.tag === 'session').slice(-4).map(e => e.msg + (e.data ? ' | ' + e.data : '')).join(' ¶ ');
  })()`);
  soll('Log: Reconnect mit Zustand und Ziel', p6, t => t.includes('Reconnect während der Fahrt: riding, Ziel 185 W'));
  soll('Log: Fahrtende 0 W bestätigt bzw. Grund', p6, t => t.includes('Ziel 0 W bestätigt')
    && t.includes('nicht bestätigt | Trainer nicht verbunden') && t.includes('nicht bestätigt | Fehler: Keine Antwort'));
  // Zweiter Durchlauf ohne Beispieldaten: „Heute fahren ›" ist frei → Startdialog, Abbrechen nimmt zurück
  const b2 = await browser({ breite: 412, hoehe: 900 });
  try {
    await b2.geh(srv.url, 1500);
    await b2.ev(`import('./js/storage.js').then(m => m.setSetting('ftp', 220))`);
    await b2.geh(srv.url, 1500);
    await b2.klick('#plan-anlegen', 700);
    await b2.ev(`(() => { const heute = (new Date().getDay() + 6) % 7, tage = [heute, ${ZWEITER_PLANTAG}].map(String);
      for (const i of document.querySelectorAll('#plan-tage input')) i.checked = tage.includes(i.value);
      document.querySelector('.plan-form').dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await b2.ev(`document.querySelector('#plan-ok').click()`); await sleep(1200);
    const vorher = await b2.ev(`[...document.querySelectorAll('.plan-tag')].map(l => l.title).join('|')`);
    if (!await spaeterenTagWaehlen(b2)) console.log('  (Ohne Vorbelastung: übersprungen — sonntags kein späterer Plantag)');
    else {
      await sleep(600);
      soll('Ohne Vorbelastung: Heute fahren frei', await b2.ev(`!document.querySelector('#plan-starten').disabled`), true);
      await heuteFahrenAbbrechen(b2, vorher);
    }
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
