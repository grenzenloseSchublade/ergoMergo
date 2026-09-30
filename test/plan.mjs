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
  kuerzerDauer, istHart, tagIso, WOCHENTAGE, DAUERN, ZIELE, TYPEN, programmFuer } from '../js/plan.js';

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
        const plan = planAnlegen({ tage, dauer, ziel, einsteiger, ftp, heute: START });
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
    const plan = planAnlegen({ tage, dauer: 45, ziel, ftp: 220, heute: START });
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
  const plan = planAnlegen({ tage: [0, 2, 4], dauer: 45, ziel: 'fitness', ftp: 220, heute: START });
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
    const plan = planAnlegen({ tage, dauer: 45, ziel, ftp: 220, heute: START });
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

const eindeutig = [...new Set(fehler)];
console.log(eindeutig.length
  ? `${eindeutig.length} Regelverstöße (${kombis} Tag-Kombinationen, ${einheiten} Einheiten):\n  ${eindeutig.slice(0, 40).join('\n  ')}${eindeutig.length > 40 ? '\n  …' : ''}`
  : `ok — ${kombis} Tag-Kombinationen × Ziele × Dauern × FTP-Fälle, ${einheiten} Einheiten regelkonform`);
process.exit(eindeutig.length ? 1 : 0);
