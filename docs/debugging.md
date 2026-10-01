# Fehlersuche

## 1. Diagnose-Log in der App (Normalweg)

Einstellungen (⚙) → „Diagnose-Log": zeigt die letzten Einträge (BLE-Verbindungen, Control-Point-Antworten, Reconnects, Controller-Pakete, JS-Fehler). „Export" lädt das komplette Log als Textdatei herunter — der einfachste Weg, ein Problem zu melden. Das Log liegt als Ringpuffer (max. 2000 Einträge) in IndexedDB und überlebt Reloads.

## 2. DevTools per USB (chrome://inspect)

Handy per USB anschließen, USB-Debugging aktivieren. Am Rechner in Chrome `chrome://inspect` öffnen → der ergoMergo-Tab erscheint unter „Remote Target" → „inspect" gibt vollwertige DevTools (Konsole, Netzwerk, IndexedDB-Inhalt unter Application → Storage).

## 3. Konsole per adb (ohne DevTools)

```sh
adb logcat -s chromium
```

Zeilen mit `[INFO:CONSOLE(...)]` sind die JS-Konsolenausgaben der Seite, inklusive aller `[ftms]`/`[ctrl]`/`[app]`-Logeinträge.

## 4. Dev-Parameter (ohne Trainer)

| URL-Parameter | Wirkung |
|---|---|
| `?demo` | Fahrbildschirm „Freies Fahren" mit synthetischen Daten |
| `?demo=<workout-id>` | Programm-Modus, z. B. `?demo=sprint3030`, `vo2max`, `schwelle` |
| `?demo=programm` | Programm-Modus mit klassischem Intervallprogramm (4×4) |
| `?dlg=<id>` | Startdialog eines Programms direkt öffnen |
| `?big=<id>` | Graph-Vollbild eines Programms direkt öffnen |

Demo-Fahrten werden nicht in die Historie gespeichert. Die Demo nutzt denselben
Fahrbildschirm, Audio-Pfad (Töne + thorsten-Ansagen) und Fahrt-Eintritt wie die
echte Fahrt; nur Datenquelle und Speichern sind simuliert. Beim `?demo`-Start
ohne Berührung bleiben Töne stumm, bis einmal getippt wurde (Autoplay-Policy).

## 5. Zwift-Ride-Tasten belegen

Einstellungen (⚙) → Geräte zeigt die Belegung als Lenkeransicht
(`js/ui/lenker-karte.js`): je Griffzone (Griff oben, Hebel vorne, Hebel
außen, Außen unten) eine Zeile mit Seitenansichts-Piktogramm, links/rechts
die Tastensymbole; belegte Tasten tragen die Aktion als Marke, unbelegte sind
gedimmt. Zone und Anordnung stehen je Taste in `zwift-ride-tasten.json`
(`zone`, `raster`), die Aktionen zentral in `js/ui/controller-aktionen.js`.
„Tasten zuordnen" startet den Lern-Modus: er verbindet den
Controller und fragt Aktion für Aktion (+/−, Block vor/zurück, STOPP) eine
Taste ab — die Belegung landet als `controllerMap` in den Einstellungen.
Lern-Modus und Belegungsanzeige nennen die Tasten im Klartext („A (grün)",
„Pfeil links") und zeigen ein dem Lenker nachempfundenes Symbol
(`js/ui/tasten-symbol.js`, Icon je Taste im Feld `symbol`); die Zuordnung
Bit → Taste steht in
`js/ble/zwift-ride-tasten.json`. Alle Tasten außer Ein/Aus sind am eigenen
Lenker bestätigt, auch Ein/Aus (Bit 11/15; halten schaltet das Pad aus,
daher in der Lenkeransicht ausgeblendet). Ungeprüfte Einträge
(`"sicher": false`) würden zusätzlich die Bit-Nummer zeigen. Zur Diagnose erscheint jede gedrückte Taste im Diagnose-Log als
`Ride-Taste Bit <n> gedrückt (laut Tabelle: <ID>)` — damit lässt sich die
Tabelle am Gerät prüfen und bei Bedarf `sicher` auf `true` setzen.

Die orangen Schulter-Paddles sind analog (−100…+100) und schlagen in beide
Richtungen aus; das Vorzeichen ist die Richtung. Die App macht daraus vier
virtuelle Tasten (Bit 24/25 = links +/−, Bit 26/27 = rechts +/−; gedrückt
ab Betrag 40, losgelassen unter 20 oder beim Kippen auf die Gegenseite),
die sich wie jede andere Taste im Lern-Modus belegen lassen. Das Log zeigt
beim Drücken den Rohwert und beim Loslassen die Spitze
(`Ride-Paddle links losgelassen — Spitze -87`). Das Vorzeichen ist die
absolute Richtung (+ = nach rechts): links innen = Bit 24, links außen = 25,
rechts außen = 26, rechts innen = 27 (am Gerät bestätigt).

Halten wiederholt ± (Einstellungen → Geräte, beides abschaltbar): Tasten nach
500 ms Pause alle 400 ms; Paddles nach mindestens 400 ms im Takt nach Druck
(Schwelle 40 → 600 ms, Vollausschlag → 150 ms, der Takt folgt dem Druck
laufend). Block vor/zurück und STOPP wiederholen nie. Kommt keine
Loslass-Meldung an, bricht die Wiederholung nach 10 s ab (Log-Warnung).
