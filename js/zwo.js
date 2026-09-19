// Import von Zwift-Workout-Dateien (.zwo): simples XML, Leistungsangaben als
// FTP-Bruchteile (0.75 = 75 % FTP). Unterstützt Warmup, Cooldown, Ramp,
// SteadyState, IntervalsT, FreeRide; Kadenz-Vorgaben werden ignoriert.
// Importierte Workouts landen als eigene Programme im programme-Store und
// skalieren zur hinterlegten FTP (ohne FTP: 170-W-Annahme wie der Generator).

const RAMPEN_STUFEN = 6;

export function parseZwo(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  if (doc.querySelector('parsererror')) throw new Error('Ungültige .zwo-Datei');
  const name = doc.querySelector('name')?.textContent?.trim() || 'Importiertes Workout';
  const workout = doc.querySelector('workout');
  if (!workout) throw new Error('Kein <workout>-Element gefunden');

  const bloecke = [];   // { dauer (s), pct (FTP-Bruchteil) }
  const num = (el, attr, fallback = 0) => {
    const v = parseFloat(el.getAttribute(attr));
    return Number.isFinite(v) ? v : fallback;
  };
  const rampe = (dauer, von, bis) => {
    const stufen = Math.min(RAMPEN_STUFEN, Math.max(2, Math.round(dauer / 60)));
    for (let i = 0; i < stufen; i++) {
      bloecke.push({
        dauer: dauer / stufen,
        pct: von + (bis - von) * (stufen === 1 ? 0 : i / (stufen - 1)),
      });
    }
  };

  for (const el of workout.children) {
    const dauer = num(el, 'Duration');
    switch (el.tagName) {
      case 'Warmup':
      case 'Cooldown':
      case 'Ramp':
        rampe(dauer, num(el, 'PowerLow', 0.5), num(el, 'PowerHigh', 0.75));
        break;
      case 'SteadyState':
        bloecke.push({ dauer, pct: num(el, 'Power', 0.6) });
        break;
      case 'IntervalsT': {
        const wdh = Math.max(1, num(el, 'Repeat', 1));
        const gruppe = `zwo${bloecke.length}`;   // je IntervalsT-Abschnitt eine Klammer
        for (let r = 0; r < wdh; r++) {
          bloecke.push({ dauer: num(el, 'OnDuration'), pct: num(el, 'OnPower', 1), gruppe, gruppeLabel: `${wdh}×` });
          bloecke.push({ dauer: num(el, 'OffDuration'), pct: num(el, 'OffPower', 0.5), gruppe, gruppeLabel: `${wdh}×` });
        }
        break;
      }
      case 'FreeRide':
        bloecke.push({ dauer, pct: 0.6 });     // freie Fahrt: neutrale Z2-Vorgabe
        break;
      default:
        break;                                  // textevent etc. ignorieren
    }
  }

  const gueltig = bloecke.filter(b => b.dauer >= 1);
  if (!gueltig.length) throw new Error('Workout enthält keine Blöcke');
  return { name, bloecke: gueltig };
}

// Gespeichertes Import-Programm → Programmobjekt für Kacheln/Startdialog
export function zwoProgramm(gespeichert, EFF_FTP_DEFAULT = 170) {
  const totalMin = Math.round(gespeichert.bloecke.reduce((a, b) => a + b.dauer, 0) / 60);
  let gruppenSeq = 0;
  return {
    id: gespeichert.id,
    name: gespeichert.name,
    sub: `Import · ${totalMin} min`,
    custom: true,
    optionen: {
      intensitaet: { label: 'Intensität (%)', min: 50, max: 130, default: 100 },
    },
    generieren(o, ftp) {
      const f = (ftp || EFF_FTP_DEFAULT) * (o.intensitaet ?? 100) / 100;
      const gruppenIds = new Map();
      return gespeichert.bloecke.map(b => {
        const block = {
          dauer: Math.round(b.dauer),
          watt: Math.max(30, Math.round(b.pct * f / 5) * 5),
        };
        if (b.gruppe) {
          if (!gruppenIds.has(b.gruppe)) gruppenIds.set(b.gruppe, `z${++gruppenSeq}`);
          block.gruppe = gruppenIds.get(b.gruppe);
          block.gruppeLabel = b.gruppeLabel;
        }
        return block;
      });
    },
  };
}
