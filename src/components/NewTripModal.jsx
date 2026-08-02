import React, { useState } from 'react';
import { useTrip } from '../engine/store.js';
import { blankDay, uid } from '../engine/ops.js';
import { cascadeDates } from '../engine/dates.js';
import { geocode } from '../engine/geocode.js';
import { runPlanner } from '../engine/planner.js';
import { SEED_TRIP } from '../data/seedTrip.js';

const today = () => new Date().toISOString().slice(0, 10);

export default function NewTripModal({ onClose, onCreated, initial }) {
  const { dispatch } = useTrip();
  const [tab, setTab] = useState(initial?.tab ?? 'ai'); // ai | blank | template
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState(today());
  const [numDays, setNumDays] = useState(5);
  const [riders, setRiders] = useState(2);
  const [startPlace, setStartPlace] = useState('');
  const [prompt, setPrompt] = useState(initial?.prompt ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // Home hands off here after trip creation so the app can land in the workspace.
  const created = () => (onCreated ? onCreated() : onClose());

  const baseMeta = (title) => ({
    title: title || 'New trip',
    subtitle: 'Planned with the motorcycle trip planner',
    startDate,
    riders: Number(riders) || 1,
    nights: Math.max(0, Number(numDays) - 1),
    fuelRule: 'Fill at half tank on any stretch over 100 miles.',
    range: { comfort: 180, absolute: 200, mpg: 45 },
  });

  const createBlank = async () => {
    setBusy(true);
    setErr('');
    try {
      const days = Array.from({ length: Math.max(1, Number(numDays)) }, (_, i) => blankDay({ title: `Day ${i + 1}` }));
      if (startPlace.trim()) {
        const hits = await geocode(startPlace);
        if (hits[0]) {
          days[0].waypoints.push({ id: uid('w'), name: hits[0].name, lat: hits[0].lat, lng: hits[0].lng, kind: 'start', mile: 0, note: hits[0].detail });
        }
      }
      const trip = cascadeDates({ meta: baseMeta(name), days, reserveNow: [], fieldNotes: null });
      dispatch({ type: 'create_trip', trip });
      created();
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setBusy(false);
    }
  };

  const createFromTemplate = () => {
    const trip = structuredClone(SEED_TRIP);
    if (name.trim()) trip.meta.title = name.trim();
    dispatch({ type: 'create_trip', trip });
    created();
  };

  const createWithAi = async () => {
    if (!prompt.trim()) { setErr('Describe the trip first.'); return; }
    setBusy(true);
    setErr('');
    try {
      const data = await runPlanner({
        mode: 'generate',
        prompt: prompt.trim(),
        basics: { name: name.trim(), startDate, numDays: Number(numDays), riders: Number(riders) },
      });
      if (!data.trip?.days?.length) throw new Error('The builder returned an empty plan — try a more specific description.');
      // assign fresh ids + defaults, then pin dates
      const trip = {
        meta: { ...baseMeta(name), ...data.trip.meta },
        days: data.trip.days.map((d) => {
          const waypoints = (d.waypoints ?? [])
            .filter((w) => Number.isFinite(w.lat) && Number.isFinite(w.lng))
            .map((w) => ({ id: uid('w'), kind: 'via', mile: null, note: '', ...w }));
          // The model names gate stops by index (it can't know the ids minted
          // here); resolve them onto the fresh waypoint ids.
          const gates = (d.gates ?? [])
            .map((g) => ({ label: g.label, by: g.by, waypointId: waypoints[g.waypointIndex]?.id ?? null }))
            .filter((g) => g.label && g.by);
          return {
            ...blankDay({}),
            ...d,
            id: uid('day'),
            waypoints,
            meals: d.meals ?? [],
            photos: [], modules: [], ops: [], constraints: d.constraints ?? [], gates,
            lodging: { status: 'none', name: '', where: '', note: '', ...(d.lodging ?? {}) },
          };
        }),
        reserveNow: [],
        fieldNotes: null,
      };
      cascadeDates(trip);
      dispatch({ type: 'create_trip', trip });
      created();
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="eyebrow">Trip library</div>
            <h3>New trip</h3>
          </div>
          <button className="btn" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="tabbar">
            <button className={tab === 'ai' ? 'active' : ''} onClick={() => setTab('ai')}>AI builder</button>
            <button className={tab === 'blank' ? 'active' : ''} onClick={() => setTab('blank')}>Blank</button>
            <button className={tab === 'template' ? 'active' : ''} onClick={() => setTab('template')}>Sturgis template</button>
          </div>

          <div className="fld-row">
            <label className="fld">Trip name<input value={name} placeholder={tab === 'template' ? 'STURGIS 2026 (copy)' : 'e.g. Blue Ridge Blast'} onChange={(e) => setName(e.target.value)} /></label>
            {tab !== 'template' && <label className="fld">Start date<input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></label>}
          </div>
          {tab !== 'template' && (
            <div className="fld-row">
              <label className="fld">Days<input type="number" min="1" max="30" value={numDays} onChange={(e) => setNumDays(e.target.value)} /></label>
              <label className="fld">Riders<input type="number" min="1" max="30" value={riders} onChange={(e) => setRiders(e.target.value)} /></label>
            </div>
          )}

          {tab === 'blank' && (
            <label className="fld">Starting point (optional)
              <input value={startPlace} placeholder="e.g. Asheville, NC — geocoded automatically" onChange={(e) => setStartPlace(e.target.value)} />
            </label>
          )}

          {tab === 'ai' && (
            <label className="fld">Describe the trip
              <textarea
                rows={4}
                value={prompt}
                placeholder="e.g. 4 riders, 6 days, Denver loop through the San Juans — Million Dollar Highway, Black Canyon, hot springs one night, big scenic passes, moderate daily miles, back to Denver."
                onChange={(e) => setPrompt(e.target.value)}
              />
            </label>
          )}
          {tab === 'template' && (
            <p style={{ fontSize: 12.5, color: 'var(--ink-dim)' }}>
              A full copy of the Sturgis 2026 field-guide trip — 11 days, every stop, gate, booking, and
              module — as a separate trip you can tear apart freely.
            </p>
          )}

          {err && <div className="warning danger">⚠ {err}</div>}
        </div>
        <div className="modal-foot">
          <span className="foot-note">
            {tab === 'ai' ? (busy ? 'Building the itinerary — routing real places…' : 'The AI drafts days, waypoints with coordinates, fuel stops, and lodging notes.') : ''}
          </span>
          <button className="btn" onClick={onClose}>Cancel</button>
          {tab === 'blank' && <button className="btn gold" disabled={busy} onClick={createBlank}>{busy ? 'Creating…' : 'Create trip'}</button>}
          {tab === 'template' && <button className="btn gold" onClick={createFromTemplate}>Create from template</button>}
          {tab === 'ai' && <button className="btn gold" disabled={busy} onClick={createWithAi}>{busy ? 'Building…' : 'Build with AI'}</button>}
        </div>
      </div>
    </div>
  );
}
