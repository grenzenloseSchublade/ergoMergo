#!/usr/bin/env node
// Trainingsplan-Regeln für ALLE Wochentag-Kombinationen (2–6 Tage), alle
// Ziele, Dauern und FTP-Fälle über 12 Wochen:
//   · zwischen harten Einheiten immer ≥ 48 h (auch über die Wochengrenze)
//   · höchstens 2 harte Einheiten pro Woche (Ziel „Leistung": 3)
//   · Erholungswoche (4, 8, 12): keine harte Einheit, Rampentest auf dem spätesten
//     Plantag, der ≥ 2 Tage vor der ersten harten Einheit der Folgewoche liegt
//   · jede Dauer liegt im erlaubten Bereich des Generators
//   · FTP unbekannt: keine harte Einheit, bis eine FTP da ist; der Test kommt am
//     ersten erreichbaren Plantag (jeder Anlege-Wochentag) und verfällt nie
//   · Einsteiger: 2 Wochen nur locker und kürzer, danach 90 %, 95 %, 100 %
//   · Abschluss nach Bilanz, Verlängern, Wiedereinstieg an jedem Wochentag
//   · Wochenumfang wächst im Block höchstens um ~25 %
// Aufruf: node test/plan.mjs   (reines Node, kein Browser)

// Zeitumstellung reproduzierbar prüfen (Termine unten in Europe/Berlin)
process.env.TZ = 'Europe/Berlin';

import { planAnlegen, einheitAm, wocheAb, wocheWirksam, wocheMitAnpassungen, verschiebeZiele, mitAnpassung,
  mitAnpassungWirksam, planAendern, verlaengern, ersterTestTag, rollen, wochentag, montag,
  kuerzerDauer, istHart, tagIso, planWoche, pausieren, wiedereinstieg, istAbgeschlossen, planBilanz,
  erledigtDurch, zaehltFuerPlan, planInfo, planBeschreibung, planEnde, plusTage, tageOhneFahrt,
  WOCHENTAGE, DAUERN, ZIELE, TYPEN, programmFuer } from '../js/plan.js';

const fehler = [];
const START = new Date(2026, 9, 5);          // ein Montag
const tag = n => new Date(START.getFullYear(), START.getMonth(), START.getDate() + n);
let kombis = 0, einheiten = 0;

for (let maske = 0; maske < 128; maske++) {
  const tage = WOCHENTAGE.map((_, i) => i).filter(i => maske & (1 << i));
  if (tage.length < 2 || tage.length > 6) continue;
  kombis++;
  for (const ziel of Object.keys(ZIELE))
    for (const dauer of DAUERN)
      for (const [ftp, einsteiger] of [[220, false], [220, true], [0, false], [0, true]]) {
        const plan = planAnlegen({ tage, dauer, ziel, einsteiger, ftp, laenge: null, heute: START });
        const name = `${tage.map(t => WOCHENTAGE[t]).join('')} ${ziel} ${dauer}′ ftp${ftp}${einsteiger ? ' einst.' : ''}`;
        let letzteHart = null, vorigeMinuten = null, testGesehen = false, vorwocheTest = false;
        for (let w = 0; w < 12; w++) {
          // FTP-Verlauf: unbekannt bis zum ersten Rampentest
          let hartInWoche = 0, minuten = 0, testInWoche = false;
          for (let d = 0; d < 7; d++) {
            const datum = tag(w * 7 + d);
            const e = einheitAm(plan, datum, ftp || (testGesehen ? 200 : 0));
            if (!e) continue;
            einheiten++;
            minuten += e.opts.dauer ?? 25;
            if (e.typ === 'T') testGesehen = testInWoche = true;
            const p = programmFuer(e);
            if (p.optionen.dauer && (e.opts.dauer < p.optionen.dauer.min || e.opts.dauer > p.optionen.dauer.max))
              fehler.push(`${name} W${w + 1} ${WOCHENTAGE[d]}: ${p.id} ${e.opts.dauer} min außerhalb ${p.optionen.dauer.min}–${p.optionen.dauer.max}`);
            if (istHart(e)) {
              if (e.typ !== 'T') hartInWoche++;
              const abstand = letzteHart === null ? 99 : w * 7 + d - letzteHart;
              if (abstand < 2) fehler.push(`${name} W${w + 1} ${WOCHENTAGE[d]}: harte Einheit ${abstand} Tag nach der letzten`);
              letzteHart = w * 7 + d;
              if (!ftp && !testGesehen && e.typ !== 'T') fehler.push(`${name} W${w + 1} ${WOCHENTAGE[d]}: hart ohne FTP`);
            }
            if (w % 4 === 3 && TYPEN[e.typ].art === 'hart') fehler.push(`${name} W${w + 1}: harte Einheit in der Erholungswoche`);
          }
          const grenze = ziel === 'leistung' && tage.length >= 5 ? 3 : 2;
          if (hartInWoche > grenze) fehler.push(`${name} W${w + 1}: ${hartInWoche} harte Einheiten`);
          const woche = wocheAb(plan, tag(w * 7), ftp || 200);
          if (w % 4 === 3 && (ftp || w > 3) && !woche.some(t => t.einheit?.typ === 'T'))
            fehler.push(`${name} W${w + 1}: Erholungswoche ohne Rampentest`);
          // Test auf dem spätesten Plantag, der ≥ 2 Tage vor der ersten harten Einheit der Folgewoche liegt
          if (w % 4 === 3 && ftp && !einsteiger) {
            const ersterHart = wocheAb(plan, tag((w + 1) * 7), ftp).findIndex(t => t.einheit && TYPEN[t.einheit.typ].art === 'hart');
            const erwartet = tage.filter(t => ersterHart < 0 || 7 + ersterHart - t >= 2).at(-1) ?? tage.at(-1);
            const ist = woche.findIndex(t => t.einheit?.typ === 'T');
            if (ist !== erwartet) fehler.push(`${name} W${w + 1}: Rampentest am ${WOCHENTAGE[ist]} statt ${WOCHENTAGE[erwartet]}`);
          }
          // Steigerung im Block (nicht nach einer Testwoche — die ist kurz)
          // (Einsteiger steigen nach dem Einrollen bewusst von der kurzen Stufe ein)
          if (vorigeMinuten && !vorwocheTest && !(einsteiger && w <= 3) && w % 4 !== 0 && w % 4 !== 3 && minuten > vorigeMinuten * 1.25 + 10)
            fehler.push(`${name} W${w + 1}: Umfang ${vorigeMinuten} → ${minuten} min`);
          vorigeMinuten = minuten;
          vorwocheTest = testInWoche;
        }
        if (!ftp && !testGesehen) fehler.push(`${name}: kein Rampentest in 12 Wochen`);
      }
}

// --- Verpasste Einheiten: für jede Kombination und jedes Verpass-Muster der
// Woche (alle Teilmengen der Plantage) muss die wirksame Woche die Regeln halten
let wochenGeprueft = 0;
for (let maske = 0; maske < 128; maske++) {
  const tage = WOCHENTAGE.map((_, i) => i).filter(i => maske & (1 << i));
  if (tage.length < 2 || tage.length > 6) continue;
  for (const ziel of Object.keys(ZIELE)) {
    const plan = planAnlegen({ tage, dauer: 45, ziel, ftp: 220, laenge: null, heute: START });
    for (const w of [1, 3]) {                                   // Aufbau- und Erholungswoche
      const mo = tag(w * 7), so = tag(w * 7 + 6);
      const heute = tag(w * 7 + 7);                             // Woche vorbei: alles bewertet
      for (let verpasst = 0; verpasst < (1 << tage.length); verpasst++) {
        wochenGeprueft++;
        // Gefahren = Plantage, die nicht im Verpass-Muster stehen (als Fahrt aus dem Plan)
        const gefahren = new Set(tage.filter((_, k) => !(verpasst & (1 << k))));
        // Schrittweise wie im Alltag: Tag für Tag, Fahrt am Tag der wirksamen Einheit
        const sessions = [];
        let woche;
        for (let d = 0; d < 7; d++) {
          woche = wocheWirksam(plan, mo, sessions, tag(w * 7 + d), 220);
          const e = woche[d].einheit;
          if (e && gefahren.has(d)) sessions.push({ planRef: e.ref, plan: { typ: e.typ }, programmId: e.programmId, start: tag(w * 7 + d).getTime() + 18 * 36e5, dauer: 2700 });
        }
        woche = wocheWirksam(plan, mo, sessions, heute, 220);
        const name = `${tage.map(t => WOCHENTAGE[t]).join('')} ${ziel} W${w + 1} verpasst ${verpasst.toString(2)}`;
        let letzte = -99;
        for (let d = 0; d < 7; d++) {
          const t = woche[d];
          if (t.einheit?.verschobenVon && t.einheit.verschobenVon >= t.datum) fehler.push(`${name}: rückwärts verschoben`);
          if (t.einheit && t.einheit.datum !== t.datum) fehler.push(`${name}: Datum falsch`);
          if (istHart(t.einheit) && t.status === 'erledigt') {
            if (d - letzte < 2) fehler.push(`${name} ${WOCHENTAGE[d]}: gefahrene harte Einheiten ${d - letzte} Tag auseinander`);
            letzte = d;
          }
          if (t.status === 'verpasst' && !t.hinweis) fehler.push(`${name} ${WOCHENTAGE[d]}: verpasst ohne Hinweis`);
        }
        if (woche.some(t => t.datum < tagIso(mo) || t.datum > tagIso(so))) fehler.push(`${name}: Übertrag in eine andere Woche`);
      }
    }
  }
}
console.log(`Verschieben: ${wochenGeprueft} Wochen mit Verpass-Mustern geprüft`);

// Harte Fahrt außerhalb des Plans: ersetzt die verpasste harte Einheit und
// sperrt den Tag danach (Mo verpasst, Di hart gefahren → Mi bleibt locker)
{
  const plan = planAnlegen({ tage: [0, 2, 4], dauer: 45, ziel: 'fitness', ftp: 220, laenge: null, heute: START });
  const di = tag(8);                                       // Woche 2
  const sessions = [{ start: di.getTime() + 18 * 36e5, dauer: 2700, np: 200, ftp: 220 }];
  const woche = wocheWirksam(plan, tag(7), sessions, tag(9), 220);
  if (woche[0].status !== 'verpasst' || !woche[0].hinweis.startsWith('ersetzt')) fehler.push(`Fremdfahrt: Mo nicht als ersetzt markiert (${woche[0].hinweis})`);
  if (istHart(woche[2].einheit)) fehler.push('Fremdfahrt: harte Einheit am Tag nach der harten Fahrt');
  const locker = [{ start: di.getTime() + 18 * 36e5, dauer: 2700, np: 140, ftp: 220 }];
  const w2 = wocheWirksam(plan, tag(7), locker, tag(9), 220);
  if (!w2[2].einheit?.verschobenVon) fehler.push('Lockere Fremdfahrt blockiert das Verschieben');
}

// --- Eigene Änderungen: jede Einheit auf jedes angebotene Ziel verschieben ---
// Freigegebene Ziele dürfen keine zwei harten Einheiten ohne Ruhetag erzeugen,
// gesperrte müssen es tun; Einheiten gehen nie verloren oder in die Vergangenheit.
let verschiebungen = 0;
const hartAbstandVerletzt = (plan, mo, sessions, heute) => {
  const nah = [-7, 0, 7].flatMap(off => wocheWirksam(plan, tag(off + Math.round((mo - START) / 864e5)), sessions, heute, 220)
    .map((t, k) => ({ ...t, idx: k + off })));
  const hart = nah.filter(t => istHart(t.einheit) && !t.ausgelassen && t.status !== 'verpasst');
  return hart.some((t, k) => hart.slice(k + 1).some(u => Math.abs(u.idx - t.idx) < 2));
};
for (let maske = 0; maske < 128; maske++) {
  const tage = WOCHENTAGE.map((_, i) => i).filter(i => maske & (1 << i));
  if (tage.length < 2 || tage.length > 6) continue;
  for (const ziel of Object.keys(ZIELE)) {
    const plan = planAnlegen({ tage, dauer: 45, ziel, ftp: 220, laenge: null, heute: START });
    for (const w of [1, 3]) {
      const mo = tag(w * 7), heute = mo;                   // Montag: alle Tage der Woche erreichbar
      const basis = wocheWirksam(plan, mo, [], heute, 220);
      const vorherAnzahl = basis.filter(t => t.einheit).length;
      for (const t of basis.filter(t => t.einheit)) {
        for (const z of verschiebeZiele(plan, t.datum, [], heute, 220)) {
          verschiebungen++;
          const neu = mitAnpassung(plan, mo, { art: 'verschieben', von: t.datum, nach: z.datum });
          const woche = wocheWirksam(neu, mo, [], heute, 220);
          const name = `${tage.map(x => WOCHENTAGE[x]).join('')} ${ziel} W${w + 1} ${t.kurz}→${z.kurz}`;
          if (woche.filter(x => x.einheit).length !== vorherAnzahl) fehler.push(`${name}: Anzahl der Einheiten ändert sich`);
          if (woche.find(x => x.datum === z.datum).einheit?.typ !== t.einheit.typ) fehler.push(`${name}: Einheit nicht am Ziel`);
          const verletzt = hartAbstandVerletzt(neu, mo, [], heute);
          if (z.zustand !== 'gesperrt' && verletzt) fehler.push(`${name}: freigegeben, aber harte Einheiten ohne Ruhetag`);
          if (z.zustand === 'gesperrt' && !verletzt) fehler.push(`${name}: gesperrt ohne Konflikt (${z.grund})`);
          if (z.zustand === 'tausch' && !basis.find(x => x.datum === z.datum).einheit) fehler.push(`${name}: Tausch auf freien Tag`);
          // Rückgängig = alten Plan zurückschreiben: der darf durch die Anpassung nicht verändert sein
          const zurueck = wocheWirksam(plan, mo, [], heute, 220);
          if (JSON.stringify(zurueck.map(x => x.einheit?.typ ?? null)) !== JSON.stringify(basis.map(x => x.einheit?.typ ?? null)))
            fehler.push(`${name}: Rückgängig stellt nicht wieder her`);
        }
        // Auslassen: fällt aus der Belastung, wird nie verlegt
        const aus = wocheWirksam(mitAnpassung(plan, mo, { art: 'auslassen', datum: t.datum }), mo, [], tag(w * 7 + 7), 220);
        const ta = aus.find(x => x.datum === t.datum);
        if (ta.status !== 'ausgelassen') fehler.push(`${t.kurz} auslassen: Status ${ta.status}`);
        if (aus.some(x => x.einheit?.verschobenVon === t.datum)) fehler.push(`${t.kurz} auslassen: trotzdem verlegt`);
        // Leichter: harte Einheit wird Grundlage gleicher Dauer; Kürzer: 15 min weniger
        if (istHart(t.einheit) && t.einheit.typ !== 'T') {
          const l = wocheMitAnpassungen(mitAnpassung(plan, mo, { art: 'leichter', datum: t.datum }), mo, 220).find(x => x.datum === t.datum).einheit;
          if (l.typ !== 'E' || istHart(l)) fehler.push(`${t.kurz} leichter: ${l.typ}`);
        }
        const kd = kuerzerDauer(t.einheit);
        if (kd) {
          const k = wocheMitAnpassungen(mitAnpassung(plan, mo, { art: 'kuerzer', datum: t.datum }), mo, 220).find(x => x.datum === t.datum).einheit;
          if (k.opts.dauer !== kd || kd >= t.einheit.opts.dauer) fehler.push(`${t.kurz} kürzer: ${t.einheit.opts.dauer} → ${k.opts.dauer}`);
        }
      }
    }
  }
}
console.log(`Eigene Änderungen: ${verschiebungen} Verschiebungen geprüft`);

// --- Länge, Pause, Wiedereinstieg ---
for (const laenge of [4, 8, 12]) {
  const plan = planAnlegen({ tage: [1, 3, 5], dauer: 45, ftp: 220, laenge, heute: START });
  const letzte = [...Array(laenge * 7 + 14).keys()].map(tag).filter(d => einheitAm(plan, d, 220)).at(-1);
  if (planWoche(plan, letzte) !== laenge - 1) fehler.push(`Länge ${laenge}: letzte Einheit in Woche ${planWoche(plan, letzte) + 1}`);
  if (einheitAm(plan, letzte, 220).typ !== 'T') fehler.push(`Länge ${laenge}: endet nicht mit dem FTP-Test`);
  if (!istAbgeschlossen(plan, tag(laenge * 7)) || istAbgeschlossen(plan, tag(laenge * 7 - 1))) fehler.push(`Länge ${laenge}: Abschluss falsch erkannt`);
}
{
  const plan = planAnlegen({ tage: [1, 3, 5], dauer: 45, ftp: 220, laenge: null, heute: START });
  const pausiert = pausieren(plan, tag(9));                   // Mi der Planwoche 2
  if ([9, 10, 20, 40].some(n => einheitAm(pausiert, tag(n), 220))) fehler.push('Pause: Einheiten während der Pause');
  // Stufen: [Pausentage, erwartete Planwoche beim Fortsetzen, erste Einheit locker?, Intensität harter Einheiten]
  for (const [tageP, woche, lockerZuerst] of [[4, 1, false], [10, 1, true], [20, 3, false], [35, 3, false]]) {
    const heute = tag(9 + tageP);
    const { plan: neu, text } = wiedereinstieg(pausiert, tagIso(tag(9)), heute);
    const name = `Wiedereinstieg nach ${tageP} Tagen (${text})`;
    if (planWoche(neu, heute) !== woche) fehler.push(`${name}: Planwoche ${planWoche(neu, heute) + 1} statt ${woche + 1}`);
    if (neu.pause) fehler.push(`${name}: noch pausiert`);
    // vor dem Wiedereinstieg nichts, danach wieder Einheiten
    // (kurze Pause: nur die Pausentage selbst — Tage davor bleiben mit ihren Fahrten sichtbar)
    const vorher = [...Array(tageP <= 6 ? tageP : 7).keys()].map(i => tag(9 + tageP - 1 - i)).some(d => einheitAm(neu, d, 220));
    if (vorher) fehler.push(`${name}: Einheiten vor dem Wiedereinstieg`);
    const naechste = [...Array(14).keys()].map(i => einheitAm(neu, tag(9 + tageP + i), 220)).filter(Boolean);
    if (!naechste.length) fehler.push(`${name}: keine Einheiten danach`);
    if (lockerZuerst && istHart(naechste[0]) && naechste[0].typ !== 'T') fehler.push(`${name}: erste Einheit hart`);
    if (tageP >= 7 && tageP <= 13 && naechste.some(e => istHart(e) && e.typ !== 'T' && e.opts.intensitaet > 95 && e.woche === woche))
      fehler.push(`${name}: harte Einheit über 95 %`);
    if (tageP >= 14 && !naechste.slice(0, 7).some(e => e.typ === 'T')) fehler.push(`${name}: kein FTP-Test in der Einstiegswoche`);
    if (tageP >= 28 && !naechste.some(e => istHart(e) && e.typ !== 'T' && e.opts.intensitaet === 95)) fehler.push(`${name}: neuer Block nicht sanfter`);
  }
  // Stufe 7–13 Tage an einem frühen Wochentag (Mo, Di): nach der lockeren ersten
  // Einheit liegt noch eine harte in der Woche — sie muss bei 95 % bleiben
  for (const tageP of [12, 13]) {
    const heute = tag(9 + tageP);
    const { plan: neu, text } = wiedereinstieg(pausiert, tagIso(tag(9)), heute);
    const woche = planWoche(neu, heute);
    const harte = [...Array(7 - wochentag(heute)).keys()].map(i => einheitAm(neu, tag(9 + tageP + i), 220))
      .filter(e => e && e.woche === woche && istHart(e) && e.typ !== 'T');
    if (!harte.length) fehler.push(`Wiedereinstieg nach ${tageP} Tagen (${text}): keine harte Einheit in der Woche`);
    if (harte.some(e => e.opts.intensitaet !== 95)) fehler.push(`Wiedereinstieg nach ${tageP} Tagen (${text}): harte Einheit nicht bei 95 %`);
  }
}

// Bilanz zählt über Pausen hinweg (Fahrten vor dem Wiedereinstieg bleiben drin)
{
  const plan = planAnlegen({ tage: [1, 3, 5], dauer: 45, ftp: 220, laenge: 4, heute: START });
  const fahrt = n => ({ planRef: `plan:${tagIso(tag(n))}`, start: tag(n).getTime() + 18 * 36e5, dauer: 2700 });
  const sessions = [fahrt(1), fahrt(3), fahrt(5), { start: tag(8).getTime(), dauer: 600 }];   // 3 Planfahrten + 10-min-Rolle
  const { plan: neu } = wiedereinstieg(pausieren(plan, tag(8)), tagIso(tag(8)), tag(20));
  const b = planBilanz(neu, [...sessions, fahrt(22), fahrt(24)], tag(60));
  const erwartet = [...Array(35).keys()].map(i => einheitAm(neu, tag(20 + i), 220)).filter(Boolean).length + 3;   // ab Wiedereinstieg + 3 davor
  if (b.gefahren !== 5 || b.geplant !== erwartet) fehler.push(`Bilanz: ${b.gefahren} von ${b.geplant} statt 5 von ${erwartet}`);
}

// Fahrten aus dem Plan: Abbruch zählt nicht, FTP-Test ab 5 min; Beschreibung lesbar
{
  const plan = planAnlegen({ tage: [1, 3, 5], dauer: 45, ftp: 220, laenge: 8, heute: START });
  const e = einheitAm(plan, tag(8), 220);                                  // Di Woche 2: Intervalle
  const s = dauer => ({ planRef: e.ref, start: tag(8).getTime() + 18 * 36e5, dauer, programmId: e.programmId });
  if (erledigtDurch(e, [s(120)])) fehler.push('Abbruch nach 2 min gilt als erledigt');
  if (!erledigtDurch(e, [s(2700)])) fehler.push('Planfahrt 45 min nicht erledigt');
  // Freie Fahrt am Plantag: ab genau 15 min erledigt sie die Einheit
  const frei = dauer => ({ start: tag(8).getTime() + 18 * 36e5, dauer });
  const statusBei = dauer => wocheWirksam(plan, tag(7), [frei(dauer)], tag(9), 220)[1].status;
  if (!erledigtDurch(e, [frei(900)]) || statusBei(900) !== 'erledigt') fehler.push(`Freie Fahrt 15 min nicht erledigt: ${statusBei(900)}`);
  if (erledigtDurch(e, [frei(899)]) || statusBei(899) !== 'verpasst') fehler.push(`Freie Fahrt unter 15 min gilt als erledigt: ${statusBei(899)}`);
  if (!zaehltFuerPlan({ dauer: 500, programmId: 'rampentest' }) || zaehltFuerPlan({ dauer: 400, programmId: 'rampentest' }) || zaehltFuerPlan({ dauer: 500, programmId: 'vo2max' }))
    fehler.push('Schwelle für den FTP-Test falsch');
  const text = planBeschreibung(planInfo(plan, e));
  if (text !== `Trainingsplan · Woche 2 von 8 · ${e.name}`) fehler.push(`Beschreibung: ${text}`);
  const ersatz = planBeschreibung(planInfo(plan, e, { ersatz: true }));
  if (!ersatz.includes('statt ')) fehler.push(`Ersatz-Beschreibung: ${ersatz}`);
}

// Zeitumstellung: Herbst (25.10.2026, 25-h-Tag) und Frühjahr (29.03.2026, 23-h-Tag)
{
  const plan = planAnlegen({ tage: [1, 3, 5], dauer: 45, ftp: 220, laenge: 4, heute: new Date(2026, 8, 28) });
  const ende = planEnde(plan);
  if (tagIso(ende) !== '2026-10-25') fehler.push(`Zeitumstellung: Planende ${tagIso(ende)} statt 2026-10-25`);
  const naechster = tagIso(plusTage(ende, 1));
  if (naechster !== '2026-10-26') fehler.push(`Zeitumstellung: Tag nach Planende ${naechster} statt 2026-10-26`);
  const w = wiedereinstieg({ ...plan, laenge: 8 }, naechster, new Date(2026, 10, 1, 9));
  if (w.text !== 'weiter wie geplant') fehler.push(`Zeitumstellung: Weiter nach 6 Tagen ergibt „${w.text}"`);
  const fruehling = planAnlegen({ tage: [1, 3, 5], dauer: 45, ftp: 220, laenge: 8, heute: new Date(2026, 2, 16) });
  const t = tageOhneFahrt(fruehling, [{ start: new Date(2026, 2, 27, 19).getTime(), dauer: 2700 }], new Date(2026, 2, 31, 8));
  if (t.seit !== 3 || t.ab !== '2026-03-28') fehler.push(`Zeitumstellung: ${t.seit} Tage ohne Fahrt ab ${t.ab} statt 3 ab 2026-03-28`);
}

// --- Anlegen an jedem Wochentag ohne FTP: nichts vor dem Anlegen, der Test kommt
// am ersten erreichbaren Plantag und verfällt nie; nichts Hartes ohne FTP
let anlagen = 0;
for (let maske = 0; maske < 128; maske++) {
  const tage = WOCHENTAGE.map((_, i) => i).filter(i => maske & (1 << i));
  if (tage.length < 2 || tage.length > 6) continue;
  for (const einsteiger of [false, true])
    for (let anlage = 0; anlage < 7; anlage++) {
      anlagen++;
      const heute = tag(anlage);
      const plan = planAnlegen({ tage, dauer: 45, ziel: 'ausdauer', einsteiger, ftp: 0, laenge: 8, heute });
      const name = `${tage.map(t => WOCHENTAGE[t]).join('')}${einsteiger ? ' einst.' : ''} angelegt ${WOCHENTAGE[anlage]}`;
      const einheiten = [...Array(56).keys()].map(i => einheitAm(plan, tag(anlage + i), 0)).filter(Boolean);
      if (einheiten.some(e => e.datum < tagIso(heute))) fehler.push(`${name}: Einheit vor dem Anlegen`);
      if (einheiten.some(e => TYPEN[e.typ].art === 'hart' || e.typ === 'Et')) fehler.push(`${name}: hart oder Tempo ohne FTP`);
      const erster = tagIso(ersterTestTag(plan));
      const ersteT = einheiten.find(e => e.typ === 'T');
      if (ersteT?.datum !== erster) fehler.push(`${name}: erster Test ${ersteT?.datum} statt ${erster}`);
      // Termin verfällt nicht: jede Plan-Woche ab dem ersten Test hat einen Test
      const wochenMitTest = new Set(einheiten.filter(e => e.typ === 'T').map(e => e.woche));
      for (const w of new Set(einheiten.filter(e => e.datum >= erster).map(e => e.woche)))
        if (!wochenMitTest.has(w)) fehler.push(`${name}: Woche ${w + 1} ohne Test, obwohl die FTP fehlt`);
      if (!einsteiger && tagIso(ersterTestTag(plan)) !== einheiten[0].datum) fehler.push(`${name}: erste Einheit ist nicht der Test`);
      if (einsteiger && einheiten.some(e => e.datum < tagIso(plusTage(heute, 14)) && (e.typ === 'T' || e.typ === 'L'))) fehler.push(`${name}: Test oder lange Fahrt beim Einrollen`);
      if (einheiten.some(e => e.typ !== 'T' && e.typ !== 'R' && e.opts.intensitaet !== 80)) fehler.push(`${name}: lockere Einheit ohne FTP nicht bei 80 %`);
      // Ohne Plantag in dieser Woche beginnt Woche 1 am nächsten Montag: voller Plan
      if (!tage.some(t => t >= anlage) && tagIso(montag(plusTage(heute, 7))) !== plan.start) fehler.push(`${name}: Start ${plan.start}`);
    }
}
console.log(`Anlegen: ${anlagen} Fälle an allen Wochentagen geprüft`);

// --- Einsteiger: spürbar langsamer, auch mit FTP und nachträglich gesetzt ---
for (let maske = 0; maske < 128; maske++) {
  const tage = WOCHENTAGE.map((_, i) => i).filter(i => maske & (1 << i));
  if (tage.length < 2 || tage.length > 6) continue;
  for (const dauer of DAUERN) {
    const mit = planAnlegen({ tage, dauer, ziel: 'leistung', einsteiger: true, ftp: 220, laenge: null, heute: START });
    const ohne = planAnlegen({ tage, dauer, ziel: 'leistung', einsteiger: false, ftp: 220, laenge: null, heute: START });
    const name = `${tage.map(t => WOCHENTAGE[t]).join('')} ${dauer}′`;
    for (let i = 0; i < 70; i++) {
      const e = einheitAm(mit, tag(i), 220), o = einheitAm(ohne, tag(i), 220);
      if (!e !== !o) fehler.push(`${name} Tag ${i}: Plantag unterschiedlich`);
      if (!e) continue;
      if (i < 14) {
        if (TYPEN[e.typ].art !== 'locker' || e.typ === 'L') fehler.push(`${name} Tag ${i}: ${e.typ} beim Einrollen`);
        if ((e.opts.dauer ?? 0) > (o.opts.dauer ?? 99)) fehler.push(`${name} Tag ${i}: nicht kürzer`);
        if (e.opts.dauer > 35) fehler.push(`${name} Tag ${i}: ${e.opts.dauer} min beim Einrollen`);
      } else if (TYPEN[e.typ].art === 'hart') {
        const soll = i < 28 ? 90 : i < 42 ? 95 : 100;
        if (e.opts.intensitaet !== soll) fehler.push(`${name} Tag ${i}: ${e.opts.intensitaet} % statt ${soll} %`);
        if (i < 42 && e.opts.dauer > o.opts.dauer) fehler.push(`${name} Tag ${i}: länger als ohne Haken`);
      }
      if (i >= 42 && JSON.stringify(e.opts) !== JSON.stringify(o.opts)) fehler.push(`${name} Tag ${i}: nach dem Einstieg anders als ohne Haken`);
    }
    // Nachträglich in Woche 7 gesetzt: wirkt ab heute wie beim Anlegen
    const spaet = planAendern(ohne, { tage, dauer, ziel: 'leistung', einsteiger: true, laenge: null }, tag(42));
    for (let i = 42; i < 56; i++) if (einheitAm(spaet, tag(i), 220) && TYPEN[einheitAm(spaet, tag(i), 220).typ].art === 'hart') fehler.push(`${name}: Haken in Woche 7 wirkt nicht (Tag ${i})`);
    if (einheitAm(spaet, tag(41), 220)?.typ !== einheitAm(ohne, tag(41), 220)?.typ) fehler.push(`${name}: Haken ändert die Vergangenheit`);
    const wieder = planAendern(spaet, { tage, dauer, ziel: 'leistung', einsteiger: false, laenge: null }, tag(43));
    if (wieder.einsteiger || wieder.einsteigerAb) fehler.push(`${name}: Haken entfernen wirkt nicht`);
  }
}

// --- Abschluss nach Bilanz: Ablauf ist kein Erfolg ---
{
  const plan = planAnlegen({ tage: [1, 3, 5], dauer: 45, ftp: 220, laenge: 4, heute: START });
  const fahrt = n => ({ planRef: `plan:${tagIso(tag(n))}`, start: tag(n).getTime() + 18 * 36e5, dauer: 2700 });
  const plantage = [...Array(28).keys()].filter(n => einheitAm(plan, tag(n), 220));
  const nach = tag(28);
  const b0 = planBilanz(plan, [], nach);
  if (b0.geschafft || b0.gefahren !== 0 || b0.geplant !== plantage.length) fehler.push(`Abschluss ohne Fahrt: ${JSON.stringify(b0)}`);
  const grenze = Math.ceil(plantage.length * 0.7);
  const knapp = planBilanz(plan, plantage.slice(0, grenze - 1).map(fahrt), nach);
  const reicht = planBilanz(plan, plantage.slice(0, grenze).map(fahrt), nach);
  if (knapp.geschafft || !reicht.geschafft) fehler.push(`Abschluss-Grenze 70 %: ${knapp.gefahren} ${knapp.geschafft}, ${reicht.gefahren} ${reicht.geschafft}`);
  // Spät angelegt: nur was wirklich geplant war, zählt
  const spaet = planAnlegen({ tage: [1, 3, 5], dauer: 45, ftp: 220, laenge: 4, heute: tag(4) });
  const real = [...Array(40).keys()].filter(n => einheitAm(spaet, tag(n), 220)).length;
  if (planBilanz(spaet, [], tag(60)).geplant !== real) fehler.push(`Bilanz spät angelegt: ${planBilanz(spaet, [], tag(60)).geplant} statt ${real}`);
  const auslass = mitAnpassung(plan, tag(0), { art: 'auslassen', datum: tagIso(tag(1)) });
  if (planBilanz(auslass, [], nach).geplant !== plantage.length - 1) fehler.push('Bilanz zählt Ausgelassenes');
  // Fortlaufend läuft nie ab
  if (istAbgeschlossen(planAnlegen({ tage: [1, 3], laenge: null, ftp: 220, heute: START }), tag(4000))) fehler.push('Fortlaufend abgeschlossen');
}

// --- Verlängern: immer die neuen Wochen ab jetzt, Einstieg nach der letzten Fahrt ---
for (const laenge of [4, 8, 12, 16]) {
  const basis = planAnlegen({ tage: [1, 3, 5], dauer: 45, ftp: 220, laenge, heute: START });
  for (let spaeter = 0; spaeter < 80; spaeter++) {
    const heuteN = laenge * 7 + spaeter, heute = tag(heuteN);
    for (const [fahrtTag, stufe] of [[heuteN - 2, 0], [heuteN - 10, 1], [heuteN - 20, 2], [null, 3]]) {
      const sessions = fahrtTag === null ? [] : [{ start: tag(fahrtTag).getTime() + 18 * 36e5, dauer: 2700 }];
      const { seit } = tageOhneFahrt(basis, sessions, heute);
      if (fahrtTag === null && seit < 28) continue;
      const { plan: neu, text } = verlaengern(basis, sessions, heute);
      const name = `Verlängern L${laenge} +${spaeter} Tage, Stufe ${stufe} (${text})`;
      if (istAbgeschlossen(neu, heute)) fehler.push(`${name}: sofort wieder abgeschlossen`);
      const offen = [...Array(100).keys()].map(i => einheitAm(neu, tag(heuteN + i), 220)).filter(Boolean);
      const wochen = new Set(offen.map(e => e.woche));
      if (wochen.size < 4) fehler.push(`${name}: nur ${wochen.size} Wochen`);
      if (offen.length < 6) fehler.push(`${name}: nur ${offen.length} Einheiten`);
      if (stufe === 1 && istHart(offen[0])) fehler.push(`${name}: erste Einheit hart`);
      if (stufe >= 2 && !offen.slice(0, 3).some(e => e.typ === 'T')) fehler.push(`${name}: kein Test vorweg`);
      if (stufe >= 2 && offen.slice(0, offen.findIndex(e => e.typ === 'T')).some(istHart)) fehler.push(`${name}: hart vor dem Test`);
      if (stufe === 3 && offen.some(e => TYPEN[e.typ].art === 'hart' && e.woche === offen.find(x => x.typ === 'T').woche + 1 && e.opts.intensitaet !== 95)) fehler.push(`${name}: Block nach Test nicht bei 95 %`);
    }
  }
}

// --- Wiedereinstieg an jedem Wochentag: was versprochen ist, findet statt ---
for (const laenge of [4, 8, 12, null])
  for (const tage of [[0, 2, 4], [1, 3, 5], [0, 6], [2, 5, 6], [0, 1, 2, 3, 4, 5]]) {
    const plan = planAnlegen({ tage, dauer: 45, ftp: 220, laenge, heute: START });
    for (const pauseTage of [7, 10, 13, 14, 20, 27, 28, 40]) {
      for (let d = 0; d < 7; d++) {
        const heuteN = 7 + pauseTage + d, ab = heuteN - pauseTage;
        if (laenge && planWoche(plan, tag(ab)) >= laenge) continue;
        const { plan: neu, text } = wiedereinstieg(pausieren(plan, tag(ab)), tagIso(tag(ab)), tag(heuteN));
        const name = `Wiedereinstieg ${tage.map(t => WOCHENTAGE[t]).join('')} L${laenge} nach ${pauseTage} am ${WOCHENTAGE[wochentag(tag(heuteN))]} (${text})`;
        const offen = [...Array(100).keys()].map(i => einheitAm(neu, tag(heuteN + i), 220)).filter(Boolean);
        if (!offen.length) { fehler.push(`${name}: keine Einheit`); continue; }
        if (pauseTage <= 13) {
          if (istHart(offen[0])) fehler.push(`${name}: erste Einheit hart`);
          const fenster = offen.filter(e => e.datum <= neu.einstieg.bis && TYPEN[e.typ].art === 'hart');
          if (fenster.some(e => e.opts.intensitaet > 95)) fehler.push(`${name}: harte Einheit über 95 %`);
        } else {
          const t = offen.findIndex(e => e.typ === 'T');
          if (t < 0 || t > 5) fehler.push(`${name}: kein Test in der Einstiegswoche`);
          if (offen.slice(0, Math.max(0, t)).some(e => istHart(e))) fehler.push(`${name}: hart vor dem Test`);
          if (t >= 0 && offen[t].woche !== offen[0].woche) fehler.push(`${name}: Test nicht in der ersten Woche`);
          const folgt = !text.includes('zum Abschluss');
          if (laenge && folgt && neu.laenge - offen[0].woche - 1 < 4) fehler.push(`${name}: versprochener Block fehlt (Länge ${neu.laenge}, Woche ${offen[0].woche + 1})`);
          if (pauseTage >= 28 && folgt && !offen.some(e => TYPEN[e.typ].art === 'hart' && e.opts.intensitaet === 95)) fehler.push(`${name}: neuer Block nicht sanfter`);
        }
      }
    }
  }
// Stufe 7–13 mit früher Rückkehr: nach der lockeren Einheit kommt wirklich eine harte mit 95 %
{
  const plan = planAnlegen({ tage: [0, 2, 4], dauer: 45, ftp: 220, laenge: null, heute: START });
  const { plan: neu } = wiedereinstieg(plan, tagIso(tag(11)), tag(21));          // Montag, 10 Tage
  const woche = [0, 2, 4].map(i => einheitAm(neu, tag(21 + i), 220));
  if (istHart(woche[0])) fehler.push('7–13 Tage: erste Einheit hart');
  if (!woche.slice(1).some(e => TYPEN[e.typ].art === 'hart' && e.opts.intensitaet === 95)) fehler.push(`7–13 Tage: keine harte Einheit mit 95 % (${woche.map(e => e.typ)})`);
}
// Kurze Pause: gefahrene Tage bleiben, die Pause gilt nicht als verpasst
{
  const plan = planAnlegen({ tage: [0, 2, 4], dauer: 45, ftp: 220, laenge: null, heute: START });
  const { plan: neu } = wiedereinstieg(pausieren(plan, tag(9)), tagIso(tag(9)), tag(11));
  const sessions = [{ planRef: `plan:${tagIso(tag(7))}`, plan: { typ: 'H1' }, start: tag(7).getTime() + 18 * 36e5, dauer: 2700, programmId: 'vo2max' }];
  const w = wocheWirksam(neu, tag(7), sessions, tag(11), 220);
  if (w[0].status !== 'erledigt') fehler.push(`Kurze Pause: gefahrener Montag ${w[0].status}`);
  if (w[2].status === 'verpasst') fehler.push('Kurze Pause: pausierter Mittwoch gilt als verpasst');
  if (w[4].status !== 'geplant') fehler.push(`Kurze Pause: Freitag ${w[4].status}`);
}

// --- Eigene Änderungen treffen die Einheit, die auf der Karte steht ---
{
  const plan = planAnlegen({ tage: [0, 2, 4], dauer: 45, ftp: 220, laenge: null, heute: START });
  const mo = tag(7), mi = tag(9), heuteIso = tagIso(mi);                         // Mo verpasst, heute Mi
  const karte = neu => wocheWirksam(neu, mo, [], mi, 220);
  const vorher = karte(plan);
  if (!vorher[2].einheit.verschobenVon || !istHart(vorher[2].einheit)) fehler.push(`Vorbedingung: Mi nicht verschoben (${vorher[2].einheit?.typ})`);
  const op = o => karte(mitAnpassungWirksam(plan, mo, o, [], mi, 220));
  const leicht = op({ art: 'leichter', datum: heuteIso });
  if (leicht[2].einheit.typ !== 'E') fehler.push(`Leichter auf Verschobenem: ${leicht[2].einheit.typ}`);
  if (leicht[0].status !== 'verpasst' || !leicht[0].hinweis) fehler.push(`Leichter: Montag ${leicht[0].status} „${leicht[0].hinweis}"`);
  if (leicht.some(t => istHart(t.einheit) && t.datum > heuteIso && t.einheit.verschobenVon)) fehler.push('Leichter: Einheit trotzdem weiterverlegt');
  const kd = kuerzerDauer(vorher[2].einheit);
  const kurz = op({ art: 'kuerzer', datum: heuteIso });
  if (kurz[2].einheit.opts.dauer !== kd) fehler.push(`Kürzer auf Verschobenem: ${kurz[2].einheit.opts.dauer} statt ${kd}`);
  const aus = op({ art: 'auslassen', datum: heuteIso });
  if (aus[2].status !== 'ausgelassen') fehler.push(`Auslassen auf Verschobenem: ${aus[2].status}`);
  if (aus.some(t => t.einheit?.verschobenVon && t.datum > heuteIso)) fehler.push('Auslassen verlegt die Einheit weiter');
  // Eigene Variante wird vom automatischen Verschieben nicht überschrieben
  const milde = mitAnpassung(plan, mo, { art: 'leichter', datum: tagIso(tag(11)) });
  const wMilde = wocheWirksam(milde, mo, [], tag(11), 220);
  if (wMilde[4].einheit?.variante !== 'leichter') fehler.push('Automatisches Verschieben überschreibt „Leichter"');
  // Ausgelassener Zieltag: seine Einheit kommt beim Verschieben nicht zurück
  const ausTag = tagIso(tag(11));
  const zurueck = mitAnpassung(mitAnpassung(plan, mo, { art: 'auslassen', datum: ausTag }), mo, { art: 'verschieben', von: tagIso(tag(9)), nach: ausTag });
  const wZ = wocheMitAnpassungen(zurueck, mo, 220);
  if (wZ[2].einheit) fehler.push(`Verschieben auf Ausgelassenes holt ${wZ[2].einheit.typ} zurück`);
}
// Vergangenheit bleibt: lockere Fahrt wird nicht rückwirkend zur harten Einheit
{
  const plan = planAnlegen({ tage: [0, 1, 2, 3], dauer: 45, ziel: 'fitness', ftp: 220, laenge: null, heute: START });
  const rolle = rollen(plan.tage, plan.ziel);
  const mo = tag(7);
  if (TYPEN[rolle.get(0)].art === 'hart') {
    const di = { planRef: `plan:${tagIso(tag(8))}`, plan: { typ: 'E' }, programmId: 'ausdauer', start: tag(8).getTime() + 18 * 36e5, dauer: 2700, np: 120, ftp: 220 };
    const w = wocheWirksam(plan, mo, [di], tag(9), 220);
    if (w[1].einheit?.verschobenVon) fehler.push('Vergangener Tag bekommt nachträglich die verpasste Einheit');
    if (w[0].status !== 'verpasst') fehler.push(`Vergangenheit: Montag ${w[0].status}`);
  }
}
// Harte Einheit verdrängt keine harte; der Test darf es
{
  const plan = planAnlegen({ tage: [0, 2, 4], dauer: 45, ftp: 220, laenge: null, heute: START });
  for (const heuteN of [8, 9, 10, 11, 12]) {
    const w = wocheWirksam(plan, tag(7), [], tag(heuteN), 220);
    const roh = wocheAb(plan, tag(7), 220);
    w.forEach((t, i) => { if (t.einheit?.verschobenVon && t.einheit.typ !== 'T' && TYPEN[roh[i].einheit?.typ]?.art === 'hart') fehler.push(`Hart verdrängt hart am ${t.kurz}`); });
  }
}
// Erledigt: freie Fahrt ab 15 min; den Test erledigt nur ein Test
{
  const plan = planAnlegen({ tage: [1, 3, 5], dauer: 45, ftp: 220, laenge: 8, heute: START });
  const e = einheitAm(plan, tag(8), 220);
  const frei = dauer => ({ start: tag(8).getTime() + 18 * 36e5, dauer });
  if (!erledigtDurch(e, [frei(900)]) || erledigtDurch(e, [frei(899)])) fehler.push('Freie Fahrt: Grenze 15 min');
  if (wocheWirksam(plan, tag(7), [frei(900)], tag(9), 220)[1].status !== 'erledigt') fehler.push('Freie Fahrt: Status nicht erledigt');
  if (wocheWirksam(plan, tag(7), [frei(899)], tag(9), 220)[1].status !== 'verpasst') fehler.push('Kurze freie Fahrt: Status nicht verpasst');
  const ohneFtp = planAnlegen({ tage: [1, 3, 5], dauer: 45, ftp: 0, laenge: 8, heute: START });
  const t = einheitAm(ohneFtp, tag(1), 0);
  if (t.typ !== 'T') fehler.push(`Ohne FTP: erste Einheit ${t.typ}`);
  if (erledigtDurch(t, [{ start: tag(1).getTime() + 18 * 36e5, dauer: 1200 }])) fehler.push('Freie Fahrt erledigt den Test');
  if (!erledigtDurch(t, [{ start: tag(1).getTime() + 18 * 36e5, dauer: 600, programmId: 'rampentest' }])) fehler.push('Rampentest erledigt den Test nicht');
  if (erledigtDurch(t, [{ start: tag(1).getTime() + 18 * 36e5, dauer: 300, programmId: 'rampentest' }])) fehler.push('Test gilt nach dem Einrollen als gefahren');
  // Gefahrener Test bleibt stehen, auch wenn er später als zuerst geplant kam; am Tag danach nichts Hartes
  const spaet = { ...ohneFtp, ftpTestAm: tagIso(tag(15)) };
  if (einheitAm(spaet, tag(15), 220)?.typ !== 'T') fehler.push('Gefahrener Test verschwindet');
  // Startwatt folgen der aktuellen FTP
  if (einheitAm(plan, tag(26), 300)?.typ === 'T' && einheitAm(plan, tag(26), 300).opts.start !== 150) fehler.push('Rampentest: Startwatt nicht nach aktueller FTP');
}
// Test der leichten Woche: spätester Plantag mit ≥ 2 Tagen vor der ersten harten Einheit
for (let maske = 0; maske < 128; maske++) {
  const tage = WOCHENTAGE.map((_, i) => i).filter(i => maske & (1 << i));
  if (tage.length < 2 || tage.length > 6) continue;
  const plan = planAnlegen({ tage, dauer: 45, ftp: 220, laenge: null, heute: START });
  const ersteHart = wocheAb(plan, tag(28), 220).findIndex(t => t.einheit && TYPEN[t.einheit.typ].art === 'hart');
  const erlaubt = tage.filter(t => ersteHart < 0 || 7 + ersteHart - t >= 2);
  const soll = erlaubt.at(-1) ?? tage.at(-1);
  const ist = wocheAb(plan, tag(21), 220).findIndex(t => t.einheit?.typ === 'T');
  if (ist !== soll) fehler.push(`${tage.map(t => WOCHENTAGE[t]).join('')}: Test am ${WOCHENTAGE[ist]} statt ${WOCHENTAGE[soll]}`);
}
// Tage mitten in der Woche ändern: Vergangenes bleibt, neue Tage gelten ab heute
{
  const plan = planAnlegen({ tage: [0, 2, 4], dauer: 45, ftp: 220, laenge: null, heute: START });
  const anp = mitAnpassung(plan, tag(7), { art: 'auslassen', datum: tagIso(tag(11)) });
  const neu = planAendern(anp, { tage: [1, 3, 5], dauer: 45, ziel: 'fitness', einsteiger: false, laenge: null }, tag(10));   // Do
  if (einheitAm(neu, tag(7), 220)?.typ !== einheitAm(plan, tag(7), 220)?.typ) fehler.push('Tage ändern: Montag verliert seine Einheit');
  if (einheitAm(neu, tag(8), 220)) fehler.push('Tage ändern: neuer Di gilt rückwirkend');
  if (!einheitAm(neu, tag(10), 220)) fehler.push('Tage ändern: Do ab heute fehlt');
  if (neu.anpassungen?.[tagIso(tag(7))]) fehler.push('Tage ändern: alte Anpassung der Woche bleibt');
}

const eindeutig = [...new Set(fehler)];
console.log(eindeutig.length
  ? `${eindeutig.length} Regelverstöße (${kombis} Tag-Kombinationen, ${einheiten} Einheiten):\n  ${eindeutig.slice(0, 40).join('\n  ')}${eindeutig.length > 40 ? '\n  …' : ''}`
  : `ok — ${kombis} Tag-Kombinationen × Ziele × Dauern × FTP-Fälle, ${einheiten} Einheiten regelkonform`);
process.exit(eindeutig.length ? 1 : 0);
