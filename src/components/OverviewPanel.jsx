import React from 'react';
import { DndContext, closestCenter, MouseSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useTrip } from '../engine/store.js';
import { PHASES } from '../data/seedTrip.js';
import { fmtDayDate, fmtLongDate } from '../engine/dates.js';
import { tripToGpx, tripToIcs, downloadFile } from '../engine/exporters.js';
import { ROAD_STATUS_LINKS } from '../engine/conditions.js';
import { useT, useTT, useUnits } from '../engine/settings.jsx';
import { uid } from '../engine/ops.js';

// The EagleRider Harley-Davidson rental lineup (eaglerider.com/harley-rentals,
// plus the CVO additions) — what the group can actually be riding.
const EAGLERIDER_HD = [
  'Street Glide', 'Street Glide Ultra', 'Road Glide', 'Road Glide Ultra',
  'Electra Glide', 'Road King', 'Heritage Softail Classic',
  'CVO Street Glide', 'CVO Road Glide', 'Pan America 1250', 'Other',
];

export default function OverviewPanel() {
  const { state, dispatch, summary, routes, routedLegsByDay, ui } = useTrip();
  const { trip } = state;
  const t = useT();
  const tt = useTT();
  const u = useUnits();
  // The whole day row is the drag handle, so on touch the drag has to wait out
  // a press-and-hold — otherwise the list could never be scrolled.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );
  const reorderHint = ui?.isMobile ? 'press & hold to reorder' : 'drag to reorder';

  const onDragEnd = (e) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = trip.days.map((d) => d.id);
    const next = arrayMove(ids, ids.indexOf(active.id), ids.indexOf(over.id));
    dispatch({ type: 'apply_ops', ops: [{ op: 'reorder_days', dayIds: next }] });
  };

  const openReservations = (trip.reserveNow ?? []).filter((r) => !r.done);
  const anchors = trip.days.filter((d) => d.anchor);

  return (
    <div>
      <div className="day-head">
        <div className="eyebrow">{tt(trip.meta.subtitle)}</div>
        <h2>{t('The whole trip at a glance')}</h2>
        <div className="datebar">
          <span className="chip">{trip.days[0]?.dow} {fmtLongDate(trip.days[0]?.date ?? trip.meta.startDate)} → {trip.days[trip.days.length - 1]?.dow} {fmtLongDate(trip.days[trip.days.length - 1]?.date ?? trip.meta.startDate)}</span>
          <span className="chip">{u.mi(summary.totalMiles)}</span>
          <span className="chip">{trip.meta.nights} {t('nights')}</span>
          <span className="chip">{trip.meta.riders} {t('riders')}</span>
        </div>
      </div>

      <p style={{ fontSize: 13, color: 'var(--ink-dim)', margin: '12px 0' }}>
        {anchors.length > 0
          ? `★ ${t('marks the')} ${anchors.length} ${anchors.length > 1 ? t('anchor days') : t('anchor day')} ${t('everything else is built around — if a day has to be trimmed, trim anywhere else first.')} `
          : ''}
        {ui?.isMobile ? t('Press and hold a day to restructure') : t('Drag days to restructure')} {t('— dates stay pinned to the calendar; content moves.')}
      </p>

      <div className="section">
        <h3>{t('Days')} <span className="cnt">{t(reorderHint)}</span></h3>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={trip.days.map((d) => d.id)} strategy={verticalListSortingStrategy}>
            <div className="ov-days">
              {trip.days.map((d) => <SortableDay key={d.id} day={d} summary={summary} dispatch={dispatch} />)}
            </div>
          </SortableContext>
        </DndContext>
        <button className="btn" style={{ marginTop: 8 }} onClick={() => dispatch({ type: 'apply_ops', ops: [{ op: 'add_day' }] })}>＋ {t('Add day')}</button>
      </div>

      <TripSettings trip={trip} dispatch={dispatch} />

      <div className="section">
        <h3>{t('Ride pack')}</h3>
        <div className="ridepack">
          <button className="btn" onClick={() => downloadFile('trip-full.gpx', tripToGpx(trip, routes, routedLegsByDay), 'application/gpx+xml')}>⬇ {t('GPX — full trip')}</button>
          <button className="btn" onClick={() => downloadFile('trip-calendar.ics', tripToIcs(trip, routedLegsByDay), 'text/calendar')}>⬇ {t('Calendar (.ics)')}</button>
        </div>
        <p style={{ fontSize: 12, color: 'var(--ink-dim)', marginTop: 6 }}>
          {t('GPX loads into Garmin, Rever, or any nav app (per-day GPX is on each day panel).')}{' '}
          {t('The calendar file drops all 11 days — departures, gates, dinners — into everyone\'s phone in Mountain Time.')}
        </p>
      </div>

      <div className="section">
        <h3>{t('Road status & smoke')} <span className="cnt">{t('check the week of')}</span></h3>
        <ul className="road-links">
          {ROAD_STATUS_LINKS.map((l) => (
            <li key={l.url}><a href={l.url} target="_blank" rel="noreferrer">{l.name} ↗</a></li>
          ))}
        </ul>
      </div>

      {(trip.reserveNow?.length ?? 0) > 0 && <div className="section">
        <h3>{t('Reserve these now')} <span className="cnt">{openReservations.length} {t('open')}</span></h3>
        {trip.reserveNow.map((r) => (
          <label key={r.id} className={`reserve-item${r.done ? ' done' : ''}`}>
            <input
              type="checkbox"
              checked={r.done}
              onChange={(e) => dispatch({ type: 'apply_ops', ops: [{ op: 'set_reservation_done', reservationId: r.id, done: e.target.checked }] })}
            />
            <div>
              <div className="r-name">{r.name}</div>
              <div className="r-when">{tt(r.when)}</div>
              <div className="r-note">{r.where}</div>
              <div className="r-note">{tt(r.note)}</div>
            </div>
          </label>
        ))}
      </div>}

      {trip.fieldNotes && <div className="section fieldnotes">
        <h3>{t('Field notes')}</h3>
        <h4>{t('Fuel discipline')}</h4>
        <ul>{trip.fieldNotes.fuel.map((x, i) => <li key={i}>{tt(x)}</li>)}</ul>
        <h4>{t('Intercom')}</h4>
        <ul>{trip.fieldNotes.intercom.map((x, i) => <li key={i}>{tt(x)}</li>)}</ul>
        <h4>{t('Cash & passes')}</h4>
        <ul>{trip.fieldNotes.cash.map((x, i) => <li key={i}>{tt(x)}</li>)}</ul>
        <h4>{t('Altitude')}</h4>
        <ul>{trip.fieldNotes.altitude.map((x, i) => <li key={i}>{tt(x)}</li>)}</ul>
        <h4>{t('Emergency')}</h4>
        <ul>{trip.fieldNotes.emergency.map((x, i) => <li key={i}>{tt(x)}</li>)}</ul>
      </div>}

      <RiderRoster trip={trip} dispatch={dispatch} />
    </div>
  );
}

// Who's riding what. Lives on the trip (meta.roster via set_meta), so it
// exports/imports with the itinerary rather than staying on one device.
function RiderRoster({ trip, dispatch }) {
  const t = useT();
  const roster = trip.meta.roster ?? [];
  const save = (next) => dispatch({ type: 'apply_ops', ops: [{ op: 'set_meta', patch: { roster: next } }] });
  const update = (id, patch) => save(roster.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  return (
    <div className="section">
      <h3>{t('Rider roster')} <span className="cnt">{t('name + bike, saved on the trip')}</span></h3>
      {roster.map((r) => (
        <div key={r.id} className="roster-row">
          <input
            placeholder={t('Rider name')}
            defaultValue={r.name}
            onBlur={(e) => { if (e.target.value !== r.name) update(r.id, { name: e.target.value }); }}
            onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
          />
          <select value={r.bike || ''} onChange={(e) => update(r.id, { bike: e.target.value })}>
            <option value="">{t('Choose a bike…')}</option>
            {EAGLERIDER_HD.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          <button className="mini-edit" title={t('Cancel')} onClick={() => save(roster.filter((x) => x.id !== r.id))}>✕</button>
        </div>
      ))}
      <button
        className="btn"
        style={{ fontSize: 11, padding: '3px 9px', marginTop: roster.length ? 6 : 0 }}
        onClick={() => save([...roster, { id: uid('rider'), name: '', bike: '' }])}
      >＋ {t('Add rider')}</button>
    </div>
  );
}

function TripSettings({ trip, dispatch }) {
  const t = useT();
  const set = (patch) => dispatch({ type: 'apply_ops', ops: [{ op: 'set_meta', patch }] });
  const range = { comfort: 180, absolute: 200, mpg: 45, ...(trip.meta.range ?? {}) };
  const setRange = (k, v) => set({ range: { ...range, [k]: Number(v) || 0 } });
  return (
    <div className="section">
      <h3>{t('Trip settings')}</h3>
      <div className="budget-grid">
        <label className="fld" style={{ gridColumn: 'span 2' }}>{t('Trip name')}
          <input defaultValue={trip.meta.title} key={trip.meta.title}
            onBlur={(e) => { if (e.target.value.trim() && e.target.value !== trip.meta.title) set({ title: e.target.value.trim() }); }} />
        </label>
        <label className="fld">{t('Start date')}
          <input type="date" value={trip.meta.startDate}
            onChange={(e) => { if (e.target.value) set({ startDate: e.target.value }); }} />
        </label>
        <label className="fld">{t('Riders')}
          <input type="number" min="1" value={trip.meta.riders}
            onChange={(e) => set({ riders: Math.max(1, Number(e.target.value) || 1) })} />
        </label>
        <label className="fld">{t('Range: comfort mi')}
          <input type="number" min="40" value={range.comfort} onChange={(e) => setRange('comfort', e.target.value)} />
        </label>
        <label className="fld">{t('Range: absolute mi')}
          <input type="number" min="50" value={range.absolute} onChange={(e) => setRange('absolute', e.target.value)} />
        </label>
        <label className="fld">MPG
          <input type="number" min="10" value={range.mpg} onChange={(e) => setRange('mpg', e.target.value)} />
        </label>
      </div>
      <p style={{ fontSize: 11.5, color: 'var(--ink-faint)', marginTop: 4 }}>
        {t('Changing the start date re-pins every day to the new calendar. Fuel warnings and feasibility use the bike range set here.')}
      </p>
    </div>
  );
}

function SortableDay({ day, summary, dispatch }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: day.id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const per = summary.perDay.find((p) => p.id === day.id);
  const dangers = per?.warnings.filter((w) => w.level === 'danger').length ?? 0;
  const tt = useTT();
  const u = useUnits();
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
      <div className="dt">{day.dow}<br />{fmtDayDate(day.date)}{day.anchor ? ' ★' : ''}</div>
      <div>
        <div className="t">{tt(day.title)}</div>
      </div>
      <div className="m">
        {u.mi(per?.miles ?? day.miles)} · {(per ? per.rideHours + per.stopHours : day.hours).toFixed(0)}h
        {dangers > 0 && <div className="warn-inline">▲ {dangers}</div>}
      </div>
    </div>
  );
}
