import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTrip } from '../engine/store.js';
import { dayTimeline, fmtTime, fmtDur, parseTime } from '../engine/timeline.js';
import { haversineMiles } from '../engine/tripEngine.js';
import { fmtDayDate } from '../engine/dates.js';

// Ride Mode: a glanceable GPS HUD. Projects your live position onto today's
// planned route and answers the only question that matters at 70 mph:
// am I ahead of or behind the plan, and by how much?

const nowMin = () => {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
};

// Project a fix onto the day's waypoint legs: returns leg index, fraction along
// it, planned clock minutes at that point, miles done, and distance off-route.
function planPosition(day, tl, pos) {
  const wps = day.waypoints;
  if (wps.length < 2) return null;
  let best = null;
  for (let i = 0; i < wps.length - 1; i++) {
    const a = wps[i];
    const b = wps[i + 1];
    // equirectangular projection around the fix — plenty for leg-level matching
    const kx = Math.cos((pos.lat * Math.PI) / 180) * 69.17;
    const ky = 69.17;
    const ax = (a.lng - pos.lng) * kx; const ay = (a.lat - pos.lat) * ky;
    const bx = (b.lng - pos.lng) * kx; const by = (b.lat - pos.lat) * ky;
    const dx = bx - ax; const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    const px = ax + t * dx; const py = ay + t * dy;
    const dist = Math.sqrt(px * px + py * py); // miles off the straight leg line
    if (!best || dist < best.dist) best = { i, f: t, dist };
  }
  const seg = tl.stops[best.i + 1];
  const plannedMin = tl.stops[best.i].depart + best.f * (seg?.legMin ?? 0);
  let doneMiles = 0;
  for (let k = 1; k <= best.i; k++) doneMiles += tl.stops[k].legMiles;
  doneMiles += best.f * (seg?.legMiles ?? 0);
  return { ...best, plannedMin, doneMiles, remainToNext: (1 - best.f) * (seg?.legMiles ?? 0) };
}

export default function RideMode({ onClose }) {
  const { state, routedLegsByDay } = useTrip();
  const { trip } = state;
  const today = new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD local
  const defaultDay = trip.days.find((d) => d.date === today)?.id ?? state.selectedDayId ?? trip.days[0]?.id;
  const [dayId, setDayId] = useState(defaultDay);
  const [fix, setFix] = useState(null); // {lat,lng,speedMph,accuracy,at}
  const [geoErr, setGeoErr] = useState(null);
  const [clock, setClock] = useState(nowMin());
  const statsRef = useRef({ miles: 0, maxMph: 0, last: null });
  const wakeRef = useRef(null);

  const day = trip.days.find((d) => d.id === dayId) ?? trip.days[0];
  const tl = useMemo(() => dayTimeline(day, routedLegsByDay[day.id]), [day, routedLegsByDay]);
  const totalMiles = tl.stops.reduce((a, s) => a + s.legMiles, 0);

  // GPS watch
  useEffect(() => {
    if (!navigator.geolocation) { setGeoErr('No GPS available in this browser.'); return; }
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const st = statsRef.current;
        const next = { lat: p.coords.latitude, lng: p.coords.longitude, at: p.timestamp, accuracy: p.coords.accuracy };
        let mph = p.coords.speed != null && !Number.isNaN(p.coords.speed) ? p.coords.speed * 2.23694 : null;
        if (mph == null && st.last) {
          const dtH = (next.at - st.last.at) / 3600000;
          if (dtH > 0) mph = haversineMiles(st.last, next) / dtH;
        }
        if (st.last) st.miles += haversineMiles(st.last, next);
        if (mph != null && mph < 140) st.maxMph = Math.max(st.maxMph, mph);
        st.last = next;
        setFix({ ...next, speedMph: mph });
        setGeoErr(null);
      },
      (e) => setGeoErr(e.code === 1 ? 'Location permission denied — allow it in your browser settings to ride with the HUD.' : e.message),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 }
    );
    const tick = setInterval(() => setClock(nowMin()), 5000);
    return () => { navigator.geolocation.clearWatch(id); clearInterval(tick); };
  }, []);

  // Keep the screen awake while riding
  useEffect(() => {
    const grab = async () => {
      try { wakeRef.current = await navigator.wakeLock?.request('screen'); } catch { /* unsupported */ }
    };
    grab();
    const onVis = () => { if (document.visibilityState === 'visible') grab(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { document.removeEventListener('visibilitychange', onVis); wakeRef.current?.release?.(); };
  }, []);

  const proj = fix ? planPosition(day, tl, fix) : null;
  const delta = proj ? clock - proj.plannedMin : null; // + = behind plan
  const offRoute = proj && proj.dist > 2.5;
  const nextWp = proj ? day.waypoints[proj.i + 1] : null;
  const nextSched = proj ? tl.stops[proj.i + 1] : null;
  const projectedEnd = delta != null ? tl.endMin + delta : null;

  const gateReads = (day.gates ?? []).map((g) => {
    const s = tl.stops.find((x) => x.id === g.waypointId);
    if (!s) return null;
    const projected = delta != null ? s.arrive + delta : s.arrive;
    const gateMin = parseTime(g.by);
    return { label: g.label, by: g.by, projected, ok: projected <= gateMin };
  }).filter(Boolean);

  const deltaChip = delta == null ? null : Math.abs(delta) < 5
    ? { cls: 'on-time', text: 'ON PLAN' }
    : delta > 0
      ? { cls: 'behind', text: `${fmtDur(delta)} BEHIND` }
      : { cls: 'ahead', text: `${fmtDur(-delta)} AHEAD` };

  return (
    <div className="ride-mode">
      <div className="ride-top">
        <select value={dayId} onChange={(e) => setDayId(e.target.value)}>
          {trip.days.map((d) => (
            <option key={d.id} value={d.id}>{d.dow} {fmtDayDate(d.date)} — {d.title.slice(0, 30)}</option>
          ))}
        </select>
        <span className="ride-clock">{fmtTime(clock)}</span>
        <button className="btn" onClick={onClose}>Exit</button>
      </div>

      {geoErr && <div className="warning danger" style={{ margin: '10px 16px' }}>⚠ {geoErr}</div>}

      <div className="ride-hud">
        <div className="ride-speed">
          <div className="n">{fix?.speedMph != null ? Math.round(fix.speedMph) : '—'}</div>
          <div className="l">MPH</div>
        </div>
        <div className={`ride-delta ${deltaChip?.cls ?? ''}`}>
          <div className="n">{deltaChip?.text ?? (fix ? 'LOCATING…' : 'WAITING FOR GPS')}</div>
          <div className="l">{proj ? `vs plan · ${offRoute ? `${proj.dist.toFixed(1)} mi off route` : 'on route'}` : day.title.slice(0, 40)}</div>
        </div>
      </div>

      {nextWp && (
        <div className="ride-next">
          <div className="rn-label">NEXT STOP{nextWp.fuel ? ' · FUEL' : ''}</div>
          <div className="rn-name">{nextWp.name}</div>
          <div className="rn-meta">
            {proj.remainToNext.toFixed(0)} mi ·
            plan {fmtTime(nextSched.arrive)} ·
            now tracking {fmtTime(nextSched.arrive + delta)}
          </div>
        </div>
      )}

      <div className="ride-progress">
        <div className="rp-bar"><div className="rp-fill" style={{ width: `${proj ? Math.min(100, (proj.doneMiles / Math.max(1, totalMiles)) * 100) : 0}%` }} /></div>
        <div className="rp-meta">
          <span>{proj ? Math.round(proj.doneMiles) : 0} / {Math.round(totalMiles)} mi</span>
          <span>day ends ~{projectedEnd != null ? fmtTime(projectedEnd) : fmtTime(tl.endMin)}{delta != null && Math.abs(delta) >= 5 ? ` (plan ${fmtTime(tl.endMin)})` : ''}</span>
        </div>
      </div>

      {gateReads.length > 0 && (
        <div className="ride-gates">
          {gateReads.map((g, i) => (
            <div key={i} className={`ride-gate ${g.ok ? 'ok' : 'miss'}`}>
              {g.ok ? '✓' : '✗'} {g.label}: tracking {fmtTime(g.projected)} vs {g.by}
            </div>
          ))}
        </div>
      )}

      <div className="ride-stats">
        <span>session {statsRef.current.miles.toFixed(1)} mi</span>
        <span>max {Math.round(statsRef.current.maxMph)} mph</span>
        <span>{fix ? `±${Math.round(fix.accuracy)}m GPS` : ''}</span>
      </div>
    </div>
  );
}
