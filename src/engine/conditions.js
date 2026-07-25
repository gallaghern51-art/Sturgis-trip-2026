// Live conditions: Open-Meteo forecast (free, no key) per day at the route midpoint.
// Forecasts cover ~16 days out; earlier than that we say so instead of guessing.

const CACHE_KEY = 'sturgis.conditions.v1';
const TTL_MS = 6 * 60 * 60 * 1000;

const WMO = {
  0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Rime fog', 51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle',
  61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains',
  80: 'Rain showers', 81: 'Rain showers', 82: 'Violent showers',
  85: 'Snow showers', 86: 'Snow showers', 95: 'Thunderstorms', 96: 'T-storms w/ hail', 99: 'T-storms w/ hail',
};

function cache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); } catch { return {}; }
}

export async function fetchDayConditions(day) {
  const mid = day.waypoints[Math.floor(day.waypoints.length / 2)];
  if (!mid) return null;
  const key = `${day.date}|${mid.lat.toFixed(2)},${mid.lng.toFixed(2)}`;
  const c = cache();
  if (c[key] && Date.now() - c[key].at < TTL_MS) return c[key].data;

  const url = `https://api.open-meteo.com/v1/forecast?latitude=${mid.lat}&longitude=${mid.lng}` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max,sunrise,sunset` +
    `&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=America%2FDenver` +
    `&start_date=${day.date}&end_date=${day.date}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return { unavailable: true };
    const j = await res.json();
    const d = j.daily;
    if (!d?.time?.length) return { unavailable: true };
    const data = {
      summary: WMO[d.weather_code?.[0]] ?? '—',
      code: d.weather_code?.[0],
      hi: Math.round(d.temperature_2m_max?.[0]),
      lo: Math.round(d.temperature_2m_min?.[0]),
      precip: d.precipitation_probability_max?.[0],
      wind: Math.round(d.wind_speed_10m_max?.[0]),
      sunrise: (d.sunrise?.[0] || '').slice(11, 16),
      sunset: (d.sunset?.[0] || '').slice(11, 16),
      at: mid.name,
    };
    const next = cache();
    next[key] = { at: Date.now(), data };
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(next)); } catch { /* full */ }
    return data;
  } catch {
    return { unavailable: true };
  }
}

export const ROAD_STATUS_LINKS = [
  { name: 'Beartooth Hwy (US-212) — MDT road report', url: 'https://roadreport.mdt.mt.gov/travinfomobile/' },
  { name: 'Going-to-the-Sun Road status — NPS', url: 'https://www.nps.gov/glac/planyourvisit/gtsrinfo.htm' },
  { name: 'Yellowstone road status — NPS', url: 'https://www.nps.gov/yell/planyourvisit/parkroads.htm' },
  { name: 'Wyoming 511 (Bighorns, Chief Joseph)', url: 'https://map.wyoroad.info/' },
  { name: 'South Dakota 511 (Black Hills)', url: 'https://sd511.org/' },
  { name: 'Wildfire smoke — AirNow fire & smoke map', url: 'https://fire.airnow.gov/' },
];
