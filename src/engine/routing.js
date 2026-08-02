// Road routing. Planning uses the public OSRM demo server (free, cached hard).
// Ride Mode navigation tries the Google Routes API first via the
// google-route Netlify function (live-traffic ETAs; needs GOOGLE_MAPS_API_KEY
// in the Netlify env) and falls back to OSRM whenever the function is absent,
// unconfigured, or failing — the app never depends on the paid path.

import { legKey, haversineMiles } from './tripEngine.js';

const OSRM = 'https://router.project-osrm.org/route/v1/driving';

// Group riding is slower than a solo car: staggered formation, fuel-stop
// re-forms, the slowest rider sets the pace. One factor, applied to every leg
// duration in one place. NOTE: baked into cached legs — making this per-trip
// means bumping the route-cache versions so old durations flush.
export const GROUP_PACE = 1.15;
const CACHE_KEY = 'sturgis.routeCache.v1';

// ---- Google Routes proxy (traffic-aware) ----

const GOOGLE_FN = '/.netlify/functions/google-route';
let gSkipUntil = 0; // backoff so a dead/keyless function costs one probe, not one per reroute

async function googleRoute(origin, waypoints) {
  if (Date.now() < gSkipUntil) throw new Error('google routing backing off');
  let res;
  try {
    res = await fetch(GOOGLE_FN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        origin: { lat: origin.lat, lng: origin.lng },
        waypoints: waypoints.map((w) => ({ lat: w.lat, lng: w.lng })),
      }),
    });
  } catch (e) {
    gSkipUntil = Date.now() + 5 * 60_000;
    throw e;
  }
  if (!res.ok) {
    // 501 = no key configured, 404 = running under plain vite dev — stay off it longer
    gSkipUntil = Date.now() + (res.status === 501 || res.status === 404 ? 30 : 5) * 60_000;
    throw new Error(`google-route ${res.status}`);
  }
  const json = await res.json();
  if (!json.geometry?.length) throw new Error('google-route empty');
  return json;
}

// Google maneuver enum → our OSRM-flavored {type, mod} (drives TurnArrow + voice).
const G_MANEUVER = {
  DEPART: ['depart', null], NAME_CHANGE: ['new name', null], STRAIGHT: ['continue', 'straight'],
  TURN_LEFT: ['turn', 'left'], TURN_RIGHT: ['turn', 'right'],
  TURN_SLIGHT_LEFT: ['turn', 'slight left'], TURN_SLIGHT_RIGHT: ['turn', 'slight right'],
  TURN_SHARP_LEFT: ['turn', 'sharp left'], TURN_SHARP_RIGHT: ['turn', 'sharp right'],
  UTURN_LEFT: ['turn', 'uturn'], UTURN_RIGHT: ['turn', 'uturn'],
  RAMP_LEFT: ['on ramp', 'left'], RAMP_RIGHT: ['on ramp', 'right'],
  MERGE: ['merge', null], FORK_LEFT: ['fork', 'left'], FORK_RIGHT: ['fork', 'right'],
  ROUNDABOUT_LEFT: ['roundabout', null], ROUNDABOUT_RIGHT: ['roundabout', null],
};

// Google gives static per-step durations but a traffic-aware total — spread the
// traffic over the steps proportionally so ETA math stays per-step.
function googleCompactSteps(g, stops) {
  const totalStatic = g.legs.reduce((a, l) => a + l.steps.reduce((b, s) => b + s.staticDurationSeconds, 0), 0);
  const scale = totalStatic > 0 ? g.durationSeconds / totalStatic : 1;
  const steps = [];
  g.legs.forEach((leg, li) => {
    for (const st of leg.steps) {
      if (!Number.isFinite(st.lat) || !Number.isFinite(st.lng)) continue;
      const [type, mod] = G_MANEUVER[st.maneuver] ?? ['turn', null];
      steps.push({
        lat: st.lat, lng: st.lng,
        dist: st.distanceMeters / 1609.34,
        sec: st.staticDurationSeconds * scale * GROUP_PACE, // group-of-8 pace, matches OSRM path
        type, mod, exit: null, road: null,
        instr: st.instruction || 'Continue',
      });
    }
    // Google has no arrive maneuver per leg — synthesize one at the stop itself
    const wp = stops?.[li];
    if (wp) {
      steps.push({
        lat: wp.lat, lng: wp.lng, dist: 0, sec: 0,
        type: 'arrive', mod: null, exit: null, road: null,
        instr: wp.name ? `Arrive: ${wp.name}` : 'Arrive at your stop',
      });
    }
  });
  return steps;
}

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
        seconds: leg.duration * GROUP_PACE, // group-of-8 pace penalty
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
// v2: steps carry per-step duration (sec) for live ETA math — old v1 entries lack it.
const STEP_CACHE = 'moto.stepsCache.v2';

function loadStepCache() {
  try { return JSON.parse(localStorage.getItem(STEP_CACHE) || '{}'); } catch { return {}; }
}

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function instructionFor(step, arriveName) {
  const m = step.maneuver;
  const mod = m.modifier ?? '';
  const road = step.name || step.ref || '';
  const onto = road ? ` onto ${road}` : '';
  // Highway signage ("toward Billings / Sheridan") reads better at speed than road names.
  const toward = step.destinations ? ` toward ${step.destinations.split(',').slice(0, 2).join(' / ')}` : '';
  switch (m.type) {
    case 'depart': return road ? `Head out on ${road}` : 'Head out';
    case 'arrive': return arriveName ? `Arrive: ${arriveName}` : 'Arrive at your stop';
    case 'merge': return `Merge ${mod}${onto}${toward}`;
    case 'on ramp': return `Take the ramp${onto}${toward}`;
    case 'off ramp': return `Take the exit${toward || onto}`;
    case 'fork': return `Keep ${mod}${toward || onto}`;
    case 'end of road': return `${cap(mod) || 'Turn'} at the end of the road${onto}`;
    case 'roundabout':
    case 'rotary': return `Roundabout — take exit ${m.exit ?? ''}${onto}`.replace('exit  ', 'the exit ');
    case 'continue': return mod && mod !== 'straight' ? `${cap(mod)}${onto}` : `Continue${road ? ` on ${road}` : ''}`;
    case 'new name': return `Continue${road ? ` on ${road}` : ''}`;
    default: return mod ? `${cap(mod) === 'Straight' ? 'Continue' : `Turn ${mod}`}${onto}` : `Continue${onto}`;
  }
}


// ---------- lane guidance ----------
// The row of arrows painted on the road before a junction. OSRM carries it on
// `intersections[0].lanes` of the step whose maneuver you are approaching —
// `valid` marks the lanes that actually carry you through that maneuver. It
// comes from OSM `turn:lanes` tags, so interstates and big junctions are well
// covered and rural two-lanes usually have nothing, which is fine: no lanes
// means the HUD just shows the maneuver arrow as before.
//
// Stored compactly ({v, i}) because the whole step list lives in localStorage.
const LANE_CAP = 6; // a phone cannot legibly show more than this

function laneCells(step) {
  const lanes = step.intersections?.[0]?.lanes;
  if (!Array.isArray(lanes) || !lanes.length) return null;
  return lanes.slice(0, LANE_CAP).map((l) => ({
    v: l.valid ? 1 : 0,
    i: Array.isArray(l.indications) ? l.indications : [],
  }));
}

// Google returns no lane guidance on any web API — it is Navigation-SDK-only —
// but lane markings are static, so they can be fetched from OSRM once and
// matched onto Google's maneuver chain by position. Best effort: if this fails
// the HUD is exactly what it was before.
const LANE_MATCH_MI = 0.03; // ~50 m: same junction, different router's idea of where

export async function attachLanes(steps, wps) {
  if (!steps?.length || steps.some((s) => s.lanes)) return steps;
  try {
    const coords = wps.map((w) => `${w.lng},${w.lat}`).join(';');
    const res = await fetch(`${OSRM}/${coords}?overview=false&steps=true&annotations=false`);
    if (!res.ok) return steps;
    const route = (await res.json()).routes?.[0];
    if (!route) return steps;

    const points = [];
    for (const leg of route.legs) {
      for (const st of leg.steps) {
        const cells = laneCells(st);
        if (cells) points.push({ lat: st.maneuver.location[1], lng: st.maneuver.location[0], cells });
      }
    }
    if (!points.length) return steps;

    return steps.map((s) => {
      let best = null;
      for (const p of points) {
        const d = haversineMiles(s, p);
        if (d <= LANE_MATCH_MI && (!best || d < best.d)) best = { d, cells: p.cells };
      }
      return best ? { ...s, lanes: best.cells } : s;
    });
  } catch {
    return steps;
  }
}

// OSRM route → compact maneuver list. `stopNames[i]` names the arrive point of leg i.
function compactSteps(route, stopNames) {
  const steps = [];
  route.legs.forEach((leg, li) => {
    leg.steps.forEach((st) => {
      const isArrive = st.maneuver.type === 'arrive';
      steps.push({
        lat: st.maneuver.location[1],
        lng: st.maneuver.location[0],
        dist: st.distance / 1609.34, // miles from this maneuver to the next
        sec: st.duration * GROUP_PACE,     // group-of-8 pace penalty, matches routeDay
        type: st.maneuver.type,
        mod: st.maneuver.modifier ?? null,
        exit: st.maneuver.exit ?? null,
        road: st.ref || st.name || null,
        // The street name on its own. The banner shows this beside the shield —
        // "Huffine Lane", not "Turn left onto Huffine Lane" — because the arrow
        // has already said "turn left" and the sentence only costs it a line.
        roadName: st.name || null,
        exitNo: st.exits || null, // signed exit number, when the junction carries one
        lanes: laneCells(st),
        instr: instructionFor(st, isArrive ? stopNames?.[li] : null),
      });
    });
  });
  return steps;
}

function saveStepCache(key, value) {
  try {
    const next = loadStepCache();
    next[key] = value;
    localStorage.setItem(STEP_CACHE, JSON.stringify(next));
  } catch { localStorage.removeItem(STEP_CACHE); }
}

export async function routeDaySteps(day) {
  const wps = day.waypoints.filter((w) => Number.isFinite(w.lat) && Number.isFinite(w.lng));
  if (wps.length < 2) return [];
  const key = 'steps|' + wps.map((w) => `${w.lat.toFixed(4)},${w.lng.toFixed(4)}`).join(';');
  const c = loadStepCache();
  const hit = c[key];
  if (Array.isArray(hit)) return hit; // OSRM-sourced: static data, cache forever
  if (hit?.g && Date.now() - hit.at < 15 * 60_000) return hit.steps; // traffic goes stale

  // Traffic-aware first; OSRM below is the always-works fallback.
  try {
    const g = await googleRoute(wps[0], wps.slice(1));
    const steps = await attachLanes(googleCompactSteps(g, wps.slice(1)), wps);
    saveStepCache(key, { g: 1, at: Date.now(), steps });
    return steps;
  } catch { /* fall through to OSRM */ }

  const coords = wps.map((w) => `${w.lng},${w.lat}`).join(';');
  const url = `${OSRM}/${coords}?overview=false&steps=true&annotations=false`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`routing ${res.status}`);
  const json = await res.json();
  const route = json.routes?.[0];
  if (!route) throw new Error('no route');

  const steps = compactSteps(route, wps.slice(1).map((w) => w.name));
  saveStepCache(key, steps);
  return steps;
}

// Live reroute: current GPS position → the day's remaining waypoints.
// Never cached (the origin is wherever the bike is right now).
// Traffic-aware via Google when configured, OSRM otherwise.
// Returns { geometry, steps, miles, seconds, traffic? } or throws.
export async function routeFrom(pos, waypoints) {
  const wps = waypoints.filter((w) => Number.isFinite(w.lat) && Number.isFinite(w.lng));
  if (!wps.length) throw new Error('no destination');

  try {
    const g = await googleRoute(pos, wps);
    return {
      geometry: g.geometry,
      steps: googleCompactSteps(g, wps),
      miles: g.distanceMeters / 1609.34,
      seconds: g.durationSeconds * GROUP_PACE,
      traffic: true,
    };
  } catch { /* fall through to OSRM */ }

  const pts = [pos, ...wps];
  const coords = pts.map((p) => `${p.lng},${p.lat}`).join(';');
  const url = `${OSRM}/${coords}?overview=full&geometries=geojson&steps=true&annotations=false`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`reroute ${res.status}`);
  const json = await res.json();
  const route = json.routes?.[0];
  if (!route) throw new Error('no route');
  return {
    geometry: route.geometry.coordinates,
    steps: compactSteps(route, wps.map((w) => w.name)),
    miles: route.distance / 1609.34,
    seconds: route.duration * GROUP_PACE,
  };
}
