import React, { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { useTrip } from '../engine/store.js';
import { dayTimeline, fmtTime, fmtDur, parseTime } from '../engine/timeline.js';
import { haversineMiles } from '../engine/tripEngine.js';
import { routeDaySteps } from '../engine/routing.js';
import { STYLE_SATELLITE } from '../engine/basemaps.js';
import { fmtDayDate } from '../engine/dates.js';

// Ride Mode: a navigation HUD over a live map. Projects your GPS position onto
// the planned route and answers the questions that matter at 70 mph: where do I
// turn next, and am I ahead of or behind the plan?

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

// Position on the maneuver chain: next turn + miles to it.
function locateOnSteps(steps, pos) {
  if (!steps || steps.length < 2) return null;
  const best = projectOnChain(steps, pos);
  if (!best) return null;
  const cur = steps[best.i];
  return { next: steps[best.i + 1], after: steps[best.i + 2] ?? null, idx: best.i + 1, toNext: Math.max(0, (1 - best.f) * cur.dist), off: best.off };
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
  const [follow, setFollow] = useState(true);
  const [muted, setMuted] = useState(false);
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

  const day = trip.days.find((d) => d.id === dayId) ?? trip.days[0];
  const tl = useMemo(() => dayTimeline(day, routedLegsByDay[day.id]), [day, routedLegsByDay]);
  const totalMiles = tl.stops.reduce((a, s) => a + s.legMiles, 0);

  // ---- nav map with position puck ----
  useEffect(() => {
    const start = day.waypoints[0];
    const map = new maplibregl.Map({
      container: mapDivRef.current,
      style: STYLE_SATELLITE,
      center: start ? [start.lng, start.lat] : [-108, 45],
      zoom: 12,
      attributionControl: { compact: true },
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

  // draw / update the day's route line on the nav map
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const geom = routes[day.id]?.geometry ?? day.waypoints.map((w) => [w.lng, w.lat]);
    const data = { type: 'Feature', geometry: { type: 'LineString', coordinates: geom } };
    const apply = () => {
      if (map.getSource('ride-route')) {
        map.getSource('ride-route').setData(data);
      } else {
        map.addSource('ride-route', { type: 'geojson', data });
        map.addLayer({ id: 'ride-route-glow', type: 'line', source: 'ride-route', paint: { 'line-color': '#e8622c', 'line-width': 11, 'line-opacity': 0.3, 'line-blur': 3 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
        map.addLayer({ id: 'ride-route-line', type: 'line', source: 'ride-route', paint: { 'line-color': '#ffb03a', 'line-width': 5, 'line-opacity': 0.95 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
      }
    };
    if (map.isStyleLoaded()) apply();
    else map.once('load', apply);
  }, [day.id, routes]); // eslint-disable-line react-hooks/exhaustive-deps

  // turn-by-turn maneuvers for the selected day
  useEffect(() => {
    let dead = false;
    setSteps(null);
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

        // camera follow: course-up like a nav app
        const map = mapRef.current;
        if (map) {
          puckRef.current?.setLngLat([next.lng, next.lat]);
          if (heading != null) puckRef.current?.setRotation(heading);
          if (followRef.current) {
            map.easeTo({
              center: [next.lng, next.lat],
              bearing: heading ?? map.getBearing(),
              zoom: Math.max(map.getZoom(), 13),
              duration: 900,
              // keep the puck low on screen so the road ahead fills the view
              padding: { top: Math.round((mapDivRef.current?.clientHeight ?? 600) * 0.35), bottom: 0, left: 0, right: 0 },
            });
          }
        }
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
  const proj = fix ? planPosition(day, tl, fix) : null;
  const nav = fix && steps?.length ? locateOnSteps(steps, fix) : null;
  const delta = proj ? clock - proj.plannedMin : null; // + = behind plan
  const offRoute = nav ? nav.off > 1.5 : proj ? proj.dist > 2.5 : false;
  const nextWp = proj ? day.waypoints[proj.i + 1] : null;
  const nextSched = proj ? tl.stops[proj.i + 1] : null;
  const projectedEnd = delta != null ? tl.endMin + delta : null;

  // voice guidance at 1 mi / ¼ mi / 500 ft
  useEffect(() => {
    if (!nav || mutedRef.current || offRoute || !('speechSynthesis' in window)) return;
    const tiers = [[1.05, 'In one mile, '], [0.27, 'In a quarter mile, '], [0.1, '']];
    for (const [at, prefix] of tiers) {
      if (nav.toNext <= at) {
        const key = `${nav.idx}:${at}`;
        if (spokenRef.current !== key) {
          spokenRef.current = key;
          try {
            window.speechSynthesis.cancel();
            window.speechSynthesis.speak(new SpeechSynthesisUtterance(prefix + nav.next.instr));
          } catch { /* no voice — HUD still works */ }
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
      ? { cls: 'behind', text: `${fmtDur(delta)} BEHIND` }
      : { cls: 'ahead', text: `${fmtDur(-delta)} AHEAD` };

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
          <button className="btn" title={muted ? 'Unmute voice guidance' : 'Mute voice guidance'} onClick={() => setMuted((m) => !m)}>{muted ? '🔇' : '🔊'}</button>
          <button className="btn" onClick={onClose}>Exit</button>
        </div>

        {geoErr && <div className="warning danger">⚠ {geoErr}</div>}
        {offRoute && !geoErr && <div className="warning danger">⚠ Off route — {nav ? nav.off.toFixed(1) : proj?.dist.toFixed(1)} mi from the line. Work back toward the glow.</div>}

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
        {!follow && fix && (
          <button className="btn gold recenter" onClick={() => setFollow(true)}>◉ Re-center</button>
        )}
        <div className="ride-bottombar">
          <div className="rb-speed">
            <div className="n">{fix?.speedMph != null ? Math.round(fix.speedMph) : '—'}</div>
            <div className="l">MPH</div>
          </div>
          <div className={`rb-delta ${deltaChip?.cls ?? ''}`}>
            <div className="n">{deltaChip?.text ?? (fix ? 'LOCATING…' : 'WAITING FOR GPS')}</div>
            {nextWp && nextSched && (
              <div className="l">next: {nextWp.name.slice(0, 26)} · {proj.remainToNext.toFixed(0)} mi · plan {fmtTime(nextSched.arrive)}{delta != null ? ` → ${fmtTime(nextSched.arrive + delta)}` : ''}</div>
            )}
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
