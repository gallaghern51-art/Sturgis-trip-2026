// Rider export pack: GPX tracks for Garmin/phone nav, ICS calendar for everyone's phone.

import { dayTimeline, fmtTime, fmtDur } from './timeline.js';

const xml = (s) => String(s ?? '').replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

// Waypoint names carry the planned ETA ("3. Bozeman — ETA 11:50 AM") so any nav
// device shows schedule vs. your clock at every stop, timezone-proof.
function gpxSegment(day, route, routedLegs) {
  const tl = dayTimeline(day, routedLegs);
  const wpts = day.waypoints
    .map((w, i) => {
      const s = tl.stops[i];
      const eta = s ? ` — ETA ${fmtTime(i === 0 ? s.depart : s.arrive)}` : '';
      const stay = s && s.dwell > 0 ? ` · stay ${fmtDur(s.dwell)}, roll ${fmtTime(s.depart)}` : '';
      const desc = [`Plan: arrive ${s ? fmtTime(s.arrive) : '?'}${stay}`, w.note].filter(Boolean).join(' | ');
      return `  <wpt lat="${w.lat}" lon="${w.lng}"><name>${xml(`${i + 1}. ${w.name}${eta}`)}</name><cmt>${xml(desc)}</cmt><desc>${xml(desc)}</desc><sym>${w.fuel ? 'Gas Station' : w.kind === 'photo' ? 'Scenic Area' : 'Flag, Blue'}</sym></wpt>`;
    })
    .join('\n');
  const coords = route?.geometry ?? day.waypoints.map((w) => [w.lng, w.lat]);
  const trkpts = coords.map(([lng, lat]) => `      <trkpt lat="${lat}" lon="${lng}"/>`).join('\n');
  const track = `  <trk><name>${xml(`${day.dow} ${day.date} — ${day.title} (${fmtTime(tl.departMin)} → ${fmtTime(tl.endMin)})`)}</name><trkseg>\n${trkpts}\n  </trkseg></trk>`;
  return { wpts, track };
}

export function tripToGpx(trip, routes, routedLegsByDay = null, onlyDayId = null) {
  const days = onlyDayId ? trip.days.filter((d) => d.id === onlyDayId) : trip.days;
  const parts = days.map((d) => gpxSegment(d, routes?.[d.id], routedLegsByDay?.[d.id]));
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Roadbook" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${xml(onlyDayId ? days[0]?.title : trip.meta.title)}</name></metadata>
${parts.map((p) => p.wpts).join('\n')}
${parts.map((p) => p.track).join('\n')}
</gpx>`;
}

// Local time → UTC using the trip's own offset (meta.utcOffset, hours east of
// UTC; -6 = Mountain DST, the original trip's zone and still the default).
function icsStamp(dateStr, minutes, utcOffset) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d, 0, Math.round(minutes) - utcOffset * 60));
  const p = (n) => String(n).padStart(2, '0');
  return `${dt.getUTCFullYear()}${p(dt.getUTCMonth() + 1)}${p(dt.getUTCDate())}T${p(dt.getUTCHours())}${p(dt.getUTCMinutes())}00Z`;
}

export function tripToIcs(trip, routedLegsByDay) {
  const utcOffset = Number.isFinite(trip.meta?.utcOffset) ? trip.meta.utcOffset : -6;
  const events = trip.days.map((d) => {
    const tl = dayTimeline(d, routedLegsByDay?.[d.id]);
    const first = d.waypoints[0]?.name ?? '';
    const last = d.waypoints[d.waypoints.length - 1]?.name ?? '';
    const gates = (d.gates ?? []).map((g) => `GATE: ${g.label} by ${g.by}`).join('\\n');
    const dinner = d.meals?.find((m) => m.meal === 'dinner');
    const desc = [
      d.summary,
      gates,
      dinner ? `Dinner: ${dinner.name}${dinner.where ? ` — ${dinner.where}` : ''}` : '',
      d.lodging?.name ? `Tonight: ${d.lodging.name}` : '',
    ].filter(Boolean).join('\\n\\n').replace(/\r?\n/g, '\\n');
    return [
      'BEGIN:VEVENT',
      `UID:roadbook-${d.id}@roadbook.app`,
      `DTSTAMP:${icsStamp(d.date, 0, utcOffset)}`,
      `DTSTART:${icsStamp(d.date, tl.departMin, utcOffset)}`,
      `DTEND:${icsStamp(d.date, Math.max(tl.endMin, tl.departMin + 60), utcOffset)}`,
      `SUMMARY:${d.title.replace(/,/g, '\\,')}`,
      `LOCATION:${`${first} → ${last}`.replace(/,/g, '\\,')}`,
      `DESCRIPTION:${desc.replace(/,/g, '\\,')}`,
      'END:VEVENT',
    ].join('\r\n');
  });
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Roadbook//EN', 'CALSCALE:GREGORIAN', ...events, 'END:VCALENDAR'].join('\r\n');
}

export function downloadFile(name, content, mime) {
  const blob = new Blob([content], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
