// Highway shields for a stop, parsed out of the text the field guide already
// carries ("Depart 5:45 AM, US-14/16/20 East", "I-90 East entrance", "MT-135
// South"). Nothing new to maintain: the road numbers live in the notes, we just
// surface them as shields.
//
// Interstates get the blue/red shield, US routes the white escutcheon, state
// routes a plain square — the same three shapes as real signage.

// Real signage artwork in public/shields (Wikimedia Commons, public domain).
// A route with no file here still renders — as a plain text chip — so adding a
// shield later is just dropping <KEY>.svg in that folder and adding the key.
// Real signage artwork in public/shields (Wikimedia Commons, public domain),
// keyed by route with its filename so mixed formats work. A route with no
// entry still renders — as a plain text chip — so adding one later is just
// dropping the file in that folder and adding a line here.
export const SHIELD_ART = {
  'I-15': 'I-15.svg',
  'I-90': 'I-90.svg',
  'MT-135': 'MT-135.svg',
  'MT-35': 'MT-35.svg',
  'SD-14A': 'SD-14A.svg',
  'SD-87': 'SD-87.svg',
  'US-14': 'US-14.svg',
  'US-14A': 'US-14A.svg',
  'US-16': 'US-16.svg',
  'US-16A': 'US-16A.svg',
  'US-191': 'US-191.svg',
  'US-2': 'US-2.svg',
  'US-20': 'US-20.svg',
  'US-212': 'US-212.svg',
  'US-385': 'US-385.svg',
  'US-85': 'US-85.svg',
  'US-87': 'US-87.svg',
  'US-89': 'US-89.svg',
  'US-93': 'US-93.svg',
  'WY-120': 'WY-120.webp',
};

const ROAD_RE = /\b(I|US|MT|WY|SD|ID|NE|CO|UT)-(\d{1,3}[A-Z]?(?:\/\d{1,3}[A-Z]?)*)\b/g;

const KIND = {
  I: 'interstate',
  US: 'us',
};

/**
 * @returns {{key:string, kind:'interstate'|'us'|'state', prefix:string, num:string}[]}
 */
export function roadShields(...texts) {
  const seen = new Set();
  const out = [];
  for (const text of texts) {
    if (!text || typeof text !== 'string') continue;
    ROAD_RE.lastIndex = 0;
    let m;
    while ((m = ROAD_RE.exec(text))) {
      const prefix = m[1];
      // "US-14/16/20" is three shields, not one
      for (const num of m[2].split('/')) {
        const key = `${prefix}-${num}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ key, kind: KIND[prefix] ?? 'state', prefix, num });
      }
    }
  }
  return out;
}

/**
 * Shields for every stop in a day, index-aligned to day.waypoints.
 *
 * Only some notes name a road ("Shell, WY — Dirty Annie's. Canyon mouth" does
 * not), but you are still on US-14 there, so an unnamed stop inherits the last
 * road stated. `inherited` is set on those so the UI can render them quieter —
 * it is a reasonable guess, not something the guide actually says.
 */
export function dayRoadShields(day) {
  let carried = [];
  return (day.waypoints ?? []).map((w) => {
    const own = roadShields(w.note, w.name);
    if (own.length) {
      carried = own;
      return own;
    }
    return carried.map((s) => ({ ...s, inherited: true }));
  });
}
