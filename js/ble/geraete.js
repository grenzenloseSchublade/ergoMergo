// Gemerkte Geräte: Wiederverbinden ohne Chooser über getDevices() —
// funktioniert nur, wenn Chrome persistente Web-Bluetooth-Berechtigungen hat
// (Flag chrome://flags/#enable-web-bluetooth-new-permissions-backend bzw.
// sobald Chrome das default ausliefert). Ohne getDevices degradiert alles
// sauber auf den bisherigen Chooser-Weg.

import { getSettings, setSetting } from '../storage.js';
import { logInfo, logWarn } from '../logger.js';

export const kannMerken = () => !!navigator.bluetooth?.getDevices;

export async function findeGemerktesGeraet(id) {
  if (!id || !kannMerken()) return null;
  try {
    const geraete = await navigator.bluetooth.getDevices();
    return geraete.find(d => d.id === id) ?? null;
  } catch { return null; }
}

// Verbindet ein bereits autorisiertes Gerät: erst direkt, sonst auf
// Advertisement warten (Gerät muss wach sein), dann verbinden.
// Kurzes Fenster: ein schlafendes Gerät darf den Kaltstart nicht lange bremsen
export async function verbindeBekanntes(device, timeoutMs = 4000) {
  try {
    await device.gatt.connect();
    return device;
  } catch { /* noch nicht in Reichweite — auf Advertisement warten */ }
  if (!device.watchAdvertisements) throw new Error('Gerät nicht erreichbar');
  const ctrl = new AbortController();
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ctrl.abort(); reject(new Error('Gerät antwortet nicht')); }, timeoutMs);
    device.addEventListener('advertisementreceived', () => {
      clearTimeout(timer);
      ctrl.abort();
      resolve();
    }, { once: true });
    device.watchAdvertisements({ signal: ctrl.signal }).catch(err => {
      clearTimeout(timer);
      reject(err);
    });
  });
  await device.gatt.connect();
  return device;
}

// Rolle: 'trainer' | 'hr' | 'controller'
export async function merkeGeraet(rolle, device, extra = {}) {
  const s = await getSettings();
  const geraete = { ...(s.geraete ?? {}) };
  geraete[rolle] = { id: device.id, name: device.name ?? null, ...extra };
  await setSetting('geraete', geraete);
  logInfo('geraete', `${rolle} gemerkt: ${device.name}`);
}

export async function vergissGeraet(rolle) {
  const s = await getSettings();
  const geraete = { ...(s.geraete ?? {}) };
  delete geraete[rolle];
  await setSetting('geraete', geraete);
}

// Bequemer Einstieg: gemerktes Gerät der Rolle suchen und verbinden, null wenn nicht möglich
export async function schnellverbinde(rolle) {
  const s = await getSettings();
  const eintrag = s.geraete?.[rolle];
  const device = await findeGemerktesGeraet(eintrag?.id);
  if (!device) return null;
  try {
    return await verbindeBekanntes(device);
  } catch (err) {
    logWarn('geraete', `Schnellverbindung ${rolle} fehlgeschlagen`, err.message);
    return null;
  }
}
