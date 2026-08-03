// Highway shields for any US route, resolved from Wikimedia Commons.
//
// This replaces a folder of hand-downloaded files and a hand-written route →
// filename map. That map only ever covered the twenty routes of one seeded
// trip; the first time anyone planned a road it had not seen, the shield fell
// back to a text chip and the only fix was a person going image-hunting. Route
// numbers are unbounded — there is no version of that list that is ever done.
//
// Commons has the real artwork for effectively all of them, but files are named
// inconsistently across states: I-90.svg, US 20.svg, MT-84.svg, SD 87.svg,
// California 1.svg, Texas 130.svg. So rather than guess one convention, try the
// handful that exist in one batched lookup, and fall back to Commons search for
// the stragglers. Measured 25/25 across 20 states and all three marker types.
//
// Everything is cached at the edge for a year: a route is resolved from Commons
// once, globally, ever. The artwork is public domain (US federal/state road
// signage), and Commons is credited in the app's map attribution already.

const API = 'https://commons.wikimedia.org/w/api.php';
const UA = 'Roadbook/1.0 (https://roadbook-app.netlify.app; highway shields)';
const YEAR = 60 * 60 * 24 * 365;

const STATE = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi',
  MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire',
  NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina',
  ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee',
  TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington',
  WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};

// Ordered by how often each convention wins, so the common cases hit early.
function candidates(prefix, num) {
  if (prefix === 'I') return [`I-${num}.svg`];
  if (prefix === 'US') return [`US ${num}.svg`, `US Route ${num}.svg`];
  const name = STATE[prefix];
  if (!name) return [`${prefix}-${num}.svg`, `${prefix} ${num}.svg`];
  return [
    `${prefix}-${num}.svg`,
    `${prefix} ${num}.svg`,
    `${name} ${num}.svg`,
    `${name} Highway ${num}.svg`,
    `${name} State Route ${num}.svg`,
  ];
}

async function commons(params) {
  const url = `${API}?${new URLSearchParams({ format: 'json', ...params })}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`commons ${res.status}`);
  return res.json();
}

// One request for every candidate: the API takes up to 50 titles at a time, so
// trying five conventions costs the same as trying one.
async function byTitle(cands) {
  const data = await commons({
    action: 'query', prop: 'imageinfo', iiprop: 'url',
    titles: cands.map((c) => `File:${c}`).join('|'),
  });
  const found = {};
  for (const page of Object.values(data.query?.pages ?? {})) {
    if (!('missing' in page)) found[page.title.replace(/^File:/, '')] = page.imageinfo?.[0]?.url;
  }
  // candidate order is the preference order, not whatever the API returned in
  for (const c of cands) if (found[c]) return found[c];
  return null;
}

async function bySearch(prefix, num) {
  const name = STATE[prefix] ?? prefix;
  const data = await commons({
    action: 'query', list: 'search', srnamespace: '6', srlimit: '8',
    srsearch: `${name} ${num} route marker shield filetype:drawing`,
  });
  const hit = (data.query?.search ?? [])
    .map((s) => s.title.replace(/^File:/, ''))
    .find((t) => /\.svg$/i.test(t) && new RegExp(`(^|[^0-9])${num}([^0-9]|$)`).test(t));
  if (!hit) return null;
  return byTitle([hit]);
}

export default async (request) => {
  const route = new URL(request.url).searchParams.get('route') ?? '';
  const m = /^([A-Z]{1,2})-([0-9]{1,3}[A-Z]?)$/.exec(route.toUpperCase());
  if (!m) return new Response('bad route', { status: 400 });
  const [, prefix, num] = m;

  try {
    const src = (await byTitle(candidates(prefix, num))) ?? (await bySearch(prefix, num));
    if (!src) {
      // Cache the miss too, briefly — a route Commons genuinely lacks should not
      // cost a lookup on every render, but it might get uploaded tomorrow.
      return new Response('no shield', {
        status: 404,
        headers: { 'Cache-Control': 'public, max-age=86400' },
      });
    }

    const img = await fetch(src, { headers: { 'User-Agent': UA } });
    if (!img.ok) throw new Error(`upload ${img.status}`);
    return new Response(img.body, {
      headers: {
        'Content-Type': img.headers.get('content-type') ?? 'image/svg+xml',
        // immutable: signage does not change, and this is the whole point —
        // Commons is touched once per route, for everyone, forever
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Netlify-CDN-Cache-Control': `public, durable, max-age=${YEAR}`,
      },
    });
  } catch {
    return new Response('lookup failed', {
      status: 502,
      headers: { 'Cache-Control': 'public, max-age=60' },
    });
  }
};
