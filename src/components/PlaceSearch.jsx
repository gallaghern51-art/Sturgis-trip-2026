import React, { useRef, useState } from 'react';
import { useTrip } from '../engine/store.js';
import { bestInsertIndex } from '../engine/tripEngine.js';

// Live place lookup via OpenStreetMap Nominatim — type a real-world place,
// get lat/lng, and drop it into the day's route at the cheapest splice point.
export default function PlaceSearch({ day }) {
  const { dispatch } = useTrip();
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const timer = useRef(null);

  const search = (text) => {
    setQ(text);
    clearTimeout(timer.current);
    if (text.trim().length < 3) { setResults([]); return; }
    timer.current = setTimeout(async () => {
      setBusy(true);
      try {
        const url = `https://nominatim.openstreetmap.org/search?format=json&limit=6&countrycodes=us&q=${encodeURIComponent(text)}`;
        const res = await fetch(url, { headers: { Accept: 'application/json' } });
        const json = await res.json();
        setResults(Array.isArray(json) ? json : []);
      } catch {
        setResults([]);
      } finally {
        setBusy(false);
      }
    }, 400);
  };

  const add = (r) => {
    const pt = { lat: parseFloat(r.lat), lng: parseFloat(r.lon) };
    const name = r.display_name.split(',').slice(0, 2).join(',');
    dispatch({
      type: 'apply_ops',
      ops: [{
        op: 'add_waypoint',
        dayId: day.id,
        index: bestInsertIndex(day.waypoints, pt),
        waypoint: { name, ...pt, kind: 'via', note: r.display_name.split(',').slice(2, 5).join(',').trim() },
      }],
    });
    setQ('');
    setResults([]);
  };

  return (
    <div className="place-search">
      <input
        value={q}
        placeholder="Add a stop — search any real place (e.g. 'Wall Drug, SD')…"
        onChange={(e) => search(e.target.value)}
      />
      {busy && <div className="ps-status">searching…</div>}
      {results.length > 0 && (
        <div className="ps-results">
          {results.map((r) => (
            <button key={r.place_id} onClick={() => add(r)}>
              <span className="ps-name">{r.display_name.split(',').slice(0, 2).join(',')}</span>
              <span className="ps-detail">{r.display_name.split(',').slice(2, 5).join(',')}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
