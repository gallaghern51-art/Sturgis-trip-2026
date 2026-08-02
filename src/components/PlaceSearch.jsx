import React, { useRef, useState } from 'react';
import { useTrip } from '../engine/store.js';
import { bestInsertIndex } from '../engine/tripEngine.js';
import { geocode } from '../engine/geocode.js';
import { useT } from '../engine/settings.jsx';

// Live place lookup via OpenStreetMap Nominatim — type a real-world place,
// get lat/lng, and drop it into the day's route at the cheapest splice point.
export default function PlaceSearch({ day }) {
  const t = useT();
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
        // bias results toward the day being edited
        const anchor = day.waypoints.find((w) => Number.isFinite(w.lat));
        setResults(await geocode(text, anchor ? { lat: anchor.lat, lng: anchor.lng } : undefined));
      } catch {
        setResults([]);
      } finally {
        setBusy(false);
      }
    }, 400);
  };

  const add = (r) => {
    const pt = { lat: r.lat, lng: r.lng };
    dispatch({
      type: 'apply_ops',
      ops: [{
        op: 'add_waypoint',
        dayId: day.id,
        index: bestInsertIndex(day.waypoints, pt),
        waypoint: {
          name: r.name, ...pt, kind: 'via', note: r.detail,
          // place identity rides with the stop so the route API snaps to the
          // place, not to whatever pavement is nearest the coordinate
          ...(r.source === 'google' && r.id ? { placeId: r.id } : {}),
        },
      }],
    });
    setQ('');
    setResults([]);
  };

  return (
    <div className="place-search">
      <input
        value={q}
        placeholder={t('Add a stop — search any real place (e.g. \'Wall Drug, SD\')…')}
        onChange={(e) => search(e.target.value)}
      />
      {busy && <div className="ps-status">{t('searching…')}</div>}
      {results.length > 0 && (
        <div className="ps-results">
          {results.map((r) => (
            <button key={r.id} onClick={() => add(r)}>
              <span className="ps-name">{r.name}</span>
              <span className="ps-detail">{r.detail}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
