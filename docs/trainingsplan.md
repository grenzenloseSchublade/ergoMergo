# Trainingsplan — Grundlagen

Der Plan (`js/plan.js`, Oberfläche `js/ui/plan-ui.js`) stellt aus den
gewählten Wochentagen, der typischen Dauer, einem Ziel und der Erfahrung
Woche für Woche die Einheiten zusammen. Diese Datei hält fest, **warum** er
so gebaut ist. Die Regeln prüft `test/plan.mjs` für alle 119
Wochentag-Kombinationen — das Verschieben für jedes Verpass-Muster einer Woche.

Vorbehalt: Die meisten Studien zur Intensitätsverteilung stammen von
trainierten Athleten. Für Freizeitfahrer mit 2–4 h pro Woche gibt es wenig
direkte Daten; einiges ist übertragen oder folgt der Praxis gängiger Apps.

## Regeln und Begründung

| Regel | Begründung |
|---|---|
| Höchstens 2 harte Einheiten pro Woche (Ziel „Leistung“ ab 5 Tagen: 3) | Unter ~4 h/Woche ist eine pyramidale Verteilung sinnvoll; polarisiert ist nur bei Hochtrainierten leicht überlegen [1][2][3]. Eine dritte 4×4-Einheit bringt Freizeitsportlern kaum Zusatznutzen [8]. |
| Zwischen harten Einheiten ≥ 48 h | 48 h Erholung zwischen HIIT-Einheiten wirkt besser als 24 h [7]. Passt es mit den gewählten Tagen nicht, wird eine Einheit locker. |
| 4-Wochen-Blöcke: 3 Wochen Aufbau, 1 Woche leicht | Mesozyklen von 3–4 Wochen mit Erholung (TrainerRoad, Friel) [12][13]. |
| Steigerung über die Dauer (mehr Wiederholungen), Intensität bleibt | So steigen auch Warmup und Cooldown nicht mit; Wochenumfang wächst moderat (Friel: +5–8 CTL/Woche als Obergrenze für Erfahrene [14]). |
| Rampentest als letzte Einheit der leichten Woche | Ausgeruht testen; alle Ziele sind %FTP und passen sich danach an [16][17]. |
| FTP unbekannt: nie hart auf Basis der 200-W-Annahme | Für Einsteiger (FTP oft 120–160 W) wären VO2-Intervalle viel zu hart. Regelmäßig Fahrende testen zuerst; Einsteiger rollen eine Woche locker ein. |
| Nur FTP-relative Programme | Pyramide, Fartlek, 4×4 mit festen Watt passen sich nach einem Test nicht an. |
| Verpasste harte Einheit / FTP-Test wandert auf den nächsten Plantag derselben Woche | Sie verdrängt dort eine lockere Einheit, aber nur wenn die 48-h-Regel hält — sonst der übernächste Tag, sonst entfällt sie [21]. Karte: „Heute: … · Verschoben von Mo“, Streifen ↷. |
| Verpasste lockere Einheiten entfallen, nichts wird nachgeholt | Keine doppelten Tage, kein Übertrag in die nächste Woche [21]. Nach ≥ 14 Tagen ohne Fahrt bietet die Karte an, ab dieser Woche neu aufzubauen. |
| Intervall-Typ wechselt je Block (4×4 → 40/20 → 30/30) | Abwechslung bei gleicher Wirkung; 2 Einheiten 4×4/Woche reichen für VO2max-Zuwächse [8][9]. |
| Gesundheitshinweis beim Anlegen | Kurzfassung der ACSM-Empfehlung zur Voruntersuchung und des PAR-Q+ [19][20]; bei Infekt pausieren [22]. |

Ein eigenes Ziel „Abnehmen“ gibt es nicht: HIIT und moderates
Dauertraining senken Körperfett etwa gleich stark [25]; es fällt unter
„Fitness“.

## Wochen (Beispiel 45 min, Ziel Fitness)

| Tage | Einheiten | ≈ h/Woche |
|---|---|---|
| 2 (Di, Sa) | Intervalle · Schwelle | 1,5 |
| 3 (Di, Do, Sa) | Intervalle · Grundlage · Schwelle | 2,2 |
| 4 (Di, Mi, Fr, So) | + Lange Ausfahrt | 3–3,5 |
| 5 | + Regeneration vor einer harten Einheit | 3,5–4 |
| 6 | + weitere Grundlage | 4,5 |

„Grundlage“ ist reine Zone 2 (`ausdauer` mit `tempo: false`), „Lange
Ausfahrt“ ebenso, nur länger; beim Ziel „Ausdauer“ wird die Schwelle zu
„Ausdauer mit Tempo“ und die lange Ausfahrt wächst schneller.

## Bewusst nicht in Version 1

Adaptive Anpassung per Modell (TrainerRoad), Pläne auf ein Ereignis hin mit
Taper, CTL/ATL-Diagramme, Verschieben per Drag & Drop, mehrere Einheiten pro
Tag, HRV-Abfrage. Kandidat für später: nach jeder Planfahrt „leicht /
passend / zu schwer“ — „zu schwer“ hält die Stufe, zweimal hintereinander
senkt die Intensität um 5 %.

## Quellen

1. Oliveira et al. 2024, Sports Med — https://pmc.ncbi.nlm.nih.gov/articles/PMC11329428/
2. Rosenblat et al. 2025 — https://www.frontiersin.org/journals/physiology/articles/10.3389/fphys.2025.1657892/full
3. Pyramidal bei Freizeitradfahrern — https://www.mdpi.com/2075-4663/12/1/17
7. Erholung zwischen HIIT-Einheiten — https://facultyshowcase.sfasu.edu/ws/portalfiles/portal/39864162/Recovery+Methodologies+and+High+Intensity+Interval+Training.pdf
8. 4×4-Häufigkeit bei Freizeitsportlern — https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12451023/
9. Helgerud et al. 2007 — https://rcc.hslu.ch/fileadmin/user_upload/downloads/sport/Aerobic_High-Intensity_Intervals_Improve_J.Helgerud_2007.pdf
12. TrainerRoad: Aufbau der Pläne — https://www.trainerroad.com/blog/how-trainerroad-plans-are-built-and-adapt-to-you/
13. Friel: Erholungswochen — https://joefrieltraining.com/recovery-week-design/
14. Friel: CTL-Anstieg — https://joefrieltraining.com/the-ctl-ramp-rate/
16. TrainerRoad Plan Builder — https://support.trainerroad.com/hc/en-us/articles/360037666312-Plan-Builder-FAQs
17. Wahoo SYSTM: Tests — https://support.wahoofitness.com/hc/en-us/articles/4403358637586-Fitness-Assessments-in-the-SYSTM-app
19. ACSM 2015, Voruntersuchung — https://pubmed.ncbi.nlm.nih.gov/26473759/
20. PAR-Q+ — https://eparmedx.com/par-q/
21. Verpasste Einheiten — https://www.trainerroad.com/blog/how-to-adjust-your-training-plan-when-you-miss-workouts/
22. Training bei Erkältung (Mayo Clinic) — https://www.mayoclinic.org/healthy-lifestyle/fitness/expert-answers/exercise/faq-20058494
25. Wewege et al. 2017 — https://onlinelibrary.wiley.com/doi/abs/10.1111/obr.12532
