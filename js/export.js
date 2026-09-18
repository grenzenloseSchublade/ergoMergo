// TCX-Export (Garmin Training Center XML). Akzeptiert von Strava,
// Garmin Connect und intervals.icu. Watt über die ns3-Activity-Extension.

import { FIELDS } from './storage.js';

export function toTCX(session, samples, count) {
  const startISO = new Date(session.start).toISOString();
  const pts = [];
  let dist = 0;
  for (let k = 0; k < count; k++) {
    const i = k * FIELDS;
    const t = new Date(session.start + samples[i] * 1000).toISOString();
    const kmh = samples[i + 5] / 10;
    dist += kmh / 3.6;
    const hr = samples[i + 4];
    pts.push(`      <Trackpoint>
        <Time>${t}</Time>
        <DistanceMeters>${dist.toFixed(1)}</DistanceMeters>
        <Cadence>${samples[i + 3]}</Cadence>${hr > 0 ? `
        <HeartRateBpm><Value>${hr}</Value></HeartRateBpm>` : ''}
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
        <TotalTimeSeconds>${session.dauer}</TotalTimeSeconds>
        <DistanceMeters>${dist.toFixed(1)}</DistanceMeters>
        <Calories>${Math.round(session.kJ)}</Calories><!-- Konvention: kJ ≈ kcal bei ~24 % Wirkungsgrad -->
        <Intensity>Active</Intensity>
        <TriggerMethod>Manual</TriggerMethod>
        <Track>
${pts.join('\n')}
        </Track>
        <Extensions><ns3:LX><ns3:AvgWatts>${session.avgW}</ns3:AvgWatts><ns3:MaxWatts>${session.maxW}</ns3:MaxWatts></ns3:LX></Extensions>
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
