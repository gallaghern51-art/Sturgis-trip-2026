// Client side of the translate flow: work out what a trip is missing, ask the
// function for it in chunks, and report progress as it goes.
//
// Chunked rather than one big call for two reasons: each request stays inside
// the host's synchronous ceiling, and a chunk that fails costs only that chunk —
// everything already returned is kept, so a retry resumes instead of restarting.

import { translationCoverage } from '../i18n/collect.js';
import { LANGUAGES } from '../i18n/resolve.js';

const ENDPOINT = '/.netlify/functions/translate';
const CHUNK = 60;

const languageName = (code) => LANGUAGES.find((l) => l.code === code)?.label ?? code;

/**
 * Fill in a trip's missing translations for `lang`.
 *
 * @param onProgress {(p:{done:number,total:number}) => void}
 * @returns {Promise<{translations:Object, done:number, total:number, failed:number}>}
 *          `translations` merges what already existed with whatever came back,
 *          so it can be stored as the trip's whole cache for that language.
 */
export async function translateTrip(trip, lang, onProgress = () => {}) {
  const { missing } = translationCoverage(trip, lang);
  const existing = trip?.i18n?.[lang] ?? {};
  if (!missing.length) return { translations: existing, done: 0, total: 0, failed: 0 };

  const language = languageName(lang);
  const merged = { ...existing };
  let done = 0;
  let failed = 0;

  for (let i = 0; i < missing.length; i += CHUNK) {
    const batch = missing.slice(i, i + CHUNK);
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ strings: batch, language }),
      });
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({}));
        throw new Error(error || `HTTP ${res.status}`);
      }
      const { translations } = await res.json();
      Object.assign(merged, translations ?? {});
      done += Object.keys(translations ?? {}).length;
    } catch (err) {
      // Keep going: one bad chunk should not lose the rest of the trip.
      failed += batch.length;
      // eslint-disable-next-line no-console
      console.warn('translate chunk failed', err);
    }
    onProgress({ done: Math.min(i + batch.length, missing.length), total: missing.length });
  }

  return { translations: merged, done, total: missing.length, failed };
}
