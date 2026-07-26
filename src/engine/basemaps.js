// Shared basemap styles — used by the planning map and the Ride Mode nav map.

export const STYLE_DARK = 'https://tiles.openfreemap.org/styles/dark';
export const STYLE_FALLBACK = 'https://tiles.openfreemap.org/styles/liberty';
export const STYLE_LIGHT = 'https://tiles.openfreemap.org/styles/positron';

// Hybrid satellite: Esri imagery + road network + city/place labels on top.
export const STYLE_SATELLITE = {
  version: 8,
  sources: {
    satellite: {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: 18,
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
  dark: { label: 'Dark', style: STYLE_DARK },
  light: { label: 'Light', style: STYLE_LIGHT },
};

// The cream "return" phase disappears on a light basemap — swap it for a legible tan.
export const LIGHT_SAFE = { return: '#a8873a', prep: '#6b675e' };
