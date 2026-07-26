// Place search proxy — Google Places (New) Text Search, key stays server-side.
// POST { query, near?: {lat,lng} } → [{ id, name, detail, lat, lng }]
// Any non-200 tells the client to fall back to Nominatim.

import { searchPlacesGoogle } from '../lib/places-core.mjs';

export default async (req) => {
  if (req.method !== 'POST') return new Response('POST only', { status: 405 });
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return Response.json({ error: 'GOOGLE_MAPS_API_KEY not configured' }, { status: 501 });

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'bad JSON' }, { status: 400 });
  }
  const query = String(body?.query ?? '').trim();
  if (query.length < 2) return Response.json([]);

  try {
    const places = await searchPlacesGoogle(key, query, body?.near);
    return Response.json(places, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return Response.json({ error: String(e.message).slice(0, 300) }, { status: 502 });
  }
};
