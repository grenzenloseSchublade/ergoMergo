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
| `?demo&ping` | zusätzlich 1 Request/s an den Dev-Server — Hintergrund-Throttling im Servlog sichtbar |

Demo-Fahrten werden nicht in die Historie gespeichert. Die Demo nutzt denselben
Fahrbildschirm, Audio-Pfad (Töne + thorsten-Ansagen) und Fahrt-Eintritt wie die
echte Fahrt; nur Datenquelle und Speichern sind simuliert. Beim `?demo`-Start
ohne Berührung bleiben Töne stumm, bis einmal getippt wurde (Autoplay-Policy).

## 5. Zwift-Ride-Tasten belegen

Einstellungen (⚙) → Geräte → „Tasten zuordnen": der Lern-Modus verbindet den
Controller und fragt Aktion für Aktion (+/−, Block vor/zurück, STOPP) eine
Taste ab — die Belegung landet als `controllerMap` in den Einstellungen.
Zur Diagnose erscheint weiterhin jede gedrückte Taste im Diagnose-Log als
`Ride-Taste Bit <n> gedrückt`.
