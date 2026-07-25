// Trip state store: reducer + localStorage persistence + undo.

import { createContext, useContext } from 'react';
import { SEED_TRIP } from '../data/seedTrip.js';
import { applyOps } from './ops.js';

// v2: seed gained gates/dwell/module locations — old saved trips lack them
const STORAGE_KEY = 'sturgis.trip.v2';
const SCENARIO_KEY = 'sturgis.scenarios.v1';

export function loadScenarios() {
  try {
    return JSON.parse(localStorage.getItem(SCENARIO_KEY) || '[]');
  } catch {
    return [];
  }
}
function persistScenarios(list) {
  try {
    localStorage.setItem(SCENARIO_KEY, JSON.stringify(list));
  } catch { /* storage full — non-fatal */ }
}

export function loadInitialTrip() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      if (saved?.days?.length) return saved;
    }
  } catch { /* fall through to seed */ }
  return structuredClone(SEED_TRIP);
}

export function persistTrip(trip) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trip));
  } catch { /* storage full — non-fatal */ }
}

export const initialState = () => ({
  trip: loadInitialTrip(),
  history: [], // undo stack of previous trips (capped)
  selectedDayId: null, // null = whole-trip overview
  pendingProposal: null, // { ops, summary, saveAs } awaiting apply/dismiss
  scenarios: loadScenarios(), // saved trip permutations
  modal: null, // { type: 'stop'|'leg', dayId, waypointId?, legIndex? }
});

export function reducer(state, action) {
  switch (action.type) {
    case 'apply_ops': {
      const { trip, errors } = applyOps(state.trip, action.ops);
      if (errors.length) console.warn('op errors', errors);
      persistTrip(trip);
      return {
        ...state,
        trip,
        history: [state.trip, ...state.history].slice(0, 30),
      };
    }
    case 'undo': {
      if (!state.history.length) return state;
      const [prev, ...rest] = state.history;
      persistTrip(prev);
      return { ...state, trip: prev, history: rest };
    }
    case 'reset': {
      const trip = structuredClone(SEED_TRIP);
      persistTrip(trip);
      return { ...state, trip, history: [state.trip, ...state.history].slice(0, 30) };
    }
    case 'import': {
      persistTrip(action.trip);
      return { ...state, trip: action.trip, history: [state.trip, ...state.history].slice(0, 30) };
    }
    case 'select_day':
      return { ...state, selectedDayId: action.dayId };
    case 'open_modal':
      return { ...state, modal: action.modal };
    case 'close_modal':
      return { ...state, modal: null };
    case 'save_scenario': {
      const scen = {
        id: `s${Date.now().toString(36)}`,
        name: action.name || `Scenario ${state.scenarios.length + 1}`,
        savedAt: new Date().toISOString(),
        trip: structuredClone(state.trip),
      };
      const scenarios = [...state.scenarios, scen];
      persistScenarios(scenarios);
      return { ...state, scenarios };
    }
    case 'load_scenario': {
      const scen = state.scenarios.find((s) => s.id === action.id);
      if (!scen) return state;
      const trip = structuredClone(scen.trip);
      persistTrip(trip);
      return { ...state, trip, history: [state.trip, ...state.history].slice(0, 30), selectedDayId: null, modal: null };
    }
    case 'delete_scenario': {
      const scenarios = state.scenarios.filter((s) => s.id !== action.id);
      persistScenarios(scenarios);
      return { ...state, scenarios };
    }
    case 'overwrite_scenario': {
      const scenarios = state.scenarios.map((s) =>
        s.id === action.id ? { ...s, trip: structuredClone(state.trip), savedAt: new Date().toISOString() } : s
      );
      persistScenarios(scenarios);
      return { ...state, scenarios };
    }
    case 'set_proposal':
      return { ...state, pendingProposal: action.proposal };
    case 'clear_proposal':
      return { ...state, pendingProposal: null };
    default:
      return state;
  }
}

export const TripContext = createContext(null);
export const useTrip = () => useContext(TripContext);
