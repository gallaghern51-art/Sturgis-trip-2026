import React, { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { useTrip } from '../engine/store.js';
import { dayTimeline, fmtTime, fmtDur, parseTime } from '../engine/timeline.js';
import { haversineMiles } from '../engine/tripEngine.js';
import { routeDaySteps, routeFrom } from '../engine/routing.js';
import { STYLE_SATELLITE, warmTilesAhead, cachedGoogleStyle, googleStyle, GOOGLE_KEY } from '../engine/basemaps.js';
import { fmtDayDate } from '../engine/dates.js';
import { useT, useUnits } from '../engine/settings.jsx';

// Ride Mode: a navigation HUD over a live map. Projects your GPS position onto
// the planned route and answers the questions that matter at 70 mph: where do I
// turn next, and am I ahead of or behind the plan? Off route, it recalculates
// from where you actually are — like any real nav app.

const nowMin = () => {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
};

// Maneuver → arrow rotation (an up-arrow SVG rotated in place).
const ARROW_DEG = {
  'uturn': 180, 'sharp left': -135, 'left': -90, 'slight left': -45,
  'straight': 0, 'slight right': 45, 'right': 90, 'sharp right': 135,
};

function TurnArrow({ step }) {
  if (!step) return null;
  if (step.type === 'arrive') return <span className="turn-glyph">⚑</span>;
  if (step.type === 'roundabout' || step.type === 'rotary') return <span className="turn-glyph">⟳</span>;
  const deg = ARROW_DEG[step.mod ?? 'straight'] ?? 0;
  return (
    <svg viewBox="0 0 48 48" className="turn-arrow" style={{ transform: `rotate(${deg}deg)` }}>
      <path d="M24 42 V16 M24 10 L13 24 M24 10 L35 24" fill="none" stroke="currentColor" strokeWidth="6.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const fmtStepDist = (mi) => {
  if (mi >= 10) return `${Math.round(mi)} mi`;
  if (mi >= 0.19) return `${mi.toFixed(1)} mi`;
  return `${Math.max(50, Math.round((mi * 5280) / 50) * 50)} ft`;
};

// Shared segment-projection: position → best segment of a coordinate chain.
function projectOnChain(chain, pos) {
  let best = null;
  const kx = Math.cos((pos.lat * Math.PI) / 180) * 69.17;
  const ky = 69.17;
  for (let i = 0; i < chain.length - 1; i++) {
    const a = chain[i];
    const b = chain[i + 1];
    const ax = (a.lng - pos.lng) * kx; const ay = (a.lat - pos.lat) * ky;
    const bx = (b.lng - pos.lng) * kx; const by = (b.lat - pos.lat) * ky;
    const dx = bx - ax; const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    const px = ax + t * dx; const py = ay + t * dy;
    const d = Math.sqrt(px * px + py * py);
    if (!best || d < best.off) best = { i, f: t, off: d };
  }
  return best;
}

// Position on the plan: leg index, planned clock minutes, miles done.
function planPosition(day, tl, pos) {
  const wps = day.waypoints;
  if (wps.length < 2) return null;
  const best = projectOnChain(wps, pos);
  if (!best) return null;
  const seg = tl.stops[best.i + 1];
  const plannedMin = tl.stops[best.i].depart + best.f * (seg?.legMin ?? 0);
  let doneMiles = 0;
  for (let k = 1; k <= best.i; k++) doneMiles += tl.stops[k].legMiles;
  doneMiles += best.f * (seg?.legMiles ?? 0);
  return { ...best, plannedMin, doneMiles, remainToNext: (1 - best.f) * (seg?.legMiles ?? 0), dist: best.off };
}

// Position on the maneuver chain: next turn, miles to it, and what's left of the day.
function locateOnSteps(steps, pos) {
  if (!steps || steps.length < 2) return null;
  const best = projectOnChain(steps, pos);
  if (!best) return null;
  const cur = steps[best.i];
  let remMi = Math.max(0, (1 - best.f) * cur.dist);
  let remSec = Math.max(0, (1 - best.f) * (cur.sec ?? 0));
  for (let j = best.i + 1; j < steps.length; j++) {
    remMi += steps[j].dist;
    remSec += steps[j].sec ?? 0;
  }
  return {
    next: steps[best.i + 1], after: steps[best.i + 2] ?? null, idx: best.i + 1,
    toNext: Math.max(0, (1 - best.f) * cur.dist), off: best.off,
    remMi, remMin: remSec / 60,
  };
}

const NAV_AHEAD = '#ffab5c';
const NAV_DONE = 'rgba(122, 122, 122, 0.65)';
const SOLID_AHEAD = ['interpolate', ['linear'], ['line-progress'], 0, NAV_AHEAD, 1, NAV_AHEAD];
const EMPTY_LINE = { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } };

// Planned route + live-reroute layer stacks. Google-style: soft glow, dark
// casing, bright line whose traveled portion dims behind you (line-gradient).
function ensureNavLayers(map) {
  if (map.getSource('ride-route')) return;
  map.addSource('ride-route', { type: 'geojson', data: EMPTY_LINE, lineMetrics: true });
  map.addSource('ride-live', { type: 'geojson', data: EMPTY_LINE, lineMetrics: true });
  const round = { 'line-cap': 'round', 'line-join': 'round' };
  map.addLayer({ id: 'ride-route-glow', type: 'line', source: 'ride-route', paint: { 'line-color': '#f48322', 'line-width': 14, 'line-opacity': 0.3, 'line-blur': 4 }, layout: round });
  map.addLayer({ id: 'ride-route-casing', type: 'line', source: 'ride-route', paint: { 'line-color': '#000000', 'line-width': 9.5, 'line-opacity': 0.85 }, layout: round });
  map.addLayer({ id: 'ride-route-line', type: 'line', source: 'ride-route', paint: { 'line-color': NAV_AHEAD, 'line-width': 5.5, 'line-opacity': 0.95 }, layout: round });
  map.addLayer({ id: 'ride-live-casing', type: 'line', source: 'ride-live', paint: { 'line-color': '#000000', 'line-width': 9.5, 'line-opacity': 0.85 }, layout: round });
  map.addLayer({ id: 'ride-live-line', type: 'line', source: 'ride-live', paint: { 'line-color': NAV_AHEAD, 'line-width': 5.5, 'line-opacity': 0.95 }, layout: round });
}


// Line-art speaker, drawn to match the HUD rather than borrowing a system glyph
// (an emoji speaker renders as a coloured tile on most platforms).
function SpeakerIcon({ muted }) {
  const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' };
  return (
    <svg viewBox="0 0 22 22" className="spk-icon" aria-hidden="true">
      <path d="M4 8.5h3l4.5-3.5v12L7 13.5H4z" {...stroke} />
      {muted ? (
        <path d="M15 8.5l4.5 5M19.5 8.5l-4.5 5" {...stroke} />
      ) : (
        <>
          <path d="M15 8a4.2 4.2 0 0 1 0 6" {...stroke} />
          <path d="M17.6 5.8a7.4 7.4 0 0 1 0 10.4" {...stroke} />
        </>
      )}
    </svg>
  );
}

export default function RideMode({ onClose }) {
  const { state, routes, routedLegsByDay } = useTrip();
  const { trip } = state;
  const today = new Date().toLocaleDateString('sv-SE');
  const defaultDay = trip.days.find((d) => d.date === today)?.id ?? state.selectedDayId ?? trip.days[0]?.id;
  const [dayId, setDayId] = useState(defaultDay);
  const [fix, setFix] = useState(null); // {lat,lng,speedMph,heading,accuracy,at}
  const [geoErr, setGeoErr] = useState(null);
  const [clock, setClock] = useState(nowMin());
  const [steps, setSteps] = useState(null);
  const [reroute, setReroute] = useState(null); // { geometry, steps } from live position
  const [rerouting, setRerouting] = useState(false);
  const [rerouteFailed, setRerouteFailed] = useState(false);
  const [follow, setFollow] = useState(true);
  const [muted, setMuted] = useState(false);
  const t = useT();
  const u = useUnits();
  const statsRef = useRef({ miles: 0, maxMph: 0, last: null });
  const wakeRef = useRef(null);
  const mapDivRef = useRef(null);
  const mapRef = useRef(null);
  const puckRef = useRef(null);
  const followRef = useRef(true);
  followRef.current = follow;
  const mutedRef = useRef(false);
  mutedRef.current = muted;
  const spokenRef = useRef('');
  const offCountRef = useRef(0);
  const warmAtRef = useRef(0);
  const liveRouteAtRef = useRef(0);
  const lastRerouteAtRef = useRef(0);
  const reroutingRef = useRef(false);
  reroutingRef.current = rerouting;

  const day = trip.days.find((d) => d.id === dayId) ?? trip.days[0];
  const tl = useMemo(() => dayTimeline(day, routedLegsByDay[day.id]), [day, routedLegsByDay]);
  const totalMiles = tl.stops.reduce((a, s) => a + s.legMiles, 0);

  const speak = (text) => {
    if (!text || mutedRef.current || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
    } catch { /* no voice — HUD still works */ }
  };

  // ---- nav map with position puck ----
  useEffect(() => {
    const start = day.waypoints[0];
    // Google hybrid when a tile session is cached; otherwise Esri now and warm
    // a session in the background so the next ride opens on Google.
    if (GOOGLE_KEY) googleStyle('hybrid').catch(() => {});
    const map = new maplibregl.Map({
      container: mapDivRef.current,
      style: cachedGoogleStyle('hybrid') ?? STYLE_SATELLITE,
      center: start ? [start.lng, start.lat] : [-108, 45],
      zoom: 12,
      attributionControl: { compact: true },
      maxTileCacheSize: 1024, // keep ridden-past tiles around for overview jumps
    });
    mapRef.current = map;
    map.on('dragstart', () => setFollow(false));

    const el = document.createElement('div');
    el.className = 'nav-puck';
    puckRef.current = new maplibregl.Marker({ element: el, rotationAlignment: 'map' })
      .setLngLat(start ? [start.lng, start.lat] : [-108, 45])
      .addTo(map);

    return () => { map.remove(); mapRef.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // draw / update the day's planned route line on the nav map
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const geom = routes[day.id]?.geometry ?? day.waypoints.map((w) => [w.lng, w.lat]);
    const apply = () => {
      ensureNavLayers(map);
      map.getSource('ride-route').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: geom } });
    };
    if (map.isStyleLoaded()) apply();
    else map.once('load', apply);
  }, [day.id, routes]); // eslint-disable-line react-hooks/exhaustive-deps

  // reroute line: draw it bright, drop the planned line to a ghost underneath
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      ensureNavLayers(map);
      map.getSource('ride-live').setData(reroute
        ? { type: 'Feature', geometry: { type: 'LineString', coordinates: reroute.geometry } }
        : EMPTY_LINE);
      const dim = !!reroute;
      map.setPaintProperty('ride-route-line', 'line-opacity', dim ? 0.3 : 0.95);
      map.setPaintProperty('ride-route-casing', 'line-opacity', dim ? 0.2 : 0.85);
      map.setPaintProperty('ride-route-glow', 'line-opacity', dim ? 0.08 : 0.3);
      if (dim) map.setPaintProperty('ride-route-line', 'line-gradient', SOLID_AHEAD);
    };
    if (map.isStyleLoaded()) apply();
    else map.once('load', apply);
  }, [reroute]);

  // turn-by-turn maneuvers for the selected day
  useEffect(() => {
    let dead = false;
    setSteps(null);
    setReroute(null);
    setRerouteFailed(false);
    offCountRef.current = 0;
    liveRouteAtRef.current = 0;
    spokenRef.current = '';
    routeDaySteps(day).then((s) => { if (!dead) setSteps(s); }).catch(() => { if (!dead) setSteps([]); });
    return () => { dead = true; };
  }, [day.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- GPS watch ----
  useEffect(() => {
    if (!navigator.geolocation) { setGeoErr('No GPS available in this browser.'); return; }
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const st = statsRef.current;
        const next = { lat: p.coords.latitude, lng: p.coords.longitude, at: p.timestamp, accuracy: p.coords.accuracy };
        let mph = p.coords.speed != null && !Number.isNaN(p.coords.speed) ? p.coords.speed * 2.23694 : null;
        let heading = p.coords.heading != null && !Number.isNaN(p.coords.heading) ? p.coords.heading : null;
        if (st.last) {
          const dtH = (next.at - st.last.at) / 3600000;
          const dMi = haversineMiles(st.last, next);
          if (mph == null && dtH > 0) mph = dMi / dtH;
          if (heading == null && dMi > 0.01) {
            heading = (Math.atan2(
              (next.lng - st.last.lng) * Math.cos((next.lat * Math.PI) / 180),
              next.lat - st.last.lat
            ) * 180) / Math.PI;
          }
          st.miles += dMi;
        }
        if (mph != null && mph < 140) st.maxMph = Math.max(st.maxMph, mph);
        st.last = next;
        setFix({ ...next, speedMph: mph, heading });
        setGeoErr(null);
      },
      (e) => setGeoErr(e.code === 1 ? 'Location permission denied — allow it in your browser settings to ride with the HUD.' : e.message),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 }
    );
    const tick = setInterval(() => setClock(nowMin()), 5000);
    return () => { navigator.geolocation.clearWatch(id); clearInterval(tick); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // keep the screen awake while riding
  useEffect(() => {
    const grab = async () => {
      try { wakeRef.current = await navigator.wakeLock?.request('screen'); } catch { /* unsupported */ }
    };
    grab();
    const onVis = () => { if (document.visibilityState === 'visible') grab(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { document.removeEventListener('visibilitychange', onVis); wakeRef.current?.release?.(); };
  }, []);

  // ---- derived readouts ----
  const activeSteps = reroute?.steps ?? steps;
  const proj = fix ? planPosition(day, tl, fix) : null;
  const nav = fix && activeSteps?.length ? locateOnSteps(activeSteps, fix) : null;
  const delta = proj ? clock - proj.plannedMin : null; // + = behind plan

  // Off-route is measured against the real routed geometry, not the maneuver
  // chain (which cuts corners between turns on winding roads).
  const hasRealRoute = !!(reroute || (routes[day.id]?.geometry && !routes[day.id]?.fallback));
  const geomInfo = useMemo(() => {
    const coords = reroute?.geometry ?? routes[day.id]?.geometry ?? day.waypoints.map((w) => [w.lng, w.lat]);
    const chain = coords.map(([lng, lat]) => ({ lat, lng }));
    const cum = [0];
    for (let i = 1; i < chain.length; i++) cum.push(cum[i - 1] + haversineMiles(chain[i - 1], chain[i]));
    return { chain, cum, total: cum[cum.length - 1] || 1 };
  }, [reroute, routes, day]);
  const geoProj = useMemo(
    () => (fix && geomInfo.chain.length > 1 ? projectOnChain(geomInfo.chain, fix) : null),
    [fix, geomInfo]
  );
  const goodFix = fix && (fix.accuracy == null || fix.accuracy < 200);
  const offRoute = !!(geoProj && goodFix && geoProj.off > (hasRealRoute ? 0.12 : 2.5));

  // dim the part of the route already ridden (Google-style traveled line)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded() || !map.getLayer('ride-route-line')) return;
    const layer = reroute ? 'ride-live-line' : 'ride-route-line';
    let frac = 0;
    if (geoProj && !offRoute) {
      const { cum, total } = geomInfo;
      frac = (cum[geoProj.i] + geoProj.f * (cum[geoProj.i + 1] - cum[geoProj.i])) / total;
    }
    frac = Math.max(0, Math.min(0.999, frac));
    map.setPaintProperty(layer, 'line-gradient',
      frac <= 0.001 ? SOLID_AHEAD : ['step', ['line-progress'], NAV_DONE, frac, NAV_AHEAD]);
  }, [geoProj, reroute, offRoute]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- puck + chase camera, map-matched ----
  // Within ~30 m of the line the puck snaps onto it and takes the road's
  // bearing instead of the GPS one — kills the wobble like the big nav apps.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !fix) return;
    const SNAP_MI = 0.019; // ≈ 30 m
    let lat = fix.lat, lng = fix.lng, heading = fix.heading;
    const a = geoProj && geomInfo.chain[geoProj.i];
    const b = geoProj && geomInfo.chain[geoProj.i + 1];
    if (geoProj && geoProj.off < SNAP_MI && a && b) {
      lat = a.lat + geoProj.f * (b.lat - a.lat);
      lng = a.lng + geoProj.f * (b.lng - a.lng);
      if (fix.speedMph == null || fix.speedMph > 3) {
        heading = (Math.atan2((b.lng - a.lng) * Math.cos((lat * Math.PI) / 180), b.lat - a.lat) * 180) / Math.PI;
      }
    }
    puckRef.current?.setLngLat([lng, lat]);
    if (heading != null) puckRef.current?.setRotation(heading);
    if (followRef.current) {
      const mph = fix.speedMph;
      // zoom breathes with speed and tightens into the next turn
      let zoom = mph == null ? 14 : mph >= 50 ? 12.9 : mph >= 25 ? 13.8 : 14.8;
      if (nav && nav.toNext < 0.35) zoom = Math.max(zoom, 15.3);
      map.easeTo({
        center: [lng, lat],
        bearing: heading ?? map.getBearing(),
        pitch: 55,
        zoom,
        duration: 950,
        // keep the puck low on screen so the road ahead fills the view
        padding: { top: Math.round((mapDivRef.current?.clientHeight ?? 600) * 0.4), bottom: 0, left: 0, right: 0 },
      });
    }
    // warm the satellite/road tiles the rider is about to need
    if (geoProj && Date.now() - warmAtRef.current > 15000) {
      warmAtRef.current = Date.now();
      warmTilesAhead(geomInfo.chain, geoProj.i, { miles: 12 });
    }
  }, [fix]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- live rerouting: off the line for a few fixes → recalc from here ----
  useEffect(() => {
    // Decay rather than reset: skimming the 0.12 mi line must not stall the trigger.
    if (!fix || !offRoute) { offCountRef.current = Math.max(0, offCountRef.current - 1); return; }
    offCountRef.current += 1;
    if (offCountRef.current < 3) return;
    const now = Date.now();
    if (reroutingRef.current || now - lastRerouteAtRef.current < 20000) return;
    const remaining = day.waypoints.slice((proj?.i ?? 0) + 1);
    if (!remaining.length) return;
    setRerouting(true);
    lastRerouteAtRef.current = now;
    speak('Off route. Recalculating.');
    routeFrom({ lat: fix.lat, lng: fix.lng }, remaining)
      .then((r) => {
        setReroute({ ...r, byOffRoute: true });
        setRerouteFailed(false);
        offCountRef.current = 0;
        spokenRef.current = '';
        speak(`New route. ${r.steps[1]?.instr ?? ''}`);
      })
      .catch(() => setRerouteFailed(true))
      .finally(() => setRerouting(false));
  }, [fix]); // eslint-disable-line react-hooks/exhaustive-deps

  // back on the original plan → drop an off-route detour (traffic-anchored
  // live routes stay — they refresh on their own cadence below)
  useEffect(() => {
    if (!reroute?.byOffRoute || !fix) return;
    const coords = routes[day.id]?.geometry;
    if (!coords) return;
    const p = projectOnChain(coords.map(([lng, lat]) => ({ lat, lng })), fix);
    if (p && p.off < 0.08) { setReroute(null); setRerouteFailed(false); }
  }, [fix]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- traffic anchor: navigate on a fresh traffic-aware route from the bike ----
  // On the first good fix (and every 10 min after) fetch a live route from the
  // current position through the day's remaining stops. Only adopted when it
  // came from the traffic-aware provider — the OSRM fallback matches the
  // planned line anyway, so swapping would add nothing.
  useEffect(() => {
    if (!fix || !goodFix || !proj || offRoute || reroutingRef.current) return;
    const now = Date.now();
    if (now - liveRouteAtRef.current < 10 * 60_000) return;
    liveRouteAtRef.current = now;
    const remaining = day.waypoints.slice(proj.i + 1);
    if (!remaining.length) return;
    routeFrom({ lat: fix.lat, lng: fix.lng }, remaining)
      .then((r) => { if (r.traffic) setReroute({ ...r, byOffRoute: false }); })
      .catch(() => { /* next cycle retries */ });
  }, [fix]); // eslint-disable-line react-hooks/exhaustive-deps

  const nextWp = proj ? day.waypoints[proj.i + 1] : null;
  const nextSched = proj ? tl.stops[proj.i + 1] : null;
  const projectedEnd = delta != null ? tl.endMin + delta : null;
  const eta = nav ? clock + nav.remMin : null;

  // voice guidance at 1 mi / ¼ mi / 500 ft
  useEffect(() => {
    if (!nav || offRoute) return;
    const tiers = [[1.05, 'In one mile, '], [0.27, 'In a quarter mile, '], [0.1, '']];
    for (const [at, prefix] of tiers) {
      if (nav.toNext <= at) {
        const key = `${nav.idx}:${at}`;
        if (spokenRef.current !== key) {
          spokenRef.current = key;
          speak(prefix + nav.next.instr);
        }
        break;
      }
    }
  }, [nav?.idx, nav?.toNext, offRoute]); // eslint-disable-line react-hooks/exhaustive-deps

  const gateReads = (day.gates ?? []).map((g) => {
    const s = tl.stops.find((x) => x.id === g.waypointId);
    if (!s) return null;
    const projected = delta != null ? s.arrive + delta : s.arrive;
    return { label: g.label, by: g.by, projected, ok: projected <= parseTime(g.by) };
  }).filter(Boolean);

  const deltaChip = delta == null ? null : Math.abs(delta) < 5
    ? { cls: 'on-time', text: 'ON PLAN' }
    : delta > 0
      ? { cls: 'behind', text: `${fmtDur(delta)} ${t('behind plan').toUpperCase()}` }
      : { cls: 'ahead', text: `${fmtDur(-delta)} ${t('ahead of plan').toUpperCase()}` };

  const showOverview = () => {
    setFollow(false);
    const map = mapRef.current;
    if (!map) return;
    const coords = reroute?.geometry ?? routes[day.id]?.geometry ?? day.waypoints.map((w) => [w.lng, w.lat]);
    if (coords.length < 2) return;
    const b = coords.reduce((acc, c) => acc.extend(c), new maplibregl.LngLatBounds(coords[0], coords[0]));
    map.setPitch(0);
    map.fitBounds(b, { padding: 60, bearing: 0, duration: 800 });
  };

  return (
    <div className="ride-mode nav">
      <div ref={mapDivRef} className="ride-map" />

      <div className="ride-overlay ride-overlay-top">
        <div className="ride-topbar">
          <select value={dayId} onChange={(e) => setDayId(e.target.value)}>
            {trip.days.map((d) => (
              <option key={d.id} value={d.id}>{d.dow} {fmtDayDate(d.date)} — {d.title.slice(0, 30)}</option>
            ))}
          </select>
          <span className="ride-clock">{fmtTime(clock)}</span>
          <button
            className={`btn icon-btn${muted ? ' off' : ''}`}
            title={muted ? t('Unmute') : t('Mute')}
            aria-label={muted ? t('Unmute') : t('Mute')}
            aria-pressed={muted}
            onClick={() => setMuted((m) => !m)}
          ><SpeakerIcon muted={muted} /></button>
          <button className="btn" onClick={onClose}>{t('Exit')}</button>
        </div>

        {geoErr && <div className="warning danger">⚠ {geoErr}</div>}
        {offRoute && !geoErr && (
          <div className="warning danger">
            {rerouting ? '⟳ Off route — finding a new way from here…'
              : rerouteFailed ? '⚠ Off route — reroute failed (no signal?). Head back toward the line.'
                : '⚠ Off route — recalculating…'}
          </div>
        )}

        {nav && !offRoute && (
          <div className="turn-card">
            <div className="turn-icon"><TurnArrow step={nav.next} /></div>
            <div className="turn-body">
              <div className="t-dist">{fmtStepDist(nav.toNext)}</div>
              <div className="t-instr">{nav.next.instr}</div>
              {nav.after && <div className="t-then">then <TurnArrow step={nav.after} /> {nav.after.instr}</div>}
            </div>
          </div>
        )}
        {steps === null && fix && <div className="turn-card loading"><div className="t-instr">loading turn-by-turn…</div></div>}
      </div>

      <div className="ride-overlay ride-overlay-bottom">
        <div className="ride-quick">
          {!follow && fix && (
            <button className="btn gold recenter" onClick={() => setFollow(true)}>◉ Re-center</button>
          )}
          <button className="btn overview" onClick={showOverview}>⤢ Overview</button>
        </div>
        <div className="ride-bottombar">
          <div className="rb-speed">
            <div className="n">{fix?.speedMph != null ? (u.metric ? Math.round(fix.speedMph * 1.609344) : Math.round(fix.speedMph)) : '—'}</div>
            <div className="l">{u.metric ? 'KM/H' : 'MPH'}</div>
          </div>
          <div className={`rb-delta ${deltaChip?.cls ?? ''}`}>
            <div className="n">{deltaChip?.text ?? (fix ? 'LOCATING…' : 'WAITING FOR GPS')}</div>
            {nextWp && nextSched && (
              <div className="l">next: {nextWp.name.slice(0, 26)} · {proj.remainToNext.toFixed(0)} mi · plan {fmtTime(nextSched.arrive)}{delta != null ? ` → ${fmtTime(nextSched.arrive + delta)}` : ''}</div>
            )}
          </div>
          <div className="rb-eta">
            <div className="n">{eta != null ? fmtTime(eta) : '—'}</div>
            <div className="l">{nav ? `${u.miNum(nav.remMi)} ${u.miUnit.toUpperCase()} · ${fmtDur(nav.remMin)}` : 'ETA'}</div>
          </div>
        </div>
        <div className="rp-bar"><div className="rp-fill" style={{ width: `${proj ? Math.min(100, (proj.doneMiles / Math.max(1, totalMiles)) * 100) : 0}%` }} /></div>
        <div className="rp-meta">
          <span>{proj ? Math.round(proj.doneMiles) : 0} / {Math.round(totalMiles)} mi · session {statsRef.current.miles.toFixed(1)} mi</span>
          <span>ends ~{projectedEnd != null ? fmtTime(projectedEnd) : fmtTime(tl.endMin)}</span>
        </div>
        {gateReads.length > 0 && (
          <div className="ride-gates">
            {gateReads.map((g, i) => (
              <span key={i} className={`ride-gate ${g.ok ? 'ok' : 'miss'}`}>{g.ok ? '✓' : '✗'} {g.label} {fmtTime(g.projected)}/{g.by}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
