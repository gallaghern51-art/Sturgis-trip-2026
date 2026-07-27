// Every translatable string on a trip, in one place.
//
// This is the contract between the UI and translation: if a field is rendered
// through tt(), it must be listed here, and then it gets translated for free —
// for the Sturgis trip and for any AI-generated trip anywhere in the world.
// Add a field to the trip shape, add it here, done. Nothing else to touch.
//
// scripts/i18n-check.mjs asserts the two stay in step.

import { hasBundled } from './resolve.js';

// Times, distances, coordinates and bare numbers are not prose — translating
// "6:15 AM" or "US-14" is worse than leaving it, so they never enter the set.
const NOT_PROSE = /^[\d\s:.,'"|/–—°%$&+()\[\]-]*$/;

export function isTranslatable(s) {
  return typeof s === 'string' && s.trim().length > 1 && !NOT_PROSE.test(s);
}

// Field lists live next to the shape they describe so a change to the trip
// model has one obvious place to be reflected.
const DAY_TEXT = ['title', 'summary'];
const WP_TEXT = ['name', 'note'];
const MEAL_TEXT = ['name', 'note', 'alt'];
const PHOTO_TEXT = ['name', 'why', 'light', 'parking', 'notes'];
const LODGING_TEXT = ['name', 'note'];
const MODULE_TEXT = ['name', 'duration', 'why', 'tradeoff', 'logistics'];
const RESERVATION_TEXT = ['name', 'when', 'note'];
const META_TEXT = ['subtitle', 'summary', 'fuelRule'];

/**
 * @returns {string[]} unique, prose-only, in stable document order
 */
export function collectTripStrings(trip) {
  const out = new Set();
  const add = (v) => { if (isTranslatable(v)) out.add(v); };
  const addFields = (obj, fields) => { if (obj) for (const f of fields) add(obj[f]); };
  const addAll = (arr) => { for (const v of arr ?? []) add(v); };

  addFields(trip?.meta, META_TEXT);

  for (const d of trip?.days ?? []) {
    addFields(d, DAY_TEXT);
    addAll(d.constraints);
    addAll(d.ops);
    for (const g of d.gates ?? []) add(g.label);
    for (const w of d.waypoints ?? []) addFields(w, WP_TEXT);
    for (const m of d.meals ?? []) addFields(m, MEAL_TEXT);
    for (const p of d.photos ?? []) addFields(p, PHOTO_TEXT);
    addFields(d.lodging, LODGING_TEXT);
    for (const mod of d.modules ?? []) {
      addFields(mod, MODULE_TEXT);
      // a module's own stops are only spliced into the day while it is on, so
      // they have to be collected from the module too
      for (const w of mod.waypoints ?? []) addFields(w, WP_TEXT);
    }
  }

  for (const r of trip?.reserveNow ?? []) addFields(r, RESERVATION_TEXT);
  for (const list of Object.values(trip?.fieldNotes ?? {})) addAll(list);

  return [...out];
}

/**
 * How much of a trip will actually render in `lang`. Drives the Settings
 * readout, so it counts both sources the UI reads from: the trip's own cache
 * and the bundled map. Counting only the cache would report the Sturgis trip as
 * 0% translated while it visibly renders in Spanish.
 *
 * `missing` is exactly what the translate run would send.
 */
export function translationCoverage(trip, lang) {
  const strings = collectTripStrings(trip);
  const cache = trip?.i18n?.[lang] ?? {};
  const missing = strings.filter((s) => !cache[s] && !hasBundled(s, lang));
  return { total: strings.length, done: strings.length - missing.length, missing };
}
