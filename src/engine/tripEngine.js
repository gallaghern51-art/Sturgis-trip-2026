// Trip engine: pure functions that recompute metrics and warnings from trip state.
// This is the "logic engine" — every edit re-runs through here so the plan stays honest.

const HARLEY_COMFORT_RANGE = 180; // miles between fuel stops before a warning
const HARLEY_MAX_RANGE = 200;
const AVG_MOVING_MPH = 45; // blended two-lane / interstate / park-traffic average
const LONG_DAY_HOURS = 12;

export function haversineMiles(a, b) {
  const R = 3958.8;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Estimate miles for a day. Prefers routed distances (from OSRM cache) keyed by
// waypoint-pair; falls back to the documented mile markers; last resort haversine * 1.25.
export function dayMiles(day, routedLegs) {
  const wps = day.waypoints;
  if (wps.length < 2) return 0;
  let total = 0;
  for (let i = 0; i < wps.length - 1; i++) {
    const key = legKey(wps[i], wps[i + 1]);
    const routed = routedLegs?.[key];
    if (routed?.miles != null) {
      total += routed.miles;
    } else {
      const docDelta = (wps[i + 1].mile ?? 0) - (wps[i].mile ?? 0);
      total += docDelta > 0 ? docDelta : haversineMiles(wps[i], wps[i + 1]) * 1.25;
    }
  }
  return Math.round(total);
}

export function dayRideHours(day, routedLegs) {
  const wps = day.waypoints;
  let seconds = 0;
  let unrouted = 0;
  for (let i = 0; i < wps.length - 1; i++) {
    const routed = routedLegs?.[legKey(wps[i], wps[i + 1])];
    if (routed?.seconds != null) seconds += routed.seconds;
    else unrouted += (wps[i + 1].mile ?? 0) - (wps[i].mile ?? 0) > 0
      ? (wps[i + 1].mile - wps[i].mile)
      : haversineMiles(wps[i], wps[i + 1]) * 1.25;
  }
  return seconds / 3600 + unrouted / AVG_MOVING_MPH;
}

export function legKey(a, b) {
  return `${a.lat.toFixed(4)},${a.lng.toFixed(4)}|${b.lat.toFixed(4)},${b.lng.toFixed(4)}`;
}

// Cheapest place to splice a new point into an existing waypoint sequence.
export function bestInsertIndex(waypoints, pt) {
  if (waypoints.length < 2) return waypoints.length;
  let best = 1;
  let bestCost = Infinity;
  for (let i = 0; i < waypoints.length - 1; i++) {
    const a = waypoints[i];
    const b = waypoints[i + 1];
    const cost = haversineMiles(a, pt) + haversineMiles(pt, b) - haversineMiles(a, b);
    if (cost < bestCost) { bestCost = cost; best = i + 1; }
  }
  return best;
}

// Fuel analysis: walk the waypoints, measure gaps between fuel stops.
export function fuelGaps(day, routedLegs) {
  const wps = day.waypoints;
  const gaps = [];
  let sinceFuel = 0;
  let fromName = wps[0]?.name ?? 'start';
  for (let i = 0; i < wps.length - 1; i++) {
    const key = legKey(wps[i], wps[i + 1]);
    const routed = routedLegs?.[key];
    const docDelta = (wps[i + 1].mile ?? 0) - (wps[i].mile ?? 0);
    const legMiles = routed?.miles ?? (docDelta > 0 ? docDelta : haversineMiles(wps[i], wps[i + 1]) * 1.25);
    sinceFuel += legMiles;
    const next = wps[i + 1];
    if (next.fuel || i === wps.length - 2) {
      gaps.push({ from: fromName, to: next.name, miles: Math.round(sinceFuel) });
      sinceFuel = 0;
      fromName = next.name;
    }
  }
  return gaps;
}

export function dayWarnings(day, routedLegs) {
  const warnings = [];
  const gaps = fuelGaps(day, routedLegs);
  for (const g of gaps) {
    if (g.miles > HARLEY_MAX_RANGE) {
      warnings.push({ level: 'danger', text: `Fuel gap ${g.miles} mi (${g.from} → ${g.to}) exceeds the 200-mi absolute range.` });
    } else if (g.miles > HARLEY_COMFORT_RANGE) {
      warnings.push({ level: 'warn', text: `Fuel gap ${g.miles} mi (${g.from} → ${g.to}) is past the 180-mi comfort range.` });
    }
  }
  const rideH = dayRideHours(day, routedLegs);
  const stopH = estimatedStopHours(day);
  if (rideH + stopH > LONG_DAY_HOURS) {
    warnings.push({ level: 'warn', text: `Estimated ${(rideH + stopH).toFixed(1)} h door-to-door (${rideH.toFixed(1)} riding + ${stopH.toFixed(1)} stopped). Packed day — know your levers.` });
  }
  if (day.lodging?.status === 'reserve') {
    warnings.push({ level: 'danger', text: `Lodging not booked: ${day.lodging.name}. Reserve now.` });
  }
  return warnings;
}

export function estimatedStopHours(day) {
  let h = 0;
  h += (day.photos?.length ?? 0) * 0.25;
  h += (day.meals?.filter((m) => m.meal !== 'breakfast').length ?? 0) * 1.0;
  for (const m of day.modules ?? []) {
    if (!m.enabled) continue;
    const match = /(\d+(?:\.\d+)?)\s*(?:hour|hr)/i.exec(m.duration ?? '');
    h += match ? parseFloat(match[1]) : 1;
  }
  return h;
}

export function tripSummary(trip, routedLegsByDay) {
  const days = trip.days;
  let miles = 0;
  const perDay = days.map((d) => {
    const m = dayMiles(d, routedLegsByDay?.[d.id]);
    miles += m;
    return {
      id: d.id,
      miles: m,
      rideHours: dayRideHours(d, routedLegsByDay?.[d.id]),
      stopHours: estimatedStopHours(d),
      warnings: dayWarnings(d, routedLegsByDay?.[d.id]),
    };
  });
  const unbooked = days.filter((d) => d.lodging?.status === 'reserve').length;
  return { totalMiles: miles, perDay, unbooked };
}

// Compact plain-text digest of the whole trip + engine analysis, for the AI optimizer.
export function tripDigest(trip, routedLegsByDay) {
  const lines = [];
  lines.push(`${trip.meta.title} — ${trip.meta.riders} riders, start ${trip.meta.startDate}. Fuel rule: ${trip.meta.fuelRule}`);
  for (const d of trip.days) {
    const m = dayMiles(d, routedLegsByDay?.[d.id]);
    const rh = dayRideHours(d, routedLegsByDay?.[d.id]);
    const sh = estimatedStopHours(d);
    lines.push('');
    lines.push(`## ${d.id} · ${d.dow} ${d.date} · ${d.title} [phase:${d.phase}]${d.anchor ? ' [ANCHOR DAY]' : ''}`);
    lines.push(`~${m} mi, ~${rh.toFixed(1)}h riding + ~${sh.toFixed(1)}h stopped. Depart ${d.depart}.`);
    if (d.constraints?.length) lines.push(`Constraints: ${d.constraints.join(' | ')}`);
    lines.push(`Waypoints: ${d.waypoints.map((w) => `${w.id}:${w.name}${w.fuel ? ' [FUEL]' : ''}`).join(' → ')}`);
    if (d.meals?.length) lines.push(`Meals: ${d.meals.map((x) => `${x.meal}: ${x.name}`).join(' · ')}`);
    if (d.modules?.length) lines.push(`Modules: ${d.modules.map((x) => `${x.id}:${x.name} (${x.enabled ? 'ON' : 'off'})`).join(' · ')}`);
    if (d.lodging) lines.push(`Lodging: ${d.lodging.name} [${d.lodging.status}]`);
    const warns = dayWarnings(d, routedLegsByDay?.[d.id]);
    for (const w of warns) lines.push(`⚠ ${w.text}`);
  }
  lines.push('');
  lines.push(`Unbooked reservations: ${trip.reserveNow.filter((r) => !r.done).map((r) => r.name).join('; ') || 'none'}`);
  return lines.join('\n');
}
