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

// ---- Apple-Weather-style condition coding ----
// The rest of the app runs on the Harley palette, but weather is the one panel
// riders scan for trouble, so each condition carries its own hue instead of the
// single accent. Colors are iOS system colors (dark-mode variants) — they stay
// legible on the black base. `conditionKind` keys the icon set in ConditionsCard.

const KIND_BY_CODE = {
  0: 'clear', 1: 'mostlyClear', 2: 'partly', 3: 'overcast',
  45: 'fog', 48: 'fog',
  51: 'drizzle', 53: 'drizzle', 55: 'drizzle',
  61: 'rain', 63: 'rain', 65: 'heavyRain',
  66: 'sleet', 67: 'sleet',
  71: 'snow', 73: 'snow', 75: 'snow', 77: 'snow',
  80: 'showers', 81: 'showers', 82: 'heavyRain',
  85: 'snow', 86: 'snow',
  95: 'storm', 96: 'storm', 99: 'storm',
};

export const CONDITION_COLORS = {
  clear: '#FFD60A',       // systemYellow
  mostlyClear: '#FFC93C',
  partly: '#9DC6F0',
  overcast: '#8E8E93',    // systemGray
  fog: '#AEAEB2',
  drizzle: '#64D2FF',     // systemTeal
  rain: '#0A84FF',        // systemBlue
  heavyRain: '#0060DF',
  showers: '#40A9FF',
  sleet: '#64D2FF',
  snow: '#C7ECFF',
  storm: '#5E5CE6',       // systemIndigo
  unknown: '#8E8E93',
};

export function conditionKind(code) {
  return KIND_BY_CODE[code] ?? 'unknown';
}

export function conditionColor(code) {
  return CONDITION_COLORS[conditionKind(code)];
}

// Apple's temperature ramp: cold blue → teal → green → yellow → orange → red.
export function tempColor(f) {
  if (f == null || Number.isNaN(f)) return CONDITION_COLORS.unknown;
  if (f >= 95) return '#FF453A';
  if (f >= 85) return '#FF9F0A';
  if (f >= 72) return '#FFD60A';
  if (f >= 58) return '#30D158';
  if (f >= 42) return '#64D2FF';
  return '#0A84FF';
}

// Metrics that aren't worth flagging stay plain and legible rather than tinted
// — matches --ink-dim, so an ordinary 8 mph reads as clearly as a dangerous 35.
const METRIC_PLAIN = 'var(--ink-dim)'; // themes with light/dark

// Rain chance reads blue and gains weight as it climbs.
export function precipColor(pct) {
  if (pct == null) return METRIC_PLAIN;
  if (pct >= 60) return '#4AA8FF';
  if (pct >= 30) return '#64D2FF';
  return METRIC_PLAIN;
}

// Wind is a real hazard on a bike, so it escalates like a warning instead of
// staying neutral: 20+ mph is a fight, 30+ is a plan change.
export function windColor(mph) {
  if (mph == null) return METRIC_PLAIN;
  if (mph >= 30) return '#FF453A';
  if (mph >= 20) return '#FF9F0A';
  return METRIC_PLAIN;
}

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
