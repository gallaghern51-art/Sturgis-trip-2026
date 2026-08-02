// Live place lookup. Google Places (via the google-places Netlify function —
// key stays server-side) with OpenStreetMap Nominatim as the always-works
// fallback. Shared by the add-stop search and the stop editor's autocomplete.

const PLACES_FN = '/.netlify/functions/google-places';
let gSkipUntil = 0; // one failed probe backs off instead of failing every keystroke

async function googlePlaces(query, near) {
  if (Date.now() < gSkipUntil) throw new Error('places backoff');
  let res;
  try {
    res = await fetch(PLACES_FN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, near }),
    });
  } catch (e) {
    gSkipUntil = Date.now() + 5 * 60_000;
    throw e;
  }
  if (!res.ok) {
    gSkipUntil = Date.now() + (res.status === 501 || res.status === 404 ? 30 : 5) * 60_000;
    throw new Error(`google-places ${res.status}`);
  }
  const json = await res.json();
  if (!Array.isArray(json)) throw new Error('google-places bad shape');
  // Google results carry a real place ID — routing snaps to the place itself
  // instead of whatever pavement is nearest a raw coordinate.
  return json.map((r) => ({ ...r, source: 'google' }));
}

async function nominatim(query) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=6&countrycodes=us&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) return [];
  const json = await res.json();
  if (!Array.isArray(json)) return [];
  return json.map((r) => ({
    id: r.place_id, // OSM id — NOT a Google place ID; never sent to the router
    source: 'osm',
    name: r.display_name.split(',').slice(0, 2).join(',').trim(),
    detail: r.display_name.split(',').slice(2, 5).join(',').trim(),
    lat: parseFloat(r.lat),
    lng: parseFloat(r.lon),
  }));
}

// `near` (optional {lat,lng}) biases results toward the day being edited.
export async function geocode(query, near) {
  try {
    return await googlePlaces(query, near);
  } catch {
    return nominatim(query);
  }
}
