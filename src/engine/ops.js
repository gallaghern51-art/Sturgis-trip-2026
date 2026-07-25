// Edit operations — the single mutation vocabulary shared by the UI and the AI optimizer.
// Every change to the trip is an op; applyOps is pure (returns a new trip).

let counter = 0;
export const uid = (p) => `${p}${Date.now().toString(36)}${(counter++).toString(36)}`;

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
      const days = op.dayIds.map((id) => {
        const d = map.get(id);
        if (!d) throw new Error(`unknown day ${id}`);
        return d;
      });
      // Dates and weekdays stay pinned to calendar slots; content moves.
      const slots = t.days.map((d) => ({ date: d.date, dow: d.dow }));
      days.forEach((d, i) => Object.assign(d, slots[i]));
      t.days = days;
      return t;
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
      const r = t.reserveNow.find((x) => x.id === op.reservationId);
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
  const dayName = (id) => trip.days.find((d) => d.id === id)?.title?.split('·')[0]?.trim() ?? id;
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
      default: return op.op;
    }
  });
}
