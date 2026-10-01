# ergoMergo — Datenschutz & Sicherheit: Selbstprüfung

ergoMergo ist kein Werkzeug, das Daten abgreift, und kein Einfallstor auf dein
Gerät. Diese Seite sagt, **was** die App tut, **womit** wir das belegen und
**wie du es selbst nachprüfst**. Sie ist eine *Selbstprüfung nach offenem
Prüfkatalog* — keine Zertifizierung durch eine unabhängige Stelle. Jede
Prüfung läuft automatisch vor jeder Veröffentlichung (`.github/workflows/pages.yml`)
und lokal mit `npm test`; scheitert eine, wird nichts veröffentlicht.

## Kurz

- **Die App schickt deine Daten nirgendwohin.** Kein Server von uns, kein Konto,
  keine Analyse, keine Werbung, keine Cookies, keine fremden Bibliotheken.
- **Der Browser erzwingt das:** Eine Content-Security-Policy erlaubt Verbindungen
  nur zur eigenen Adresse der App (`connect-src 'self'`). Selbst eingeschleuster
  Code könnte nichts an einen fremden Server schicken.
- **Ohne Netz läuft alles.** Ist das Gerät online, fragt die App nur die Datei
  `sw.js` ab, um Updates zu erkennen — beim Öffnen, beim Zurückkehren in die App
  und alle 10 Minuten, **nie während der Fahrt**. Dabei werden keine Daten
  gesendet; GitHub (der Hoster) sieht wie bei jedem Seitenaufruf IP-Adresse und
  Zeitpunkt.
- **Bluetooth nur für die Geräte, die du im Chrome-Dialog auswählst**, und nur
  die nötigen Dienste. Keine Abfrage von Standort, Kamera, Mikrofon, Kontakten
  oder Benachrichtigungen.

## Wohin geht etwas? (Datenfluss-Register)

| Wohin | Was | Wann |
|---|---|---|
| eigene Adresse (GitHub Pages) | die App-Dateien | Erststart und nach Updates |
| eigene Adresse | `sw.js` (nur lesen, ohne Nutzdaten) | Update-Prüfung: Start, Zurückkehren, alle 10 min — nicht während der Fahrt |
| eigene Adresse | `audio/*.ogg` (Sprach-Bausteine) | bei Ansagen, meist aus dem Offline-Speicher |
| Trainer, Herzgurt, Lenker | Watt-Ziele, Start/Stopp an den Trainer; vom Gurt wird nur gelesen | während der Fahrt, per Bluetooth |
| Datei auf deinem Gerät | Sicherung, TCX-Export, Diagnose-Log | nur auf deinen Tipp |
| **sonst nirgendwohin** | — | — |

Erzeugt aus dem Code mit `node tools/datenschutz-check.mjs --register`; jede
neue Netzstelle ohne Freigabe lässt die Prüfung scheitern.

## Was wird gespeichert? (nur auf deinem Gerät)

| Wo | Was | Löschen |
|---|---|---|
| IndexedDB `ergomergo` · sessions | je Fahrt: Zeit, Dauer, Programm, Kennwerte (Watt, kJ, km, NP, TSS), **Herzfrequenz-Mittel/-Maximum**, Zonenzeiten, Plan-Zuordnung | Fahrt öffnen → Löschen |
| · sessionData | Sekundenwerte der Fahrt: Watt, Ziel, Kadenz, **Herzfrequenz**, Geschwindigkeit | mit der Fahrt |
| · settings | FTP, Wattschritt, Grenzen, Töne, Tastenbelegung, Trainingsplan, gemerkte Geräte (Name + Browser-ID) | Einstellungen / Plan beenden / Gerät entfernen |
| · programme | importierte `.zwo`-Workouts | Kachel → ✕ |
| · logs | Diagnose-Log (Gerätenamen, Firmware, Programmnamen, Fehler — keine Herzfrequenz, keine Wattreihen), max. 2000 Einträge | Einstellungen → Diagnose-Log → Leeren |
| localStorage | `uiState` (zuletzt offener Bildschirm), `rubrik-*` (auf-/zugeklappt), `seed-*` (Fartlek-Ablauf) | Browserdaten löschen |
| sessionStorage | `driftReload` (einmaliger Update-Neustart) | endet mit dem Tab |
| Cache Storage | `ergomergo-vX.Y` — die App-Dateien für den Offline-Start | Browserdaten löschen |

Herzfrequenz ist ein Gesundheitsdatum (Art. 9 DSGVO). Sie verlässt das Gerät
nur, wenn **du** eine Sicherung oder einen TCX-Export erstellst und weitergibst.

## Prüfkatalog

Gliederung angelehnt an OWASP ASVS 5.0 (Frontend, Data Protection), die OWASP
Client-Side Top 10, OWASP MASVS-PRIVACY und DSGVO Art. 5/9/25/32. Serverseitige
Anforderungen sind „n/a — kein Backend".

| ID | Prüfpunkt | Nachweis |
|---|---|---|
| NET-01 | Anfragen nur an die eigene Adresse und nur an ausgelieferte Dateien | `test/netz.mjs`: Mitschnitt aller Abläufe inkl. Service Worker |
| NET-02 | nur lesen (GET) — nirgends ein Senden von Daten | `test/netz.mjs` |
| NET-03 | ohne Zutun nur die Update-Prüfung; während der Fahrt keine | `test/netz.mjs` (Leerlauf + Fahrt) |
| NET-04 | jede Netz-/Navigationsstelle im Code ist begründet freigegeben | `tools/datenschutz-check.mjs` |
| NET-05 | Sprachausgabe nur mit lokaler Stimme (kein Online-Sprachdienst) | Code-Review `js/signals.js` |
| CSP-01/02 | Content-Security-Policy vorhanden und unverändert | `tools/datenschutz-check.mjs` |
| CSP-03 | fremde Server werden blockiert (fetch, Beacon, WebSocket, Bild) | `test/netz.mjs` |
| STO-01 | keine Cookies | `test/netz.mjs` |
| STO-02 | Speicher nur wie oben dokumentiert | `test/netz.mjs` |
| STO-03 | Sicherung ohne gerätebezogene Daten | `test/sicherheit.mjs` |
| DOM-01 | präparierte Sicherung führt keinen Code aus und wird bereinigt | `test/sicherheit.mjs` |
| DOM-02 | jede Bildschirmausgabe aus Fremddaten über `textContent` oder `esc()` | Code-Review + CSP |
| BLE-01 | Bluetooth nur per Tipp, Gerätewahl im Chrome-Dialog, minimale Dienste | Code-Review `js/ble/*` |
| BLE-02 | an den Trainer nur Steuerbefehle (Kontrolle, Start/Stopp, Watt ≤ Obergrenze) | Code-Review `js/ble/ftms.js` |
| PER-01 | keine Berechtigung außer Bluetooth (Wake Lock nur während der Fahrt) | Code-Review |
| DEP-01 | keine Laufzeit-Abhängigkeiten, keine fremden Skripte, Schriften, Bilder | `tools/datenschutz-check.mjs` |
| PUB-01 | veröffentlicht werden nur die App-Dateien | `tools/auslieferung.mjs` + Deploy |

## Was wir nicht garantieren können

- **Hoster:** GitHub Pages sieht bei jedem Abruf IP-Adresse, Browser und Zeit.
- **Gemeinsame Adresse:** Die App liegt unter `grenzenloseschublade.github.io`,
  wo weitere Projekte desselben Kontos liegen. Browser trennen Speicher nach
  Adresse, nicht nach Pfad — diese Projekte könnten technisch auf denselben
  Speicher zugreifen. (Eine eigene Domain würde das lösen.)
- **Meta-CSP:** Die Policy steht im HTML, nicht als Server-Header — Einbetten in
  fremde Seiten (`frame-ancestors`) lässt sich damit nicht verbieten; Bluetooth
  ist in eingebetteten Seiten ohnehin gesperrt.
- **Browser und Betriebssystem:** Synchronisierung, Backups oder Erweiterungen
  deines Browsers liegen außerhalb der App.

## So prüfst du es selbst (5 Minuten)

1. App in Chrome öffnen, **F12** → Reiter **Network**, „Preserve log" an.
2. Demo starten (`?demo`), eine Weile fahren, Fahrten ansehen, Einstellungen öffnen.
3. In der Liste stehen nur Anfragen an `grenzenloseschublade.github.io`, alle
   vom Typ GET; während der Fahrt keine.
4. **Quelltext anzeigen** (Strg+U): die Zeile `Content-Security-Policy` mit
   `connect-src 'self'`.
5. F12 → **Application**: keine Cookies; Speicher nur wie in der Tabelle oben.
6. Bluetooth-Freigaben: `chrome://settings/content/bluetoothDevices`.
7. Flugmodus an, App neu öffnen: läuft weiter.

Oder alles automatisch: Repository klonen, `npm run datenschutz` (braucht
Node ≥ 22 und Chrome).

## Fund melden

Du findest etwas, das gesendet oder gespeichert wird und hier nicht steht?
Das ist ein Fehler — bitte melden, siehe [SECURITY.md](../SECURITY.md).
