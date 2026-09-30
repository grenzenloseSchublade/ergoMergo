// TCX-Export (Garmin Training Center XML). Akzeptiert von Strava,
// Garmin Connect und intervals.icu. Watt über die ns3-Activity-Extension.

import { FIELDS } from './storage.js';
import { dateiStempel } from './format.js';

// Dateiname einer Fahrt (Ortszeit des Starts) — Download und Upload gleich
export const tcxDateiname = session => `ergomergo-${dateiStempel(new Date(session.start))}.tcx`;

// Upload zu intervals.icu (Basic Auth, CORS nur auf /api/v1/-Endpunkten)
export async function ladeZuIntervals(session, samples, count, apiKey) {
  const fd = new FormData();
  fd.append('file', new Blob([toTCX(session, samples, count)], { type: 'application/xml' }), tcxDateiname(session));
  fd.append('name', `ergoMergo: ${session.programm}`);
  const resp = await fetch('https://intervals.icu/api/v1/athlete/0/activities', {
    method: 'POST',
    headers: { Authorization: 'Basic ' + btoa('API_KEY:' + apiKey) },
    body: fd,
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
}

// Lap-Summen aus denselben Samples wie die Trackpoints (ganze Fahrt inkl.
// Ausfahren) — die App-Kennwerte beziehen Ø/max W aufs Programmfenster
export function toTCX(session, samples, count) {
  const startISO = new Date(session.start).toISOString();
  const pts = [];
  let dist = 0, sumW = 0, maxW = 0;
  for (let k = 0; k < count; k++) {
    const i = k * FIELDS;
    sumW += samples[i + 1];
    maxW = Math.max(maxW, samples[i + 1]);
    const t = new Date(session.start + samples[i] * 1000).toISOString();
    const kmh = samples[i + 5] / 10;
    dist += kmh / 3.6;
    const hr = samples[i + 4];
    // Elementreihenfolge laut TCX-XSD: Time, DistanceMeters, HeartRateBpm, Cadence, Extensions
    pts.push(`      <Trackpoint>
        <Time>${t}</Time>
        <DistanceMeters>${dist.toFixed(1)}</DistanceMeters>${hr > 0 ? `
        <HeartRateBpm><Value>${hr}</Value></HeartRateBpm>` : ''}
        <Cadence>${samples[i + 3]}</Cadence>
        <Extensions><ns3:TPX><ns3:Watts>${samples[i + 1]}</ns3:Watts></ns3:TPX></Extensions>
      </Trackpoint>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"
  xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2">
  <Activities>
    <Activity Sport="Biking">
      <Id>${startISO}</Id>
      <Lap StartTime="${startISO}">
        <TotalTimeSeconds>${count}</TotalTimeSeconds>
        <DistanceMeters>${dist.toFixed(1)}</DistanceMeters>
        <Calories>${Math.round(sumW / 1000)}</Calories><!-- Konvention: kJ ≈ kcal bei ~24 % Wirkungsgrad -->
        <Intensity>Active</Intensity>
        <TriggerMethod>Manual</TriggerMethod>
        <Track>
${pts.join('\n')}
        </Track>
        <Extensions><ns3:LX><ns3:AvgWatts>${count ? Math.round(sumW / count) : 0}</ns3:AvgWatts><ns3:MaxWatts>${maxW}</ns3:MaxWatts></ns3:LX></Extensions>
      </Lap>
    </Activity>
  </Activities>
</TrainingCenterDatabase>`;
}

export function download(filename, text, type = 'application/xml') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
