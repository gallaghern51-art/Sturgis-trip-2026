import React, { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { useTrip } from '../engine/store.js';
import { dayTimeline, fmtTime, fmtDur, parseTime, planTargetAt } from '../engine/timeline.js';
import { haversineMiles } from '../engine/tripEngine.js';
import { routeDaySteps, routeFrom } from '../engine/routing.js';
import { STYLE_SATELLITE, STYLE_STREETS, STYLE_DARK, STYLE_LIGHT, warmTilesAhead, cachedGoogleStyle, googleStyle, GOOGLE_KEY } from '../engine/basemaps.js';
import { fmtDayDate } from '../engine/dates.js';
import { fetchConditionsAhead } from '../engine/conditions.js';
import WeatherIcon from './WeatherIcon.jsx';
import { useT, useTT, useUnits } from '../engine/settings.jsx';

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


// ---------- lane guidance ----------
// The arrows painted on the road before a junction, the way Google and Apple
// draw them: every lane at the intersection, with the ones that carry you
// through the next maneuver lit and the rest dimmed. The data rides on the step
// (see attachLanes in routing.js) and comes from OSM turn:lanes tags, so it is
// there on interstates and big junctions and absent on rural two-lanes — absent
// is fine, the strip simply does not render and the maneuver arrow stands alone.
const LANE_DEG = {
  'sharp left': -135, 'left': -90, 'slight left': -45, 'merge to left': -30,
  'straight': 0, 'none': 0,
  'merge to right': 30, 'slight right': 45, 'right': 90, 'sharp right': 135,
};

function LaneArrow({ ind }) {
  if (ind === 'uturn') return <span className="lane-glyph">\u21B6</span>;
  const deg = LANE_DEG[ind] ?? 0;
  // 'none' is an unmarked lane: a bare shaft, no head, so it does not read as
  // an instruction to go straight.
  const d = ind === 'none' ? 'M12 21 V5' : 'M12 21 V8 M12 3 L5.5 11 M12 3 L18.5 11';
  return (
    <svg viewBox="0 0 24 24" className="lane-arrow" style={{ transform: `rotate(${deg}deg)` }}>
      <path d={d} fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LaneStrip({ lanes }) {
  if (!lanes?.length) return null;
  return (
    <div className="lane-strip" aria-hidden="true">
      {lanes.map((l, i) => (
        <span key={i} className={`lane${l.v ? ' on' : ''}`}>
          {(l.i.length ? l.i : ['none']).map((ind, j) => <LaneArrow key={j} ind={ind} />)}
        </span>
      ))}
    </div>
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

// Nav map looks. Satellite is the default because terrain reads better at speed;
// streets is the fallback when imagery is too busy, and dark suits night riding.
const NAV_STYLES = [
  { key: 'hybrid', label: 'Satellite' },
  { key: 'streets', label: 'Streets' },
  { key: 'dark', label: 'Dark' },
  { key: 'light', label: 'Light' },
];

const navStyleFor = (key) => (
  key === 'streets' ? STYLE_STREETS
    : key === 'dark' ? STYLE_DARK
      : key === 'light' ? STYLE_LIGHT
        : cachedGoogleStyle('hybrid') ?? STYLE_SATELLITE
);


// A stop name is often longer than a phone is wide. Rather than truncate it,
// this scrolls it — one direction, looping, not ping-ponging back and forth.
// The text is rendered twice and shifted by exactly one copy plus the gap, so
// the second copy lands where the first began and the seam is invisible.
// Only overflowing text moves; short names sit still.
const MQ_GAP = 44; // px between the two copies — must match .mq-ink gap
const MQ_SPEED = 26; // px per second, so long and short names read the same

const SCRUB_POP_W = 256; // must match .scrub-pop width

function Marquee({ className, label, text }) {
  const boxRef = useRef(null);
  const segRef = useRef(null);
  const inkRef = useRef(null);
  const [runs, setRuns] = useState(false);

  useEffect(() => {
    const box = boxRef.current;
    const seg = segRef.current;
    const ink = inkRef.current;
    if (!box || !seg || !ink) return;
    const segW = seg.scrollWidth;
    // Any overflow at all clips a character, so scroll on 1px — a name that
    // ends in a sliced "a" reads as a typo at 70 mph.
    const over = segW - box.clientWidth > 1;
    setRuns(over);
    if (over) {
      const shift = segW + MQ_GAP;
      ink.style.setProperty('--shift', `${-shift}px`);
      ink.style.setProperty('--dur', `${shift / MQ_SPEED}s`);
    }
  }, [text]);

  // The label sits OUTSIDE the clipping box: inside it, the text slid underneath
  // the label instead of being cut at the edge of the scroll window.
  return (
    <div className={`${className} mq-row`}>
      {label && <i className="mq-label">{label}</i>}
      <div className="mq-box" ref={boxRef}>
        <span className={`mq-ink${runs ? ' runs' : ''}`} ref={inkRef}>
          <span className="mq-seg" ref={segRef}>{text}</span>
          {runs && <span className="mq-seg" aria-hidden="true">{text}</span>}
        </span>
      </div>
    </div>
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [navStyle, setNavStyle] = useState('hybrid');
  const [ahead, setAhead] = useState(null); // conditions a few miles up the road
  const [scrub, setScrub] = useState(null); // {pct, stop} while dragging the bar
  const barRef = useRef(null);
  const wpMarkersRef = useRef([]);
  // Posted limits are not in what we route with: OSRM's steps carry no maxspeed
  // and Google's limits sit behind a separately-licensed Roads API. The chip is
  // wired and will render the moment a source is plumbed in — it just will not
  // invent a number in the meantime.
  const speedLimit = null;
  const t = useT();
  const tt = useTT();
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
      attributionControl: false, // shown in the hub instead — see below
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
  const applyLiveRef = useRef(() => {});
  applyLiveRef.current = () => {
    const map = mapRef.current;
    if (!map) return;
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
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (map.isStyleLoaded()) applyLiveRef.current();
    else map.once('load', () => applyLiveRef.current());
  }, [reroute]);

  // Changing the basemap calls setStyle, which drops every source and layer we
  // added — so the route has to be laid back down once the new style settles.
  const drawPlannedRef = useRef(() => {});
  drawPlannedRef.current = () => {
    const map = mapRef.current;
    if (!map) return;
    ensureNavLayers(map);
    const geom = routes[day.id]?.geometry ?? day.waypoints.map((w) => [w.lng, w.lat]);
    map.getSource('ride-route').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: geom } });
    applyLiveRef.current();
  };
  const firstStyle = useRef(true);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;
    // the map is constructed with the initial style already applied
    if (firstStyle.current) { firstStyle.current = false; return undefined; }
    map.setStyle(navStyleFor(navStyle));
    const redraw = () => drawPlannedRef.current();
    map.once('styledata', redraw);
    return () => map.off('styledata', redraw);
  }, [navStyle]);

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

  // Weather for a point up the road rather than underfoot — what matters on a
  // bike is what you are about to ride into. Keyed to a coarse grid in
  // conditions.js so travelling along a road reuses one cache entry.
  const aheadPt = useMemo(() => {
    const chain = geomInfo?.chain;
    if (!chain?.length || !proj) return null;
    // ~12 miles ahead along the routed line
    const startIdx = Math.min(chain.length - 1, Math.max(0, proj.i));
    let acc = 0;
    for (let i = startIdx; i < chain.length - 1; i++) {
      acc += haversineMiles(chain[i], chain[i + 1]);
      if (acc >= 12) return chain[i + 1];
    }
    return chain[chain.length - 1];
  }, [geomInfo, proj?.i]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!aheadPt) return;
    let dead = false;
    fetchConditionsAhead(aheadPt.lat, aheadPt.lng).then((w) => { if (!dead && w) setAhead(w); });
    return () => { dead = true; };
  }, [aheadPt?.lat?.toFixed?.(1), aheadPt?.lng?.toFixed?.(1)]); // eslint-disable-line react-hooks/exhaustive-deps

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
    ? { cls: 'on-time', text: t('ON PLAN') }
    : delta > 0
      ? { cls: 'behind', text: `${fmtDur(delta)} ${t('LATE')}` }
      : { cls: 'ahead', text: `${fmtDur(-delta)} ${t('EARLY')}` };

  // "Behind" on its own is not actionable. This is where the plan says you
  // should be at this minute — which leg, and how far off in ground terms —
  // read straight off the timeline, so moving a stop or retiming a departure
  // changes it with nothing to invalidate.
  const target = proj ? planTargetAt(day, tl, clock) : null;
  const targetWp = target ? day.waypoints[target.stopIndex] : null;
  const milesOff = target && proj ? proj.doneMiles - target.miles : null;

  // Stops placed along the progress bar by their share of the day's distance, so
  // the bar shows what is coming (fuel, a photo stop, the end) and not just how
  // far along you are.
  const stopMarks = useMemo(() => {
    if (!totalMiles) return [];
    // Meals are day-level, not waypoint-level, so a stop counts as a meal when a
    // meal's venue name turns up in it — "Our Place (breakfast)" and the like.
    const mealNames = (day.meals ?? [])
      .map((m) => (m.name || '').toLowerCase().replace(/\s*\(.*$/, '').trim())
      .filter((n) => n.length > 3);
    let acc = 0;
    return tl.stops.map((st, i) => {
      acc += st.legMiles;
      const w = day.waypoints[i];
      if (!w) return null;
      const lower = (w.name || '').toLowerCase();
      // A stop is often more than one thing — breakfast at Our Place is also the
      // fuel top-off next door — so these are flags, not a single category.
      const isFuel = !!w.fuel;
      const isMeal = mealNames.some((n) => lower.includes(n));
      const isPhoto = w.kind === 'photo';
      const isEnd = w.kind === 'end' || w.kind === 'start';
      const letter = `${isFuel ? 'F' : ''}${isMeal ? 'M' : ''}${isPhoto ? 'P' : ''}`;
      // the dot takes the most safety-critical of them
      const kind = isFuel ? 'fuel' : isMeal ? 'meal' : isPhoto ? 'photo' : isEnd ? 'end' : 'via';
      // a via with real time on the ground is worth marking; a pass-through is not
      const minor = kind === 'via' && !(st.dwell > 0);
      return {
        pct: Math.max(0, Math.min(100, (acc / totalMiles) * 100)),
        kind, letter, name: w.name, note: w.note || '', miles: acc,
        arrive: st.arrive, minor,
      };
    }).filter(Boolean);
  }, [tl, day, totalMiles]);

  // Only the stops that actually get a dot on the bar. Scrubbing has to snap to
  // this set, not to every waypoint — otherwise the card anchors to a stop with
  // no dot under it and appears to be pointing at nothing.
  const barStops = useMemo(() => stopMarks.filter((m) => !m.minor), [stopMarks]);

  // Drag along the bar to read the day ahead: the nearest stop to the finger,
  // with what it is, where it is, and how far off. Pointer events so it works
  // the same under a glove on glass as under a mouse.
  const scrubAt = (clientX) => {
    const el = barRef.current;
    if (!el || !barStops.length) return;
    const r = el.getBoundingClientRect();
    const pct = Math.max(0, Math.min(100, ((clientX - r.left) / r.width) * 100));
    let best = barStops[0];
    for (const m of barStops) if (Math.abs(m.pct - pct) < Math.abs(best.pct - pct)) best = m;

    // Snap to the stop, not the finger: the card describes one stop, so parking
    // it mid-leg made it look like it was describing a stretch of empty road.
    // The card is wider than the gap between the end stops and the screen edge,
    // so it cannot always sit centred on its dot — it gets pushed inboard to
    // stay readable, and a tail points back at the dot it belongs to.
    const host = el.offsetParent?.getBoundingClientRect() ?? { left: 0, width: window.innerWidth };
    const dotX = r.left + (r.width * best.pct) / 100 - host.left;
    const w = Math.min(SCRUB_POP_W, window.innerWidth * 0.88);
    const left = Math.max(4, Math.min(dotX - w / 2, host.width - w - 4));
    setScrub({ stop: best, pct: best.pct, left, tail: Math.max(14, Math.min(dotX - left, w - 14)) });
  };
  const onScrubDown = (e) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    scrubAt(e.clientX);
  };
  const onScrubMove = (e) => { if (scrub) scrubAt(e.clientX); };
  const endScrub = () => setScrub(null);

  const showOverview = () => {
    setFollow(false);
    const map = mapRef.current;
    if (!map) return;
    const coords = reroute?.geometry ?? routes[day.id]?.geometry ?? day.waypoints.map((w) => [w.lng, w.lat]);
    if (coords.length < 2) return;
    const b = coords.reduce((acc, c) => acc.extend(c), new maplibregl.LngLatBounds(coords[0], coords[0]));
    map.setPitch(0);
    // Padding leaves room for the HUD, which covers the top and bottom of the
    // screen — without it the first and last stops sit under the panels.
    map.fitBounds(b, {
      bearing: 0,
      duration: 800,
      padding: { top: 120, bottom: 190, left: 60, right: 60 },
    });
  };

  // Named stops, but only while the whole day is on screen. During navigation
  // they would be noise on top of the turn card; in overview they are the point.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;
    wpMarkersRef.current.forEach((m) => m.remove());
    wpMarkersRef.current = [];
    if (follow) return undefined;

    const labels = [];
    day.waypoints.forEach((w, i) => {
      if (!Number.isFinite(w.lat) || !Number.isFinite(w.lng)) return;
      const mark = stopMarks.find((m) => m.name === w.name);
      const el = document.createElement('div');
      el.className = `ov-wp ${mark?.kind ?? 'via'}`;
      const dot = document.createElement('span');
      dot.className = 'ov-dot';
      const label = document.createElement('span');
      label.className = 'ov-label';
      label.textContent = tt(w.name);
      // alternate sides so consecutive labels along a line do not stack
      el.classList.add(i % 2 ? 'below' : 'above');
      el.append(dot, label);
      labels.push(label);
      wpMarkersRef.current.push(new maplibregl.Marker({ element: el }).setLngLat([w.lng, w.lat]).addTo(map));
    });

    // A label is centred on its stop, so a stop near the edge of the screen
    // hangs half its name off it — the first and last stop of a day, every
    // time. Slide those back inside instead of letting them get cut.
    const clamp = () => {
      const box = map.getContainer().getBoundingClientRect();
      labels.forEach((el) => {
        const prev = Number(el.dataset.dx || 0);
        const r = el.getBoundingClientRect();
        const left = r.left - box.left - prev; // where it would sit untranslated
        const dx = left < 6 ? 6 - left
          : left + r.width > box.width - 6 ? box.width - 6 - (left + r.width)
            : 0;
        if (dx !== prev) {
          el.dataset.dx = String(dx);
          el.style.transform = dx ? `translateX(${dx}px)` : '';
        }
      });
    };
    clamp();
    map.on('move', clamp);
    return () => {
      map.off('move', clamp);
      wpMarkersRef.current.forEach((m) => m.remove());
      wpMarkersRef.current = [];
    };
  }, [follow, day, stopMarks, tt]);

  return (
    <div className="ride-mode nav">
      <div ref={mapDivRef} className="ride-map" />

      <div className="ride-overlay ride-overlay-top">
        {/* A day <select> used to sit here and eat the whole row, which pushed
            the sound and exit controls off a phone screen. The bar is now just
            the leg you are on plus one way in; everything else is in the hub. */}
        <div className="ride-topbar">
          {/* Tapping the leg frames the whole day — the standalone Overview
              button was a second control for the same thing. */}
          <button
            className="ride-leg"
            onClick={showOverview}
            title={t('Route overview')}
          >
            <span className="rl-day">{day.dow} {fmtDayDate(day.date)}</span>
            <Marquee className="rl-title" text={tt(day.title)} />
          </button>
          {/* Weather a dozen miles up the road, and the posted limit when we can
              get it. No clock — the phone shows one an inch above this. */}
          {ahead && (
            <div className="ride-chip wx" title={`${ahead.summary} · ${t('ahead')}`}>
              {/* same glyph the day panel uses, so one sky reads one way */}
              <WeatherIcon code={ahead.code} className="wxc-icon" />
              <span className="wxc-temp">{u.temp(ahead.temp)}</span>
            </div>
          )}
          {speedLimit != null && (
            <div className="ride-chip limit" title={t('Speed limit')}>
              <span className="sl-num">{u.metric ? Math.round(speedLimit * 1.609344) : speedLimit}</span>
            </div>
          )}
          <button
            className={`btn icon-btn ride-menu-btn${menuOpen ? ' on' : ''}`}
            onClick={() => setMenuOpen((v) => !v)}
            aria-expanded={menuOpen}
            aria-label={t('Ride menu')}
            title={t('Ride menu')}
          >
            <svg viewBox="0 0 22 22" aria-hidden="true" className="hamb">
              <path d="M3 6h16M3 11h16M3 16h16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {menuOpen && (
          <div className="ride-menu" role="dialog" aria-label={t('Ride menu')}>
            <label className="rm-row">
              <span className="rm-label">{t('Leg')}</span>
              <select value={dayId} onChange={(e) => setDayId(e.target.value)}>
                {trip.days.map((d) => (
                  <option key={d.id} value={d.id}>{d.dow} {fmtDayDate(d.date)} — {tt(d.title)}</option>
                ))}
              </select>
            </label>

            <div className="rm-row">
              <span className="rm-label">{t('Map')}</span>
              <div className="rm-seg">
                {NAV_STYLES.map((o) => (
                  <button
                    key={o.key}
                    className={navStyle === o.key ? 'active' : ''}
                    onClick={() => setNavStyle(o.key)}
                  >{t(o.label)}</button>
                ))}
              </div>
            </div>

            <div className="rm-row">
              <span className="rm-label">{t('Voice')}</span>
              {/* A switch, not a pair of yes/no buttons — it is one binary thing
                  and the segmented version read as "Sí / No" in Spanish. It
                  rides in a full-width bar so the row is built like the leg
                  select and the map segments above it, rather than a small
                  control floating alone against the left edge. */}
              <div className="rm-switch">
                <SpeakerIcon muted={muted} />
                <button
                  className={`toggle rm-toggle${muted ? '' : ' on'}`}
                  role="switch"
                  aria-checked={!muted}
                  aria-label={t('Voice')}
                  onClick={() => setMuted((m) => !m)}
                />
              </div>
            </div>

            {/* The thing a rider actually needs to find, so it gets the weight
                and sits alone at the bottom. */}
            <button className="btn end-nav" onClick={onClose}>{t('End navigation')}</button>

            {/* Tile credit still has to appear somewhere — it just has no place
                on a HUD read at speed, so it lives here. */}
            <div className="rm-attrib">
              {navStyle === 'hybrid' ? 'Imagery © Esri, Maxar, Earthstar Geographics' : '© OpenFreeMap · OpenMapTiles · OpenStreetMap'}
            </div>
          </div>
        )}

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
            <div className="turn-head">
              <div className="turn-icon"><TurnArrow step={nav.next} /></div>
              <div className="turn-body">
                <div className="t-dist">{fmtStepDist(nav.toNext)}</div>
                <div className="t-instr">{nav.next.instr}</div>
              </div>
            </div>
            <LaneStrip lanes={nav.next.lanes} />
            {nav.after && <div className="t-then">{t('then')} <TurnArrow step={nav.after} /> {nav.after.instr}</div>}
          </div>
        )}
        {steps === null && fix && <div className="turn-card loading"><div className="t-instr">loading turn-by-turn…</div></div>}
      </div>

      <div className="ride-overlay ride-overlay-bottom">
        <div className="ride-quick">
          {!follow && fix && (
            <button className="btn gold recenter" onClick={() => setFollow(true)}>◉ {t('Re-center')}</button>
          )}
        </div>
        {/* One card. Speed came off — a bike has a speedometer six inches away
            and it was the least useful number here. */}
        <div className={`rb-delta ${deltaChip?.cls ?? ''}`}>
          <div className="n">{deltaChip?.text ?? (fix ? t('LOCATING…') : t('WAITING FOR GPS'))}</div>
          <div className="rb-line">
            {proj && nextWp && <><b>{u.miNum(proj.remainToNext)}</b> <i>{u.miUnit}</i></>}
            {nav && <><b className="sep">{fmtDur(nav.remMin)}</b> <i>{t('left')}</i></>}
          </div>
          <div className="rb-line eta">
            <b>{eta != null ? fmtTime(eta) : '—'}</b> <i>{t('ETA')}</i>
          </div>
          {nextWp && <Marquee className="rb-next" label={t('Next')} text={tt(nextWp.name)} />}
        </div>
        {/* clamped so dragging to either end keeps the card fully on screen */}
        {scrub && (
          <div className="scrub-pop" style={{ left: `${scrub.left}px` }}>
            <span className="sp-arrow" style={{ left: `${scrub.tail}px` }} />
            <div className="sp-name">{tt(scrub.stop.name)}</div>
            <div className="sp-meta">
              {scrub.stop.letter && <span className={`sp-tag ${scrub.stop.kind}`}>{scrub.stop.letter}</span>}
              <span>{u.miNum(Math.max(0, scrub.stop.miles - (proj?.doneMiles ?? 0)))} {u.miUnit} {t('away')}</span>
              <span>· {fmtTime(scrub.stop.arrive)}</span>
            </div>
            {scrub.stop.note && <div className="sp-note">{tt(scrub.stop.note)}</div>}
          </div>
        )}
        <div
          className="rp-bar"
          ref={barRef}
          onPointerDown={onScrubDown}
          onPointerMove={onScrubMove}
          onPointerUp={endScrub}
          onPointerCancel={endScrub}
          onPointerLeave={endScrub}
        >
          <div className="rp-fill" style={{ width: `${proj ? Math.min(100, (proj.doneMiles / Math.max(1, totalMiles)) * 100) : 0}%` }} />
          {barStops.map((m, i) => (
            <span
              key={i}
              className={`rp-stop ${m.kind}${scrub?.stop === m ? ' active' : ''}`}
              style={{ left: `${m.pct}%` }}
              title={m.name}
            />
          ))}
          {scrub && <span className="rp-cursor" style={{ left: `${scrub.pct}%` }} />}
        </div>
        {/* Letters under the marks: F fuel, M meal, P photo. Self-describing, so
            there is no key to hunt for at speed. */}
        <div className="rp-keys">
          {barStops.filter((m) => m.letter).map((m, i) => (
            <span key={i} className={`rp-key ${m.kind}`} style={{ left: `${m.pct}%` }} title={m.name}>{m.letter}</span>
          ))}
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
