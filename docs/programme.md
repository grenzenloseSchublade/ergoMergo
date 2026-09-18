# Zeitbasierte Workouts — Strukturen und Begründung

Die Kacheln unter „Nach Zeit & Typ" erzeugen aus **Gesamtdauer + Typ** ein vollständiges Programm. Umsetzung in `js/workouts.js`.

## Generator-Prinzip

Nach TrainerRoad-/Zwift-Konvention bleiben die **Intensitäten je Typ fix** (%FTP); die Gesamtzeit wird ausschließlich über die **Anzahl der Wiederholungen/Sätze** und einen **Zone-2-Füller (65 % FTP)** skaliert.

```
Warmup   = 15 % der Gesamtzeit, begrenzt auf 6–15 min  (Stufenrampe 45 → 72 % FTP)
Cooldown = 10 % der Gesamtzeit, begrenzt auf 4–10 min  (Stufenrampe 60 → 40 % FTP)
Hauptteil = Rest; Wiederholungszahl N = f(Hauptteil), Rest → Z2-Füller
```

Ohne hinterlegten FTP-Wert rechnet der Generator mit **170 W** (≈ 2 W/kg, Freizeitfahrer-Mittel). Der Regler „Intensität %" im Startdialog skaliert alle Wattwerte (wie Zwifts FTP-Bias) — erste Einheiten konservativ bei 90 % beginnen.

## ERG-Modus-Randbedingung

Smart-Trainer brauchen **2–6 s**, um einen neuen Sollwert anzufahren. Work-Intervalle unter ~30 s bestehen im ERG-Modus überwiegend aus Rampe — deshalb bietet der Generator **kein Tabata (10-s-Pausen) und keine 10–20-s-Sprints** an. 30/30 und 40/20 sind die praktikable Untergrenze; Trick bei 30/30: in der Pause die Trittfrequenz absenken und zum Intervallstart hochziehen, das kompensiert die Regelträgheit.

## Die sechs Typen

| Typ | Hauptteil | Intensität | Skalierung | Zweck |
|---|---|---|---|---|
| **Sprint 30/30** (Billat) | Sätze à 8 × (30 s / 30 s Pause), 4 min Satzpause | 118 % / 50 % | 2–4 Sätze | anaerobe Kapazität, VO2max |
| **HIIT 40/20** | Sätze à 8 × (40 s / 20 s), 5 min Satzpause | 120 % / 45 % | 2–4 Sätze | VO2max, Wiederholbarkeit harter Antritte |
| **VO2max 4×4** (norwegisch, Helgerud) | 4 min hart / 3 min locker | 110 % / 55 % | 3–6 Wiederholungen: N = ⌊(Hauptteil+3)/7⌋ | maximale Sauerstoffaufnahme (+7–10 % in 8 Wochen belegt) |
| **Schwelle / Sweet Spot** | Blöcke 10–20 min, Pause = Blocklänge/4 | 90 % / 50 % | 2+ Blöcke, Blocklänge passt sich an (W:R ≈ 4:1) | FTP anheben, muskuläre Ausdauer |
| **Ausdauer** | Z2-Basis, ab 24 min Hauptteil: 8-min-Tempo-Blöcke mit 4 min Z2 | 67 % Basis, 80 % Tempo | bis 4 Tempo-Blöcke: N = ⌊Hauptteil/12⌋ | aerobe Grundlage (San-Millán-/Seiler-Zone-2) |
| **Recovery** | ein flacher Block, 2 min Ein-/Ausrollen | 48 %, hart gedeckelt < 55 % | nur Dauer | aktive Erholung — danach muss man sich besser fühlen als davor |

## Sinnvolle Mindestdauern

Sprint 30/30 ab 30 min, HIIT 40/20 und VO2max ab 35 min, Schwelle ab 40 min (sonst passen keine zwei vollwertigen Blöcke), Ausdauer ab 20 min, Recovery ab 15 min. Die Startdialoge erzwingen diese Grenzen.

## Quellen (Auswahl)

- Billat 30/30: Sports Performance Bulletin, „Billat intervals"; robertovukovic.com/30-30-intervals
- 4×4: Helgerud/Hoff-Protokoll, myworkout.com/en/4x4-intervals; roadmancycling.com VO2max-Guide
- 40/20: trainingpeaks.com „Benefits of 40/20 Workouts"; fascatcoaching.com VO2-Intervals
- Sweet Spot/Threshold: fascatcoaching.com Sweet-Spot-Guide; trainerroad.com Blog (Sweet Spot, Over-Unders, Threshold)
- Zone 2/Recovery: trainright.com (CTS) „Minimum Durations for Zone 2"; roadmancycling.com Recovery-Guide
- Warmup-Protokolle: roadmancycling.com Warm-up/Cool-down Evidence Guide
- ERG-Trägheit & kurze Intervalle: zwiftinsider.com „All About Erg Mode"; TrainerRoad-Forum „Short intervals <30 s — Erg or resistance"
- Skalierungskonvention: TrainerRoad Workout/Progression Levels; Zwift Workout-Editor (%FTP-basiert)

Vollständige Linkliste in der Recherche-Session vom 18.09.2026.
