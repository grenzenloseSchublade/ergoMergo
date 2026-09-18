// Zeitbasierter Workout-Generator: Dauer + Typ wählen, die App baut ein
// strukturiertes Programm mit Warmup, skaliertem Hauptteil und Cooldown.
//
// Prinzip (nach TrainerRoad/Zwift-Konvention): Die Intensitäten je Typ sind
// fix (%FTP), die Gesamtzeit wird ausschließlich über die Anzahl der
// Wiederholungen bzw. Sätze und einen Z2-Füller skaliert. Work-Intervalle
// unter 30 s gibt es nicht — im ERG-Modus braucht der Trainer 2–6 s bis zum
// Sollwert, kürzere Intervalle wären überwiegend Rampe (deshalb kein Tabata
// und keine 10-s-Sprints; 30/30 und 40/20 sind die ERG-taugliche Untergrenze).
// Strukturen und Quellen: docs/programme.md

const EFF_FTP_DEFAULT = 170;   // Annahme für Freizeitfahrer ohne FTP-Wert (~2 W/kg)

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const block = (sekunden, watt) => ({ dauer: Math.round(sekunden), watt: Math.max(30, Math.round(watt / 5) * 5) });

// Wiederholte Abschnitte fürs Profil markieren: alle Blöcke einer Gruppe
// bekommen dieselbe ID + Label („4×") — drawProfile zeichnet die Klammer.
let gruppenZaehler = 0;
function markiere(blocks, label) {
  const gruppe = `g${++gruppenZaehler}`;
  for (const b of blocks) { b.gruppe = gruppe; b.gruppeLabel = label; }
  return blocks;
}

// Rampe als Stufenfolge (ERG kennt keine echten Rampen — 3 Stufen reichen)
function rampe(min, vonPct, bisPct, f, stufen = 3) {
  const out = [];
  for (let i = 0; i < stufen; i++) {
    const p = vonPct + (bisPct - vonPct) * (stufen === 1 ? 0 : i / (stufen - 1));
    out.push(block(min * 60 / stufen, p * f));
  }
  return out;
}

// Warmup 15 % der Zeit (6–15 min), Cooldown 10 % (4–10 min), Rest = Hauptteil
function rahmen(T) {
  const wu = clamp(Math.round(0.15 * T), 6, 15);
  const cd = clamp(Math.round(0.10 * T), 4, 10);
  return { wu, cd, main: T - wu - cd };
}

// Rundung von Warmup/Cooldown kann den Hauptteil minimal überziehen —
// negative Restzeit fällt hier still auf null zurück.
function fueller(minuten, f) {
  return minuten >= 1 ? [block(minuten * 60, 0.65 * f)] : [];
}

export const WORKOUTS = [
  {
    id: 'sprint3030',
    name: 'Sprint 30/30',
    sub: 'Billat-Intervalle: 30 s hart / 30 s locker in Sätzen',
    optionen: {
      dauer: { label: 'Dauer (min)', min: 30, max: 75, default: 40 },
      intensitaet: { label: 'Intensität (%)', min: 70, max: 120, default: 100 },
    },
    // Satz = 8 × (30 s @ 118 % / 30 s @ 50 %) = 8 min, dazwischen 4 min Satzpause
    generieren(o, ftp) {
      const f = eff(ftp, o);
      const { wu, cd, main } = rahmen(o.dauer);
      const saetze = clamp(Math.floor((main + 4) / 12), 2, 4);
      const blocks = rampe(wu, 0.45, 0.72, f);
      for (let s = 0; s < saetze; s++) {
        if (s > 0) blocks.push(block(4 * 60, 0.5 * f));
        const satz = [];
        for (let r = 0; r < 8; r++) satz.push(block(30, 1.18 * f), block(30, 0.5 * f));
        blocks.push(...markiere(satz, '8×'));
      }
      blocks.push(...fueller(main - saetze * 8 - (saetze - 1) * 4, f));
      blocks.push(...rampe(cd, 0.6, 0.4, f, 2));
      return blocks;
    },
  },
  {
    id: 'hiit4020',
    name: 'HIIT 40/20',
    sub: '40 s hart / 20 s locker, 2:1-Verhältnis',
    optionen: {
      dauer: { label: 'Dauer (min)', min: 35, max: 75, default: 45 },
      intensitaet: { label: 'Intensität (%)', min: 70, max: 120, default: 100 },
    },
    // Satz = 8 × (40 s @ 120 % / 20 s @ 45 %) = 8 min, 5 min Satzpause
    generieren(o, ftp) {
      const f = eff(ftp, o);
      const { wu, cd, main } = rahmen(o.dauer);
      const saetze = clamp(Math.floor((main + 5) / 13), 2, 4);
      const blocks = rampe(wu, 0.45, 0.72, f);
      for (let s = 0; s < saetze; s++) {
        if (s > 0) blocks.push(block(5 * 60, 0.5 * f));
        const satz = [];
        for (let r = 0; r < 8; r++) satz.push(block(40, 1.2 * f), block(20, 0.45 * f));
        blocks.push(...markiere(satz, '8×'));
      }
      blocks.push(...fueller(main - saetze * 8 - (saetze - 1) * 5, f));
      blocks.push(...rampe(cd, 0.6, 0.4, f, 2));
      return blocks;
    },
  },
  {
    id: 'vo2max',
    name: 'VO2max 4×4',
    sub: 'Norwegische Intervalle: 4 min hart / 3 min locker',
    optionen: {
      dauer: { label: 'Dauer (min)', min: 35, max: 75, default: 45 },
      intensitaet: { label: 'Intensität (%)', min: 70, max: 120, default: 100 },
    },
    // N = (main + 3) / 7 Wiederholungen à 4 min @ 110 % + 3 min @ 55 %
    generieren(o, ftp) {
      const f = eff(ftp, o);
      const { wu, cd, main } = rahmen(o.dauer);
      const n = clamp(Math.floor((main + 3) / 7), 3, 6);
      const blocks = rampe(wu, 0.45, 0.72, f);
      const serie = [];
      for (let r = 0; r < n; r++) {
        if (r > 0) serie.push(block(3 * 60, 0.55 * f));
        serie.push(block(4 * 60, 1.1 * f));
      }
      blocks.push(...markiere(serie, `${n}×`));
      blocks.push(...fueller(main - n * 4 - (n - 1) * 3, f));
      blocks.push(...rampe(cd, 0.6, 0.4, f, 2));
      return blocks;
    },
  },
  {
    id: 'schwelle',
    name: 'Schwelle / Sweet Spot',
    sub: 'Lange Blöcke bei 90 % FTP',
    optionen: {
      dauer: { label: 'Dauer (min)', min: 40, max: 90, default: 60 },
      intensitaet: { label: 'Intensität (%)', min: 70, max: 120, default: 100 },
    },
    // Blöcke 10–20 min @ 90 %, Pause = Blocklänge/4 @ 50 % (W:R ≈ 4:1)
    generieren(o, ftp) {
      const f = eff(ftp, o);
      const { wu, cd, main } = rahmen(o.dauer);
      let blockLen = clamp(Math.round(main / 3), 10, 20);
      let pause = Math.round(blockLen / 4);
      let n = Math.max(2, Math.floor((main + pause) / (blockLen + pause)));
      // Bliebe viel Rest übrig, lieber ein Block mehr mit kürzerer Länge
      const alt = Math.floor((main - n * pause) / (n + 1));
      if (alt >= 10) { n += 1; blockLen = Math.min(20, alt); pause = Math.round(blockLen / 4); }
      const blocks = rampe(wu, 0.45, 0.72, f);
      const serie = [];
      for (let r = 0; r < n; r++) {
        if (r > 0) serie.push(block(pause * 60, 0.5 * f));
        serie.push(block(blockLen * 60, 0.9 * f));
      }
      blocks.push(...markiere(serie, `${n}×`));
      blocks.push(...fueller(main - n * blockLen - (n - 1) * pause, f));
      blocks.push(...rampe(cd, 0.6, 0.4, f, 2));
      return blocks;
    },
  },
  {
    id: 'ausdauer',
    name: 'Ausdauer',
    sub: 'Zone 2 mit Tempo-Blöcken',
    optionen: {
      dauer: { label: 'Dauer (min)', min: 20, max: 90, default: 45 },
      intensitaet: { label: 'Intensität (%)', min: 70, max: 120, default: 100 },
    },
    // Z2-Basis @ 67 %, ab 24 min Hauptteil: 8-min-Tempo-Blöcke @ 80 % mit 4 min Z2
    generieren(o, ftp) {
      const f = eff(ftp, o);
      const { wu, cd, main } = rahmen(o.dauer);
      const blocks = rampe(wu, 0.45, 0.65, f);
      if (main >= 24) {
        const n = Math.min(4, Math.floor(main / 12));
        const serie = [];
        for (let r = 0; r < n; r++) {
          serie.push(block(8 * 60, 0.8 * f), block(4 * 60, 0.65 * f));
        }
        blocks.push(...(n > 1 ? markiere(serie, `${n}×`) : serie));
        blocks.push(...fueller(main - n * 12, f));
      } else {
        blocks.push(block(main * 60, 0.68 * f));
      }
      blocks.push(...rampe(cd, 0.6, 0.4, f, 2));
      return blocks;
    },
  },
  {
    id: 'recovery',
    name: 'Recovery',
    sub: 'Locker rollen, max. 55 % FTP',
    optionen: {
      dauer: { label: 'Dauer (min)', min: 15, max: 60, default: 30 },
      intensitaet: { label: 'Intensität (%)', min: 70, max: 110, default: 100 },
    },
    generieren(o, ftp) {
      const f = eff(ftp, o);
      return [
        block(2 * 60, 0.4 * f),
        block((o.dauer - 4) * 60, 0.48 * f),
        block(2 * 60, 0.4 * f),
      ];
    },
  },
];

function eff(ftp, o) {
  return (ftp || EFF_FTP_DEFAULT) * (o.intensitaet ?? 100) / 100;
}

export { EFF_FTP_DEFAULT };
