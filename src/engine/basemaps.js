// Shared basemap styles — used by the planning map and the Ride Mode nav map.

import { haversineMiles } from './tripEngine.js';

export const STYLE_DARK = 'https://tiles.openfreemap.org/styles/dark';
export const STYLE_STREETS = 'https://tiles.openfreemap.org/styles/liberty';
export const STYLE_FALLBACK = STYLE_STREETS;
export const STYLE_LIGHT = 'https://tiles.openfreemap.org/styles/positron';

// Hybrid satellite: Esri imagery + road network + city/place labels on top.
export const STYLE_SATELLITE = {
  version: 8,
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  sources: {
    satellite: {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: 19,
      attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
    },
    'esri-roads': {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: 18,
    },
    'esri-places': {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: 18,
    },
  },
  layers: [
    { id: 'satellite', type: 'raster', source: 'satellite' },
    { id: 'esri-roads', type: 'raster', source: 'esri-roads', paint: { 'raster-opacity': 0.9 } },
    { id: 'esri-places', type: 'raster', source: 'esri-places' },
  ],
};

export const BASEMAPS = {
  sat: { label: 'Satellite', style: STYLE_SATELLITE },
  streets: { label: 'Streets', style: STYLE_STREETS },
  dark: { label: 'Dark', style: STYLE_DARK },
  light: { label: 'Light', style: STYLE_LIGHT },
};

// The cream "return" phase disappears on a light basemap — swap it for a legible tan.
export const LIGHT_SAFE = { return: '#a8873a', prep: '#6b675e' };

// ---- 3D terrain (AWS Open Data / Mapzen terrarium DEM — free, no key) ----

const DEM_SOURCE_ID = 'terrain-dem';
const HILLSHADE_ID = 'terrain-hillshade';
const DEM_TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

// Idempotent: safe to call from every redraw. setStyle() wipes sources, so the
// draw path re-asserts terrain state after any style switch.
// ---- look-ahead tile warming (Ride Mode) ----
// The satellite basemap is plain raster URLs (Esri), so fetching a tile fills
// the browser HTTP cache and MapLibre gets an instant hit when the camera
// arrives. We warm the corridor the rider is about to ride through.

const WARM_LAYERS = [
  (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
  (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/${z}/${y}/${x}`,
];
let warmedTiles = new Set();

function tileXY(lat, lng, z) {
  const n = 2 ** z;
  const x = Math.floor(((lng + 180) / 360) * n);
  const rad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n);
  return [x, y];
}

// chain: [{lat,lng}] route geometry · fromIdx: rider's current segment.
// Warms the next `miles` of route at nav zooms. Fire-and-forget; failures ignored.
export function warmTilesAhead(chain, fromIdx, { miles = 12, zooms = [13, 14], cap = 60 } = {}) {
  if (!chain?.length) return 0;
  if (warmedTiles.size > 5000) warmedTiles = new Set();
  const urls = [];
  let dist = 0;
  for (let i = Math.max(0, fromIdx); i < chain.length - 1 && dist < miles && urls.length < cap; i++) {
    dist += haversineMiles(chain[i], chain[i + 1]);
    for (const z of zooms) {
      const [x, y] = tileXY(chain[i].lat, chain[i].lng, z);
      for (const mk of WARM_LAYERS) {
        const key = `${z}/${x}/${y}/${mk === WARM_LAYERS[0] ? 'i' : 'r'}`;
        if (warmedTiles.has(key)) continue;
        warmedTiles.add(key);
        urls.push(mk(z, x, y));
      }
    }
  }
  for (const u of urls.slice(0, cap)) {
    fetch(u, { priority: 'low' }).catch(() => { /* cache warming only */ });
  }
  return Math.min(urls.length, cap);
}

export function ensureTerrain(map, on, { exaggeration = 1.5 } = {}) {
  if (!map.isStyleLoaded()) return;
  if (on) {
    if (!map.getSource(DEM_SOURCE_ID)) {
      map.addSource(DEM_SOURCE_ID, {
        type: 'raster-dem',
        tiles: [DEM_TILES],
        encoding: 'terrarium',
        tileSize: 256,
        maxzoom: 15,
        attribution: 'Elevation: Mapzen/AWS Open Data',
      });
    }
    if (!map.getLayer(HILLSHADE_ID)) {
      // Sit the shading under roads/labels so they stay crisp.
      const layers = map.getStyle().layers ?? [];
      const beforeId = layers.find((l) => l.type === 'symbol' || l.id === 'esri-roads')?.id;
      map.addLayer({
        id: HILLSHADE_ID,
        type: 'hillshade',
        source: DEM_SOURCE_ID,
        paint: { 'hillshade-exaggeration': 0.45, 'hillshade-shadow-color': '#0b0e12' },
      }, beforeId);
    }
    if (!map.getTerrain()) map.setTerrain({ source: DEM_SOURCE_ID, exaggeration });
  } else {
    if (map.getTerrain()) map.setTerrain(null);
    if (map.getLayer(HILLSHADE_ID)) map.removeLayer(HILLSHADE_ID);
  }
}
