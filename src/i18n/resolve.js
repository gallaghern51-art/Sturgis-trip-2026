// One resolution chain for trip content, so there is exactly one answer to
// "why is this string in English?".
//
//   1. the trip's own cache   trip.i18n[lang][source]
//        Written by the translate flow. Works for ANY trip — the Sturgis guide,
//        an AI-generated ride through Patagonia, or a day a rider typed by hand.
//        Travels with export/import because it lives on the trip.
//   2. the bundled map        CONTENT_ES
//        The Sturgis translation that shipped in source. Kept as an offline
//        fallback so the template reads correctly with no network and no keys.
//        New trips do not add to this file — they fill their own cache.
//   3. engine patterns        PATTERN_ES
//        Warnings assembled from numbers at runtime ("Fuel gap 197 mi …").
//        Exact-match can never hit these, so they are matched by shape.
//   4. the source string
//        Better honest English than a wrong guess.

import { CONTENT_ES, PATTERN_ES } from './content-es.js';

const BUNDLED = { es: CONTENT_ES };
const PATTERNS = { es: PATTERN_ES };

export function resolveContent(source, lang, tripCache) {
  if (!source || typeof source !== 'string' || lang === 'en') return source;

  const hit = tripCache?.[source];
  if (hit) return hit;

  const bundled = BUNDLED[lang]?.[source];
  if (bundled) return bundled;

  for (const [re, tpl] of PATTERNS[lang] ?? []) {
    if (re.test(source)) return source.replace(re, tpl);
  }
  return source;
}

/** Does the bundled map already cover this string? Coverage has to count it,
 *  or the Sturgis trip reports 0% while visibly rendering in Spanish. */
export function hasBundled(source, lang) {
  return Boolean(BUNDLED[lang]?.[source]);
}

/** Languages the app offers. Adding one means adding a bundled map above, or
 *  nothing at all — a language with no bundled map still works, it just relies
 *  on each trip's own translation cache. */
export const LANGUAGES = [
  { code: 'en', label: 'English', native: 'English' },
  { code: 'es', label: 'Spanish', native: 'Español' },
];
