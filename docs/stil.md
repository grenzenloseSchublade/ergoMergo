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
  anderes Element. Was je nach Zustand fehlt, lässt seinen Platz frei
  (`visibility: hidden` bzw. Mindesthöhe statt `hidden`) — so bleibt der
  Wochenstreifen beim Tageswechsel unter dem Finger. Unsichtbares ist dabei
  auch nicht fokussierbar und wird nicht vorgelesen.
- **STOPP ist immer erreichbar.** Kein Panel, Toast oder Dialog liegt über
  −10/+10/STOPP/Beenden; ein Tipp daneben schließt ein Panel und wirkt
  trotzdem, wenn er die Bedienleiste trifft.
- **Ein Tipp daneben schließt — wenn nichts verloren geht.** Fenster zum
  Ansehen und Wählen (Graph im Vollbild, Blätter von unten, Startdialog,
  Panel und Blatt in der Fahrt) schließen bei einem Tipp daneben wie „Abbrechen“
  (`<dialog closedby="any">`). Fenster mit Eingaben, die verloren gingen
  (Einstellungen, Plan anlegen/ändern, Tasten lernen), schließen nur über
  Abbrechen, Zurück oder Esc.
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
| `--hr-line` | Herzfrequenz — Pulskurve im Graphen (mit Legende) und der Puls ab der eigenen Pulsgrenze | alles andere; nicht für Symbole und den Puls im Normalfall — die stehen neutral wie die anderen Nebenwerte |

Farbe trägt nie allein Bedeutung: Zustände haben immer auch Text, Symbol
oder Form (gestrichelter Rahmen = nicht gekoppelt, pulsierender Punkt =
verbindet). Ausnahme sind Wertfärbungen („Im Bereich“, „Über Grenze“): Die
Zahl selbst ist die Information, die Farbe nur ein Zusatz — sie darf dort
allein stehen. `--ink3` erreicht mindestens 4,5:1 auf `--bg` und `--surface`.

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
  breit) — dort zählt jede Zeile für den Graphen — und Wochentag-Reihen mit
  7 Spalten (Wochenstreifen, Tagewahl): lückenlos, 44 px hoch, bei 360 px
  knapp 40 px breit.
- Symbole: `--icon-xs` 12 · `--icon-s` 14 · `--icon-m` 18 · `--icon-l` 20.

## Bausteine

| Baustein | Klasse | Wann |
|---|---|---|
| Karte | `.tile`, `.bilanz`, `.sessions li`, `dialog` | eigenständiger Block auf dem Hintergrund |
| Zeile | `.schalter-zeile`, `.fo-zeile`, `.geraete li` | Eintrag auf einer Karte oder im Panel; Titel + Erklärung |
| Schalter-Zeile | `.schalter-zeile` + `input.schalter` | Ein/Aus-**Einstellung** |
| Aktions-Zeile | `.fo-zeile` | **Aktion** (öffnen, koppeln) — nie ein Schalter für eine Aktion; leise einzeilig mit „›“, wenn sie nur etwas zum Ansehen öffnet („Tastenbelegung ›“, Symbol `tasten`) |
| Chip | `.chip`, `.chip-fahrt` | Aktionen in einer Leiste |
| Bedientaste | `.ctl` | nur −10/+10/STOPP/Beenden |
| Geräte-Zustand | `[data-zustand]` | Home-Leiste, Kopfzeile, Panel — eine Regel für alle |
| Kopfzeilen-Symbol | `.kopf-geraet`, `.kopf-pip`, `.kopf-mehr` | Symbol ohne Rahmen in der Kopfzeile der Fahrt, 44 px; Umschalter tragen `aria-pressed` (an = `--accent`, keine Fläche) |
| Im Bereich | `.rpm-wert` + `[data-bereich="drin"]` / `"daneben"` | Wert gegen eine Vorgabe (Kadenz): drin = Schrift `--z2` (leicht eingefärbt, keine Fläche), nach 5 s daneben `--ink3`; nur die Farbe wechselt, nichts springt. Bild-in-Bild färbt genauso |
| Über Grenze | `[data-grenze="ueber"]` auf der Zahl | Wert über einer selbst gesetzten Grenze (Puls ab „Pulsgrenze“): nur die Zahl in `--hr-line`, Symbol und Einheit bleiben neutral; keine Fläche, kein Ton, neutral erst 3 bpm darunter (kein Flackern). Bild-in-Bild färbt genauso |
| Zahlenfeld mit Hinweis | `.feld-hinweis` (Feld + `.hint`) | Einstellung als Zahl mit kurzer Erklärung eng darunter (Pulsgrenze); Feld per `aria-describedby` mit dem Hinweis verbunden |
| Blatt von unten | `dialog.sheet` + `closedby="any"` | Aktionen oder Erklärung zu einem Eintrag (Plan-Einheit ändern, „Deine Daten“); Aktionen als Aktions-Zeilen; Tipp daneben schließt |
| Blatt in der Fahrt | `dialog.sheet.blatt-fahrt` + `closedby="any"` | nur Ansehen während der Fahrt (Tastenbelegung); **nicht modal**, sitzt zwischen Kopfzeile und Bedienleiste (quer links daneben, Lage setzt `ride.js`) — STOPP bleibt frei; Tipp daneben schließt wie beim Panel |
| Tastensymbol | `.ts` (Paddle `.ts-paddle`) | Lenkertaste in Belegung, Lern-Modus und Lenkeransicht, Form und Farbe wie am Lenker; eine Paddle-Richtung je Symbol mit eigener Marke, wenn die Richtungen verschieden belegt sind (Standard: außen +, innen −; in der Lenkeransicht übereinander, `.lk-stapel`) — wirken beide gleich, ist es **eine** Taste: ein Symbol mit beiden Pfeilen („← L →“) und eine Marke |
| Mehrere Tasten je Aktion | `.belegung-tasten` (Liste), `.tasten-gewaehlt` (Lern-Modus) | jede Taste mit Symbol + Name; in der Liste untereinander unter bzw. neben der Aktion, im Lern-Modus nebeneinander mit Platz für eine Zeile (die erste Taste verschiebt nichts) |
| Leise Text-Aktion | `.text-aktion` (Warnung: `.warnung`) | Verweis „… ›“ in einer Statuszeile oder einem Hinweis; keine Fläche, Tippfläche 44 px |
| Leise Hauptaktion | `.dlg-actions .ghost.haupt` | Schritt nach vorn in einem Ablauf-Dialog („Weiter“/„Fertig“ beim Tasten zuordnen): Akzentschrift ohne Fläche; erscheint erst, wenn der Schritt etwas hat — bis dahin steht an derselben Stelle die Alternative („Ohne Belegung weiter“) |
| Auswahl | `.tag-wahl`, `.segment`, `.ziel-wahl` | Wochentage, Dauer, Ziel — gewählt = Akzentrahmen + `--accent-flaeche` |
| Wochenstreifen | `.plan-woche` / `.plan-tag` | Balken in Zonenfarbe, Höhe = Dauer; jeder Tag ist wählbar, die Karte darüber hält für jeden Tag ihre Höhe (Titel/Erklärung je 2 Zeilen, dann „…“; Profil und Knopfzeile bleiben stehen) |

## Rückmeldungen

| Wo | Was |
|---|---|
| LED-Zeile (Fahrt) | alles während der Fahrt: Zustände dauerhaft, Infos zweimal durchlaufend |
| Hinweiszeile im Panel | Rückmeldung auf einen Tipp im Panel; fester Platz (2 Zeilen) ohne eigene Lücke: hochkant über der Beschriftung „Töne“, die solange ausgeblendet ist, quer unter den Tönen |
| Toast | außerhalb der Fahrt; in der Fahrt nur „Nochmal Zurück“ und Fahrtende |
| Toast mit „Rückgängig“ | nach jeder umkehrbaren Änderung (6 s) — **statt** einer Rückfrage vorher |
| Rückfrage (`confirm`) | nur bei Unumkehrbarem: Fahrt/Programm löschen, Plan beenden, Sicherung einspielen |

## Texte

Deutsch, kurz, in der Sprache der Fahrt („Block übersprungen“, nicht
„Segment wurde übersprungen“). Beschreibungen sagen, was passiert
(„Auftakt, Countdown und Ton beim Blockwechsel, Tick bei Lenkertasten“),
nicht wie es heißt.
Aktionen als Verb („Bild-in-Bild öffnen“), Zustände als Partizip
(„verbunden“).

## Neue Teile bauen

1. Vorhandenen Baustein oder Rolle nehmen; nur ergänzen, was abweicht.
2. Fehlt ein Wert, erst ein Token in `tokens.css` anlegen (mit Kommentar,
   wofür) — nie einen festen Wert in `app.css`.
3. Den Baustein in `docs/stil.html` aufnehmen.
4. `node tools/stil-check.mjs` und die Layout-Prüfungen aus `test/`
   laufen lassen, Screenshots abnehmen.
