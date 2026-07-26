// Road routing via the public OSRM demo server, with localStorage caching.
// Returns real road geometry + distance/duration per consecutive-waypoint leg.

import { legKey } from './tripEngine.js';

const OSRM = 'https://router.project-osrm.org/route/v1/driving';
const CACHE_KEY = 'sturgis.routeCache.v1';

let cache = null;
function loadCache() {
  if (cache) return cache;
  try {
    cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
  } catch {
    cache = {};
  }
  return cache;
}
function saveCache() {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // cache full — drop it and carry on
    localStorage.removeItem(CACHE_KEY);
  }
}

// Route one day's waypoints. Chunks the request (OSRM handles many vias in one call).
// Returns { legs: {legKey: {miles, seconds}}, geometry: GeoJSON LineString coords }.
export async function routeDay(day) {
  const wps = day.waypoints.filter((w) => Number.isFinite(w.lat) && Number.isFinite(w.lng));
  if (wps.length < 2) return { legs: {}, geometry: null };

  const c = loadCache();
  const dayKey = wps.map((w) => `${w.lat.toFixed(4)},${w.lng.toFixed(4)}`).join(';');
  if (c[dayKey]) return c[dayKey];

  const coords = wps.map((w) => `${w.lng},${w.lat}`).join(';');
  const url = `${OSRM}/${coords}?overview=full&geometries=geojson&steps=false`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`OSRM ${res.status}`);
    const json = await res.json();
    const route = json.routes?.[0];
    if (!route) throw new Error('no route');
    const legs = {};
    route.legs.forEach((leg, i) => {
      legs[legKey(wps[i], wps[i + 1])] = {
        miles: leg.distance / 1609.34,
        seconds: leg.duration * 1.15, // group-of-8 pace penalty
      };
    });
    const result = { legs, geometry: route.geometry.coordinates };
    c[dayKey] = result;
    saveCache();
    return result;
  } catch {
    // Fallback: straight lines between waypoints, doc mileage drives the metrics.
    return { legs: {}, geometry: wps.map((w) => [w.lng, w.lat]), fallback: true };
  }
}

// Turn-by-turn maneuvers for Ride Mode. Fetched per day on demand (steps inflate
// payloads ~10x, so they never ride along with the planning fetch) and cached
// as compact maneuver points only.
const STEP_CACHE = 'moto.stepsCache.v1';

function loadStepCache() {
  try { return JSON.parse(localStorage.getItem(STEP_CACHE) || '{}'); } catch { return {}; }
}

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function instructionFor(step, arriveName) {
  const m = step.maneuver;
  const mod = m.modifier ?? '';
  const road = step.name || step.ref || '';
  const onto = road ? ` onto ${road}` : '';
  switch (m.type) {
    case 'depart': return road ? `Head out on ${road}` : 'Head out';
    case 'arrive': return arriveName ? `Arrive: ${arriveName}` : 'Arrive at your stop';
    case 'merge': return `Merge ${mod}${onto}`;
    case 'on ramp': return `Take the ramp${onto}`;
    case 'off ramp': return `Take the exit${onto}`;
    case 'fork': return `Keep ${mod}${onto}`;
    case 'end of road': return `${cap(mod) || 'Turn'} at the end of the road${onto}`;
    case 'roundabout':
    case 'rotary': return `Roundabout — take exit ${m.exit ?? ''}${onto}`.replace('exit  ', 'the exit ');
    case 'continue': return mod && mod !== 'straight' ? `${cap(mod)}${onto}` : `Continue${road ? ` on ${road}` : ''}`;
    case 'new name': return `Continue${road ? ` on ${road}` : ''}`;
    default: return mod ? `${cap(mod) === 'Straight' ? 'Continue' : `Turn ${mod}`}${onto}` : `Continue${onto}`;
  }
}

export async function routeDaySteps(day) {
  const wps = day.waypoints.filter((w) => Number.isFinite(w.lat) && Number.isFinite(w.lng));
  if (wps.length < 2) return [];
  const key = 'steps|' + wps.map((w) => `${w.lat.toFixed(4)},${w.lng.toFixed(4)}`).join(';');
  const c = loadStepCache();
  if (c[key]) return c[key];

  const coords = wps.map((w) => `${w.lng},${w.lat}`).join(';');
  const url = `${OSRM}/${coords}?overview=false&steps=true&annotations=false`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`routing ${res.status}`);
  const json = await res.json();
  const route = json.routes?.[0];
  if (!route) throw new Error('no route');

  const steps = [];
  route.legs.forEach((leg, li) => {
    leg.steps.forEach((st) => {
      const isArrive = st.maneuver.type === 'arrive';
      // drop intermediate-waypoint arrive/depart chatter except real stops
      steps.push({
        lat: st.maneuver.location[1],
        lng: st.maneuver.location[0],
        dist: st.distance / 1609.34, // miles from this maneuver to the next
        type: st.maneuver.type,
        mod: st.maneuver.modifier ?? null,
        exit: st.maneuver.exit ?? null,
        instr: instructionFor(st, isArrive ? wps[li + 1]?.name : null),
      });
    });
  });
  try {
    const next = loadStepCache();
    next[key] = steps;
    localStorage.setItem(STEP_CACHE, JSON.stringify(next));
  } catch { localStorage.removeItem(STEP_CACHE); }
  return steps;
}
