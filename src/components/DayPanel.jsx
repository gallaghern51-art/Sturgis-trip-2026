import React from 'react';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useTrip } from '../engine/store.js';
import { PHASES } from '../data/seedTrip.js';
import { fuelGaps } from '../engine/tripEngine.js';
import { dayTimeline, fmtTime, fmtDur } from '../engine/timeline.js';
import PlaceSearch from './PlaceSearch.jsx';
import ConditionsCard from './ConditionsCard.jsx';
import { tripToGpx, downloadFile } from '../engine/exporters.js';

export default function DayPanel({ day }) {
  const { state, dispatch, summary, routedLegsByDay, routes } = useTrip();
  const per = summary.perDay.find((p) => p.id === day.id);
  const phase = PHASES[day.phase];
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const gaps = fuelGaps(day, routedLegsByDay[day.id]);
  const longestGap = gaps.reduce((m, g) => Math.max(m, g.miles), 0);
  const timeline = dayTimeline(day, routedLegsByDay[day.id]);

  const onDragEnd = (e) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = day.waypoints.map((w) => w.id);
    const next = arrayMove(ids, ids.indexOf(active.id), ids.indexOf(over.id));
    dispatch({ type: 'apply_ops', ops: [{ op: 'reorder_waypoints', dayId: day.id, waypointIds: next }] });
  };

  return (
    <div>
      <div className="day-head">
        <div className="eyebrow">{day.dow} · Aug {day.date.slice(8).replace(/^0/, '')} · Day {state.trip.days.indexOf(day) + 1} of {state.trip.days.length}</div>
        <h2>{day.title}</h2>
        <div className="datebar">
          <span className="chip phase" style={{ background: phase?.color }}>{phase?.label}</span>
          {day.anchor && <span className="chip anchor">★ Anchor day — trim elsewhere first</span>}
          <label className="chip depart-edit">Depart
            <input
              defaultValue={day.depart}
              key={day.id + day.depart}
              onBlur={(e) => { if (e.target.value !== day.depart) dispatch({ type: 'apply_ops', ops: [{ op: 'set_day_field', dayId: day.id, field: 'depart', value: e.target.value }] }); }}
              onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
            />
          </label>
          <span className="chip">End ~{fmtTime(timeline.endMin)}</span>
          <button
            className="chip gpx-btn"
            title="Download this day as a GPX route for Garmin / phone nav"
            onClick={() => downloadFile(`sturgis-${day.date}-${day.dow.toLowerCase()}.gpx`, tripToGpx(state.trip, routes, day.id), 'application/gpx+xml')}
          >⬇ GPX</button>
        </div>
      </div>

      <div className="stat-row">
        <div className="stat"><div className="n">{per?.miles ?? day.miles}</div><div className="l">Miles</div></div>
        <div className="stat"><div className="n">{per ? per.rideHours.toFixed(1) : day.hours}</div><div className="l">Ride hrs</div></div>
        <div className="stat"><div className="n">{per ? per.stopHours.toFixed(1) : '—'}</div><div className="l">Stop hrs</div></div>
        <div className="stat"><div className="n">{longestGap || '—'}</div><div className="l">Longest fuel gap</div></div>
      </div>

      {per?.warnings.map((w, i) => (
        <div key={i} className={`warning${w.level === 'danger' ? ' danger' : ''}`}>⚠ {w.text}</div>
      ))}

      <p style={{ fontSize: 13, color: 'var(--ink-dim)', marginTop: 10 }}>{day.summary}</p>

      {day.constraints?.length > 0 && (
        <div className="section">
          <h3>Hard constraints</h3>
          <ul className="ops-list">{day.constraints.map((c, i) => <li key={i}>{c}</li>)}</ul>
        </div>
      )}

      <div className="section">
        <h3>Route & stops <span className="cnt">{day.waypoints.length} · drag to reorder · click for details</span></h3>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={day.waypoints.map((w) => w.id)} strategy={verticalListSortingStrategy}>
            {day.waypoints.map((w, i) => (
              <SortableWaypoint key={w.id} w={w} dayId={day.id} dispatch={dispatch} sched={timeline.stops[i]} first={i === 0} />
            ))}
          </SortableContext>
        </DndContext>
        <PlaceSearch day={day} />
      </div>

      <ConditionsCard day={day} />

      {day.modules?.length > 0 && (
        <div className="section">
          <h3>Optional modules</h3>
          {day.modules.map((m) => (
            <div key={m.id} className={`module${m.enabled ? '' : ' off'}`}>
              <div className="mod-head">
                <span className="nm">{m.name}</span>
                <span className="mod-dur">{m.duration}</span>
                <button
                  className={`toggle${m.enabled ? ' on' : ''}`}
                  aria-label={`Toggle ${m.name}`}
                  onClick={() => dispatch({ type: 'apply_ops', ops: [{ op: 'toggle_module', dayId: day.id, moduleId: m.id, enabled: !m.enabled }] })}
                />
              </div>
              <p><b>Why:</b> {m.why}</p>
              <p><b>Trade-off:</b> {m.tradeoff}</p>
              {m.logistics && <p><b>Logistics:</b> {m.logistics}</p>}
            </div>
          ))}
        </div>
      )}

      {day.meals?.length > 0 && (
        <div className="section">
          <h3>Food</h3>
          {day.meals.map((m, i) => (
            <div key={i} className="meal">
              <div className="m-kind">{m.meal}</div>
              <div className="m-name">{m.name}</div>
              {m.where && <div className="m-where">{m.where}</div>}
              {m.note && <div className="m-note">{m.note}</div>}
              {m.alt && <div className="m-alt">{m.alt}</div>}
            </div>
          ))}
        </div>
      )}

      {day.photos?.length > 0 && (
        <div className="section">
          <h3>Photo stops</h3>
          {day.photos.map((p) => (
            <div key={p.id} className="photo-card">
              <div className="p-name">{p.name}</div>
              <div className="p-why">{p.why}</div>
              <div className="p-meta">
                <div><b>Light</b> — {p.light}</div>
                <div><b>8 bikes</b> — {p.parking}</div>
                {p.notes && <div><b>Note</b> — {p.notes}</div>}
              </div>
            </div>
          ))}
        </div>
      )}

      {day.lodging && day.lodging.status !== 'none' && (
        <div className="section">
          <h3>Tonight</h3>
          <div className={`lodging ${day.lodging.status}`}>
            <div className="l-status">{day.lodging.status === 'booked' ? '● Confirmed booking' : '▲ Not yet booked — reserve now'}</div>
            <div className="l-name">{day.lodging.name}</div>
            <div className="l-where">{day.lodging.where}</div>
            {day.lodging.note && <div className="l-note">{day.lodging.note}</div>}
          </div>
        </div>
      )}

      {day.ops?.length > 0 && (
        <div className="section">
          <h3>Operations</h3>
          <ul className="ops-list">{day.ops.map((o, i) => <li key={i}>{o}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

function SortableWaypoint({ w, dayId, dispatch, sched, first }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: w.id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <div ref={setNodeRef} style={style} className={`wp-row${isDragging ? ' dragging' : ''}`}>
      <span className="grip" {...attributes} {...listeners}>⠿</span>
      <span className="eta">
        {sched ? fmtTime(first ? sched.depart : sched.arrive) : '·'}
        {!first && sched && sched.legMin > 0 && <span className="leg-t">+{fmtDur(sched.legMin)}</span>}
      </span>
      <span
        className="nm clickable"
        onClick={() => dispatch({ type: 'open_modal', modal: { type: 'stop', dayId, waypointId: w.id } })}
      >
        {w.name}
        {w.fuel && <span className="tag fuel">FUEL</span>}
        {w.kind === 'photo' && <span className="tag photo">PHOTO</span>}
        {sched && sched.dwell > 0 && <span className="tag dwell">{fmtDur(sched.dwell)}</span>}
      </span>
      <button
        className="rm"
        title="Remove stop"
        onClick={() => dispatch({ type: 'apply_ops', ops: [{ op: 'remove_waypoint', dayId, waypointId: w.id }] })}
      >✕</button>
      {w.note && <span className="note">{w.note}</span>}
    </div>
  );
}
