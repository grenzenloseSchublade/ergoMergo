# ergoMergo

Eine Progressive Web App, die einen Wahoo KICKR CORE 2 als wattgesteuertes Ergometer betreibt — ohne Zwift, ohne Abo, ohne Konto. Vanilla JS, Web Bluetooth (FTMS), keine Buildkette, kein Backend.

## Nutzung

Die App läuft in Chrome unter Android (Primärziel, Handy am Lenker) und unter Ubuntu/Windows. iOS wird nicht unterstützt (kein Web Bluetooth).

- **Android:** Seite öffnen bzw. als App installieren, Trainer auswählen, fahren. Den Trainer **nicht** vorab in den Android-Bluetooth-Einstellungen koppeln — das blockiert die Verbindung aus der App.
- **Linux:** Web Bluetooth ist hinter einer Flag: `chrome://flags/#enable-web-bluetooth` (oder `#enable-experimental-web-platform-features`) aktivieren. Falls die Verbindung am Pairing scheitert, den Trainer einmalig per `bluetoothctl` koppeln (`pair` + `trust`), danach verbindet Chrome über die bestehende Kopplung.
- Optional auf allen Plattformen: `chrome://flags/#enable-web-bluetooth-new-permissions-backend` erspart die Geräteauswahl bei jedem Start.

## Workouts nach Zeit & Typ

Auf dem Startbildschirm eine Dauer und einen Trainingstyp wählen — die App generiert daraus ein vollständiges Programm mit Warmup-Rampe, skaliertem Hauptteil und Cooldown:

- **Sprint 30/30** (Billat), **HIIT 40/20**, **VO2max 4×4** (norwegisch), **Schwelle/Sweet Spot**, **Ausdauer** (Z2 + Tempo-Blöcke), **Recovery**.
- Intensitäten sind fix (%FTP), die Zeit skaliert über Wiederholungen und Z2-Füller. Ohne FTP-Wert wird 170 W angenommen; der Regler „Intensität %" im Startdialog verschiebt alles nach oben/unten.
- Kein Tabata und keine 10-s-Sprints: Der ERG-Modus braucht 2–6 s pro Sollwertwechsel, Intervalle unter 30 s wären überwiegend Rampe.

Strukturen, Formeln und Quellen: [docs/programme.md](docs/programme.md)

## Daten & Speicherung

Alle Daten liegen **lokal** in einer IndexedDB (`ergomergo`) im Chrome-Profil des jeweiligen Geräts — kein Server, kein Konto, keine Cloud. Stores: `sessions` (Kennwerte je Fahrt: Dauer, Ø/max Watt, kJ, NP, IF/TSS, HF, Zeit in Zonen, Gerät, Firmware), `sessionData` (Rohsamples, 1/s), `settings`, `programme`, `logs` (Diagnose). `navigator.storage.persist()` schützt vor automatischem Aufräumen durch den Browser. Sicherung: TCX-Export je Fahrt; „Browserdaten löschen" entfernt alles. Ein geräteübergreifender Verlauf existiert bewusst nicht (kein Backend).

## Geräte & schnelles Starten

Der Kachel-Tap bleibt der einzige nötige Schritt. Einmal verbundene Geräte (Trainer, HF-Gurt, Zwift Click/Ride) werden gemerkt; unterstützt der Browser persistente Web-Bluetooth-Berechtigungen (`chrome://flags/#enable-web-bluetooth-new-permissions-backend`), verbindet die App beim Start **ohne Geräteauswahl** direkt, HF-Gurt und Controller automatisch mit. Ohne Flag bleibt es bei einem Chooser-Tap pro Sitzung. Verwaltung unter Einstellungen → „Geräte".

## Firmware

Die App liest die Trainer-Firmware-Version aus (Geräte-Liste und Diagnose-Log). **Updates macht sie nicht** — dafür gibt es kein öffentliches Protokoll: der KICKR CORE 2 aktualisiert sich automatisch über WLAN (bzw. Wahoo-App), Zwift Ride/Click über die Zwift-Companion-App. Hinweis: Ride-Firmware ab Jan 2025 wechselt die BLE-Service-UUID auf `FC82` — die App unterstützt beide Varianten.

Fehlersuche: [docs/debugging.md](docs/debugging.md)

## Entwicklung

```sh
python3 -m http.server 8000
# http://localhost:8000 — localhost gilt als Secure Context, HTTPS ist lokal nicht nötig.
```

Test vom Android-Gerät: entweder über das GitHub-Pages-Deployment oder per USB-Debugging und Port-Forwarding über `chrome://inspect`.

## V0 — Gerätecheck

`tools/gatt_dump.py` liest per Python/Bleak die GATT-Dienste des Trainers aus und schreibt `docs/services.json`. Das Ergebnis legt fest, welche Modi die App anbieten kann (insbesondere ob FTMS-Widerstandsstufen existieren).

```sh
pip install bleak
python3 tools/gatt_dump.py            # nur lesen
python3 tools/gatt_dump.py --control  # zusätzlich Steuerbefehle testen (Trainer reagiert spürbar)
```

`test/bonding.html` ist die Browser-Gegenprobe: verbindet sich per Web Bluetooth, liest dieselben Characteristics und setzt auf Wunsch 100 W Zielleistung.

## Lizenz

MIT
