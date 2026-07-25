// Trip state store: reducer + localStorage persistence + undo.

import { createContext, useContext } from 'react';
import { SEED_TRIP } from '../data/seedTrip.js';
import { applyOps } from './ops.js';

const STORAGE_KEY = 'sturgis.trip.v1';

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
  pendingProposal: null, // { ops, summary, description } awaiting apply/dismiss
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
