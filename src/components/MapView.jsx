import React, { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import { useTrip } from '../engine/store.js';
import { PHASES } from '../data/seedTrip.js';
import { haversineMiles } from '../engine/tripEngine.js';

const STYLE_DARK = 'https://tiles.openfreemap.org/styles/dark';
const STYLE_FALLBACK = 'https://tiles.openfreemap.org/styles/liberty';
const STYLE_LIGHT = 'https://tiles.openfreemap.org/styles/positron';
const STYLE_SATELLITE = {
  version: 8,
  sources: {
    satellite: {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: 18,
      attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
    },
  },
  layers: [{ id: 'satellite', type: 'raster', source: 'satellite' }],
};
const BASEMAPS = {
  dark: { label: 'Dark', style: STYLE_DARK },
  light: { label: 'Light', style: STYLE_LIGHT },
  sat: { label: 'Satellite', style: STYLE_SATELLITE },
};
// The cream "return" phase disappears on a light basemap — swap it for a legible tan.
const LIGHT_SAFE = { return: '#a8873a', prep: '#6b675e' };

export default function MapView() {
  const { state, dispatch, routes } = useTrip();
  const { trip, selectedDayId } = state;
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);
  const readyRef = useRef(false);
  const [basemap, setBasemap] = React.useState('dark');
  const basemapRef = useRef('dark');
  basemapRef.current = basemap;
  const stateRef = useRef({ trip, selectedDayId });
  stateRef.current = { trip, selectedDayId };

  const phaseColor = (phase) => {
    if (basemapRef.current === 'light' && LIGHT_SAFE[phase]) return LIGHT_SAFE[phase];
    return PHASES[phase]?.color ?? '#999';
  };

  // Event handlers registered at init would otherwise capture the first render's
  // drawAll (empty routes) — route everything through a ref to the latest one.
  const drawAllRef = useRef(() => {});
  useEffect(() => { drawAllRef.current = drawAll; });
  const scheduleDraw = () => {
    const map = mapRef.current;
    if (!map) return;
    if (map.isStyleLoaded()) drawAllRef.current();
    else map.once('idle', () => drawAllRef.current());
  };

  // init once
  useEffect(() => {
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE_DARK,
      center: [-108.5, 45.9],
      zoom: 5.4,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    let fellBack = false;
    map.on('error', (e) => {
      if (!fellBack && String(e?.error?.message || '').match(/style|404|403/i)) {
        fellBack = true;
        map.setStyle(STYLE_FALLBACK);
      }
    });
    map.on('load', () => {
      readyRef.current = true;
      drawAllRef.current();
    });
    map.on('styledata', () => {
      if (readyRef.current) scheduleDraw();
    });
    // click empty map = add waypoint to the selected day
    map.on('click', (e) => {
      const { selectedDayId: dayId } = stateRef.current;
      if (!dayId) return;
      if (e.originalEvent._wpHandled) return;
      const name = window.prompt('Add a stop here — name it:');
      if (!name) return;
      const day = stateRef.current.trip.days.find((d) => d.id === dayId);
      const pt = { lat: e.lngLat.lat, lng: e.lngLat.lng };
      dispatch({
        type: 'apply_ops',
        ops: [{ op: 'add_waypoint', dayId, index: bestInsertIndex(day.waypoints, pt), waypoint: { name, ...pt, kind: 'via' } }],
      });
    });
    return () => map.remove();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // redraw on data change
  useEffect(() => {
    if (readyRef.current) drawAll();
  }, [trip, selectedDayId, routes]); // eslint-disable-line react-hooks/exhaustive-deps

  // basemap switch — setStyle wipes sources; redraw once the new style has loaded
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    map.setStyle(BASEMAPS[basemap].style);
    map.once('idle', () => drawAllRef.current());
  }, [basemap]); // eslint-disable-line react-hooks/exhaustive-deps

  // fit bounds when selection changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const days = selectedDayId ? trip.days.filter((d) => d.id === selectedDayId) : trip.days;
    const pts = days.flatMap((d) => d.waypoints.map((w) => [w.lng, w.lat]));
    if (!pts.length) return;
    const b = pts.reduce((acc, p) => acc.extend(p), new maplibregl.LngLatBounds(pts[0], pts[0]));
    map.fitBounds(b, { padding: 70, duration: 700, maxZoom: 10.5 });
  }, [selectedDayId, trip.days.length]); // eslint-disable-line react-hooks/exhaustive-deps

  function drawAll() {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const { trip: t, selectedDayId: sel } = stateRef.current;

    for (const day of t.days) {
      const geom = routes[day.id]?.geometry ?? day.waypoints.map((w) => [w.lng, w.lat]);
      const active = sel === null || sel === day.id;
      const color = phaseColor(day.phase);
      const srcId = `route-${day.id}`;
      const data = {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: geom },
      };
      if (map.getSource(srcId)) {
        map.getSource(srcId).setData(data);
      } else {
        map.addSource(srcId, { type: 'geojson', data });
        map.addLayer({
          id: `${srcId}-glow`, type: 'line', source: srcId,
          paint: { 'line-color': color, 'line-width': 8, 'line-opacity': 0.18, 'line-blur': 4 },
          layout: { 'line-cap': 'round', 'line-join': 'round' },
        });
        map.addLayer({
          id: `${srcId}-line`, type: 'line', source: srcId,
          paint: { 'line-color': color, 'line-width': 3, 'line-opacity': 0.9 },
          layout: { 'line-cap': 'round', 'line-join': 'round' },
        });
      }
      const lineOpacity = active ? 0.95 : 0.25;
      map.setPaintProperty(`${srcId}-line`, 'line-color', color);
      map.setPaintProperty(`${srcId}-glow`, 'line-color', color);
      map.setPaintProperty(`${srcId}-line`, 'line-opacity', lineOpacity);
      map.setPaintProperty(`${srcId}-line`, 'line-width', sel === day.id ? 4.5 : 3);
      map.setPaintProperty(`${srcId}-glow`, 'line-opacity', active ? 0.2 : 0.05);
    }
    // prune sources for deleted days
    drawMarkers();
  }

  function drawMarkers() {
    const map = mapRef.current;
    const { trip: t, selectedDayId: sel } = stateRef.current;
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    const days = sel ? t.days.filter((d) => d.id === sel) : t.days;
    for (const day of days) {
      const color = phaseColor(day.phase);
      const showAll = sel === day.id;
      for (const w of day.waypoints) {
        const isEnd = w.kind === 'start' || w.kind === 'end';
        if (!showAll && !isEnd) continue;
        const el = document.createElement('div');
        el.className = `wp-marker${w.fuel ? ' fuel' : ''}${w.kind === 'photo' ? ' photo' : ''}`;
        el.style.background = w.fuel ? '#e8622c' : w.kind === 'photo' ? '#f0e3c8' : color;
        if (isEnd) { el.style.width = '16px'; el.style.height = '16px'; }
        el.addEventListener('click', (ev) => { ev.stopPropagation(); ev._wpHandled = true; });

        const marker = new maplibregl.Marker({ element: el, draggable: showAll })
          .setLngLat([w.lng, w.lat])
          .addTo(map);

        const popupEl = document.createElement('div');
        popupEl.innerHTML = `
          <div class="pp-name">${esc(w.name)}</div>
          ${w.mile != null ? `<div class="pp-note">Mile ${w.mile}${w.fuel ? ' · FUEL' : ''}</div>` : ''}
          ${w.note ? `<div class="pp-note">${esc(w.note)}</div>` : ''}
        `;
        if (showAll) {
          const actions = document.createElement('div');
          actions.className = 'pp-actions';
          const rm = document.createElement('button');
          rm.textContent = 'Remove stop';
          rm.onclick = () => dispatch({ type: 'apply_ops', ops: [{ op: 'remove_waypoint', dayId: day.id, waypointId: w.id }] });
          actions.appendChild(rm);
          popupEl.appendChild(actions);
        }
        marker.setPopup(new maplibregl.Popup({ offset: 14, closeButton: true }).setDOMContent(popupEl));

        if (showAll) {
          marker.on('dragend', () => {
            const ll = marker.getLngLat();
            dispatch({
              type: 'apply_ops',
              ops: [{ op: 'update_waypoint', dayId: day.id, waypointId: w.id, patch: { lat: ll.lat, lng: ll.lng } }],
            });
          });
        }
        markersRef.current.push(marker);
      }
    }
  }

  const selectedDay = trip.days.find((d) => d.id === selectedDayId);
  return (
    <div className="map-wrap">
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
      <div className="map-hint">
        {selectedDay
          ? <>Editing <b>{selectedDay.dow} {selectedDay.date.slice(5)}</b> — click map to add a stop · drag markers to move · click a marker to remove</>
          : <>Whole-trip view — pick a day in the ribbon to edit its route</>}
      </div>
      <div className="basemap-switch">
        {Object.entries(BASEMAPS).map(([key, b]) => (
          <button
            key={key}
            className={basemap === key ? 'active' : ''}
            onClick={() => setBasemap(key)}
          >{b.label}</button>
        ))}
      </div>
      <div className="map-legend">
        {Object.entries(PHASES).map(([k, p]) => (
          <span key={k} className="key"><i style={{ background: p.color }} />{p.label}</span>
        ))}
        <span className="key"><i style={{ background: '#e8622c', height: 8, width: 8, borderRadius: 2 }} />Fuel</span>
        <span className="key"><i style={{ background: '#f0e3c8', height: 8, width: 8, borderRadius: 2, transform: 'rotate(45deg)' }} />Photo</span>
      </div>
    </div>
  );
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// Cheapest place to splice a new point into an existing waypoint sequence.
function bestInsertIndex(waypoints, pt) {
  if (waypoints.length < 2) return waypoints.length;
  let best = 1;
  let bestCost = Infinity;
  for (let i = 0; i < waypoints.length - 1; i++) {
    const a = waypoints[i];
    const b = waypoints[i + 1];
    const cost = haversineMiles(a, pt) + haversineMiles(pt, b) - haversineMiles(a, b);
    if (cost < bestCost) { bestCost = cost; best = i + 1; }
  }
  return best;
}
