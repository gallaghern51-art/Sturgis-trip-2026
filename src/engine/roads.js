// Highway shields for a stop, parsed out of the text the field guide already
// carries ("Depart 5:45 AM, US-14/16/20 East", "I-90 East entrance", "MT-135
// South"). Nothing new to maintain: the road numbers live in the notes, we just
// surface them as shields.
//
// Interstates get the blue/red shield, US routes the white escutcheon, state
// routes a plain square — the same three shapes as real signage.

// Shields are fetched by route key from the `shield` function, which resolves
// them on Wikimedia Commons — see netlify/functions/shield.mjs. There is
// deliberately no list of known routes here: route numbers are unbounded, and
// any such list is a manual step that is never finished.

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
