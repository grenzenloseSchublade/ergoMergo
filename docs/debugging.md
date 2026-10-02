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
Controller und fragt Aktion für Aktion (+/−, Block vor/zurück, STOPP) die
Tasten ab — je Aktion beliebig viele (höchstens `MAX_TASTEN_JE_AKTION` = 4)
nacheinander, nochmal drücken nimmt eine Taste wieder heraus, „Weiter“ bzw.
„Ohne Belegung weiter“ geht zur nächsten Aktion. Eine Taste, die schon eine
frühere Aktion hat, wird abgewiesen. Die Belegung landet als `controllerMap`
in den Einstellungen: je Aktion ein Bit (`skip: 2`), eine Liste von Bits
(`plus: [26, 25]`) oder `null` (bewusst unbelegt). Eine Liste mit einem Bit
wird als Einzelbit gespeichert. Das Schema in `js/storage.js` (`tastenMap`)
lässt Listen nur eindeutig, mit 1–4 bekannten Tasten und ohne Ein/Aus zu —
auch beim Import einer Sicherung; `tastenVon()` macht aus jedem Wert die
Liste der Bits.
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
ab Betrag 40, losgelassen unter 20 oder beim Kippen auf die Gegenseite).
Die Auflösung Bit → Aktionen steht an EINER Stelle (`aktionenJeBit` in
`zwift-controller.js`), Controller, Tick und Anzeige nutzen sie: jedes Bit
einer Aktion löst sie aus. Ist von einem Paddle nur eine Richtung belegt
(z. B. `plus: 26`) und die Gegenrichtung von keiner Aktion, wirkt die
Gegenrichtung gleich — das Paddle ist dann **eine** Taste (Partner aus
`analogOrt` der Tastentabelle, `tastenGruppe`), Kippen auf die Gegenseite
ist kein neuer Druck (kein zweites Auslösen, Halten läuft weiter). Sind
beide Richtungen verschieden belegt (z. B. `plus: 26, minus: 27`), gilt jede
für sich; Kippen in einem Zug ist dann Loslassen und neuer Druck der
Gegenrichtung. Standard ohne gespeicherte Belegung (`STANDARD_TASTEN` in
`js/storage.js`): Watt hoch = beide Paddles nach außen (`[26, 25]`), Watt
runter = beide nach innen (`[27, 24]`), Block vor/zurück = Pfeil
rechts/links, STOPP = B; fehlt in einer gespeicherten Belegung eine Aktion,
ergänzt der Standard sie nur mit seinen freien Tasten (`mitStandardBelegung`;
z. B. alte Belegung `{plus: 26}` → Watt runter = links innen, wirkt am ganzen
linken Paddle). Das Log zeigt
beim Drücken den Rohwert und beim Loslassen die Spitze
(`Ride-Paddle links losgelassen — Spitze -87`). Das Vorzeichen ist die
absolute Richtung (+ = nach rechts): links innen = Bit 24, links außen = 25,
rechts außen = 26, rechts innen = 27 (am Gerät bestätigt).

Halten wiederholt ± (Einstellungen → Geräte, Tasten und Paddles getrennt
abschaltbar), beide im selben festen Takt aus `HALTEN_TEMPO` (`js/storage.js`,
Einstellung `haltenTempo`): Ruhig (Standard) erste Wiederholung nach 800 ms,
dann alle 400 ms; Normal 600/300 ms; Flott 400/150 ms. Ein Takt nach
Paddle-Druck war wirkungslos — die Paddles melden fast immer sofort ±100.
Block vor/zurück und STOPP wiederholen nie. Kommt keine Loslass-Meldung an,
bricht die Wiederholung nach 10 s ab (Log-Warnung).

In der Fahrt quittiert ein kurzer hoher Tick (mit Aufblitzen des Zielwerts)
jede belegte Taste; eine unbelegte Taste gibt einen tiefen Doppel-Tick ohne
Aufblitzen, Ein/Aus bleibt stumm (nur mit eingeschalteten Signaltönen).

## 6. Bildschirm, Audiofokus und Fahrtende im Log

- `[wakelock]` — Bildschirm wach halten in der Fahrt: `angefordert`,
  `abgelehnt <Name>: <Meldung>` (z. B. Energiesparmodus; dann läuft einmal pro
  Fahrt „Bildschirm bleibt nicht an — Energiesparmodus aus?" durch die
  LED-Zeile), `freigegeben (Seite verdeckt | Fahrtende)` und `bei sichtbarer
  Fahrt entzogen — fordere neu an` (höchstens alle 5 s; nach 5 Einträgen nur
  noch die Summe am Fahrtende).
- `[audio] Audio Session API …` — einmal beim ersten Ton: ob der Browser die
  API hat und welcher Typ gilt (`ambient` = mischt mit YouTube & Co., statt
  sie anzuhalten). Chrome hat sie (Stand 10/2026) noch nicht.
- `[session] Reconnect während der Fahrt: riding|gestoppt, Ziel … W` und
  `[session] Fahrtende: Ziel 0 W bestätigt` bzw. `… nicht bestätigt` mit
  Grund (Trainer nicht verbunden, Control Point beschäftigt, Fehler).
- `[ftms] Trainer hält die Watt wohl nicht selbst — Firmware aktualisieren?`
  — das Feature-Bit 3 (Leistungsvorgabe, ERG) fehlt; Set Target Power wird
  trotzdem versucht. Derselbe Satz steht beim Fahrtstart in der LED-Zeile
  bzw. beim Verbinden über die Geräte-Leiste als Meldung.
