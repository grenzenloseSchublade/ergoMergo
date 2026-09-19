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
    optionen: { dauer: { label: 'Dauer (min)', min: 20, max: 90, default: 40 },
                von: { label: 'Watt min', min: 50, max: 300, default: 100 },
                bis: { label: 'Watt max', min: 80, max: 400, default: 220 } },
    bauen: o => {
      const blocks = [{ min: 5, watt: o.von }];
      let rest = o.dauer - 10;
      while (rest > 0) {
        const m = Math.min(rest, 1 + Math.floor(Math.random() * 4));
        blocks.push({ min: m, watt: o.von + Math.round(Math.random() * (o.bis - o.von) / 10) * 10 });
        rest -= m;
      }
      blocks.push({ min: 5, watt: o.von });
      return blocks;
    },
  },
];

// Schrittliste → flache Blockliste [{dauer, watt}] in Sekunden.
// wattWert löst "55%" gegen die FTP auf.
let gruppenZaehler = 0;

export function expand(schritte, ftp = 0) {
  // 30-W-Boden: "%"-Ziele ohne hinterlegte FTP dürfen nicht zu 0-W-Blöcken werden
  const watt = w => typeof w === 'string' && w.endsWith('%')
    ? Math.max(30, Math.round(parseFloat(w) / 100 * ftp)) : w;
  const out = [];
  for (const s of schritte) {
    if (s.wdh) {
      // Wiederholung fürs Intensitätsprofil markieren (Klammer „n×")
      const gruppe = `p${++gruppenZaehler}`;
      for (let i = 0; i < s.wdh; i++) {
        for (const b of expand(s.block, ftp)) {
          b.gruppe ??= gruppe;
          b.gruppeLabel ??= `${s.wdh}×`;
          out.push(b);
        }
      }
    } else {
      out.push({ dauer: Math.round(s.min * 60), watt: watt(s.watt) });
    }
  }
  return out;
}

export class ProgramRun extends EventTarget {
  constructor(session, name, blocks) {
    super();
    this.session = session;
    this.name = name;
    this.blocks = blocks;
    this.total = blocks.reduce((a, b) => a + b.dauer, 0);
    this.offset = 0;                       // ± verschiebt den gesamten Ablauf (Watt)
    this.zeitOffset = 0;                   // Skip/Verlängern verschiebt die Programmuhr
    this.index = -1;
    session.addEventListener('tick', () => this.#tick());
    this.#tick();
  }

  // ±-Taps wirken als Offset auf alle Blöcke, nicht nur den aktuellen
  adjust(delta) {
    this.offset += delta;
    this.#apply();
  }

  // Aktuellen Block überspringen (Programmuhr ans Blockende springen)
  skip() {
    if (this.index < 0 || !this.restImBlock) return;
    this.zeitOffset += this.restImBlock;
    this.#tick();
  }

  // Aktuellen Block um Sekunden verlängern
  verlaengern(sek) {
    this.zeitOffset -= sek;
    this.#tick();
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
    const t = Math.max(0, this.session.elapsed + this.zeitOffset);
    const cur = this.blockAt(t);
    if (!cur) {
      this.restImBlock = 0;
      this.restGesamt = 0;
      if (this.index !== -2) { this.index = -2; this.dispatchEvent(new Event('done')); }
      return;
    }
    if (cur.i !== this.index) {
      this.index = cur.i;
      this.#apply();
      this.dispatchEvent(new CustomEvent('block', { detail: { index: cur.i, watt: cur.block.watt } }));
    }
    this.restImBlock = cur.ende - t;
    this.restGesamt = this.total - t;
    if (this.restImBlock === 5 && cur.i < this.blocks.length - 1)
      this.dispatchEvent(new Event('countdown'));
  }

  #apply() {
    const b = this.blocks[Math.max(0, this.index)];
    if (b) this.session.setTarget(b.watt + this.offset);
  }
}
