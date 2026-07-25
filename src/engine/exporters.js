// Rider export pack: GPX tracks for Garmin/phone nav, ICS calendar for everyone's phone.

import { dayTimeline } from './timeline.js';

const xml = (s) => String(s ?? '').replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

function gpxSegment(day, route) {
  const wpts = day.waypoints
    .map((w) => `  <wpt lat="${w.lat}" lon="${w.lng}"><name>${xml(w.name)}</name>${w.note ? `<desc>${xml(w.note)}</desc>` : ''}<sym>${w.fuel ? 'Gas Station' : w.kind === 'photo' ? 'Scenic Area' : 'Flag, Blue'}</sym></wpt>`)
    .join('\n');
  const coords = route?.geometry ?? day.waypoints.map((w) => [w.lng, w.lat]);
  const trkpts = coords.map(([lng, lat]) => `      <trkpt lat="${lat}" lon="${lng}"/>`).join('\n');
  const track = `  <trk><name>${xml(`${day.dow} ${day.date} — ${day.title}`)}</name><trkseg>\n${trkpts}\n  </trkseg></trk>`;
  return { wpts, track };
}

export function tripToGpx(trip, routes, onlyDayId = null) {
  const days = onlyDayId ? trip.days.filter((d) => d.id === onlyDayId) : trip.days;
  const parts = days.map((d) => gpxSegment(d, routes?.[d.id]));
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Sturgis 2026 Trip Planner" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${xml(onlyDayId ? days[0]?.title : trip.meta.title)}</name></metadata>
${parts.map((p) => p.wpts).join('\n')}
${parts.map((p) => p.track).join('\n')}
</gpx>`;
}

// MDT is UTC-6 for the entire trip window (August).
function icsStamp(dateStr, minutes) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d, 0, Math.round(minutes) + 6 * 60));
  const p = (n) => String(n).padStart(2, '0');
  return `${dt.getUTCFullYear()}${p(dt.getUTCMonth() + 1)}${p(dt.getUTCDate())}T${p(dt.getUTCHours())}${p(dt.getUTCMinutes())}00Z`;
}

export function tripToIcs(trip, routedLegsByDay) {
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
      `UID:sturgis2026-${d.id}@sturgis-2026-trip.netlify.app`,
      `DTSTAMP:${icsStamp(d.date, 0)}`,
      `DTSTART:${icsStamp(d.date, tl.departMin)}`,
      `DTEND:${icsStamp(d.date, Math.max(tl.endMin, tl.departMin + 60))}`,
      `SUMMARY:${d.title.replace(/,/g, '\\,')}`,
      `LOCATION:${`${first} → ${last}`.replace(/,/g, '\\,')}`,
      `DESCRIPTION:${desc.replace(/,/g, '\\,')}`,
      'END:VEVENT',
    ].join('\r\n');
  });
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Sturgis 2026 Trip Planner//EN', 'CALSCALE:GREGORIAN', ...events, 'END:VCALENDAR'].join('\r\n');
}

export function downloadFile(name, content, mime) {
  const blob = new Blob([content], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
