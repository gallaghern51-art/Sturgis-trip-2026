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
