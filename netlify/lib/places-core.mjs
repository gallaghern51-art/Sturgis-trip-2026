// Google Places (New) Text Search — shared by the google-places function
// (client search box) and planner-core (the AI's search_places tool).
// One call returns names + addresses + coordinates; Pro SKU, 5k free/month.

const SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';

export async function searchPlacesGoogle(key, query, near, { limit = 6 } = {}) {
  const body = {
    textQuery: query,
    pageSize: Math.min(10, limit),
    ...(near && Number.isFinite(near.lat) && Number.isFinite(near.lng)
      ? { locationBias: { circle: { center: { latitude: near.lat, longitude: near.lng }, radius: 50000 } } }
      : {}),
  };
  const res = await fetch(SEARCH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const err = new Error(`places ${res.status}: ${detail.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  const json = await res.json();
  return (json.places ?? []).map((p) => ({
    id: p.id,
    name: p.displayName?.text ?? '',
    detail: p.formattedAddress ?? '',
    lat: p.location?.latitude,
    lng: p.location?.longitude,
  })).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
}
