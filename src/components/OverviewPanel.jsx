import React from 'react';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useTrip } from '../engine/store.js';
import { PHASES } from '../data/seedTrip.js';

export default function OverviewPanel() {
  const { state, dispatch, summary } = useTrip();
  const { trip } = state;
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const onDragEnd = (e) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = trip.days.map((d) => d.id);
    const next = arrayMove(ids, ids.indexOf(active.id), ids.indexOf(over.id));
    dispatch({ type: 'apply_ops', ops: [{ op: 'reorder_days', dayIds: next }] });
  };

  const openReservations = trip.reserveNow.filter((r) => !r.done);

  return (
    <div>
      <div className="day-head">
        <div className="eyebrow">{trip.meta.subtitle}</div>
        <h2>The whole trip at a glance</h2>
        <div className="datebar">
          <span className="chip">Fri Aug 7 → Mon Aug 17</span>
          <span className="chip">{Math.round(summary.totalMiles)} mi</span>
          <span className="chip">{trip.meta.nights} nights</span>
          <span className="chip">{trip.meta.riders} riders</span>
        </div>
      </div>

      <p style={{ fontSize: 13, color: 'var(--ink-dim)', margin: '12px 0' }}>
        ★ marks the three anchor days everything else is built around: the Cody Firearms Museum morning,
        the full Sturgis rally day, and the Beartooth loop with Piccola lunch. If a day has to be trimmed,
        trim anywhere else first. Drag days to restructure — dates stay pinned to the calendar; content moves.
      </p>

      <div className="section">
        <h3>Days <span className="cnt">drag to reorder</span></h3>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={trip.days.map((d) => d.id)} strategy={verticalListSortingStrategy}>
            <div className="ov-days">
              {trip.days.map((d) => <SortableDay key={d.id} day={d} summary={summary} dispatch={dispatch} />)}
            </div>
          </SortableContext>
        </DndContext>
      </div>

      <div className="section">
        <h3>Reserve these now <span className="cnt">{openReservations.length} open</span></h3>
        {trip.reserveNow.map((r) => (
          <label key={r.id} className={`reserve-item${r.done ? ' done' : ''}`}>
            <input
              type="checkbox"
              checked={r.done}
              onChange={(e) => dispatch({ type: 'apply_ops', ops: [{ op: 'set_reservation_done', reservationId: r.id, done: e.target.checked }] })}
            />
            <div>
              <div className="r-name">{r.name}</div>
              <div className="r-when">{r.when}</div>
              <div className="r-note">{r.where}</div>
              <div className="r-note">{r.note}</div>
            </div>
          </label>
        ))}
      </div>

      <div className="section fieldnotes">
        <h3>Field notes</h3>
        <h4>Fuel discipline</h4>
        <ul>{trip.fieldNotes.fuel.map((x, i) => <li key={i}>{x}</li>)}</ul>
        <h4>Intercom</h4>
        <ul>{trip.fieldNotes.intercom.map((x, i) => <li key={i}>{x}</li>)}</ul>
        <h4>Cash & passes</h4>
        <ul>{trip.fieldNotes.cash.map((x, i) => <li key={i}>{x}</li>)}</ul>
        <h4>Altitude</h4>
        <ul>{trip.fieldNotes.altitude.map((x, i) => <li key={i}>{x}</li>)}</ul>
        <h4>Emergency</h4>
        <ul>{trip.fieldNotes.emergency.map((x, i) => <li key={i}>{x}</li>)}</ul>
      </div>
    </div>
  );
}

function SortableDay({ day, summary, dispatch }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: day.id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const per = summary.perDay.find((p) => p.id === day.id);
  const dangers = per?.warnings.filter((w) => w.level === 'danger').length ?? 0;
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`ov-day${isDragging ? ' dragging' : ''}`}
      {...attributes}
      {...listeners}
      onClick={() => dispatch({ type: 'select_day', dayId: day.id })}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') dispatch({ type: 'select_day', dayId: day.id }); }}
    >
      <div className="ph" style={{ background: PHASES[day.phase]?.color }} />
      <div className="dt">{day.dow}<br />8/{day.date.slice(8).replace(/^0/, '')}{day.anchor ? ' ★' : ''}</div>
      <div>
        <div className="t">{day.title}</div>
      </div>
      <div className="m">
        {per?.miles ?? day.miles} mi · {(per ? per.rideHours + per.stopHours : day.hours).toFixed(0)}h
        {dangers > 0 && <div className="warn-inline">▲ {dangers}</div>}
      </div>
    </div>
  );
}
