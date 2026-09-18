// Bootstrap und Screen-Routing.

import { FTMS } from './ble/ftms.js';
import { Session } from './state.js';
import { getSettings, requestPersistence } from './storage.js';
import { RideScreen } from './ui/ride.js';
import { renderList, renderDetail } from './ui/list.js';

const $ = s => document.querySelector(s);
const screens = { home: $('#screen-home'), ride: $('#screen-ride'), detail: $('#screen-detail') };

function show(name) {
  for (const [k, el] of Object.entries(screens)) el.hidden = k !== name;
}

let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on) {
      wakeLock = await navigator.wakeLock?.request('screen');
    } else {
      await wakeLock?.release();
      wakeLock = null;
    }
  } catch { /* Wake Lock optional */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !screens.ride.hidden) keepAwake(true);
});

let rideScreen = null;

async function startFree() {
  const settings = await getSettings();
  const ftms = new FTMS();
  try {
    await ftms.connect();
  } catch (err) {
    if (err.name !== 'NotFoundError') alert('Verbindung fehlgeschlagen: ' + err.message);
    return;
  }
  requestPersistence();
  const session = new Session(ftms, settings);
  session.setTarget(settings.startWatt, { instant: true });
  show('ride');
  keepAwake(true);
  rideScreen = new RideScreen(screens.ride, session, settings, async () => {
    rideScreen.destroy();
    rideScreen = null;
    ftms.disconnect();
    keepAwake(false);
    await goHome();
  });
}

async function goHome() {
  show('home');
  await renderList($('#session-list'), openDetail);
}

async function openDetail(sessionMeta) {
  show('detail');
  await renderDetail(screens.detail, sessionMeta, goHome);
}

$('#start-free').addEventListener('click', startFree);
$('#btn-back').addEventListener('click', goHome);

// ?demo — Fahrbildschirm mit synthetischen Daten, ohne Trainer (UI-Arbeit, Screenshots)
async function startDemo() {
  const settings = await getSettings();
  const ftms = new EventTarget();
  Object.assign(ftms, { connected: true, busy: false, setTargetPower: async () => {}, disconnect: () => {} });
  const session = new Session(ftms, settings);
  session.setTarget(180, { instant: true });
  // 8 min synthetische Historie, damit Kurve und Werte sofort gefüllt sind
  const F = 6;
  for (let k = 0; k < 480; k++) {
    const ziel = k < 120 ? 120 : k < 300 ? 200 : 160;
    const watt = ziel + Math.round(Math.sin(k / 3) * 10 + (Math.random() - 0.5) * 8);
    session.samples.set([k, watt, ziel, 88, 141, 325], k * F);
    session.kj += watt / 1000;
  }
  session.count = 480;
  Object.assign(session.live, { watt: 162, rpm: 89, hr: 142, kmh: 32.5 });
  session.setTarget(160, { instant: true });
  let t = 0;
  setInterval(() => {
    t++;
    ftms.dispatchEvent(new CustomEvent('data', { detail: {
      watt: Math.round(session.target + Math.sin(t / 3) * 12 + (Math.random() - 0.5) * 10),
      rpm: 88 + Math.round(Math.sin(t / 7) * 4),
      kmh: 32.5, hr: 142,
    } }));
  }, 1000);
  show('ride');
  rideScreen = new RideScreen(screens.ride, session, settings, async () => { location.search = ''; });
  ftms.dispatchEvent(new Event('connected'));
}


if (!navigator.bluetooth) {
  $('#bt-support').textContent = 'Kein Web Bluetooth — Chrome unter Android/Desktop nötig';
  $('#start-free').disabled = true;
}

if (new URLSearchParams(location.search).has('demo')) startDemo();
else goHome();
