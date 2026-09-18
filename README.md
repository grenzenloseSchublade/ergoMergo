# ergoMergo

Eine Progressive Web App, die einen Wahoo KICKR CORE 2 als wattgesteuertes Ergometer betreibt — ohne Zwift, ohne Abo, ohne Konto. Vanilla JS, Web Bluetooth (FTMS), keine Buildkette, kein Backend.

## Nutzung

Die App läuft in Chrome unter Android (Primärziel, Handy am Lenker) und unter Ubuntu/Windows. iOS wird nicht unterstützt (kein Web Bluetooth).

- **Android:** Seite öffnen bzw. als App installieren, Trainer auswählen, fahren. Den Trainer **nicht** vorab in den Android-Bluetooth-Einstellungen koppeln — das blockiert die Verbindung aus der App.
- **Linux:** Web Bluetooth ist hinter einer Flag: `chrome://flags/#enable-web-bluetooth` (oder `#enable-experimental-web-platform-features`) aktivieren. Falls die Verbindung am Pairing scheitert, den Trainer einmalig per `bluetoothctl` koppeln (`pair` + `trust`), danach verbindet Chrome über die bestehende Kopplung.
- Optional auf allen Plattformen: `chrome://flags/#enable-web-bluetooth-new-permissions-backend` erspart die Geräteauswahl bei jedem Start.

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
