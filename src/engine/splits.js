// Break-up recommendations: where to split long days and how to break riding loops.
// Deterministic engine heuristics — the AI optimizer gets these in its digest too.

import { dayTimeline, fmtTime, fmtDur } from './timeline.js';
import { haversineMiles } from './tripEngine.js';

const LONG_DAY_H = 10.5;
const LOOP_RADIUS_MI = 15;

export function splitRecommendations(trip, routedLegsByDay) {
  const recs = [];
  for (const day of trip.days) {
    const wps = day.waypoints;
    if (wps.length < 4) continue;
    const tl = dayTimeline(day, routedLegsByDay?.[day.id]);
    const durH = tl.durMin / 60;
    const isLoop = haversineMiles(wps[0], wps[wps.length - 1]) < LOOP_RADIUS_MI;
    if (durH < LONG_DAY_H && !isLoop) continue;

    const totalMiles = tl.stops.reduce((a, s) => a + s.legMiles, 0);
    // Best break: the mid-route stop closest to half the day's clock, towns (fuel stops) preferred.
    const half = tl.durMin / 2;
    let best = null;
    let bestScore = Infinity;
    tl.stops.forEach((s, i) => {
      if (i === 0 || i === wps.length - 1) return;
      let score = Math.abs((s.arrive - tl.departMin) - half);
      if (!wps[i].fuel) score += 60; // fuel stops are towns — overnight/lunch-capable
      if (score < bestScore) { bestScore = score; best = { i, s }; }
    });
    if (!best) continue;
    const w = wps[best.i];
    const town = w.name.split(/[,—–]/)[0].trim();
    const before = tl.stops.slice(1, best.i + 1).reduce((a, s) => a + s.legMiles, 0);
    const after = totalMiles - before;

    if (isLoop && totalMiles >= 60) {
      recs.push({
        dayId: day.id,
        type: 'loop',
        text: `Loop day — ${Math.round(totalMiles)} mi returning to ${wps[0].name.split(',')[0]}. Natural break point: ${w.name} at ~${fmtTime(best.s.arrive)} (${Math.round(before)} mi out, ${Math.round(after)} mi home). Running late? Cut the stops after ${town} and take the direct road back. Want it easier? Ride the first half in the morning, decide at ${town} over lunch whether the back half is worth it.`,
      });
    } else if (durH >= LONG_DAY_H) {
      recs.push({
        dayId: day.id,
        type: 'split',
        text: `${durH.toFixed(1)}h door-to-door. Best split point: ${w.name} at ~${fmtTime(best.s.arrive)} — ${Math.round(before)} mi (${fmtDur(best.s.arrive - tl.departMin)}) in front, ${Math.round(after)} mi behind it. Breaking the day here means an overnight near ${town}, or shifting the stops after ${town} onto the neighboring day.`,
      });
    }
  }
  return recs;
}

export function splitsDigest(trip, routedLegsByDay) {
  const recs = splitRecommendations(trip, routedLegsByDay);
  if (!recs.length) return '';
  return '## BREAK-UP RECOMMENDATIONS (engine-computed split points)\n' +
    recs.map((r) => `${r.dayId} [${r.type}]: ${r.text}`).join('\n');
}
