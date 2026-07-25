// Live place lookup (OpenStreetMap Nominatim). Shared by the add-stop search
// and the stop editor's Google-Maps-style location autocomplete.

export async function geocode(query) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=6&countrycodes=us&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) return [];
  const json = await res.json();
  if (!Array.isArray(json)) return [];
  return json.map((r) => ({
    id: r.place_id,
    name: r.display_name.split(',').slice(0, 2).join(',').trim(),
    detail: r.display_name.split(',').slice(2, 5).join(',').trim(),
    lat: parseFloat(r.lat),
    lng: parseFloat(r.lon),
  }));
}
