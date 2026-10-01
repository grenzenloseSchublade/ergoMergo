# ergoMergo

**Zwei Taps bis zum Treten.** ergoMergo macht aus einem Wahoo KICKR (oder jedem
FTMS-Smarttrainer) ein wattgesteuertes Ergometer — direkt im Browser, ohne Zwift,
ohne Abo, ohne Konto, ohne virtuelle Welt. Trainer per Bluetooth verbinden,
Programm oder Wattzahl wählen, fahren.

**Live:** https://grenzenloseschublade.github.io/ergoMergo/

![PWA](https://img.shields.io/badge/PWA-offline--f%C3%A4hig-45c7d4) ![Lizenz](https://img.shields.io/badge/Lizenz-MIT-green) ![Backend](https://img.shields.io/badge/Backend-keins-lightgrey)

## Datenschutz

**Alle Daten bleiben auf dem Gerät.** Fahrten, Einstellungen und Programme
liegen ausschließlich in der lokalen IndexedDB des Browsers — es gibt keinen
Server, kein Konto, keine Cloud, keine Telemetrie, keine Cookies und keine
Drittanbieter-Anfragen. Die App ist eine rein statische Seite; nach dem ersten
Laden funktioniert sie komplett offline. Export (Backup/TCX) passiert nur auf
ausdrücklichen Tap und landet als Datei auf dem eigenen Gerät.

## Warum

Wer nur strukturiert Watt treten will, braucht keine 3D-Welt, kein Monatsabo und
keinen Account. Was fehlte: eine App, die den Trainer ansteuert wie ein
Studio-Ergometer — Ziel-Watt, Intervalle, ±-Tasten am Lenker, Auswertung.
ergoMergo ist genau das: eine einzige statische Web-App (Vanilla JS, Web
Bluetooth/FTMS, keine Buildkette, kein Backend), alle Daten bleiben lokal auf
dem Gerät.

| | | | | |
|---|---|---|---|---|
| ![Startbildschirm mit Trainingsplan](docs/img/start.png) | ![Einheit ändern](docs/img/plan.png) | ![Fahrbildschirm](docs/img/fahrt.png) | ![Panel „Geräte und Töne"](docs/img/panel.png) | ![Fahrten-Historie](docs/img/fahrten.png) |

![Fahrmodus im Querformat](docs/img/quer.png)

## Features

| Bereich | Was drin ist |
|---|---|
| ERG-Steuerung | Ziel-Watt mit sanften Rampen, ±-Tasten (Touch, Tastatur, Zwift Click/Ride), Not-Stopp mit geschütztem WEITER |
| Trainingsplan | Tage/Dauer/Ziel wählen, Wochen mit Aufbau und leichter Testwoche, heutige Einheit mit einem Tipp, verschieben/kürzer/leichter/auslassen mit Rückgängig |
| Programme | Zeitbasierte Generatoren (Sprint 30/30, HIIT 40/20, VO2max 4×4, Schwelle, Ausdauer, Recovery), klassische Programme, FTP-Rampentest, `.zwo`-Import (Einstellungen → Erweitert, standardmäßig aus) |
| Fahrbildschirm | Live-Graph mit Programmprofil und Positionscursor, Blocksteuerung (überspringen/zurück/+30 s), Kadenz-Zielbereiche, Fokus-Modus (Tap auf Werte oder Graph kippt die Gewichtung), LED-Statuszeile, Gerätezustand oben links, Bild-in-Bild (Experiment) |
| Ansagen & Töne | Countdown vor jedem Wechsel, unterscheidbare Signale für härter/leichter (Dur-Dreiklang rauf bzw. Töne abwärts), Sprachansagen aus vorgerenderten Audio-Bausteinen — funktionieren auch mit Bildschirm aus |
| Geräte | Trainer, Herzfrequenz-Gurt, Zwift Click/Ride; Tasten frei belegbar per Lern-Modus; Schnellverbindung ohne Geräteauswahl (mit Chrome-Flag) |
| Auswertung | Dauer, Ø/max/NP, IF/TSS, HF, Distanz (aus Trainer-Speed integriert, im ERG-Modus gangabhängig), Zeit in Zonen, Soll/Ist-Vergleich pro Block, Wochenbilanz, TCX-Export, Akkuverbrauch pro Fahrt |
| Plattform | Installierbare PWA, offlinefähig, alles lokal in IndexedDB — kein Server, keine Cloud; Demo-Modus ohne Trainer (Button auf dem Startbildschirm) |

## Neu in 3.2

- **Plan-Karte wie ein Kalender:** Tag im Wochenstreifen antippen zeigt
  dessen Einheit bzw. die gefahrene Fahrt. Leise Aktionen darunter:
  „Starten ›“ (heute), „Heute fahren ›“ (späterer Tag — legt die Einheit auf
  heute und startet; gesperrt mit Grund, Abbrechen nimmt es zurück),
  „Fahrt ansehen ›“ (gefahren) und „Ändern“.

## Neu in 3.1

- **Plan-Länge** wählbar: 4, 8 oder 12 Wochen oder fortlaufend; am Ende eine
  Bilanz mit „4 Wochen weiter“ oder „Neuer Plan“. Die Karte zeigt „Woche 3 von 8“.
- **Pausieren** ohne Grund; beim Fortsetzen richtet sich der Einstieg nach
  der Pausenlänge (nahtlos · Woche wiederholen · leichte Woche mit FTP-Test ·
  Neubeginn). Nach 7 Tagen ohne Fahrt bietet die Karte das selbst an.
- **Planfahrten sichtbar:** Marke „Plan“ in der Fahrtenliste, „(2 im Plan)“
  im Wochenkopf, in der Detailansicht „Trainingsplan · Woche 3 von 8 ·
  Intervalle“ — auch „statt …“, wenn frei an einem Plantag gefahren wurde.
- Eine abgebrochene Planfahrt (unter 15 min, FTP-Test unter 5 min) gilt nicht
  mehr als erledigt.

## Neu in 3.0

- **Trainingsplan:** Wochentage, Dauer (30/45/60 min) und Ziel (Fitness,
  Leistung, Ausdauer) wählen — die App stellt jede Woche zusammen. Höchstens
  zwei harte Einheiten mit Ruhetag dazwischen, 4-Wochen-Blöcke mit leichter
  Woche und FTP-Rampentest, ohne bekannte FTP zuerst der Test. Auf Home steht
  „Heute: …" (ein Tipp startet die Einheit) und ein Wochenstreifen in
  Zonenfarben. Grundlagen und Quellen: [docs/trainingsplan.md](docs/trainingsplan.md).
- **Einheiten ändern:** Tag im Wochenstreifen antippen — heute fahren,
  verschieben (belegter Tag = Tausch; zu nah an einer harten Einheit =
  gesperrt, mit Grund), kürzer, leichter, auslassen. Jede Änderung lässt sich
  rückgängig machen. Verpasste harte Einheiten wandern automatisch auf den
  nächsten passenden Tag; eine harte Fahrt außerhalb des Plans zählt mit.
- **Design-System:** Farben, Schrift, Radien, Abstände nur noch aus
  `css/tokens.css`; lebendiger Style Guide
  ([docs/stil.html](https://grenzenloseschublade.github.io/ergoMergo/docs/stil.html)),
  eine Prüfung verhindert feste Werte. Alle Tippflächen ≥ 44 px.
- **`.zwo`-Import** ist jetzt eine Einstellung (Erweitert), standardmäßig aus.
- **Tests im Repo:** `npm test` prüft Stil, Plan-Regeln (alle
  Wochentag-Kombinationen, Verpass-Muster, Verschiebungen), Abläufe und
  Layout.

## Neu in 2.0

- **Fahrbildschirm aufgeräumt:** Oben links zeigen drei Symbole mit Punkt den
  Zustand von Trainer, Herzgurt und Lenker; ein Tipp verbindet oder koppelt.
  „⋯" oben rechts öffnet ein Panel mit den Geräten im Klartext (Name, Zustand,
  was ein Tipp bewirkt), Signaltönen, Sprachansagen und Bild-in-Bild. Das Panel
  sperrt nichts: STOPP und ± bleiben daneben sofort bedienbar.
- **LED-Statuszeile:** Meldungen der Fahrt (Block übersprungen, Gerät getrennt,
  Not-Stopp …) laufen als Punktmatrix-Laufschrift durch eine feste Mulde statt
  als Toast — nichts springt, nichts verdeckt.
- **Ruhiges Layout:** Feste Feldbreiten und ein festes Raster für die
  Detailwerte (hochkant 2×2, quer 4 nebeneinander); in allen Ausrichtungen und
  Fokus-Modi geprüft, dass nichts springt und STOPP immer im Bild ist.
- **Fahrten-Historie:** Eigener Screen mit Monaten und Wochensummen,
  Detail-Graph mit Herzfrequenz, Zielblöcken und Not-Stopp-Streifen.
- **Demo:** Beispielfahrten direkt aus der Demo-Fahrt erreichbar, mit Rückweg.

## Getestet mit

| Gerät | Firmware/Version |
|---|---|
| Wahoo KICKR CORE 2 | FW 3.5.37 |
| Zwift Ride (Lenker) | FC82-Firmware (ab Jan 2025), Lern-Modus für Tastenbelegung |
| Samsung-Smartphone, Android-Chrome | Primärziel (Handy am Lenker) |
| Ubuntu-Laptop, Chrome | Sekundärziel |

Jeder FTMS-Trainer sollte funktionieren (Standard-Protokoll); getestet ist die
Kombination oben. iOS wird nicht unterstützt (kein Web Bluetooth in Safari).

## Nutzung

- **Android:** Seite öffnen bzw. als App installieren, Trainer auswählen, fahren.
  Den Trainer **nicht** vorab in den Android-Bluetooth-Einstellungen koppeln —
  das blockiert die Verbindung aus der App.
- **Linux:** Web Bluetooth hinter Flag: `chrome://flags/#enable-web-bluetooth`
  aktivieren. Scheitert das Pairing, den Trainer einmalig per `bluetoothctl`
  koppeln (`pair` + `trust`).
- Optional überall: `chrome://flags/#enable-web-bluetooth-new-permissions-backend`
  erspart die Geräteauswahl bei jedem Start (Schnellverbindung).

## Workouts nach Zeit & Typ

Dauer und Trainingstyp wählen — die App generiert ein vollständiges Programm mit
Warmup-Rampe, skaliertem Hauptteil und Cooldown. Intensitäten sind fix (%FTP),
die Zeit skaliert über Wiederholungen und Z2-Füller. Ohne FTP-Wert wird 170 W
angenommen. Kein Tabata, keine 10-s-Sprints: ERG braucht 2–6 s pro
Sollwertwechsel, kürzere Intervalle wären überwiegend Rampe.
Strukturen, Formeln und Quellen: [docs/programme.md](docs/programme.md)

## Daten & Speicherung

Alle Daten liegen **lokal** in einer IndexedDB (`ergomergo`) im Chrome-Profil —
kein Server, kein Konto, keine Cloud. Stores: `sessions` (Kennwerte je Fahrt),
`sessionData` (Rohsamples 1/s), `settings`, `programme`, `logs` (Diagnose).
`navigator.storage.persist()` schützt vor automatischem Aufräumen. Sicherung:
Komplett-Backup als JSON (Einstellungen → Sicherung) und TCX-Export je Fahrt.

## Geräte & schnelles Starten

Einmal verbundene Geräte (Trainer, HF-Gurt, Zwift Click/Ride) werden gemerkt;
mit persistenten Web-Bluetooth-Berechtigungen verbindet die App beim Start ohne
Geräteauswahl, HF-Gurt und Controller automatisch mit. Zwift-Ride-Tasten werden
in Einstellungen → Geräte → „Tasten zuordnen" interaktiv belegt (+/−, Block
vor/zurück, STOPP). Die rpm-Anzeige kommt direkt vom Trainer (der KICKR schätzt
die Trittfrequenz selbst, kein externer Sensor nötig).

## Firmware

Die App liest die Trainer-Firmware aus (Geräteliste, Diagnose-Log). Updates
macht sie nicht — es gibt kein öffentliches Protokoll: der KICKR CORE 2
aktualisiert über WLAN/Wahoo-App, Zwift Ride/Click über die Companion-App.
Ride-Firmware ab Jan 2025 wechselt die BLE-Service-UUID auf `FC82` — die App
unterstützt beide Varianten. Fehlersuche: [docs/debugging.md](docs/debugging.md)

## Entwicklung

```sh
python3 -m http.server 8000
# http://localhost:8000 — localhost ist Secure Context, HTTPS lokal nicht nötig.
```

Dev-Parameter: `?demo=<workoutId>` (z. B. `?demo=vo2max` — Demo-Fahrt ohne
Trainer), `?demo` (freies Fahren); alle Parameter in
[docs/debugging.md](docs/debugging.md). Test vom Android-Gerät:
GitHub-Pages-Deployment oder USB-Debugging + `chrome://inspect`.

### Stil und Tests

Farben, Schriftgrößen, Radien und Abstände kommen nur aus `css/tokens.css`
(Regeln: [docs/stil.md](docs/stil.md), alle Bausteine live:
[docs/stil.html](https://grenzenloseschublade.github.io/ergoMergo/docs/stil.html)).

```sh
node tools/stil-check.mjs   # feste Werte außerhalb der Tokens (läuft auch in release.mjs)
node test/layout.mjs        # Fahrbildschirm in 5 Größen: Bedienleiste, Überlauf, Zentrierung, Sprünge, Panel
node test/ablauf.mjs        # Navigation, Einstellungen, Fahrt, Programm, Demo-Wege mit Sollwerten
```

Die Browser-Tests brauchen Node ≥ 22 und ein Chrome (`CHROME=/pfad/zu/chrome`,
sonst Playwrights `chrome-headless-shell` oder `google-chrome`); sie starten
ihren eigenen Server.

### Release

Der Versionsstempel steht doppelt (`VERSION` in `sw.js` für die
Update-Erkennung, `APP_VERSION` in `js/version.js` für den
Install-Konsistenz-Check) — laufen sie auseinander, bricht jede
Service-Worker-Installation ab. Deshalb ausschließlich über das Skript bumpen:

```sh
node tools/release.mjs            # nächste Version, setzt beide Stempel
node tools/release.mjs --check    # prüft vor dem Push auf Drift
```

Danach committen (Konvention: „…; Release vXX") und pushen — GitHub Pages
deployt `main` direkt; installierte Apps bieten das Update per Button an.

### V0 — Gerätecheck

`tools/gatt_dump.py` liest per Python/Bleak die GATT-Dienste des Trainers aus
und schreibt `docs/services.json`:

```sh
pip install bleak
python3 tools/gatt_dump.py            # nur lesen
python3 tools/gatt_dump.py --control  # zusätzlich Steuerbefehle testen
```

`test/bonding.html` ist die Browser-Gegenprobe.

### Diagnose-Log vom Gerät ziehen

`tools/log-pull.mjs` holt das Diagnose-Log und die Fahrtdaten direkt aus der
IndexedDB der App auf dem Android-Gerät — ohne Export in der App. Es nutzt
`adb forward` auf den Chrome-DevTools-Socket und das DevTools-Protokoll.
Voraussetzungen: USB-Debugging, Chrome mit offenem ergoMergo-Tab, Node ≥ 22.

```sh
node tools/log-pull.mjs                    # Log anzeigen + Komplett-Dump als JSON
node tools/log-pull.mjs --logs-only        # nur das Log
node tools/log-pull.mjs --seit 2026-09-21  # Log ab Datum
```

## Lizenz

MIT
