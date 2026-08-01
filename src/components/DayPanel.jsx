import React, { useState } from 'react';
import { DndContext, closestCenter, MouseSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useTrip } from '../engine/store.js';
import { PHASES } from '../data/seedTrip.js';
import { fmtLongDate } from '../engine/dates.js';
import { fuelGaps } from '../engine/tripEngine.js';
import { dayTimeline, fmtTime, fmtDur } from '../engine/timeline.js';
import PlaceSearch from './PlaceSearch.jsx';
import ConditionsCard from './ConditionsCard.jsx';
import { tripToGpx, downloadFile } from '../engine/exporters.js';
import { useT, useTT, useUnits, useSettings } from '../engine/settings.jsx';
import { dayRoadShields } from '../engine/roads.js';
import RoadShield from './RoadShield.jsx';
import { parksForDay } from '../data/parks.js';

export default function DayPanel({ day }) {
  const { state, dispatch, summary, routedLegsByDay, routes } = useTrip();
  const per = summary.perDay.find((p) => p.id === day.id);
  const phase = PHASES[day.phase];
  // Mouse drags start immediately; touch drags wait out a short press so a
  // finger swipe over the list scrolls instead of reordering stops.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
  );
  const gaps = fuelGaps(day, routedLegsByDay[day.id]);
  const longestGap = gaps.reduce((m, g) => Math.max(m, g.miles), 0);
  const timeline = dayTimeline(day, routedLegsByDay[day.id]);
  const t = useT();
  const tt = useTT();
  const u = useUnits();
  const { shields: showShields } = useSettings();
  const shieldsByStop = dayRoadShields(day);
  const parks = parksForDay(day);
  // Running odometer per stop — leg miles come from the same timeline the ETAs use.
  const cumMiles = [];
  let acc = 0;
  for (const s of timeline.stops) { acc += s.legMiles; cumMiles.push(acc); }

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
        <div className="eyebrow">{day.dow} · {fmtLongDate(day.date)} · {t('Day')} {state.trip.days.indexOf(day) + 1} {t('of')} {state.trip.days.length}</div>
        <h2>{tt(day.title)}</h2>
        <div className="datebar">
          <span className="chip phase" style={{ background: phase?.color }}>{t(phase?.label)}</span>
          {day.anchor && <span className="chip anchor">{t('★ Anchor day — trim elsewhere first')}</span>}
          <label className="chip depart-edit">{t('Depart')}
            <input
              defaultValue={day.depart}
              key={day.id + day.depart}
              onBlur={(e) => { if (e.target.value !== day.depart) dispatch({ type: 'apply_ops', ops: [{ op: 'set_day_field', dayId: day.id, field: 'depart', value: e.target.value }] }); }}
              onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
            />
          </label>
          <span className="chip">{t('End')} ~{fmtTime(timeline.endMin)}</span>
          <button
            className="chip gpx-btn"
            title="Download this day as a GPX route for Garmin / phone nav"
            onClick={() => downloadFile(`trip-${day.date}-${day.dow.toLowerCase()}.gpx`, tripToGpx(state.trip, routes, routedLegsByDay, day.id), 'application/gpx+xml')}
          >↓ GPX</button>
        </div>
        {(day.phase === 'rally' || parks.length > 0) && (
          <div className="day-badges">
            {day.phase === 'rally' && (
              <img className="badge-thumb rally" src="/pics/sturgis-86.png" alt="Sturgis Rally 2026" title="Sturgis Motorcycle Rally 2026 · 86th" loading="lazy" />
            )}
            {parks.map((pk) => <ParkBadge key={pk.id} park={pk} label={t('National park')} />)}
          </div>
        )}
      </div>

      <div className="stat-row">
        <div className="stat"><div className="n">{u.miNum(per?.miles ?? day.miles)}</div><div className="l">{u.metric ? 'km' : t('Miles')}</div></div>
        <div className="stat"><div className="n">{per ? per.rideHours.toFixed(1) : day.hours}</div><div className="l">{t('Ride hrs')}</div></div>
        <div className="stat"><div className="n">{per ? per.stopHours.toFixed(1) : '—'}</div><div className="l">{t('Stop hrs')}</div></div>
        <div className="stat"><div className="n">{longestGap ? u.miNum(longestGap) : '—'}</div><div className="l">{t('Longest fuel gap')}{u.metric ? ' (km)' : ''}</div></div>
      </div>

      {per?.warnings.map((w, i) => (
        <div key={i} className={`warning${w.level === 'danger' ? ' danger' : ''}`}>⚠ {tt(w.text)}</div>
      ))}

      <p style={{ fontSize: 13, color: 'var(--ink-dim)', marginTop: 10 }}>{tt(day.summary)}</p>

      {day.constraints?.length > 0 && (
        <div className="section">
          <h3>{t('Hard constraints')}</h3>
          <ul className="ops-list">{day.constraints.map((c, i) => <li key={i}>{tt(c)}</li>)}</ul>
        </div>
      )}

      <div className="section">
        <h3>{t('Route & stops')} <span className="cnt">{day.waypoints.length} · {t('drag ⠿ to reorder · tap to zoom the map · ⓘ for details')}</span></h3>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={day.waypoints.map((w) => w.id)} strategy={verticalListSortingStrategy}>
            {day.waypoints.map((w, i) => (
              <SortableWaypoint key={w.id} w={w} dayId={day.id} dispatch={dispatch} sched={timeline.stops[i]} cum={cumMiles[i]} first={i === 0} tt={tt} u={u} t={t} shields={showShields ? shieldsByStop[i] : null} />
            ))}
          </SortableContext>
        </DndContext>
        <PlaceSearch day={day} />
      </div>

      <ConditionsCard day={day} />

      <ModulesSection day={day} dispatch={dispatch} days={state.trip.days} />

      <MealsSection day={day} dispatch={dispatch} />

      {day.photos?.length > 0 && (
        <div className="section">
          <h3>{t('Photo stops')}</h3>
          {day.photos.map((p) => (
            <div key={p.id} className="photo-card">
              <div className="p-name">{tt(p.name)}</div>
              <div className="p-why">{tt(p.why)}</div>
              <div className="p-meta">
                <div><b>{t('Best light')}</b> — {tt(p.light)}</div>
                <div><b>{t('Parking')}</b> — {tt(p.parking)}</div>
                {p.notes && <div><b>{t('Note')}</b> — {tt(p.notes)}</div>}
              </div>
            </div>
          ))}
        </div>
      )}

      <LodgingSection day={day} dispatch={dispatch} />

      {day.ops?.length > 0 && (
        <div className="section">
          <h3>{t('Operations')}</h3>
          <ul className="ops-list">{day.ops.map((o, i) => <li key={i}>{tt(o)}</li>)}</ul>
        </div>
      )}

      <div className="section" style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
        <button
          className="btn danger-ghost"
          onClick={() => {
            if (state.trip.days.length <= 1) return alert('A trip needs at least one day.');
            if (confirm(`Remove ${day.dow} — “${day.title}” and all its stops? Later days shift earlier.`)) {
              dispatch({ type: 'select_day', dayId: null });
              dispatch({ type: 'apply_ops', ops: [{ op: 'remove_day', dayId: day.id }] });
            }
          }}
        >{t('Remove this day')}</button>
      </div>
    </div>
  );
}


// Park badge — the NPS arrowhead plus the park's name.
function ParkBadge({ park, label }) {
  return (
    <span className="park-badge" title={`${park.short} · ${label}`}>
      <img src="/pics/nps-arrowhead.png" alt="" aria-hidden="true" loading="lazy" />
      {park.short}
    </span>
  );
}

const MEAL_SLOTS = ['breakfast', 'lunch', 'dinner'];

function MealsSection({ day, dispatch }) {
  const [editing, setEditing] = useState(null); // meal slot being edited
  const [form, setForm] = useState({});
  const meals = day.meals ?? [];
  const missing = MEAL_SLOTS.filter((s) => !meals.some((m) => m.meal === s));
  const t = useT();
  const tt = useTT();

  const startEdit = (slot) => {
    const m = meals.find((x) => x.meal === slot) ?? { meal: slot, name: '', where: '', note: '', alt: '' };
    setForm(m);
    setEditing(slot);
  };
  const save = () => {
    dispatch({ type: 'apply_ops', ops: [{ op: 'update_meal', dayId: day.id, meal: editing, patch: { name: form.name, where: form.where, note: form.note, alt: form.alt } }] });
    setEditing(null);
  };

  return (
    <div className="section">
      <h3>{t('Food')} <span className="cnt">{t('click ✎ to edit')}</span></h3>
      {meals.map((m) => (
        <div key={m.meal} className="meal">
          {editing === m.meal ? (
            <MealForm form={form} setForm={setForm} save={save} cancel={() => setEditing(null)} />
          ) : (
            <>
              <div className="m-kind">{t(m.meal)}
                <button className="mini-edit" onClick={() => startEdit(m.meal)}>✎</button>
                <button className="mini-edit" title={t('Remove meal')} onClick={() => dispatch({ type: 'apply_ops', ops: [{ op: 'remove_meal', dayId: day.id, meal: m.meal }] })}>✕</button>
              </div>
              <div className="m-name">{m.name || '—'}</div>
              {m.where && <div className="m-where">{m.where}</div>}
              {m.note && <div className="m-note">{tt(m.note)}</div>}
              {m.alt && <div className="m-alt">{tt(m.alt)}</div>}
            </>
          )}
        </div>
      ))}
      {editing && !meals.some((m) => m.meal === editing) && (
        <div className="meal"><div className="m-kind">{t(editing)}</div><MealForm form={form} setForm={setForm} save={save} cancel={() => setEditing(null)} /></div>
      )}
      {missing.length > 0 && !editing && (
        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          {missing.map((s) => <button key={s} className="btn" style={{ fontSize: 11, padding: '3px 9px' }} onClick={() => startEdit(s)}>＋ {t(s)}</button>)}
        </div>
      )}
    </div>
  );
}

// Optional add-ons. The toggle is the common action, but the prose needs to be
// editable too: when an activity moves to another day, text still describing the
// old slot is worse than no text — so name/timing/reasoning are all editable,
// and a module can be relocated without losing its researched why/logistics.
const BLANK_MODULE = { name: '', duration: '', why: '', tradeoff: '', logistics: '' };

function ModulesSection({ day, dispatch, days }) {
  const t = useT();
  const tt = useTT();
  const [editing, setEditing] = useState(null); // module id, or '__new'
  const [form, setForm] = useState(BLANK_MODULE);
  const modules = day.modules ?? [];
  const elsewhere = days.filter((d) => d.id !== day.id);

  const apply = (ops) => dispatch({ type: 'apply_ops', ops });
  const startEdit = (m) => { setForm({ ...BLANK_MODULE, ...m }); setEditing(m.id); };
  const startNew = () => { setForm(BLANK_MODULE); setEditing('__new'); };

  const save = () => {
    const patch = {
      name: form.name, duration: form.duration,
      why: form.why, tradeoff: form.tradeoff, logistics: form.logistics,
    };
    if (editing === '__new') {
      if (!patch.name.trim()) return; // add_module rejects a nameless module
      apply([{ op: 'add_module', dayId: day.id, module: patch }]);
    } else {
      apply([{ op: 'update_module', dayId: day.id, moduleId: editing, patch }]);
    }
    setEditing(null);
  };

  if (!modules.length && editing !== '__new') {
    return (
      <div className="section">
        <h3>{t('Optional modules')}</h3>
        <button className="btn" style={{ fontSize: 11, padding: '3px 9px' }} onClick={startNew}>＋ {t('add an option')}</button>
      </div>
    );
  }

  return (
    <div className="section">
      <h3>{t('Optional modules')} <span className="cnt">{t('click ✎ to edit')}</span></h3>
      {modules.map((m) => (
        <div key={m.id} className={`module${m.enabled ? '' : ' off'}`}>
          {editing === m.id ? (
            <ModuleForm form={form} setForm={setForm} save={save} cancel={() => setEditing(null)} />
          ) : (
            <>
              <div className="mod-head">
                <span className="nm">{tt(m.name)}</span>
                <span className="mod-dur">{tt(m.duration)}</span>
                <button className="mini-edit" title="Edit this module" onClick={() => startEdit(m)}>✎</button>
                <button
                  className="mini-edit"
                  title="Remove this module"
                  onClick={() => apply([{ op: 'remove_module', dayId: day.id, moduleId: m.id }])}
                >✕</button>
                <button
                  className={`toggle${m.enabled ? ' on' : ''}`}
                  aria-label={`Toggle ${m.name}`}
                  onClick={() => apply([{ op: 'toggle_module', dayId: day.id, moduleId: m.id, enabled: !m.enabled }])}
                />
              </div>
              {m.why && <p><b>{t('Why:')}</b> {tt(m.why)}</p>}
              {m.tradeoff && <p><b>{t('Trade-off:')}</b> {tt(m.tradeoff)}</p>}
              {m.logistics && <p><b>{t('Logistics:')}</b> {tt(m.logistics)}</p>}
              {elsewhere.length > 0 && (
                <label className="mod-move">
                  {t('move to')}
                  <select
                    value=""
                    onChange={(e) => {
                      if (e.target.value) apply([{ op: 'move_module', moduleId: m.id, fromDayId: day.id, toDayId: e.target.value }]);
                    }}
                  >
                    <option value="">{t('another day…')}</option>
                    {elsewhere.map((d) => (
                      <option key={d.id} value={d.id}>{d.dow} {d.date?.slice(5)} — {tt(d.title)}</option>
                    ))}
                  </select>
                </label>
              )}
            </>
          )}
        </div>
      ))}
      {editing === '__new' && (
        <div className="module off">
          <ModuleForm form={form} setForm={setForm} save={save} cancel={() => setEditing(null)} isNew />
        </div>
      )}
      {!editing && (
        <button className="btn" style={{ fontSize: 11, padding: '3px 9px', marginTop: 6 }} onClick={startNew}>＋ {t('add an option')}</button>
      )}
    </div>
  );
}

function ModuleForm({ form, setForm, save, cancel, isNew }) {
  const t = useT();
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  return (
    <div>
      <div className="fld-row">
        <label className="fld">{t('Name')}<input value={form.name} onChange={set('name')} placeholder="e.g. Cody Firearms Museum" /></label>
        <label className="fld">{t('Timing')}<input value={form.duration} onChange={set('duration')} placeholder="e.g. 2 hrs, Sunday afternoon" /></label>
      </div>
      <label className="fld">{t('Why')}<textarea rows={2} value={form.why} onChange={set('why')} /></label>
      <label className="fld">{t('Trade-off')}<textarea rows={2} value={form.tradeoff} onChange={set('tradeoff')} /></label>
      <label className="fld">{t('Logistics')}<textarea rows={2} value={form.logistics} onChange={set('logistics')} /></label>
      <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
        <button className="btn gold" onClick={save} disabled={isNew && !form.name.trim()}>{isNew ? t('Add') : t('Save')}</button>
        <button className="btn" onClick={cancel}>{t('Cancel')}</button>
      </div>
    </div>
  );
}

function MealForm({ form, setForm, save, cancel }) {
  const t = useT();
  return (
    <div style={{ marginTop: 6 }}>
      <div className="fld-row">
        <label className="fld">{t('Spot')}<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
        <label className="fld">{t('Where')}<input value={form.where} onChange={(e) => setForm({ ...form, where: e.target.value })} /></label>
      </div>
      <label className="fld">{t('Note')}<input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn gold" onClick={save}>{t('Save')}</button>
        <button className="btn" onClick={cancel}>{t('Cancel')}</button>
      </div>
    </div>
  );
}

function LodgingSection({ day, dispatch }) {
  const [editing, setEditing] = useState(false);
  const lodging = day.lodging ?? { status: 'none', name: '', where: '', note: '' };
  const [form, setForm] = useState(lodging);
  const t = useT();
  const tt = useTT();

  const save = () => {
    dispatch({ type: 'apply_ops', ops: [{ op: 'update_lodging', dayId: day.id, patch: form }] });
    setEditing(false);
  };

  return (
    <div className="section">
      <h3>{t('Tonight')} <span className="cnt">{t('lodging')}</span></h3>
      {!editing ? (
        <div className={`lodging ${lodging.status}`}>
          <div className="l-status">
            {lodging.status === 'booked' ? t('● Confirmed booking') : lodging.status === 'reserve' ? t('▲ Not yet booked — reserve now') : t('○ No lodging set')}
            <button className="mini-edit" onClick={() => { setForm(lodging); setEditing(true); }}>{t('✎ edit')}</button>
          </div>
          <div className="l-name">{tt(lodging.name) || t('Nothing planned yet')}</div>
          {lodging.where && <div className="l-where">{lodging.where}</div>}
          {lodging.note && <div className="l-note">{tt(lodging.note)}</div>}
        </div>
      ) : (
        <div className="lodging">
          <div className="fld-row">
            <label className="fld">{t('Property / plan')}<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            <label className="fld">{t('Status')}
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                <option value="none">{t('none')}</option>
                <option value="reserve">{t('needs booking')}</option>
                <option value="booked">{t('booked')}</option>
              </select>
            </label>
          </div>
          <label className="fld">{t('Address / town')}<input value={form.where} onChange={(e) => setForm({ ...form, where: e.target.value })} /></label>
          <label className="fld">{t('Note')}<input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn gold" onClick={save}>{t('Save')}</button>
            <button className="btn" onClick={() => setEditing(false)}>{t('Cancel')}</button>
          </div>
        </div>
      )}
    </div>
  );
}

function SortableWaypoint({ w, dayId, dispatch, sched, cum, first, tt, u, t, shields }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: w.id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <div ref={setNodeRef} style={style} className={`wp-row${isDragging ? ' dragging' : ''}`}>
      <span className="grip" {...attributes} {...listeners}>⠿</span>
      <span className="eta">
        {sched ? fmtTime(first ? sched.depart : sched.arrive) : '·'}
        {!first && sched && sched.legMin > 0 && <span className="leg-t">+{fmtDur(sched.legMin)}</span>}
        {/* interval distance since the last stop, then the day's running odometer */}
        {!first && sched && sched.legMiles > 0 && (
          <span className="leg-mi">+{u.miNum(sched.legMiles)} {u.miUnit} · {u.miNum(cum)}</span>
        )}
        {shields?.length > 0 && (
          <span className="leg-roads">
            {shields.map((r) => <RoadShield key={r.key} road={r} />)}
          </span>
        )}
      </span>
      <div className="wp-main">
        <span
          className="nm clickable"
          title="Center the map on this stop"
          onClick={() => {
            if (Number.isFinite(w.lat) && Number.isFinite(w.lng)) dispatch({ type: 'focus_point', lat: w.lat, lng: w.lng });
          }}
        >
          {tt(w.name)}
          {w.fuel && <span className="tag fuel">FUEL</span>}
          {w.kind === 'photo' && <span className="tag photo">{t('Photo').toUpperCase()}</span>}
          {sched && sched.dwell > 0 && <span className="tag dwell">{fmtDur(sched.dwell)}</span>}
        </span>
        {w.note && <span className="note">{tt(w.note)}</span>}
      </div>
      <button
        className="rm info"
        title="Stop details"
        onClick={() => dispatch({ type: 'open_modal', modal: { type: 'stop', dayId, waypointId: w.id } })}
      >ⓘ</button>
      <button
        className="rm"
        title="Remove stop"
        onClick={() => dispatch({ type: 'apply_ops', ops: [{ op: 'remove_waypoint', dayId, waypointId: w.id }] })}
      >✕</button>
    </div>
  );
}
