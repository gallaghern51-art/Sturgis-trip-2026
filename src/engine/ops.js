// Edit operations — the single mutation vocabulary shared by the UI and the AI optimizer.
// Every change to the trip is an op; applyOps is pure (returns a new trip).

import { cascadeDates } from './dates.js';

let counter = 0;
export const uid = (p) => `${p}${Date.now().toString(36)}${(counter++).toString(36)}`;

export function blankDay(patch = {}) {
  return {
    id: uid('day'),
    dow: '', date: '',
    title: 'New day', phase: 'outbound',
    miles: 0, hours: 0, depart: '9:00 AM', arrive: '', anchor: false,
    summary: '', constraints: [], gates: [],
    waypoints: [], meals: [], photos: [], modules: [], ops: [],
    lodging: { status: 'none', name: '', where: '', note: '' },
    ...patch,
  };
}

export function applyOps(trip, ops) {
  let t = structuredClone(trip);
  const errors = [];
  for (const op of ops) {
    try {
      t = applyOp(t, op);
    } catch (e) {
      errors.push(`${op.op}: ${e.message}`);
    }
  }
  return { trip: t, errors };
}

function findDay(t, dayId) {
  const d = t.days.find((x) => x.id === dayId);
  if (!d) throw new Error(`unknown day ${dayId}`);
  return d;
}

function applyOp(t, op) {
  switch (op.op) {
    case 'reorder_days': {
      const map = new Map(t.days.map((d) => [d.id, d]));
      if (op.dayIds.length !== t.days.length) throw new Error('dayIds must include every day');
      t.days = op.dayIds.map((id) => {
        const d = map.get(id);
        if (!d) throw new Error(`unknown day ${id}`);
        return d;
      });
      return cascadeDates(t);
    }
    case 'add_day': {
      const day = blankDay(op.day ?? {});
      const at = Math.min(Math.max(op.index ?? t.days.length, 0), t.days.length);
      t.days.splice(at, 0, day);
      return cascadeDates(t);
    }
    case 'remove_day': {
      const idx = t.days.findIndex((d) => d.id === op.dayId);
      if (idx < 0) throw new Error(`unknown day ${op.dayId}`);
      if (t.days.length <= 1) throw new Error('a trip needs at least one day');
      t.days.splice(idx, 1);
      return cascadeDates(t);
    }
    case 'update_lodging': {
      const d = findDay(t, op.dayId);
      d.lodging = { status: 'none', name: '', where: '', note: '', ...d.lodging, ...op.patch };
      return t;
    }
    case 'remove_meal': {
      const d = findDay(t, op.dayId);
      d.meals = (d.meals ?? []).filter((m) => m.meal !== op.meal);
      return t;
    }
    case 'set_meta': {
      // roster: [{ id, name, bike }] — who's riding what, shown under Field notes
      const allowed = ['title', 'subtitle', 'riders', 'startDate', 'fuelRule', 'range', 'roster'];
      for (const k of Object.keys(op.patch ?? {})) {
        if (!allowed.includes(k)) throw new Error(`meta field ${k} not editable`);
      }
      const dateChanged = op.patch.startDate && op.patch.startDate !== t.meta.startDate;
      Object.assign(t.meta, op.patch);
      return dateChanged ? cascadeDates(t) : t;
    }
    case 'reorder_waypoints': {
      const d = findDay(t, op.dayId);
      const map = new Map(d.waypoints.map((w) => [w.id, w]));
      if (op.waypointIds.length !== d.waypoints.length) throw new Error('waypointIds must include every waypoint');
      d.waypoints = op.waypointIds.map((id) => {
        const w = map.get(id);
        if (!w) throw new Error(`unknown waypoint ${id}`);
        return w;
      });
      return t;
    }
    case 'move_waypoint': {
      const from = findDay(t, op.fromDayId);
      const to = findDay(t, op.toDayId);
      const idx = from.waypoints.findIndex((w) => w.id === op.waypointId);
      if (idx < 0) throw new Error(`unknown waypoint ${op.waypointId}`);
      const [w] = from.waypoints.splice(idx, 1);
      const at = Math.min(Math.max(op.index ?? to.waypoints.length, 0), to.waypoints.length);
      to.waypoints.splice(at, 0, w);
      return t;
    }
    case 'add_waypoint': {
      const d = findDay(t, op.dayId);
      const w = { id: uid('w'), kind: 'via', mile: null, note: '', ...op.waypoint };
      if (!Number.isFinite(w.lat) || !Number.isFinite(w.lng)) throw new Error('waypoint needs lat/lng');
      const at = Math.min(Math.max(op.index ?? d.waypoints.length, 0), d.waypoints.length);
      d.waypoints.splice(at, 0, w);
      return t;
    }
    case 'remove_waypoint': {
      const d = findDay(t, op.dayId);
      const idx = d.waypoints.findIndex((w) => w.id === op.waypointId);
      if (idx < 0) throw new Error(`unknown waypoint ${op.waypointId}`);
      d.waypoints.splice(idx, 1);
      return t;
    }
    case 'update_waypoint': {
      const d = findDay(t, op.dayId);
      const w = d.waypoints.find((x) => x.id === op.waypointId);
      if (!w) throw new Error(`unknown waypoint ${op.waypointId}`);
      Object.assign(w, op.patch);
      return t;
    }
    case 'set_day_field': {
      const d = findDay(t, op.dayId);
      const allowed = ['title', 'summary', 'depart', 'arrive', 'phase', 'anchor', 'miles', 'hours'];
      if (!allowed.includes(op.field)) throw new Error(`field ${op.field} not editable`);
      d[op.field] = op.value;
      return t;
    }
    case 'toggle_module': {
      const d = findDay(t, op.dayId);
      const m = (d.modules ?? []).find((x) => x.id === op.moduleId);
      if (!m) throw new Error(`unknown module ${op.moduleId}`);
      m.enabled = op.enabled ?? !m.enabled;
      // Modules with real-world locations populate the map when switched on.
      if (m.waypoints?.length) {
        const ids = m.waypoints.map((_, i) => `${m.id}-wp${i}`);
        d.waypoints = d.waypoints.filter((w) => !ids.includes(w.id));
        if (m.enabled) {
          // splice before the day's final waypoint so the route runs out and back
          const at = Math.max(1, d.waypoints.length - 1);
          const added = m.waypoints.map((mw, i) => ({ id: ids[i], kind: 'via', mile: null, note: '', ...mw }));
          d.waypoints.splice(at, 0, ...added);
        }
      }
      return t;
    }
    case 'set_reservation_done': {
      const r = (t.reserveNow ?? []).find((x) => x.id === op.reservationId);
      if (!r) throw new Error(`unknown reservation ${op.reservationId}`);
      r.done = op.done ?? !r.done;
      // Mirror onto lodging status when they correspond
      for (const d of t.days) {
        if (d.lodging?.status === 'reserve' && r.name.toLowerCase().includes(d.lodging.name.split(',')[0].toLowerCase().slice(0, 12))) {
          if (op.done) d.lodging.status = 'booked';
        }
      }
      return t;
    }
    case 'update_meal': {
      const d = findDay(t, op.dayId);
      d.meals = d.meals ?? [];
      const m = d.meals.find((x) => x.meal === op.meal);
      if (m) Object.assign(m, op.patch);
      else d.meals.push({ meal: op.meal, name: '', where: '', note: '', alt: '', ...op.patch });
      return t;
    }
    default:
      throw new Error(`unknown op ${op.op}`);
  }
}

// Human-readable description of an op list, for the AI proposal preview.
export function describeOps(trip, ops) {
  // Name the leg the way the optimizer is told to name it — never a raw id.
  const dayName = (id) => {
    const d = trip.days.find((x) => x.id === id);
    if (!d) return 'a removed day';
    const title = d.title?.split('·')[0]?.trim() || 'untitled';
    return `${d.dow} ${d.date?.slice(5).replace(/^0?(\d+)-0?(\d+)$/, '$1/$2')} — ${title}`;
  };
  return ops.map((op) => {
    switch (op.op) {
      case 'reorder_days': return 'Reorder the day sequence';
      case 'reorder_waypoints': return `Reorder stops on ${dayName(op.dayId)}`;
      case 'move_waypoint': return `Move a stop from ${dayName(op.fromDayId)} to ${dayName(op.toDayId)}`;
      case 'add_waypoint': return `Add “${op.waypoint?.name}” to ${dayName(op.dayId)}`;
      case 'remove_waypoint': return `Remove a stop from ${dayName(op.dayId)}`;
      case 'update_waypoint': return `Edit a stop on ${dayName(op.dayId)}`;
      case 'set_day_field': return `Set ${op.field} on ${dayName(op.dayId)}`;
      case 'toggle_module': return `Turn ${op.enabled ? 'ON' : 'OFF'} a module on ${dayName(op.dayId)}`;
      case 'set_reservation_done': return 'Update the booking checklist';
      case 'update_meal': return `Change ${op.meal} on ${dayName(op.dayId)}`;
      case 'remove_meal': return `Remove ${op.meal} on ${dayName(op.dayId)}`;
      case 'add_day': return `Add a day${op.day?.title ? ` — “${op.day.title}”` : ''}`;
      case 'remove_day': return `Remove ${dayName(op.dayId)}`;
      case 'update_lodging': return `Change lodging on ${dayName(op.dayId)}`;
      case 'set_meta': return `Update trip settings (${Object.keys(op.patch ?? {}).join(', ')})`;
      default: return op.op;
    }
  });
}
