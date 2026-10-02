// Programm-Engine. Programme sind Daten: Schritte mit Minuten und Watt,
// Watt absolut (Zahl) oder relativ zur FTP ("55%"). Wiederholungsblöcke
// über { wdh, block }. Die Engine expandiert das vor dem Start zu einer
// flachen Blockliste und steuert das Session-Ziel pro Sekunde.

export const PROGRAMME = [
  {
    id: 'rampentest',
    name: 'FTP-Rampentest',
    sub: '+20 W/min bis zur Erschöpfung — einfach Beenden drücken',
    optionen: { start: { label: 'Startwatt', min: 50, max: 200, default: 100 } },
    // Standardprotokoll (TrainerRoad/Zwift): kurze Einrollphase, dann +20 W
    // je Minute. Testende = Beenden-Taste; FTP = 0,75 × beste 60-s-Leistung.
    // Hinweis: die Watt-Obergrenze in den Einstellungen muss hoch genug sein.
    bauen: o => [
      { min: 5, watt: Math.round(o.start * 0.7 / 5) * 5 },
      ...Array.from({ length: 40 }, (_, i) => ({ min: 1, watt: o.start + i * 20 })),
    ],
  },
  {
    id: 'grundlage',
    name: 'Grundlage',
    sub: 'Konstante Last, Dauer wählbar',
    optionen: { dauer: { label: 'Dauer (min)', min: 20, max: 90, default: 45 },
                watt: { label: 'Watt', min: 60, max: 300, default: 130 } },
    bauen: o => [{ min: o.dauer, watt: o.watt }],
  },
  {
    id: 'intervalle44',
    name: '4×4 Intervalle',
    sub: '8 min ein · 4× (4 hart / 3 locker) · 5 min aus',
    optionen: { wdh: { label: 'Wiederholungen', min: 2, max: 8, default: 4 },
                hart: { label: 'Watt hart', min: 100, max: 400, default: 210 },
                locker: { label: 'Watt locker', min: 50, max: 200, default: 90 } },
    bauen: o => [
      { min: 8, watt: Math.round(o.locker * 1.2) },
      { wdh: o.wdh, block: [{ min: 4, watt: o.hart }, { min: 3, watt: o.locker }] },
      { min: 5, watt: o.locker },
    ],
  },
  {
    id: 'pyramide',
    name: 'Pyramide',
    sub: '1-2-3-4-3-2-1 min, dazwischen locker',
    optionen: { spitze: { label: 'Watt Spitze', min: 100, max: 400, default: 200 },
                locker: { label: 'Watt locker', min: 50, max: 200, default: 90 } },
    bauen: o => {
      const stufen = [1, 2, 3, 4, 3, 2, 1];
      const blocks = [{ min: 6, watt: Math.round(o.locker * 1.2) }];
      for (const [i, m] of stufen.entries()) {
        blocks.push({ min: m, watt: o.spitze });
        if (i < stufen.length - 1) blocks.push({ min: 2, watt: o.locker });
      }
      blocks.push({ min: 5, watt: o.locker });
      return blocks;
    },
  },
  {
    id: 'fartlek',
    name: 'Fartlek',
    sub: 'Zufällige Blöcke in gesetzten Grenzen',
    // Zufall über gespeicherten Startwert: Kachel, Vorschau und Fahrt zeigen
    // denselben Ablauf; neu gewürfelt wird nur per Button im Startdialog
    zufall: true,
    optionen: { dauer: { label: 'Dauer (min)', min: 20, max: 90, default: 40 },
                von: { label: 'Untergrenze (W)', min: 50, max: 300, default: 100 },
                bis: { label: 'Obergrenze (W)', min: 80, max: 400, default: 220 } },
    bauen: (o, rng) => {
      // Vertauschte Grenzen (Untergrenze > Obergrenze) nicht auf den Kopf stellen
      const lo = Math.min(o.von, o.bis), hi = Math.max(o.von, o.bis);
      const blocks = [{ min: 5, watt: lo }];
      let rest = o.dauer - 10;
      while (rest > 0) {
        const m = Math.min(rest, 1 + Math.floor(rng() * 4));
        blocks.push({ min: m, watt: lo + Math.round(rng() * (hi - lo) / 10) * 10 });
        rest -= m;
      }
      blocks.push({ min: 5, watt: lo });
      return blocks;
    },
  },
];

// Schrittliste → flache Blockliste [{dauer, watt}] in Sekunden.
let gruppenZaehler = 0;

export function expand(schritte) {
  const out = [];
  for (const s of schritte) {
    if (s.wdh) {
      // Wiederholung fürs Intensitätsprofil markieren (Klammer „n×")
      const gruppe = `p${++gruppenZaehler}`;
      for (let i = 0; i < s.wdh; i++) {
        for (const b of expand(s.block)) {
          b.gruppe ??= gruppe;
          b.gruppeLabel ??= `${s.wdh}×`;
          out.push(b);
        }
      }
    } else {
      out.push({ dauer: Math.round(s.min * 60), watt: s.watt });
    }
  }
  return out;
}

export class ProgramRun extends EventTarget {
  constructor(session, blocks) {
    super();
    this.session = session;
    this.blocks = blocks;
    this.total = blocks.reduce((a, b) => a + b.dauer, 0);
    this.offset = 0;                       // ± verschiebt den gesamten Ablauf (Watt)
    this.zeitOffset = 0;                   // Skip/Verlängern/Zurück verschiebt die Programmuhr
    // Offset-Historie: [{ab (Aufzeichnungssekunde), offset}] — damit der Graph
    // jeden Samplepunkt an seiner DAMALIGEN Programmzeit zeichnen kann
    this.offsetLog = [{ ab: 0, offset: 0 }];
    // Not-Stopp-Pausen: [{von, bis, frozen}] in Aufzeichnungssekunden —
    // die Programmuhr steht währenddessen bei `frozen`
    this.pauseLog = [];
    this.index = -1;
    session.addEventListener('tick', () => this.#tick());
    this.#tick();
  }

  // Aufzeichnungszeit → Programmzeit (stückweise konstante Offsets).
  // Samples in einer Not-Stopp-Pause liegen an der eingefrorenen Stelle.
  programmZeit(sampleT) {
    for (const p of this.pauseLog) {
      if (sampleT >= p.von && (p.bis === null || sampleT < p.bis)) return p.frozen;
    }
    let offset = 0;
    for (const e of this.offsetLog) {
      if (e.ab > sampleT) break;
      offset = e.offset;
    }
    return Math.max(0, sampleT + offset);
  }

  // Lag das Sample in einer Not-Stopp-Pause? (Chart lässt dort eine Lücke)
  istPause(sampleT) {
    return this.pauseLog.some(p => sampleT > p.von && (p.bis === null || sampleT < p.bis));
  }

  // Offene Not-Stopp-Pause abschließen und die Uhr um die Pausendauer
  // zurücksetzen — auch Skip/Zurück/Verlängern während des Stopps brauchen
  // erst eine korrekte Programmzeit
  #schliessePause() {
    const offen = this.pauseLog.at(-1);
    if (!offen || offen.bis !== null) return;
    const el = this.session.elapsed;
    offen.bis = el;
    this.zeitOffset -= el - offen.von;
    this.offsetLog.push({ ab: el, offset: this.zeitOffset });
    this.dispatchEvent(new Event('zeitsprung'));
  }

  #setzeZeitOffset(neu) {
    this.zeitOffset = neu;
    this.offsetLog.push({ ab: this.session.elapsed, offset: neu });
    this.dispatchEvent(new Event('zeitsprung'));
    this.#tick();
  }

  // Programm durchlaufen, ab jetzt wird ausgefahren
  get vorbei() { return this.index === -2; }

  // Laufender Block (vor dem ersten Tick der erste), nach Programmende null
  get aktuellerBlock() {
    return this.vorbei ? null : this.blocks[Math.max(0, this.index)] ?? null;
  }

  // Block nach dem laufenden (Vorschau im Bild-in-Bild); im letzten Block
  // und nach Programmende null
  get naechsterBlock() {
    return this.vorbei ? null : this.blocks[Math.max(0, this.index) + 1] ?? null;
  }

  // Effektives Ziel eines Blocks inkl. ±-Offset (Anzeige, Ansage, Zonenfarbe,
  // Vorschau im Bild-in-Bild) — geklemmt wie setTarget (state.js): adjust()
  // hält nur den LAUFENDEN Block in 0 … maxWatt, ein anderer Block käme mit
  // demselben Offset darüber hinaus, gefahren wird aber der geklemmte Wert
  zielFuer(b) {
    return Math.min(Math.max(0, Math.round(b.watt + this.offset)), this.session.settings.maxWatt ?? Infinity);
  }

  // Sekunden seit Programmende (Ausfahren) für eine Aufzeichnungszeit
  ueberzeit(elapsed) {
    return Math.max(0, this.programmZeit(elapsed) - this.total);
  }

  // ±-Taps wirken als Offset auf alle Blöcke, nicht nur den aktuellen.
  // Geklemmt, sodass der laufende Block zwischen 0 W und maxWatt bleibt —
  // sonst liefen Taps an der Grenze ins Leere und Anzeige/Ansage zeigten
  // negative oder unerreichbare Ziele. anwenden=false: nur den Offset
  // setzen (Wiedereinstieg nach Not-Stopp fährt ihn selbst sanft an).
  adjust(delta, { anwenden = true } = {}) {
    let neu = this.offset + delta;
    const b = this.aktuellerBlock;
    if (b) neu = Math.min(Math.max(neu, -b.watt), (this.session.settings.maxWatt ?? Infinity) - b.watt);
    this.offset = neu;
    if (anwenden) this.#apply();
  }

  // Aktuellen Block überspringen (Programmuhr ans Blockende springen).
  // Liefert, ob etwas passiert ist (für die Rückmeldung in der UI).
  skip() {
    if (this.index < 0 || !this.restImBlock) return false;
    this.#schliessePause();
    this.#setzeZeitOffset(this.zeitOffset + this.restImBlock);
    return true;
  }

  // Player-Logik: erst an den Blockanfang, kurz nach Blockanfang (<3 s
  // gefahren) zum vorherigen Block. Liefert 'anfang' | 'vorheriger' | null.
  zurueck() {
    this.#schliessePause();
    const t = Math.max(0, this.session.elapsed + this.zeitOffset);
    const cur = this.blockAt(t);
    if (!cur) return null;
    const blockStart = cur.ende - cur.block.dauer;
    const gefahren = t - blockStart;
    if (gefahren >= 3 || cur.i === 0) {
      this.#setzeZeitOffset(blockStart - this.session.elapsed);
      return 'anfang';
    }
    const prev = this.blocks[cur.i - 1];
    this.#setzeZeitOffset(blockStart - prev.dauer - this.session.elapsed);
    return 'vorheriger';
  }

  // Aktuellen Block um Sekunden verlängern: die Zeit wird HINTEN angehängt
  // (Blockdauer wächst), statt die Programmuhr zurückzuspulen — der Graph
  // läuft vorwärts weiter, nichts wird doppelt durchlaufen oder gezeichnet.
  verlaengern(sek) {
    const b = this.aktuellerBlock;             // nach Programmende nichts anhängen
    if (!b) return false;
    b.dauer += sek;
    this.total += sek;
    this.#tick();
    return true;
  }

  // Aktuelles Blockziel inkl. Watt-Offset (für Resume nach Not-Stopp).
  // Nach Programmende (done) gilt das zuletzt gesetzte Session-Ziel.
  aktuellesZiel() {
    if (this.vorbei) return this.session.zielVorStopp ?? this.session.target;
    const b = this.aktuellerBlock;
    return b ? b.watt + this.offset : 0;
  }

  blockAt(t) {
    let acc = 0;
    for (const [i, b] of this.blocks.entries()) {
      acc += b.dauer;
      if (t < acc) return { i, block: b, ende: acc };
    }
    return null;
  }

  #tick() {
    const el = this.session.elapsed;
    // Not-Stopp friert die Programmuhr ein (Countdown steht, WEITER setzt
    // exakt an der Stoppstelle fort); die Aufzeichnung läuft ehrlich weiter.
    if (this.session.gestoppt && !this.vorbei) {
      let offen = this.pauseLog.at(-1);
      if (!offen || offen.bis !== null) {
        offen = { von: el, bis: null, frozen: Math.max(0, el + this.zeitOffset) };
        this.pauseLog.push(offen);
      }
      // Anzeige an der eingefrorenen Stelle nachführen: Skip/Zurück während
      // der Pause müssen index/Countdown sichtbar ändern (sonst wirkt der
      // Druck folgenlos und provoziert Doppel-Skips mit stalem restImBlock);
      // #apply und Blockwechsel-Events bleiben im Stopp unterdrückt.
      const cur = this.blockAt(offen.frozen);
      if (cur) {
        this.index = cur.i;
        this.restImBlock = cur.ende - offen.frozen;
        this.restGesamt = this.total - offen.frozen;
      } else {
        // Skip über den letzten Block im Stopp: kein veralteter Rest, sonst
        // schöbe ein zweiter Skip die Überzeit dauerhaft weiter
        this.restImBlock = this.restGesamt = 0;
      }
      return;
    }
    this.#schliessePause();
    const t = Math.max(0, this.session.elapsed + this.zeitOffset);
    const cur = this.blockAt(t);
    if (!cur) {
      this.restImBlock = 0;
      this.restGesamt = 0;
      if (!this.vorbei) {
        this.index = -2;
        // Statistik-Schnitt: alles ab hier ist Ausfahren (wird aufgezeichnet,
        // zählt aber nicht in NP/IF/TSS)
        this.session.programmEndeBei ??= this.session.elapsed;
        this.dispatchEvent(new Event('done'));
      }
      return;
    }
    if (cur.i !== this.index) {
      this.index = cur.i;
      this.#apply();
      this.dispatchEvent(new CustomEvent('block', { detail: { index: cur.i, watt: cur.block.watt } }));
    }
    this.restImBlock = cur.ende - t;
    this.restGesamt = this.total - t;
    if ((this.restImBlock === 2 || this.restImBlock === 1) && cur.i < this.blocks.length - 1)
      this.dispatchEvent(new Event('countdown'));
  }

  #apply() {
    // Not-Stopp respektieren: ein Blockwechsel darf den Widerstand nicht
    // wieder einschalten — WEITER/± sind die einzige Rückkehr
    if (this.session.gestoppt) return;
    const b = this.aktuellerBlock;            // nach Programmende kein Blockziel mehr
    if (b) this.session.setTarget(b.watt + this.offset);
  }
}

// Blockliste eines Programms für gegebene Optionen (Generator oder klassisch).
// Zufallsprogramme würfeln deterministisch aus opts.seed.
export function baueBlocks(programm, opts, ftp) {
  if (programm.generieren) return programm.generieren(opts, ftp);
  const rng = programm.zufall ? mulberry32(opts.seed ?? holeSeed(programm.id)) : Math.random;
  return expand(programm.bauen(opts, rng));
}

export function defaultOpts(programm) {
  const opts = Object.fromEntries(Object.entries(programm.optionen).map(([k, v]) => [k, v.default]));
  if (programm.zufall) opts.seed = holeSeed(programm.id);
  return opts;
}

// --- Startwerte für Zufallsprogramme ---
// Liegen in localStorage und überleben so App-Neustarts. Die Map hält den
// Wert zusätzlich im Speicher, falls localStorage nicht verfügbar ist.
const seeds = new Map();
const zufallsSeed = () => Math.floor(Math.random() * 2 ** 32);

export function holeSeed(id) {
  if (!seeds.has(id)) {
    let s = null;
    try { s = localStorage.getItem(`seed-${id}`); } catch { /* optional */ }
    seeds.set(id, s !== null && Number.isFinite(Number(s)) ? Number(s) : null);
    if (seeds.get(id) === null) setzeSeed(id, zufallsSeed());
  }
  return seeds.get(id);
}

export function setzeSeed(id, seed) {
  seeds.set(id, seed >>> 0);
  try { localStorage.setItem(`seed-${id}`, String(seed >>> 0)); } catch { /* optional */ }
}

export function neuerSeed(id) {
  setzeSeed(id, zufallsSeed());
  return seeds.get(id);
}

// Kleiner, schneller 32-Bit-PRNG: gleicher Startwert → gleiche Folge
function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
