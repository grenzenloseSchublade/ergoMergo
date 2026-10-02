// Navigation und App-Lebenszyklus: Browser-History für Screens und Dialoge,
// geordnetes Neuladen (Updates).
//
// History-Regel: Home ist die Wurzel. Jeder Screen darüber (Fahrten, Detail,
// Fahrt) und jeder offene Dialog hat GENAU einen Eintrag. Zurück — Taste
// oder UI-Knopf — baut den obersten Eintrag ab; nur popstate schaltet dann
// die Ansicht. Wird ein Eintrag programmatisch abgebaut (Dialog per OK
// geschlossen, Fahrt beendet), ist die Ansicht schon umgeschaltet: der
// folgende popstate wird „still" übergangen.

import { logInfo, flushJetzt } from './logger.js';

let still = 0;                 // so viele kommende popstates ignorieren
let danach = [];               // wartet, bis die eigenen Abbauten durch sind
const modale = [];             // offene Dialoge, oberster zuletzt

// Beim popstate zuerst fragen: war das unser eigenes history.back()?
export function istStill() {
  if (!still) return false;
  still--;
  if (!still) { const f = danach; danach = []; for (const fn of f) setTimeout(fn); }
  return true;
}

// fn ausführen, sobald die eigenen history.back() abgearbeitet sind — ein
// Dialog, der direkt nach dem Schließen eines anderen aufgeht, legte seinen
// Eintrag sonst an, bevor das back() läuft, und verlöre ihn wieder
export function nachAbbau(fn) {
  if (still) danach.push(fn);
  else fn();
}

// Eigenen Eintrag abbauen, ohne dass popstate noch einmal navigiert
export function eintragAbbauen() {
  if (!history.state?.screen && !history.state?.dialog) return;
  still++;
  history.back();
}

// Zurück aus einem Screen: über die History (popstate navigiert), sonst —
// falls kein eigener Eintrag existiert — direkt
export function zurueck(ersatz) {
  if (history.state?.screen) history.back();
  else ersatz();
}

// Modalen Dialog öffnen: History-Eintrag (Zurück schließt ihn), returnValue
// zurückgesetzt (sonst bliebe „ok" vom letzten Mal stehen und Zurück/Esc
// zählte als Bestätigung — der Startdialog startete so eine Fahrt), kein
// Auto-Fokus (sonst klappt am Gerät sofort die Tastatur auf).
// modal:false öffnet ohne Backdrop (show statt showModal) — für Menüs im
// Fahrbildschirm, neben denen STOPP bedienbar bleiben muss; History und
// Zurück-Taste funktionieren genauso.
export function oeffneModal(dlg, name, { modal = true } = {}) {
  dlg.returnValue = '';
  history.pushState({ dialog: name }, '');
  modale.push(dlg);
  dlg.addEventListener('close', () => {
    const i = modale.indexOf(dlg);
    if (i >= 0) modale.splice(i, 1);
    // Per OK/Abbrechen/Esc geschlossen → eigenen Eintrag abbauen; bei der
    // Zurück-Taste ist er schon gepoppt
    if (history.state?.dialog === name) eintragAbbauen();
    ausstehendNachholen();
  }, { once: true });
  if (modal) dlg.showModal();
  else dlg.show();
  document.activeElement?.blur();
}

const offeneModale = () => modale.length;

// Zurück-Taste: obersten Dialog abbrechen. true = es war einer offen.
export function schliesseObersten() {
  const dlg = modale.at(-1);
  if (!dlg) return false;
  dlg.close('cancel');
  return true;
}

// --- Neuladen (Updates) ---------------------------------------------------------

let darfNeuLaden = () => true;
let ausstehend = null;

// Regel der App: wann stört ein Reload niemanden (keine Fahrt, kein
// Verbindungsaufbau, kein offener Dialog)?
export function setzeReloadRegel(fn) { darfNeuLaden = fn; }

// Neu laden, sobald es niemanden stört — sonst merken und nachholen.
// Log vorher schreiben, sonst gehen die letzten Einträge verloren.
export async function neuLaden(grund) {
  if (!darfNeuLaden() || offeneModale()) { ausstehend = grund; return false; }
  ausstehend = null;
  logInfo('app', `Neu laden: ${grund}`);
  await flushJetzt();
  location.reload();
  return true;
}

// Ausstehendes Neuladen nachholen (Home erreicht, Dialog zu, App sichtbar).
// verzoegerung: z. B. damit „Fahrt gespeichert" noch zu lesen ist.
export function ausstehendNachholen(verzoegerung = 0) {
  if (!ausstehend) return;
  const grund = ausstehend;
  setTimeout(() => neuLaden(grund), verzoegerung);
}

