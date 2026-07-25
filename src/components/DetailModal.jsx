import React, { useState } from 'react';
import { useTrip } from '../engine/store.js';
import { dayTimeline, fmtTime, fmtDur, dwellFor } from '../engine/timeline.js';
import { PHASES } from '../data/seedTrip.js';

export default function DetailModal() {
  const { state, dispatch, routedLegsByDay } = useTrip();
  const { modal, trip } = state;
  if (!modal) return null;
  const day = trip.days.find((d) => d.id === modal.dayId);
  if (!day) return null;
  const close = () => dispatch({ type: 'close_modal' });

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        {modal.type === 'stop'
          ? <StopDetail day={day} waypointId={modal.waypointId} trip={trip} dispatch={dispatch} routedLegsByDay={routedLegsByDay} close={close} />
          : <LegDetail day={day} legIndex={modal.legIndex} routedLegsByDay={routedLegsByDay} dispatch={dispatch} close={close} />}
      </div>
    </div>
  );
}

function StopDetail({ day, waypointId, trip, dispatch, routedLegsByDay, close }) {
  const w = day.waypoints.find((x) => x.id === waypointId);
  const [form, setForm] = useState(w ? { name: w.name, note: w.note ?? '', dwell: dwellFor(w), fuel: !!w.fuel } : null);
  if (!w || !form) return <div className="modal-body">This stop no longer exists.</div>;
  const tl = dayTimeline(day, routedLegsByDay[day.id]);
  const idx = day.waypoints.indexOf(w);
  const s = tl.stops[idx];
  const phase = PHASES[day.phase];

  const save = () => {
    dispatch({
      type: 'apply_ops',
      ops: [{
        op: 'update_waypoint', dayId: day.id, waypointId: w.id,
        patch: { name: form.name, note: form.note, dwell: Number(form.dwell) || 0, fuel: form.fuel },
      }],
    });
    close();
  };
  const moveTo = (toDayId) => {
    if (!toDayId || toDayId === day.id) return;
    dispatch({ type: 'apply_ops', ops: [{ op: 'move_waypoint', fromDayId: day.id, toDayId, waypointId: w.id }] });
    close();
  };
  const remove = () => {
    dispatch({ type: 'apply_ops', ops: [{ op: 'remove_waypoint', dayId: day.id, waypointId: w.id }] });
    close();
  };

  return (
    <>
      <div className="modal-head">
        <div>
          <div className="eyebrow">{day.dow} · <span style={{ color: phase?.color }}>{phase?.label}</span> · stop {idx + 1} of {day.waypoints.length}</div>
          <h3>{w.name}</h3>
        </div>
        <button className="btn" onClick={close}>✕</button>
      </div>
      <div className="modal-body">
        <div className="time-strip">
          <div className="ts-cell"><div className="n">{s ? fmtTime(s.arrive) : '—'}</div><div className="l">Arrive</div></div>
          <div className="ts-cell"><div className="n">{s ? fmtDur(s.dwell) : '—'}</div><div className="l">On the ground</div></div>
          <div className="ts-cell"><div className="n">{s ? fmtTime(s.depart) : '—'}</div><div className="l">Roll out</div></div>
          {idx > 0 && s && <div className="ts-cell"><div className="n">{Math.round(s.legMiles)} mi · {fmtDur(s.legMin)}</div><div className="l">Leg in</div></div>}
        </div>
        <label className="fld">Name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
        <label className="fld">Note<textarea rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
        <div className="fld-row">
          <label className="fld">Time here (min)<input type="number" min="0" step="5" value={form.dwell} onChange={(e) => setForm({ ...form, dwell: e.target.value })} /></label>
          <label className="fld chk"><input type="checkbox" checked={form.fuel} onChange={(e) => setForm({ ...form, fuel: e.target.checked })} /> Fuel stop</label>
        </div>
        <div className="fld-row">
          <label className="fld">Move to day
            <select defaultValue="" onChange={(e) => moveTo(e.target.value)}>
              <option value="" disabled>Choose…</option>
              {trip.days.filter((d) => d.id !== day.id).map((d) => (
                <option key={d.id} value={d.id}>{d.dow} 8/{d.date.slice(8).replace(/^0/, '')} — {d.title.slice(0, 34)}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="pp-note" style={{ marginTop: 6 }}>lat {w.lat.toFixed(4)}, lng {w.lng.toFixed(4)}{w.mile != null ? ` · field-guide mile ${w.mile}` : ''}</div>
      </div>
      <div className="modal-foot">
        <button className="btn danger-ghost" onClick={remove}>Remove stop</button>
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={close}>Cancel</button>
        <button className="btn gold" onClick={save}>Save</button>
      </div>
    </>
  );
}

function LegDetail({ day, legIndex, routedLegsByDay, dispatch, close }) {
  const from = day.waypoints[legIndex];
  const to = day.waypoints[legIndex + 1];
  if (!from || !to) return <div className="modal-body">This leg no longer exists.</div>;
  const tl = dayTimeline(day, routedLegsByDay[day.id]);
  const dep = tl.stops[legIndex];
  const arr = tl.stops[legIndex + 1];
  const phase = PHASES[day.phase];

  return (
    <>
      <div className="modal-head">
        <div>
          <div className="eyebrow">{day.dow} · <span style={{ color: phase?.color }}>{phase?.label}</span> · leg {legIndex + 1} of {day.waypoints.length - 1}</div>
          <h3>{from.name} → {to.name}</h3>
        </div>
        <button className="btn" onClick={close}>✕</button>
      </div>
      <div className="modal-body">
        <div className="time-strip">
          <div className="ts-cell"><div className="n">{dep ? fmtTime(dep.depart) : '—'}</div><div className="l">Depart {shortN(from.name)}</div></div>
          <div className="ts-cell"><div className="n">{arr ? `${Math.round(arr.legMiles)} mi` : '—'}</div><div className="l">Distance</div></div>
          <div className="ts-cell"><div className="n">{arr ? fmtDur(arr.legMin) : '—'}</div><div className="l">Ride time</div></div>
          <div className="ts-cell"><div className="n">{arr ? fmtTime(arr.arrive) : '—'}</div><div className="l">Arrive {shortN(to.name)}</div></div>
        </div>
        {from.note && <div className="pp-note">Start: {from.note}</div>}
        {to.note && <div className="pp-note">End: {to.note}</div>}
      </div>
      <div className="modal-foot">
        <button className="btn" onClick={() => { dispatch({ type: 'select_day', dayId: day.id }); close(); }}>Open this day</button>
        <span style={{ flex: 1 }} />
        <button className="btn gold" onClick={close}>Done</button>
      </div>
    </>
  );
}

const shortN = (n) => (n && n.length > 14 ? n.slice(0, 13) + '…' : n);
