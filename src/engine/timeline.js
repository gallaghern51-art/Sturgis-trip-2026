// Timeline + feasibility engine.
// Simulates each day minute-by-minute: departure → leg durations (routed) →
// dwell at each stop → ETAs → hard-gate checks → feasibility score.

import { legKey, haversineMiles, fuelGaps, DEFAULT_RANGE, tripRange } from './tripEngine.js';

export const DWELL_DEFAULT = { start: 0, via: 5, fuel: 15, photo: 20, end: 0 };
const AVG_MPH = 45;
const DARK_MIN = 20 * 60 + 30; // ~8:30 PM MT in August

export function parseTime(str, fallbackMin = 8 * 60) {
  const m = /(\d{1,2}):(\d{2})\s*(AM|PM)?/i.exec(str || '');
  if (!m) return fallbackMin;
  let h = +m[1];
  const min = +m[2];
  const ap = m[3]?.toUpperCase();
  if (ap === 'PM' && h !== 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  return h * 60 + min;
}

export function fmtTime(mins) {
  mins = ((Math.round(mins) % 1440) + 1440) % 1440;
  const h24 = Math.floor(mins / 60);
  const m = mins % 60;
  const ap = h24 >= 12 ? 'PM' : 'AM';
  let h = h24 % 12;
  if (h === 0) h = 12;
  return `${h}:${String(m).padStart(2, '0')} ${ap}`;
}

export function fmtDur(mins) {
  mins = Math.round(mins);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

export function dwellFor(w) {
  return Number.isFinite(w.dwell) ? w.dwell : (DWELL_DEFAULT[w.kind] ?? 5);
}

// Per-waypoint schedule: { id, arrive, depart, legMiles, legMin, dwell }
export function dayTimeline(day, routedLegs) {
  const departMin = parseTime(day.depart);
  const wps = day.waypoints;
  const stops = [];
  let t = departMin;
  for (let i = 0; i < wps.length; i++) {
    const w = wps[i];
    let legMiles = 0;
    let legMin = 0;
    if (i > 0) {
      const prev = wps[i - 1];
      const r = routedLegs?.[legKey(prev, w)];
      const docDelta = (w.mile ?? 0) - (prev.mile ?? 0);
      legMiles = r?.miles ?? (docDelta > 0 ? docDelta : haversineMiles(prev, w) * 1.25);
      legMin = r?.seconds != null ? r.seconds / 60 : (legMiles / AVG_MPH) * 60;
    }
    const arrive = t + legMin;
    const dwell = i === 0 || i === wps.length - 1 ? 0 : dwellFor(w);
    const depart = arrive + dwell;
    stops.push({ id: w.id, arrive, depart, legMiles, legMin, dwell });
    t = depart;
  }
  const endMin = stops.length ? stops[stops.length - 1].arrive : departMin;
  return { departMin, stops, endMin, durMin: endMin - departMin };
}

// Feasibility for one day: gate checks, fuel range, day length, darkness, lodging.
export function dayFeasibility(day, routedLegs, range = DEFAULT_RANGE) {
  const tl = dayTimeline(day, routedLegs);
  const issues = [];
  let score = 100;

  for (const g of day.gates ?? []) {
    const stop = tl.stops.find((s) => s.id === g.waypointId);
    if (!stop) continue;
    const gateMin = parseTime(g.by);
    const margin = Math.round(gateMin - stop.arrive);
    if (margin < 0) {
      score -= 25;
      issues.push({ level: 'fail', text: `${g.label}: ETA ${fmtTime(stop.arrive)} misses the ${g.by} gate by ${fmtDur(-margin)}.` });
    } else if (margin < 20) {
      score -= 8;
      issues.push({ level: 'warn', text: `${g.label}: ETA ${fmtTime(stop.arrive)} — only ${fmtDur(margin)} of margin on the ${g.by} gate.` });
    } else {
      issues.push({ level: 'ok', text: `${g.label}: ETA ${fmtTime(stop.arrive)}, ${fmtDur(margin)} ahead of the ${g.by} gate.` });
    }
  }

  for (const gap of fuelGaps(day, routedLegs)) {
    if (gap.miles > range.absolute) {
      score -= 15;
      issues.push({ level: 'fail', text: `Fuel gap ${gap.miles} mi (${gap.from} → ${gap.to}) exceeds the ${range.absolute}-mi absolute range.` });
    } else if (gap.miles > range.comfort) {
      score -= 6;
      issues.push({ level: 'warn', text: `Fuel gap ${gap.miles} mi (${gap.from} → ${gap.to}) past the ${range.comfort}-mi comfort range.` });
    }
  }

  const durH = tl.durMin / 60;
  if (durH > 13) {
    score -= 12;
    issues.push({ level: 'warn', text: `${durH.toFixed(1)}h door-to-door — brutal for a group ride.` });
  } else if (durH > 11) {
    score -= 6;
    issues.push({ level: 'warn', text: `${durH.toFixed(1)}h door-to-door — long day, protect the stops that matter.` });
  }

  if (tl.endMin > DARK_MIN && day.waypoints.length > 1) {
    score -= 8;
    issues.push({ level: 'warn', text: `Projected arrival ${fmtTime(tl.endMin)} — after dark (~8:30 PM). Wildlife risk on rural two-lane.` });
  }

  if (day.lodging?.status === 'reserve') {
    score -= 10;
    issues.push({ level: 'fail', text: `Lodging not booked: ${day.lodging.name}.` });
  }

  return { score: Math.max(0, Math.round(score)), issues, timeline: tl };
}

export function gradeFor(score) {
  if (score >= 90) return 'A';
  if (score >= 78) return 'B';
  if (score >= 62) return 'C';
  if (score >= 45) return 'D';
  return 'F';
}

export function tripFeasibility(trip, routedLegsByDay) {
  const range = tripRange(trip);
  const perDay = trip.days.map((d) => ({ id: d.id, ...dayFeasibility(d, routedLegsByDay?.[d.id], range) }));
  const overall = Math.round(perDay.reduce((a, p) => a + p.score, 0) / Math.max(1, perDay.length));
  return { perDay, overall, grade: gradeFor(overall) };
}

// Plain-text feasibility digest appended to the AI context.
export function feasibilityDigest(trip, routedLegsByDay) {
  const lines = ['## FEASIBILITY STUDY (engine-computed)'];
  const f = tripFeasibility(trip, routedLegsByDay);
  lines.push(`Overall: ${f.overall}/100 (grade ${f.grade})`);
  for (const d of trip.days) {
    const p = f.perDay.find((x) => x.id === d.id);
    const tl = p.timeline;
    lines.push(`${d.id} ${d.dow}: score ${p.score}, depart ${fmtTime(tl.departMin)}, end ~${fmtTime(tl.endMin)} (${fmtDur(tl.durMin)} door-to-door)`);
    for (const i of p.issues.filter((x) => x.level !== 'ok')) lines.push(`  ${i.level.toUpperCase()}: ${i.text}`);
  }
  return lines.join('\n');
}
