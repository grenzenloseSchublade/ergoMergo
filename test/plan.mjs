#!/usr/bin/env node
// Trainingsplan-Regeln für ALLE Wochentag-Kombinationen (2–6 Tage), alle
// Ziele, Dauern und FTP-Fälle über 12 Wochen:
//   · zwischen harten Einheiten immer ≥ 48 h (auch über die Wochengrenze)
//   · höchstens 2 harte Einheiten pro Woche (Ziel „Leistung": 3)
//   · Erholungswoche (4, 8, 12): keine harte Einheit, Rampentest am letzten Tag
//   · jede Dauer liegt im erlaubten Bereich des Generators
//   · FTP unbekannt: keine harte Einheit, bis eine FTP da ist; Test kommt zuerst
//   · Wochenumfang wächst im Block höchstens um ~25 %
// Aufruf: node test/plan.mjs   (reines Node, kein Browser)

import { planAnlegen, einheitAm, wocheAb, wocheWirksam, wocheMitAnpassungen, verschiebeZiele, mitAnpassung, ohneLetzteAnpassung,
  kuerzerDauer, istHart, tagIso, planWoche, pausieren, wiedereinstieg, istAbgeschlossen, planBilanz,
  erledigtDurch, zaehltFuerPlan, planInfo, planBeschreibung,
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
          // Test so spät wie möglich, aber ≥ 48 h vor der nächsten harten Einheit (prüft der Abstand oben)
          if (w % 4 === 3 && (ftp || w > 3) && !woche.some(t => t.einheit?.typ === 'T'))
            fehler.push(`${name} W${w + 1}: Erholungswoche ohne Rampentest`);
          // Steigerung im Block (nicht nach einer Testwoche — die ist kurz)
          if (vorigeMinuten && !vorwocheTest && w % 4 !== 0 && w % 4 !== 3 && minuten > vorigeMinuten * 1.25 + 10)
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
          if (e && gefahren.has(d)) sessions.push({ planRef: e.ref, start: tag(w * 7 + d).getTime() + 18 * 36e5, dauer: 2700 });
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
          // Rückgängig stellt die Woche exakt wieder her
          const zurueck = wocheWirksam(ohneLetzteAnpassung(neu, mo), mo, [], heute, 220);
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
    const vorher = [...Array(7).keys()].map(i => tag(9 + tageP - 1 - i)).some(d => einheitAm(neu, d, 220));
    if (vorher) fehler.push(`${name}: Einheiten vor dem Wiedereinstieg`);
    const naechste = [...Array(14).keys()].map(i => einheitAm(neu, tag(9 + tageP + i), 220)).filter(Boolean);
    if (!naechste.length) fehler.push(`${name}: keine Einheiten danach`);
    if (lockerZuerst && istHart(naechste[0]) && naechste[0].typ !== 'T') fehler.push(`${name}: erste Einheit hart`);
    if (tageP >= 7 && tageP <= 13 && naechste.some(e => istHart(e) && e.typ !== 'T' && e.opts.intensitaet > 95 && e.woche === woche))
      fehler.push(`${name}: harte Einheit über 95 %`);
    if (tageP >= 14 && !naechste.slice(0, 7).some(e => e.typ === 'T')) fehler.push(`${name}: kein FTP-Test in der Einstiegswoche`);
    if (tageP >= 28 && !naechste.some(e => istHart(e) && e.typ !== 'T' && e.opts.intensitaet === 95)) fehler.push(`${name}: neuer Block nicht sanfter`);
  }
}

// Bilanz zählt über Pausen hinweg (Fahrten vor dem Wiedereinstieg bleiben drin)
{
  const plan = planAnlegen({ tage: [1, 3, 5], dauer: 45, ftp: 220, laenge: 4, heute: START });
  const fahrt = n => ({ planRef: `plan:${tagIso(tag(n))}`, start: tag(n).getTime() + 18 * 36e5, dauer: 2700 });
  const sessions = [fahrt(1), fahrt(3), fahrt(5), { start: tag(8).getTime(), dauer: 600 }];   // 3 Planfahrten + 10-min-Rolle
  const { plan: neu } = wiedereinstieg(pausieren(plan, tag(8)), tagIso(tag(8)), tag(20));
  const b = planBilanz(neu, [...sessions, fahrt(22), fahrt(24)], tag(60));
  if (b.gefahren !== 5 || b.geplant !== 12) fehler.push(`Bilanz: ${b.gefahren} von ${b.geplant} statt 5 von 12`);
}

// Fahrten aus dem Plan: Abbruch zählt nicht, FTP-Test ab 5 min; Beschreibung lesbar
{
  const plan = planAnlegen({ tage: [1, 3, 5], dauer: 45, ftp: 220, laenge: 8, heute: START });
  const e = einheitAm(plan, tag(8), 220);                                  // Di Woche 2: Intervalle
  const s = dauer => ({ planRef: e.ref, start: tag(8).getTime() + 18 * 36e5, dauer, programmId: e.programmId });
  if (erledigtDurch(e, [s(120)])) fehler.push('Abbruch nach 2 min gilt als erledigt');
  if (!erledigtDurch(e, [s(2700)])) fehler.push('Planfahrt 45 min nicht erledigt');
  if (!zaehltFuerPlan({ dauer: 400, programmId: 'rampentest' }) || zaehltFuerPlan({ dauer: 400, programmId: 'vo2max' }))
    fehler.push('Schwelle für den FTP-Test falsch');
  const text = planBeschreibung(planInfo(plan, e));
  if (text !== `Trainingsplan · Woche 2 von 8 · ${e.name}`) fehler.push(`Beschreibung: ${text}`);
  const ersatz = planBeschreibung(planInfo(plan, e, { ersatz: true }));
  if (!ersatz.includes('statt ')) fehler.push(`Ersatz-Beschreibung: ${ersatz}`);
}

const eindeutig = [...new Set(fehler)];
console.log(eindeutig.length
  ? `${eindeutig.length} Regelverstöße (${kombis} Tag-Kombinationen, ${einheiten} Einheiten):\n  ${eindeutig.slice(0, 40).join('\n  ')}${eindeutig.length > 40 ? '\n  …' : ''}`
  : `ok — ${kombis} Tag-Kombinationen × Ziele × Dauern × FTP-Fälle, ${einheiten} Einheiten regelkonform`);
process.exit(eindeutig.length ? 1 : 0);
