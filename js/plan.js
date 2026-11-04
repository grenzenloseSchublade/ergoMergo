// Trainingsplan: aus gewählten Wochentagen, typischer Dauer, Ziel und
// Erfahrung wird eine Woche nach der anderen zusammengestellt — reine
// Rechnung, kein DOM. Grundlagen und Quellen: docs/trainingsplan.md
//
// Regeln (Kurzfassung):
//   · höchstens 2 harte Einheiten pro Woche (Ziel „Leistung": 3), zwischen
//     harten Tagen immer ≥ 48 h; passt das nicht, wird eine locker
//   · 4-Wochen-Blöcke: 3 Wochen Steigerung über die Dauer, 1 Woche Erholung
//     mit FTP-Rampentest als letzter Einheit (ausgeruht)
//   · nur FTP-relative Generatoren — nach jedem Test passt sich alles an
//   · FTP unbekannt: nie hart auf Basis der Annahme — erst der Test, und der
//     Termin verfällt nicht: jede Woche wieder, bis eine FTP da ist
//   · Einsteiger: 2 Wochen nur locker und kürzer, dann steigt die Intensität
//   · verpasste Einheiten werden nicht nachgeholt

import { WORKOUTS } from './workouts.js';
import { PROGRAMME } from './program.js';
import { effektiveFtp } from './metrics.js';

export const PLAN_VERSION = 1;
export const WOCHENTAGE = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
export const DAUERN = [30, 45, 60];
export const LAENGEN = [4, 8, 12, null];              // Wochen; null = fortlaufend
export const ZIELE = {
  fitness: { name: 'Fitness', sub: 'Ausgewogen: Intervalle, Schwelle, Grundlage' },
  leistung: { name: 'Leistung', sub: 'Mehr Intensität für eine höhere FTP' },
  ausdauer: { name: 'Ausdauer', sub: 'Längere, gleichmäßige Fahrten' },
};

// Einheitentypen: Farbe = Zone des Hauptteils (Token), art = hart/locker/test
export const TYPEN = {
  H1: { name: 'Intervalle', art: 'hart', farbe: '--z5' },
  H2: { name: 'Schwelle', art: 'hart', farbe: '--z4' },
  H3: { name: 'Kurze Intervalle', art: 'hart', farbe: '--z6' },
  E: { name: 'Grundlage', art: 'locker', farbe: '--z2', sub: 'Gleichmäßig in Zone 2 — baut die Grundlage' },
  Et: { name: 'Ausdauer mit Tempo', art: 'locker', farbe: '--z3', sub: 'Zone 2 mit Tempo-Blöcken' },
  L: { name: 'Lange Ausfahrt', art: 'locker', farbe: '--z2', sub: 'Lang und gleichmäßig in Zone 2' },
  R: { name: 'Regeneration', art: 'locker', farbe: '--z1', sub: 'Locker rollen, die Beine erholen sich' },
  T: { name: 'FTP-Test', art: 'test', farbe: '--accent' },
};

// Ab diesem Anteil gefahrener Einheiten gilt ein Plan als geschafft
export const GESCHAFFT_AB = 0.7;
// Einsteiger: Tage ab Anlegen bzw. Setzen des Hakens und was dann gilt
const EINSTEIGER_STUFEN = [{ bis: 14, einrollen: true }, { bis: 28, intensitaet: 90 }, { bis: 42, intensitaet: 95 }];
const LOCKER_OHNE_FTP = 80;      // Grundlage ohne FTP: die Annahme ist für Einsteiger oft zu hoch
const TEST_SCHWELLE_S = 480;     // FTP-Test zählt ab 8 min: die Rampe beginnt erst nach dem Einrollen

const TAG_MS = 864e5;
const INTERVALL_FOLGE = ['vo2max', 'hiit4020', 'sprint3030'];   // wechselt je Block
const alleProgramme = [...WORKOUTS, ...PROGRAMME];
const programm = id => alleProgramme.find(p => p.id === id);
const klemme = (id, min) => {
  const d = programm(id).optionen.dauer;
  return Math.min(d.max, Math.max(d.min, Math.round(min / 5) * 5));
};

// Datum ohne Uhrzeit (lokal) als 'JJJJ-MM-TT' und zurück
export const tagIso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const ausIso = s => { const [j, m, t] = s.split('-').map(Number); return new Date(j, m - 1, t); };
export const wochentag = d => (d.getDay() + 6) % 7;                  // Mo = 0 … So = 6
export const montag = d => new Date(d.getFullYear(), d.getMonth(), d.getDate() - wochentag(d));
export const plusTage = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
// Kalendertage zwischen zwei Daten — gerundet, damit 23-/25-Stunden-Tage der
// Zeitumstellung nicht als halber Tag zählen
const nullUhr = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const tageZwischen = (a, b) => Math.round((nullUhr(b) - nullUhr(a)) / TAG_MS);

// Abstand in Tagen zwischen aufeinanderfolgenden Tagen, über das Wochenende hinweg
function kleinsterAbstand(tage) {
  if (tage.length < 2) return 7;
  let min = 7;
  for (let i = 0; i < tage.length; i++) min = Math.min(min, (tage[(i + 1) % tage.length] - tage[i] + 7) % 7 || 7);
  return min;
}
function* teilmengen(liste, k, start = 0, bisher = []) {
  if (bisher.length === k) { yield bisher; return; }
  for (let i = start; i < liste.length; i++) yield* teilmengen(liste, k, i + 1, [...bisher, liste[i]]);
}

// Rollen der Wochentage: welcher Tag ist hart, lang, Regeneration, Grundlage
export function rollen(tage, ziel = 'fitness') {
  const sortiert = [...new Set(tage)].sort((a, b) => a - b);
  const n = sortiert.length;
  const rolle = new Map(sortiert.map(t => [t, 'E']));
  // Lange Ausfahrt ab 4 Tagen: spätester Wochenendtag, sonst der letzte Tag
  let lang = null;
  if (n >= 4) {
    lang = [6, 5].find(t => rolle.has(t)) ?? sortiert.at(-1);
    rolle.set(lang, 'L');
  }
  // Harte Tage: möglichst weit auseinander, ≥ 2 Tage Abstand (48 h)
  const kandidaten = sortiert.filter(t => t !== lang);
  let hart = [];
  for (let k = Math.min(ziel === 'leistung' && n >= 5 ? 3 : 2, kandidaten.length); k >= 1 && !hart.length; k--) {
    let beste = null, besterAbstand = 0;
    for (const s of teilmengen(kandidaten, k)) {
      const a = kleinsterAbstand(s);
      if (a >= 2 && a > besterAbstand) { beste = s; besterAbstand = a; }
    }
    if (beste) hart = beste;
  }
  const hartTypen = ziel === 'ausdauer' ? ['H1', 'Et', 'H3'] : ['H1', 'H2', 'H3'];
  hart.forEach((t, i) => rolle.set(t, hartTypen[i]));
  // Ab 5 Tagen: ein lockerer Tag wird Regeneration — der vor einer harten Einheit
  if (n >= 5) {
    const locker = sortiert.filter(t => rolle.get(t) === 'E');
    const vorHart = locker.find(t => hart.includes((t + 1) % 7)) ?? locker[0];
    if (vorHart !== undefined) rolle.set(vorHart, 'R');
  }
  return rolle;
}

// Dauer und Programm einer Rolle in einer Blockwoche (0–2 Aufbau, 3 Erholung)
function einheit(rolleTyp, plan, blockNr, blockWoche) {
  const D = plan.dauer;
  const intensitaet = 100;
  const stufe = [-5, 0, 7][blockWoche];
  switch (rolleTyp) {
    case 'H1': {
      let id = INTERVALL_FOLGE[blockNr % 3];
      if (D + stufe < programm(id).optionen.dauer.min) id = 'sprint3030';   // 30-min-Pläne
      return { typ: 'H1', programmId: id, opts: { dauer: klemme(id, D + stufe), intensitaet } };
    }
    case 'H3': {
      const id = INTERVALL_FOLGE[(blockNr + 1) % 3] === 'vo2max' ? 'hiit4020' : INTERVALL_FOLGE[(blockNr + 1) % 3];
      return { typ: 'H3', programmId: id, opts: { dauer: klemme(id, D), intensitaet } };
    }
    case 'H2':
      return { typ: 'H2', programmId: 'schwelle', opts: { dauer: klemme('schwelle', D + [-10, 0, 15][blockWoche]), intensitaet } };
    case 'Et':
      return { typ: 'Et', programmId: 'ausdauer', opts: { dauer: klemme('ausdauer', D + [0, 10, 20][blockWoche]), intensitaet: 100, tempo: true } };
    case 'L': {
      const plus = plan.ziel === 'ausdauer' ? [20, 35, 50] : [15, 30, 45];
      return { typ: 'L', programmId: 'ausdauer', opts: { dauer: klemme('ausdauer', D + plus[blockWoche]), intensitaet: 100, tempo: false } };
    }
    case 'R':
      return { typ: 'R', programmId: 'recovery', opts: { dauer: 30, intensitaet: 100 } };
    default:
      return { typ: 'E', programmId: 'ausdauer', opts: { dauer: klemme('ausdauer', D), intensitaet: 100, tempo: false } };
  }
}

// Rampentest der Erholungswoche: möglichst spät (ausgeruht), aber ≥ 48 h
// vor der ersten harten Einheit der Folgewoche
function testTag(plan) {
  const rolle = rollen(plan.tage, plan.ziel);
  const ersterHart = plan.tage.find(t => TYPEN[rolle.get(t)]?.art === 'hart');
  return [...plan.tage].reverse().find(t => ersterHart === undefined || 7 + ersterHart - t >= 2) ?? plan.tage.at(-1);
}

const grundlage = plan => ({ typ: 'E', programmId: 'ausdauer',
  opts: { dauer: klemme('ausdauer', plan.dauer), intensitaet: 100, tempo: false } });
const rampentest = (plan, ftpJetzt = plan.ftp) => {
  const ftp = ftpJetzt || plan.ftp;
  return { typ: 'T', programmId: 'rampentest',
    opts: { start: ftp ? Math.min(200, Math.max(50, Math.round(ftp * 0.5 / 10) * 10)) : 100 } };
};

// Einsteiger-Stufe eines Tages: { einrollen } | { intensitaet } | null (vorbei, kein Haken)
function einsteigerStufe(plan, tag) {
  if (!plan.einsteiger) return null;
  const seit = tageZwischen(ausIso(plan.einsteigerAb ?? plan.angelegt ?? plan.start), tag);
  return seit < 0 ? null : EINSTEIGER_STUFEN.find(s => seit < s.bis) ?? null;
}

// Frühester Tag für einen Test: nach dem Start und nach dem Einrollen
function fruehesterTest(plan) {
  const aktiv = ausIso(plan.aktivAb ?? plan.angelegt ?? plan.start);
  if (!plan.einsteiger) return aktiv;
  const ende = plusTage(ausIso(plan.einsteigerAb ?? plan.angelegt ?? plan.start), EINSTEIGER_STUFEN[0].bis);
  return ende > aktiv ? ende : aktiv;
}
// Erster Plantag ab einem Datum
function ersterPlantagAb(plan, datum) {
  for (let i = 0; i < 14; i++) {
    const d = plusTage(datum, i);
    if (plan.tage.includes(wochentag(d))) return d;
  }
  return datum;
}
// Termin des Eingangstests eines ohne FTP angelegten Plans
export const ersterTestTag = plan => ersterPlantagAb(plan, fruehesterTest(plan));

// Plan anlegen. tage: Wochentag-Indizes (Mo = 0), dauer: 30/45/60,
// ftp: bekannte FTP oder 0 (dann beginnt der Plan mit dem Test)
export function planAnlegen({ tage, dauer = 45, ziel = 'fitness', einsteiger = false, ftp = 0, laenge = 8, heute = new Date() }) {
  const sortiert = [...new Set(tage)].sort((a, b) => a - b);
  // Kein Plantag mehr in dieser Woche: Woche 1 ist die nächste, sonst wäre der Plan eine Woche kürzer
  const mo = sortiert.some(t => t >= wochentag(heute)) ? montag(heute) : plusTage(montag(heute), 7);
  return {
    version: PLAN_VERSION,
    tage: sortiert,
    dauer, ziel, einsteiger,
    laenge,                               // Wochen (4/8/12) oder null = fortlaufend
    ftp,                                  // FTP beim Anlegen (0 = unbekannt)
    start: tagIso(mo),                    // Montag der Planwoche 1 (Pausen verschieben ihn)
    angelegt: tagIso(heute),
  };
}

// Planwoche (0 = erste) eines Datums — Pausen sind über plan.start herausgerechnet
export const planWoche = (plan, datum) => Math.floor(Math.round((montag(datum) - ausIso(plan.start)) / TAG_MS) / 7);
export const planEnde = plan => plan.laenge ? plusTage(ausIso(plan.start), plan.laenge * 7 - 1) : null;
export const istAbgeschlossen = (plan, heute) => !!plan.laenge && planWoche(plan, heute) >= plan.laenge;

// Die Einheit eines Tages oder null (Ruhetag, vor dem Start).
// ftpJetzt: aktuelle FTP aus den Einstellungen — solange sie fehlt, fährt
// der Plan nicht hart (Ziele wären nur geschätzt)
export function einheitAm(plan, datum, ftpJetzt = plan.ftp) {
  const tag = new Date(datum.getFullYear(), datum.getMonth(), datum.getDate());
  const iso = tagIso(tag);
  // Tage vor einer Änderung der Wochentage gelten mit den alten Tagen
  if (plan.frueher && iso <= plan.frueher.bis) { const { frueher, ...rest } = plan; plan = { ...rest, tage: frueher.tage }; }
  // vor dem Start bzw. vor dem Wiedereinstieg, während einer Pause, nach dem Ende: nichts
  if (tag < ausIso(plan.aktivAb ?? plan.angelegt ?? plan.start)) return null;
  if (plan.ruhe && iso >= plan.ruhe.von && iso <= plan.ruhe.bis) return null;
  if (plan.pause && tag >= ausIso(plan.pause.seit)) return null;
  const woche = planWoche(plan, tag);
  const wt = wochentag(tag);
  if (woche < 0 || !plan.tage.includes(wt)) return null;
  if (plan.laenge && woche >= plan.laenge) return null;
  const blockNr = Math.floor(woche / 4), blockWoche = woche % 4;
  const rolle = rollen(plan.tage, plan.ziel);
  let e;
  const ein = plan.einstieg;
  if (blockWoche === 3) {
    // Erholungswoche: letzte Einheit der Woche = Rampentest, sonst kurz und
    // locker. Ohne FTP gestartet: im ersten Block lag der Test schon am Anfang;
    // ein Wiedereinstieg ab 14 Tagen verlangt ihn immer
    const testNoetig = plan.ftp || blockNr > 0 || ein?.testWoche === woche;
    e = wt === testTag(plan) && testNoetig ? rampentest(plan, ftpJetzt)
      : rolle.get(wt) === 'R' ? einheit('R', plan, blockNr, 0)
      : { typ: 'E', programmId: 'ausdauer', opts: { dauer: klemme('ausdauer', Math.min(45, plan.dauer * 0.7)), intensitaet: 100, tempo: false } };
  } else {
    e = einheit(rolle.get(wt), plan, blockNr, blockWoche);
  }
  // FTP unbekannt: der Test kommt am ersten erreichbaren Plantag und danach jede
  // Woche wieder, bis eine FTP da ist; bis dahin nichts Hartes und kein Tempo.
  // Ein gefahrener Test bleibt an seinem Tag stehen, am Tag danach bleibt es locker.
  const gefahrenerTest = plan.ftpTestAm ?? (plan.ftp ? null : tagIso(ersterTestTag(plan)));
  const frueh = fruehesterTest(plan);
  if (iso === gefahrenerTest) e = rampentest(plan, ftpJetzt);
  else if (!ftpJetzt && tag >= frueh && wt === plan.tage.find(t => plusTage(montag(tag), t) >= frueh)) e = rampentest(plan, ftpJetzt);
  else if (gefahrenerTest && tageZwischen(ausIso(gefahrenerTest), tag) === 1 && TYPEN[e.typ].art === 'hart') e = grundlage(plan);
  if (!ftpJetzt && (TYPEN[e.typ].art === 'hart' || e.typ === 'Et')) e = grundlage(plan);
  // Einsteiger: erst nur locker und kürzer, dann harte Einheiten mit reduzierter
  // Intensität und ohne die Dauer-Zuschläge des Blocks
  const stufe = einsteigerStufe(plan, tag);
  if (stufe?.einrollen && e.typ !== 'R') {
    e = { typ: 'E', programmId: 'ausdauer', opts: { dauer: klemme('ausdauer', Math.min(45, plan.dauer) * 0.75), intensitaet: 100, tempo: false } };
  } else if (stufe && TYPEN[e.typ].art === 'hart') {
    e = { ...e, opts: { ...e.opts, intensitaet: stufe.intensitaet, dauer: Math.min(e.opts.dauer, klemme(e.programmId, plan.dauer)) } };
  }
  if (!ftpJetzt && (e.typ === 'E' || e.typ === 'L')) e = { ...e, opts: { ...e.opts, intensitaet: LOCKER_OHNE_FTP } };
  // Wiedereinstieg nach einer Pause: harte Einheiten sanfter, die erste locker
  if (ein && iso >= ein.ab && iso <= ein.bis && TYPEN[e.typ].art === 'hart') {
    const ersterPlantag = ersterPlantagAb(plan, ausIso(ein.ab));
    if (ein.lockerZuerst && tagIso(ersterPlantag) === iso) e = grundlage(plan);
    else e = { ...e, opts: { ...e.opts, intensitaet: Math.min(e.opts.intensitaet ?? 100, ein.intensitaet ?? 100) } };
  }
  return { ...e, ...TYPEN[e.typ], datum: tagIso(tag), woche, blockNr, blockWoche, ref: `plan:${tagIso(tag)}` };
}

// --- Pause und Wiedereinstieg ---
// Stufen nach Pausenlänge (Grund egal; docs/trainingsplan.md):
//   ≤ 6 Tage  nahtlos weiter an derselben Stelle im Block
//   7–13      unterbrochene Woche wiederholen, erste Einheit locker, harte mit 95 %
//   14–27     leichte Woche mit FTP-Test, danach neuer Block
//   ≥ 28      wie 14–27, der neue Block beginnt mit 95 %
const stufeNachTagen = tage => (tage <= 6 ? 0 : tage <= 13 ? 1 : tage < 28 ? 2 : 3);

// Plan so setzen, dass die Planwoche „ziel" jetzt läuft. Reicht die laufende
// Kalenderwoche nicht mehr (kein Plantag übrig, Testtag vorbei), beginnt der
// Einstieg am nächsten Montag — sonst fiele die sanfte Einheit oder der Test aus.
function setzeEinstieg(plan, { stufe, ziel, laenge, heuteT, pauseAb = null, neueWochen = false }) {
  const wt = wochentag(heuteT);
  const zuSpaet = stufe >= 2 ? testTag(plan) < wt : (stufe === 1 || neueWochen) && !plan.tage.some(t => t >= wt);
  const mo = zuSpaet ? plusTage(montag(heuteT), 7) : montag(heuteT);
  const ab = zuSpaet ? mo : heuteT;
  let einstieg = null;
  if (stufe === 1) {
    einstieg = { ab: tagIso(ab), bis: tagIso(plusTage(ersterPlantagAb(plan, ab), 6)), lockerZuerst: true, intensitaet: 95 };
  } else if (stufe >= 2) {
    einstieg = { ab: tagIso(plusTage(mo, 7)), bis: tagIso(plusTage(mo, 13)), intensitaet: stufe === 3 ? 95 : 100, testWoche: ziel };
  }
  const start = tagIso(plusTage(mo, -7 * ziel));
  const gleich = start === plan.start;
  const neu = { ...plan, start, laenge, pause: null, einstieg, anpassungen: gleich ? plan.anpassungen : undefined,
    // Gleiche Woche: gefahrene Tage bleiben sichtbar, nur die Pause fällt aus der Wertung
    aktivAb: gleich && stufe === 0 ? plan.aktivAb : tagIso(ab) };
  if (gleich && stufe === 0 && pauseAb && pauseAb < tagIso(heuteT)) {
    neu.ruhe = { von: plan.ruhe && plan.ruhe.von < pauseAb ? plan.ruhe.von : pauseAb, bis: tagIso(plusTage(heuteT, -1)) };
  } else delete neu.ruhe;
  for (const k of ['anpassungen', 'einstieg', 'aktivAb']) if (!neu[k]) delete neu[k];
  return { plan: neu, abMontag: zuSpaet };
}

export function wiedereinstieg(plan, pauseAb, heute = new Date()) {
  const ab = ausIso(pauseAb);
  const heuteT = nullUhr(heute);
  const tage = Math.max(0, tageZwischen(ab, heuteT));
  const unterbrochen = Math.min(Math.max(0, planWoche(plan, ab)), plan.laenge ? plan.laenge - 1 : Infinity);
  const stufe = stufeNachTagen(tage);
  let ziel = unterbrochen, laenge = plan.laenge, text = 'weiter wie geplant';
  if (stufe === 1) text = 'die unterbrochene Woche wird wiederholt, zum Einstieg locker';
  if (stufe >= 2) {
    ziel = Math.floor(unterbrochen / 4) * 4 + 3;
    // Der neue Block ist versprochen: Restlänge erhalten. Nur wer ohnehin kurz
    // vor dem Ende war (≤ 2 Wochen), schließt mit der leichten Woche ab
    if (plan.laenge) {
      const rest = plan.laenge - unterbrochen;
      laenge = ziel + 1 + (rest > 2 ? Math.ceil((rest - 1) / 4) * 4 : 0);
    }
    const blockFolgt = !laenge || laenge > ziel + 1;
    text = !blockFolgt ? 'leichte Woche mit FTP-Test zum Abschluss'
      : stufe === 3 ? 'Neubeginn: leichte Woche mit FTP-Test, danach ein sanfter Block'
      : 'leichte Woche mit FTP-Test, danach ein neuer Block';
  }
  const r = setzeEinstieg(plan, { stufe, ziel, laenge, heuteT, pauseAb });
  return { plan: r.plan, tage, text: r.abMontag ? `${text} (ab Montag)` : text };
}

// „Weitermachen" am Planende: immer die neuen Wochen ab jetzt. Der Einstieg
// richtet sich nach der Zeit seit der letzten Fahrt, nicht nach dem Planende.
export function verlaengern(plan, sessions, heute = new Date(), wochen = 4) {
  const heuteT = nullUhr(heute);
  const { seit } = tageOhneFahrt(plan, sessions, heute);
  const stufe = stufeNachTagen(Math.max(0, seit));
  const laenge = plan.laenge + wochen;
  // Ab 14 Tagen läuft zuerst die leichte Woche mit Test: die letzte des alten Plans
  const ziel = stufe >= 2 ? plan.laenge - 1 : plan.laenge;
  const text = stufe === 0 ? `${wochen} neue Wochen`
    : stufe === 1 ? `${wochen} neue Wochen, zum Einstieg locker`
    : `leichte Woche mit FTP-Test, danach ${wochen} neue Wochen`;
  const r = setzeEinstieg(plan, { stufe, ziel, laenge, heuteT, neueWochen: true });
  return { plan: r.plan, tage: seit, text: r.abMontag ? `${text} (ab Montag)` : text };
}
export const pausieren = (plan, heute = new Date()) => ({ ...plan, pause: { seit: tagIso(heute) } });

// Ein Trainingstag: Fahrt aus dem Plan oder ≥ 15 min (keine Probefahrten)
export const zaehltAlsTrainingstag = f => !!f.planRef || (f.dauer ?? 0) >= 900;

// Wie lange nicht gefahren? seit = volle Tage ohne Fahrt bis gestern,
// ab = erster Tag ohne Fahrt (Beginn einer gedachten Pause). Bezug ist die
// letzte Fahrt, frühestens der Start bzw. Wiedereinstieg des Plans.
export function tageOhneFahrt(plan, sessions, heute = new Date()) {
  let letzte = plusTage(ausIso(plan.aktivAb ?? plan.angelegt ?? plan.start), -1);
  for (const f of sessions) if (zaehltAlsTrainingstag(f) && f.start > letzte.getTime()) letzte = nullUhr(new Date(f.start));
  return { seit: tageZwischen(letzte, heute) - 1, ab: tagIso(plusTage(letzte, 1)) };
}

// Bilanz am Planende: Trainingstage (Fahrt aus dem Plan oder ≥ 15 min) vom
// Anlegen bis heute bzw. Planende — über Pausen und Wiedereinstiege hinweg —
// gegen die Einheiten, die der Plan wirklich ausgespielt hat: ab Start bzw.
// Wiedereinstieg bis zum Ende, ohne Ausgelassenes; davor zählt, was gefahren wurde.
export function planBilanz(plan, sessions, heute = new Date()) {
  const ende = planEnde(plan);
  const bis = tagIso(ende && ende < heute ? ende : heute);
  const tage = new Set(sessions
    .filter(zaehltAlsTrainingstag)
    .map(f => tagIso(new Date(f.start)))
    .filter(d => d >= (plan.angelegt ?? plan.start) && d <= bis));
  if (!ende) return { gefahren: tage.size, geplant: 0, geschafft: false };
  const aktiv = plan.aktivAb ?? plan.angelegt ?? plan.start;
  let geplant = [...tage].filter(d => d < aktiv).length;
  for (let mo = montag(ausIso(aktiv)); mo <= ende; mo = plusTage(mo, 7)) {
    for (const t of wocheMitAnpassungen(plan, mo)) {
      if (t.einheit && !t.ausgelassen && t.datum >= aktiv && t.datum <= tagIso(ende)) geplant++;
    }
  }
  return { gefahren: tage.size, geplant, geschafft: geplant > 0 && tage.size / geplant >= GESCHAFFT_AB };
}

// Sieben Tage ab dem Montag der Woche von datum
export function wocheAb(plan, datum, ftpJetzt = plan.ftp) {
  const mo = montag(datum);
  return WOCHENTAGE.map((kurz, i) => ({ kurz, datum: tagIso(plusTage(mo, i)), einheit: einheitAm(plan, plusTage(mo, i), ftpJetzt) }));
}

// Nächste Einheit ab (einschließlich) datum
export function naechsteEinheit(plan, datum, ftpJetzt = plan.ftp, tage = 14) {
  for (let i = 0; i < tage; i++) {
    const e = einheitAm(plan, plusTage(datum, i), ftpJetzt);
    if (e) return e;
  }
  return null;
}

// Erledigt: eine Fahrt aus dem Plan (planRef) oder irgendeine Fahrt
// ≥ 15 min an dem Tag — wer an einem Plantag anders fährt, hat trotzdem
// trainiert. Nur der FTP-Test braucht einen Test: sonst entsteht keine FTP.
export function erledigtDurch(einheit, sessions) {
  const amTag = s => tagIso(new Date(s.start)) === einheit.datum;
  if (einheit.typ === 'T') return sessions.find(s => s.programmId === 'rampentest' && zaehltFuerPlan(s) && (s.planRef === einheit.ref || amTag(s))) ?? null;
  return sessions.find(s => s.planRef === einheit.ref && zaehltFuerPlan(s))
    ?? sessions.find(s => amTag(s) && (s.dauer ?? 0) >= 900)
    ?? null;
}

// Zählt eine Fahrt für den Plan? ≥ 15 min; der FTP-Test ab 8 min (er endet
// gewollt an der Erschöpfung, die Rampe beginnt aber erst nach dem Einrollen).
// Ein Abbruch nach 2 min ist nicht „gefahren".
export const zaehltFuerPlan = s => (s.dauer ?? 0) >= (s.programmId === 'rampentest' ? TEST_SCHWELLE_S : 900);

// Plan-Info, die mit der Fahrt gespeichert wird — bleibt lesbar, auch wenn
// der Plan später geändert oder beendet wird. ersatz: frei oder mit einem
// anderen Programm gefahren, gilt aber für die Einheit des Tages.
export function planInfo(plan, e, { ersatz = false } = {}) {
  return {
    ref: e.ref, plan: plan.angelegt, woche: e.woche + 1, laenge: plan.laenge ?? null,
    typ: e.typ, name: e.name, art: e.art,
    ...(e.variante ? { variante: e.variante } : {}),
    ...(ersatz ? { ersatz: true, statt: titel(e) } : {}),
  };
}
// „Trainingsplan · Woche 3 von 8 · Intervalle" (+ „· statt Grundlage · 45 min")
export function planBeschreibung(info) {
  if (!info) return '';
  const woche = `Woche ${info.woche}${info.laenge ? ` von ${info.laenge}` : ''}`;
  const art = info.ersatz ? `statt ${info.statt}` : `${info.name}${info.variante ? ` (${info.variante})` : ''}`;
  return `Trainingsplan · ${woche} · ${art}`;
}

// --- Verpasste Einheiten verschieben ---
// Harte Einheiten und der FTP-Test wandern auf den nächsten Plantag derselben
// Woche und verdrängen dort eine lockere Einheit — nur wenn die 48-h-Regel
// hält, sonst auf den übernächsten. Lockere Einheiten entfallen (nichts wird
// nachgeholt), kein Übertrag in die nächste Woche, nie zwei an einem Tag.
const PRIO = { T: 4, H1: 3, H2: 2, H3: 1 };
export const istHart = e => !!e && (TYPEN[e.typ].art === 'hart' || e.typ === 'T');
const prio = e => (e && PRIO[e.typ]) || 0;

// Woche wie sie wirklich läuft: je Tag { kurz, datum, einheit, status, hinweis }
// status: frei | geplant | erledigt | verpasst; einheit.verschobenVon = Ursprungstag
export function wocheWirksam(plan, datum, sessions, heute = new Date(), ftpJetzt = plan.ftp) {
  const mo = montag(datum);
  const heuteIso = tagIso(heute);
  const tage = wocheMitAnpassungen(plan, mo, ftpJetzt).map(t => ({ ...t, status: 'frei', hinweis: '' }));
  // harte Einheiten der Nachbarwochen (Plan) für den Abstand über die Wochengrenze
  const aktiv = t => (t.ausgelassen ? null : t.einheit);
  const vor = wocheMitAnpassungen(plan, plusTage(mo, -7), ftpJetzt).map(aktiv);
  const nach = wocheMitAnpassungen(plan, plusTage(mo, 7), ftpJetzt).map(aktiv);
  const letzteVorher = vor.findLastIndex(istHart);
  const ersteNachher = nach.findIndex(istHart);
  // Harte Fahrt außerhalb des Plans (≥ 15 min) zählt als Belastung: IF ≥ 0,85,
  // ≥ 15 min ab Zone 4 (Schwelle) oder ≥ 8 min in Zone 5/6 — Intervalle mit
  // langen Pausen haben eine niedrige IF und wären sonst „locker"
  const z = (f, ab) => (f.zonenSek ?? []).slice(ab).reduce((a, x) => a + x, 0);
  const hartGefahren = datum => sessions.some(f => tagIso(new Date(f.start)) === datum && (f.dauer ?? 0) >= 900
    && ((f.np && f.np / effektiveFtp(f.ftp || ftpJetzt) >= 0.85) || z(f, 3) >= 900 || z(f, 4) >= 480));
  const abstandOk = i => {
    let davor = letzteVorher === -1 ? -99 : letzteVorher - 7;
    for (let j = 0; j < i; j++)
      if ((istHart(tage[j].einheit) && tage[j].status !== 'verpasst' && !tage[j].ausgelassen) || tage[j].fremdHart) davor = j;
    let danach = ersteNachher === -1 ? 99 : ersteNachher + 7;
    for (let j = 6; j > i; j--) if (istHart(tage[j].einheit) && !tage[j].ausgelassen) danach = j;
    return i - davor >= 2 && danach - i >= 2;
  };
  let offen = null;                                  // { einheit, von } sucht einen Platz
  // Vergangene Tage bleiben, wie sie waren: Verschobenes landet dort nur, wenn
  // die Fahrt dieses Tages genau diese Einheit war — eine spätere Änderung darf
  // eine lockere Fahrt nicht rückwirkend zu „Intervalle ✓" machen
  const darfHierher = (t, e) => t.datum >= heuteIso || sessions.some(s => s.planRef === `plan:${t.datum}` && s.plan?.typ === e.typ);
  for (let i = 0; i < 7; i++) {
    const t = tage[i];
    if (t.verlegtNach) { t.status = 'verpasst'; t.hinweis = `verschoben auf ${t.verlegtNach}`; continue; }
    // eigene Änderungen haben Vorrang: kein Überschreiben manuell gesetzter, geänderter oder
    // ausgelassener Tage. Harte Einheiten verdrängen nur lockere, der Test auch harte.
    if (offen && t.einheit && !t.einheit.manuell && !t.einheit.variante && !t.ausgelassen
      && prio(offen.einheit) > prio(t.einheit) && (!prio(t.einheit) || offen.einheit.typ === 'T')
      && darfHierher(t, offen.einheit) && abstandOk(i)) {
      t.einheit = { ...offen.einheit, datum: t.datum, ref: `plan:${t.datum}`, verschobenVon: offen.einheit.verschobenVon ?? tage[offen.von].datum };
      tage[offen.von].hinweis = `verschoben auf ${t.kurz}`;
      offen = null;
    }
    if (t.datum <= heuteIso && hartGefahren(t.datum) && !istHart(t.einheit)) {
      t.fremdHart = true;
      // eine verpasste harte Einheit gilt durch diese Fahrt als ersetzt
      if (offen) { tage[offen.von].hinweis = `ersetzt durch die Fahrt am ${t.kurz}`; offen = null; }
    }
    if (!t.einheit) continue;
    if (t.ausgelassen) { t.status = 'ausgelassen'; t.hinweis = 'ausgelassen'; continue; }   // wird nie verlegt
    if (erledigtDurch(t.einheit, sessions)) t.status = 'erledigt';
    else if (t.datum < heuteIso) {
      t.status = 'verpasst';
      // Es sucht immer nur eine Einheit einen Platz: die wichtigere, bei
      // gleichem Rang die jüngere; die andere verfällt
      if (prio(t.einheit) && (!offen || prio(t.einheit) >= prio(offen.einheit))) {
        if (offen) tage[offen.von].hinweis = 'entfällt';
        offen = { einheit: t.einheit, von: i };
      } else t.hinweis = 'entfällt';
    } else t.status = 'geplant';
  }
  if (offen) tage[offen.von].hinweis = 'entfällt';
  return tage;
}

// --- Eigene Änderungen ---
// plan.anpassungen[Montag 'JJJJ-MM-TT'] = Liste in Reihenfolge:
//   { art: 'verschieben', von, nach } (belegter Zieltag = Tausch)
//   { art: 'fest', von, nach } (automatische Verschiebung festgeschrieben)
//   { art: 'auslassen' | 'kuerzer' | 'leichter', datum }
// Sie gelten nur für ihre Woche und werden nach dem Erzeugen angewendet —
// der Generator bleibt unverändert. Anpassungen erzeugen immer eine neue
// Plan-Kopie — Rückgängig schreibt einfach die alte zurück.
const umdatieren = (e, datum, von) => {
  const herkunft = e.verschobenVon ?? von;
  const neu = { ...e, datum, ref: `plan:${datum}`, manuell: true, verschobenVon: herkunft };
  if (herkunft === datum) delete neu.verschobenVon;
  return neu;
};
// Kürzer: eine Stufe (15 min) weniger, nicht unter die Untergrenze des Programms
export function kuerzerDauer(e) {
  const d = programm(e.programmId).optionen.dauer;
  if (!d || e.typ === 'T') return null;
  const neu = Math.max(d.min, Math.round((e.opts.dauer - 15) / 5) * 5);
  return neu < e.opts.dauer ? neu : null;
}
export function wocheMitAnpassungen(plan, datum, ftpJetzt = plan.ftp) {
  const tage = wocheAb(plan, datum, ftpJetzt);
  for (const op of plan.anpassungen?.[tagIso(montag(datum))] ?? []) {
    const i = tage.findIndex(t => t.datum === (op.von ?? op.datum));
    if (i < 0 || !tage[i].einheit) continue;
    const e = tage[i].einheit;
    if (op.art === 'fest') {
      const j = tage.findIndex(t => t.datum === op.nach);
      if (j < 0 || j === i) continue;
      tage[j] = { ...tage[j], einheit: umdatieren(e, tage[j].datum, tage[i].datum), ausgelassen: false };
      tage[i] = { ...tage[i], verlegtNach: tage[j].kurz };
    } else if (op.art === 'verschieben') {
      const j = tage.findIndex(t => t.datum === op.nach);
      if (j < 0 || j === i) continue;
      // Ein ausgelassener Zieltag gilt als frei: seine Einheit kommt nicht zurück
      const b = tage[j].ausgelassen ? null : tage[j].einheit;
      tage[j] = { ...tage[j], einheit: umdatieren(e, tage[j].datum, tage[i].datum), ausgelassen: tage[i].ausgelassen };
      tage[i] = { ...tage[i], einheit: b ? umdatieren(b, tage[i].datum, tage[j].datum) : null, ausgelassen: false };
    } else if (op.art === 'auslassen') tage[i] = { ...tage[i], ausgelassen: true };
    else if (op.art === 'kuerzer' && kuerzerDauer(e))
      tage[i] = { ...tage[i], einheit: { ...e, opts: { ...e.opts, dauer: kuerzerDauer(e) }, variante: 'kürzer' } };
    else if (op.art === 'leichter' && istHart(e) && e.typ !== 'T')
      tage[i] = { ...tage[i], einheit: { ...e, ...TYPEN.E, typ: 'E', programmId: 'ausdauer',
        opts: { dauer: klemme('ausdauer', e.opts.dauer), intensitaet: 100, tempo: false }, variante: 'leichter', statt: titel(e) } };
  }
  return tage;
}

// Wohin darf die Einheit von Tag „von" verschoben werden? Ziele: heute bis
// Sonntag derselben Woche (nie zurück, nie in eine andere Woche); belegter
// Tag = Tausch. Gesperrt, wenn danach zwei harte Einheiten (auch der Test)
// keinen Tag Abstand hätten — mit Grund.
export function verschiebeZiele(plan, von, sessions, heute = new Date(), ftpJetzt = plan.ftp) {
  const mo = montag(ausIso(von)), heuteIso = tagIso(heute);
  const basis = festschreiben(plan, mo, sessions, heute, ftpJetzt);
  const vorher = wocheWirksam(basis, mo, sessions, heute, ftpJetzt);
  // Heute schon gefahren: die Fahrt erledigte die hergelegte Einheit sofort
  const heuteGefahren = sessions.some(f => tagIso(new Date(f.start)) === heuteIso && zaehltAlsTrainingstag(f));
  return vorher.filter(t => t.datum >= heuteIso && t.datum !== von && t.status !== 'erledigt' && !(t.datum === heuteIso && heuteGefahren)).map(t => {
    const probe = mitAnpassung(basis, mo, { art: 'verschieben', von, nach: t.datum });
    const nachher = wocheWirksam(probe, mo, sessions, heute, ftpJetzt);
    const konflikt = harterKonflikt(probe, nachher, [t.datum, von], ftpJetzt, sessions, heute);
    const tausch = t.einheit && !t.ausgelassen ? titel(t.einheit) : null;
    return { datum: t.datum, kurz: t.kurz, zustand: konflikt ? 'gesperrt' : tausch ? 'tausch' : 'frei',
      grund: konflikt ? `zu nah an ${konflikt}` : '', tauschMit: tausch };
  });
}

// Anpassung anhängen (neue Plan-Kopie); alte Wochen (> 8 Wochen) fallen weg
export function mitAnpassung(plan, datum, op) {
  const woche = tagIso(montag(datum));
  const grenze = tagIso(plusTage(montag(datum), -56));
  const alle = Object.fromEntries(Object.entries(plan.anpassungen ?? {}).filter(([k]) => k >= grenze));
  return { ...plan, anpassungen: { ...alle, [woche]: [...(alle[woche] ?? []), op] } };
}
// Automatische Verschiebungen der Woche festschreiben, bevor eine eigene Änderung
// dazukommt: die Änderung meint die Einheit, die auf der Karte steht, nicht die
// ursprünglich erzeugte — und die Verschiebung darf sich danach nicht mehr ändern
export function festschreiben(plan, datum, sessions, heute = new Date(), ftpJetzt = plan.ftp) {
  return wocheWirksam(plan, datum, sessions, heute, ftpJetzt)
    .filter(t => t.einheit?.verschobenVon && !t.einheit.manuell)
    .reduce((p, t) => mitAnpassung(p, datum, { art: 'fest', von: t.einheit.verschobenVon, nach: t.datum }), plan);
}
export const mitAnpassungWirksam = (plan, datum, op, sessions, heute = new Date(), ftpJetzt = plan.ftp) =>
  mitAnpassung(festschreiben(plan, datum, sessions, heute, ftpJetzt), datum, op);

// Einstellungen eines laufenden Plans ändern: Start und Stand bleiben. Der neu
// gesetzte Einsteiger-Haken beginnt heute; neue Wochentage gelten ab heute, ältere
// Tage bleiben mit den alten bewertet, Änderungen der laufenden Woche entfallen.
export function planAendern(alt, wahl, heute = new Date()) {
  const neu = { ...alt, ...planAnlegen({ ...wahl, ftp: alt.ftp, heute }), start: alt.start, angelegt: alt.angelegt, ftp: alt.ftp };
  if (wahl.einsteiger && !alt.einsteiger) neu.einsteigerAb = tagIso(heute);
  if (!wahl.einsteiger) delete neu.einsteigerAb;
  if (neu.tage.join() !== alt.tage.join()) {
    neu.frueher = { bis: tagIso(plusTage(heute, -1)), tage: alt.tage };
    const woche = tagIso(montag(heute));
    if (alt.anpassungen) neu.anpassungen = Object.fromEntries(Object.entries(alt.anpassungen).filter(([k]) => k < woche));
  }
  return neu;
}

// Was der Einsteiger-Haken bzw. die fehlende FTP bewirkt — ein Satz für den Dialog
export function einstiegsHinweis(plan, ftpJetzt) {
  const teile = [];
  if (plan.einsteiger) {
    const wochen = s => Math.round(s.bis / 7);
    const [a, b, c] = EINSTEIGER_STUFEN;
    teile.push(`Einstieg: ${wochen(a)} Wochen nur locker und kürzer, dann harte Einheiten mit ${b.intensitaet} %, ab Woche ${wochen(b) + 1} mit ${c.intensitaet} %, ab Woche ${wochen(c) + 1} wie geplant.`);
  }
  if (!ftpJetzt) teile.push(`Ohne FTP: Rampentest am ${WOCHENTAGE[wochentag(ersterTestTag(plan))]}, ${ersterTestTag(plan).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}, und jede Woche wieder, bis eine FTP da ist.`);
  return teile.join(' ');
}

export function ohneAnpassungen(plan, datum) {
  const anpassungen = { ...plan.anpassungen };
  delete anpassungen[tagIso(montag(datum))];
  return { ...plan, anpassungen };
}
export const hatAnpassungen = (plan, datum) => !!plan.anpassungen?.[tagIso(montag(datum))]?.length;

// Hätte eine harte Einheit an einem der Tage keinen Tag Abstand zur nächsten
// aktiven harten Einheit (auch Nachbarwochen)? Liefert „Titel am Tag" oder null
function harterKonflikt(plan, tage, pruefDaten, ftpJetzt, sessions, heute) {
  const mo = ausIso(tage[0].datum);
  const nah = [
    // Vorwoche mit tatsächlichem Stand: verpasst ist keine Belastung
    ...wocheWirksam(plan, plusTage(mo, -7), sessions, heute, ftpJetzt).map((t, k) => ({ ...t, idx: k - 7 })),
    ...tage.map((t, k) => ({ ...t, idx: k })),
    ...wocheMitAnpassungen(plan, plusTage(mo, 7), ftpJetzt).map((t, k) => ({ ...t, idx: k + 7 })),
  ].filter(t => (istHart(t.einheit) && !t.ausgelassen && t.status !== 'verpasst') || t.fremdHart);
  for (const d of pruefDaten) {
    const hier = nah.find(t => t.datum === d);
    if (!hier) continue;
    const anderer = nah.find(t => t !== hier && Math.abs(t.idx - hier.idx) < 2);
    if (anderer) return `${anderer.fremdHart || !anderer.einheit ? 'der harten Fahrt' : titel(anderer.einheit).split(' · ')[0]} am ${WOCHENTAGE[(anderer.idx + 7) % 7]}`;
  }
  return null;
}

// Wochenstunden (geplant) für die Vorschau beim Anlegen
export function wochenMinuten(plan, datum, ftpJetzt = plan.ftp) {
  return wocheAb(plan, datum, ftpJetzt).reduce((a, t) => a + (t.einheit?.opts.dauer ?? (t.einheit ? 25 : 0)), 0);
}

// Kurzbezeichnung, z. B. „VO2max 4×4 · 45 min"
export function titel(e) {
  const p = programm(e.programmId);
  const name = TYPEN[e.typ].art === 'locker' ? TYPEN[e.typ].name : p.name;
  return e.typ === 'T' ? p.name : `${name} · ${e.opts.dauer} min`;
}
export const programmFuer = e => programm(e.programmId);
