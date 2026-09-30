# ergoMergo — Stil

Das Design-System der App besteht aus vier Teilen, die sich gegenseitig
absichern:

| Teil | Datei | Aufgabe |
|---|---|---|
| Tokens | `css/tokens.css` | einzige Quelle für Farben, Schrift, Radien, Abstände, Schatten, Tippflächen |
| Style Guide | `docs/stil.html` ([online](https://grenzenloseschublade.github.io/ergoMergo/docs/stil.html)) | zeigt alle Tokens und Bausteine mit den echten Stilen — kann nicht veralten |
| Prüfung | `tools/stil-check.mjs` (läuft in `release.mjs`) | meldet feste Werte außerhalb von `tokens.css` mit Datei und Zeile |
| Vergleich | `test/` | Screenshots und Layout-Messungen vor jeder Abnahme |

Diese Datei hält fest, **warum** es so ist und wie neue Teile gebaut werden.

## Leitbild

Instrumenten-Optik für das Handy am Lenker: dunkel, ruhig, kontraststark,
Tabellenziffern. Gelesen wird aus einem Meter Abstand mit Puls 170, getippt
mit schweißigen Daumen. Daraus folgt alles Weitere:

- **Nichts springt.** Werte haben feste Feldbreiten, Meldungen feste Plätze
  (LED-Zeile, Hinweiszeile im Panel). Ein neuer Text verschiebt nie ein
  anderes Element.
- **STOPP ist immer erreichbar.** Kein Panel, Toast oder Dialog liegt über
  −10/+10/STOPP/Beenden; ein Tipp daneben schließt ein Panel und wirkt
  trotzdem, wenn er die Bedienleiste trifft.
- **Wenig gleichzeitig.** Was selten gebraucht wird, liegt hinter „⋯“.

## Tokens

Alle Werte stehen in `css/tokens.css`. In `app.css` und im JS kommen nur
`var(--…)` bzw. `tokenLeser()`/`canvasSchrift()` aus `js/ui/tokens.js` vor.

### Farben nach Bedeutung

| Token | Bedeutung | Nie für |
|---|---|---|
| `--accent` | Aktion, Auswahl, aktuelle Position | Warnungen |
| `--ok` | verbunden, im Ziel, WEITER | Dekoration |
| `--danger` | STOPP, Fehler, Löschen | Hervorhebung ohne Gefahr |
| `--warn` | Demo, „verbindet …“ | Fehler |
| `--z1`…`--z6` | Powerzonen (Zwift-Konvention) | andere Skalen |
| `--hr-line` | Herzfrequenz — Kurve, Werte, Symbol | alles andere |

Farbe trägt nie allein Bedeutung: Zustände haben immer auch Text, Symbol
oder Form (gestrichelter Rahmen = nicht gekoppelt, pulsierender Punkt =
verbindet). `--ink3` erreicht mindestens 4,5:1 auf `--bg` und `--surface`.

### Schrift

Eine Familie (`--schrift`, Systemschrift), sieben Stufen von `--text-2xs`
(10 px) bis `--text-2xl` (24 px). Die großen Fahrwerte (Watt, Ziel, Zeit)
sind **Anzeigen**, keine Textstufen: Sie skalieren mit `clamp()` am
Bildschirm und sind die einzige erlaubte Ausnahme.

Rollen:

- **Versal-Beschriftung** (`--text-xs`, VERSAL, `--sperrung-versal`, `--ink3`):
  Abschnittstitel, Feldnamen, Kicker. Eine gemeinsame Regel in `app.css`
  („Rollen“) — neue Beschriftungen kommen in deren Selektorliste.
- **Zeilentext** `--text-md`, **Erklärung darunter** `--text-xs` in `--ink3`.
- **Zahlen** immer `font-variant-numeric: tabular-nums`.

### Radien, Abstände, Tippflächen

- Radien: `--radius-xs` 4 (Balken) · `--radius-s` 8 (Eingaben, kleine Knöpfe)
  · `--radius-m` 12 (Zeilen, Karten) · `--radius-l` 16 (Kacheln, Dialoge,
  Bedientasten) · `--radius-pill`.
- Abstände im 4-px-Raster: `--abstand-05` (2 px) bis `--abstand-12` (48 px),
  der Name ist die Zahl der 4-px-Schritte.
- Alles Tippbare mindestens `--tippflaeche` (44 px), Zeilen in Panels und
  Dialogen `--tippflaeche-zeile` (48 px), die Bedienleiste `--bedien-hoehe`
  (64 px). Einzige Ausnahme: die Kopfzeilen-Symbole quer (38 px hoch, 44 px
  breit) — dort zählt jede Zeile für den Graphen.
- Symbole: `--icon-xs` 12 · `--icon-s` 14 · `--icon-m` 18 · `--icon-l` 20.

## Bausteine

| Baustein | Klasse | Wann |
|---|---|---|
| Karte | `.tile`, `.bilanz`, `.sessions li`, `dialog` | eigenständiger Block auf dem Hintergrund |
| Zeile | `.schalter-zeile`, `.fo-zeile`, `.geraete li` | Eintrag auf einer Karte oder im Panel; Titel + Erklärung |
| Schalter-Zeile | `.schalter-zeile` + `input.schalter` | Ein/Aus-**Einstellung** |
| Aktions-Zeile | `.fo-zeile` | **Aktion** (öffnen, koppeln) — nie ein Schalter für eine Aktion |
| Chip | `.chip`, `.chip-fahrt` | Aktionen in einer Leiste |
| Bedientaste | `.ctl` | nur −10/+10/STOPP/Beenden |
| Geräte-Zustand | `[data-zustand]` | Home-Leiste, Kopfzeile, Panel — eine Regel für alle |

## Rückmeldungen

| Wo | Was |
|---|---|
| LED-Zeile (Fahrt) | alles während der Fahrt: Zustände dauerhaft, Infos zweimal durchlaufend |
| Hinweiszeile im Panel | Rückmeldung auf einen Tipp im Panel |
| Toast | außerhalb der Fahrt; in der Fahrt nur „Nochmal Zurück“ und Fahrtende |

## Texte

Deutsch, kurz, in der Sprache der Fahrt („Block übersprungen“, nicht
„Segment wurde übersprungen“). Beschreibungen sagen, was passiert
(„Countdown vor dem Wechsel, Ton beim Wechsel“), nicht wie es heißt.
Aktionen als Verb („Bild-in-Bild öffnen“), Zustände als Partizip
(„verbunden“).

## Neue Teile bauen

1. Vorhandenen Baustein oder Rolle nehmen; nur ergänzen, was abweicht.
2. Fehlt ein Wert, erst ein Token in `tokens.css` anlegen (mit Kommentar,
   wofür) — nie einen festen Wert in `app.css`.
3. Den Baustein in `docs/stil.html` aufnehmen.
4. `node tools/stil-check.mjs` und die Layout-Prüfungen aus `test/`
   laufen lassen, Screenshots abnehmen.
