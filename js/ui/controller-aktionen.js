// Aktionen, die Controller-Tasten auslösen können — EINE Quelle für
// Lern-Modus, Belegungsliste und Lenkeransicht. key = Event-Name des
// ZwiftController (ride.js abonniert dieselben Namen), label = Langform,
// kurz = Legende der Lenkeransicht, marke = Zeichen an der Taste.

import { tastenVon, istBelegbar } from '../storage.js';

export const CONTROLLER_AKTIONEN = [
  { key: 'plus', label: 'Watt hoch (+)', kurz: 'Watt hoch', marke: '+' },
  { key: 'minus', label: 'Watt runter (−)', kurz: 'Watt runter', marke: '−' },
  { key: 'skip', label: 'Block vor (⏭)', kurz: 'Block vor', marke: '⏭' },
  { key: 'prev', label: 'Block zurück (⏮)', kurz: 'Block zurück', marke: '⏮' },
  { key: 'stopp', label: 'STOPP / WEITER', kurz: 'STOPP', marke: '■' },
];

// Belegt = mindestens eine Taste (Einzelbit oder Liste, tastenVon)
export const istBelegt = (map, key) => tastenVon(map?.[key]).length > 0;

// Belegbar = alles außer Ein/Aus — Regel in storage.js (auch Schema-Prüfung)
export { istBelegbar };

// Aktion, der eine Taste AUSDRÜCKLICH zugeordnet ist (ohne die freie
// Paddle-Gegenrichtung) — Lern-Modus und Lenkeransicht im Lern-Modus
export const aktionMitTaste = (map, bit) => CONTROLLER_AKTIONEN.find(a => tastenVon(map?.[a.key]).includes(bit));
