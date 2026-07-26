// Trip library store: multiple trips, per-trip scenarios, reducer + localStorage + undo.

import { createContext, useContext } from 'react';
import { SEED_TRIP } from '../data/seedTrip.js';
import { applyOps, uid } from './ops.js';

const LIB_KEY = 'moto.trips.v1';
// pre-library keys (single Sturgis trip) — migrated on first load
const LEGACY_TRIP_KEY = 'sturgis.trip.v2';
const LEGACY_SCEN_KEY = 'sturgis.scenarios.v1';

function freshRecord(trip, name) {
  return {
    id: uid('trip'),
    name: name ?? trip.meta?.title ?? 'Untitled trip',
    trip,
    scenarios: [],
    chat: [],
    updatedAt: new Date().toISOString(),
  };
}

export function loadLibrary() {
  try {
    const lib = JSON.parse(localStorage.getItem(LIB_KEY) || 'null');
    if (lib?.trips?.length) return lib;
  } catch { /* rebuild below */ }
  // migrate legacy single-trip storage, else seed with the Sturgis template
  let trip = null;
  let scenarios = [];
  try { trip = JSON.parse(localStorage.getItem(LEGACY_TRIP_KEY) || 'null'); } catch { /* seed */ }
  try { scenarios = JSON.parse(localStorage.getItem(LEGACY_SCEN_KEY) || '[]'); } catch { /* none */ }
  const rec = freshRecord(trip?.days?.length ? trip : structuredClone(SEED_TRIP));
  rec.scenarios = Array.isArray(scenarios) ? scenarios : [];
  const lib = { trips: [rec], activeId: rec.id };
  persistLibrary(lib);
  return lib;
}

export function persistLibrary(lib) {
  try {
    localStorage.setItem(LIB_KEY, JSON.stringify(lib));
  } catch { /* storage full — non-fatal */ }
}

function activeRecord(lib) {
  return lib.trips.find((t) => t.id === lib.activeId) ?? lib.trips[0];
}

// Write the working trip back into its library record and persist.
function syncTrip(state, trip) {
  const lib = state.lib;
  const rec = activeRecord(lib);
  rec.trip = trip;
  rec.name = trip.meta?.title ?? rec.name;
  rec.updatedAt = new Date().toISOString();
  persistLibrary(lib);
  return trip;
}

export const initialState = () => {
  const lib = loadLibrary();
  const rec = activeRecord(lib);
  return {
    lib,
    trip: rec.trip,
    scenarios: rec.scenarios,
    chat: rec.chat ?? [],
    history: [], // undo stack of previous trips (capped)
    selectedDayId: null, // null = whole-trip overview
    pendingProposal: null, // { ops, summary, saveAs, overwriteScenarioId }
    modal: null, // { type: 'stop'|'leg', dayId, waypointId?, legIndex? }
    chatAsk: null, // question queued for the optimizer
  };
};

export function reducer(state, action) {
  switch (action.type) {
    case 'apply_ops': {
      const { trip, errors } = applyOps(state.trip, action.ops);
      if (errors.length) console.warn('op errors', errors);
      syncTrip(state, trip);
      return { ...state, trip, history: [state.trip, ...state.history].slice(0, 30) };
    }
    case 'undo': {
      if (!state.history.length) return state;
      const [prev, ...rest] = state.history;
      syncTrip(state, prev);
      return { ...state, trip: prev, history: rest };
    }
    case 'reset': {
      const trip = structuredClone(SEED_TRIP);
      syncTrip(state, trip);
      return { ...state, trip, history: [state.trip, ...state.history].slice(0, 30) };
    }
    case 'import': {
      syncTrip(state, action.trip);
      return { ...state, trip: action.trip, history: [state.trip, ...state.history].slice(0, 30) };
    }

    // ---- trip library ----
    case 'create_trip': {
      const rec = freshRecord(action.trip, action.name);
      const lib = { ...state.lib, trips: [...state.lib.trips, rec], activeId: rec.id };
      persistLibrary(lib);
      return { ...state, lib, trip: rec.trip, scenarios: rec.scenarios, chat: rec.chat ?? [], history: [], selectedDayId: null, pendingProposal: null, modal: null };
    }
    case 'switch_trip': {
      const lib = { ...state.lib, activeId: action.id };
      const rec = activeRecord(lib);
      persistLibrary(lib);
      return { ...state, lib, trip: rec.trip, scenarios: rec.scenarios, chat: rec.chat ?? [], history: [], selectedDayId: null, pendingProposal: null, modal: null };
    }
    case 'delete_trip': {
      if (state.lib.trips.length <= 1) return state;
      const trips = state.lib.trips.filter((t) => t.id !== action.id);
      const lib = { trips, activeId: state.lib.activeId === action.id ? trips[0].id : state.lib.activeId };
      const rec = activeRecord(lib);
      persistLibrary(lib);
      return { ...state, lib, trip: rec.trip, scenarios: rec.scenarios, chat: rec.chat ?? [], history: [], selectedDayId: null };
    }

    // ---- UI ----
    case 'select_day':
      return { ...state, selectedDayId: action.dayId };
    case 'open_modal':
      return { ...state, modal: action.modal };
    case 'close_modal':
      return { ...state, modal: null };
    case 'ask_optimizer':
      return { ...state, chatAsk: action.text };
    case 'clear_chat_ask':
      return { ...state, chatAsk: null };
    case 'set_proposal':
      return { ...state, pendingProposal: action.proposal };
    case 'clear_proposal':
      return { ...state, pendingProposal: null };

    // Chat history persists per trip so the optimizer's memory survives reloads.
    case 'save_chat': {
      const rec = activeRecord(state.lib);
      rec.chat = action.messages.slice(-60); // cap so localStorage stays sane
      persistLibrary(state.lib);
      return { ...state, chat: rec.chat };
    }
    case 'clear_chat': {
      const rec = activeRecord(state.lib);
      rec.chat = [];
      persistLibrary(state.lib);
      return { ...state, chat: [] };
    }

    // ---- scenarios (scoped to the active trip) ----
    case 'save_scenario': {
      const rec = activeRecord(state.lib);
      const scen = {
        id: uid('s'),
        name: action.name || `Scenario ${rec.scenarios.length + 1}`,
        savedAt: new Date().toISOString(),
        trip: structuredClone(state.trip),
      };
      rec.scenarios = [...rec.scenarios, scen];
      persistLibrary(state.lib);
      return { ...state, scenarios: rec.scenarios };
    }
    case 'load_scenario': {
      const rec = activeRecord(state.lib);
      const scen = rec.scenarios.find((s) => s.id === action.id);
      if (!scen) return state;
      const trip = structuredClone(scen.trip);
      syncTrip(state, trip);
      return { ...state, trip, history: [state.trip, ...state.history].slice(0, 30), selectedDayId: null, modal: null };
    }
    case 'delete_scenario': {
      const rec = activeRecord(state.lib);
      rec.scenarios = rec.scenarios.filter((s) => s.id !== action.id);
      persistLibrary(state.lib);
      return { ...state, scenarios: rec.scenarios };
    }
    case 'overwrite_scenario': {
      const rec = activeRecord(state.lib);
      rec.scenarios = rec.scenarios.map((s) =>
        s.id === action.id ? { ...s, trip: structuredClone(state.trip), savedAt: new Date().toISOString() } : s
      );
      persistLibrary(state.lib);
      return { ...state, scenarios: rec.scenarios };
    }
    default:
      return state;
  }
}

export const TripContext = createContext(null);
export const useTrip = () => useContext(TripContext);
