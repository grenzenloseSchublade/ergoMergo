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
| `?dlg=<id>` | Startdialog eines Programms direkt öffnen |
| `?big=<id>` | Graph-Vollbild eines Programms direkt öffnen |

Demo-Fahrten werden nicht in die Historie gespeichert.

## 5. Zwift-Ride-Tastenbelegung ermitteln

Controller im Fahrbildschirm über „+ Controller" verbinden, beliebige Tasten drücken, dann Diagnose-Log ansehen: jede Taste erscheint als `Ride-Taste Bit <n> gedrückt`. Die Bits für ± sind als Einstellung hinterlegt (Standard: Bit 4 = plus, Bit 0 = minus) und können bei Abweichung angepasst werden.
