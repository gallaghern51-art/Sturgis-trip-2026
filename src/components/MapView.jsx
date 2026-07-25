import React, { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import { useTrip } from '../engine/store.js';
import { PHASES } from '../data/seedTrip.js';
import { haversineMiles, bestInsertIndex } from '../engine/tripEngine.js';
import { dayTimeline, fmtTime, fmtDur } from '../engine/timeline.js';

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
const isTouch = () => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

export default function MapView() {
  const { state, dispatch, routes, routedLegsByDay } = useTrip();
  const { trip, selectedDayId } = state;
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);
  const readyRef = useRef(false);
  const hoverPopupRef = useRef(null);
  const routedRef = useRef(routedLegsByDay);
  routedRef.current = routedLegsByDay;
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
    // On touch, pinch-zoom replaces the +/− control and the screen is too
    // small to spend on it.
    if (!isTouch()) map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
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
    hoverPopupRef.current = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12, maxWidth: '280px' });
    // click empty map = add waypoint to the selected day
    map.on('click', (e) => {
      const { selectedDayId: dayId } = stateRef.current;
      if (!dayId) return;
      if (e.originalEvent._wpHandled) return;
      // clicking a route line opens the leg modal, not the add-stop prompt
      const lineIds = stateRef.current.trip.days
        .map((d) => `route-${d.id}-line`)
        .filter((id) => map.getLayer(id));
      if (map.queryRenderedFeatures(e.point, { layers: lineIds }).length) return;
      const name = window.prompt('Add a stop here — name it:');
      if (!name) return;
      const day = stateRef.current.trip.days.find((d) => d.id === dayId);
      const pt = { lat: e.lngLat.lat, lng: e.lngLat.lng };
      dispatch({
        type: 'apply_ops',
        ops: [{ op: 'add_waypoint', dayId, index: bestInsertIndex(day.waypoints, pt), waypoint: { name, ...pt, kind: 'via' } }],
      });
    });
    // The map is a hidden tab on mobile; maplibre only watches the window, so
    // watch the container and re-measure whenever it comes back on screen.
    const ro = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0 && entry.contentRect.height > 0) map.resize();
    });
    ro.observe(containerRef.current);
    return () => { ro.disconnect(); map.remove(); };
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
    // A phone-width map has no room for desk-sized gutters.
    const padding = map.getContainer().clientWidth < 560 ? 28 : 70;
    map.fitBounds(b, { padding, duration: 700, maxZoom: 10.5 });
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
        wireLegEvents(map, day.id, `${srcId}-line`);
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

  // Which leg of a day is nearest to a clicked/hovered point.
  function nearestLegIndex(day, pt) {
    let best = 0;
    let bestCost = Infinity;
    for (let i = 0; i < day.waypoints.length - 1; i++) {
      const a = day.waypoints[i];
      const b = day.waypoints[i + 1];
      const cost = haversineMiles(a, pt) + haversineMiles(pt, b) - haversineMiles(a, b);
      if (cost < bestCost) { bestCost = cost; best = i; }
    }
    return best;
  }

  const wiredLayers = useRef(new Set());
  function wireLegEvents(map, dayId, layerId) {
    if (wiredLayers.current.has(layerId)) return;
    wiredLayers.current.add(layerId);
    map.on('mousemove', layerId, (e) => {
      map.getCanvas().style.cursor = 'pointer';
      const day = stateRef.current.trip.days.find((d) => d.id === dayId);
      if (!day) return;
      const pt = { lat: e.lngLat.lat, lng: e.lngLat.lng };
      const li = nearestLegIndex(day, pt);
      const tl = dayTimeline(day, routedRef.current?.[dayId]);
      const from = day.waypoints[li];
      const to = day.waypoints[li + 1];
      const seg = tl.stops[li + 1];
      hoverPopupRef.current
        .setLngLat(e.lngLat)
        .setHTML(`
          <div class="pp-name">${esc(day.dow)} · ${esc(shortLeg(from?.name))} → ${esc(shortLeg(to?.name))}</div>
          <div class="pp-note">${seg ? `${Math.round(seg.legMiles)} mi · ${fmtDur(seg.legMin)} · ETA ${fmtTime(seg.arrive)}` : ''}</div>
          <div class="pp-note">Click for leg details</div>`)
        .addTo(map);
    });
    map.on('mouseleave', layerId, () => {
      map.getCanvas().style.cursor = '';
      hoverPopupRef.current?.remove();
    });
    map.on('click', layerId, (e) => {
      e.originalEvent._wpHandled = true;
      const day = stateRef.current.trip.days.find((d) => d.id === dayId);
      if (!day) return;
      const li = nearestLegIndex(day, { lat: e.lngLat.lat, lng: e.lngLat.lng });
      hoverPopupRef.current?.remove();
      dispatch({ type: 'open_modal', modal: { type: 'leg', dayId, legIndex: li } });
    });
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
        if (isEnd) {
          const size = isTouch() ? '20px' : '16px';
          el.style.width = size;
          el.style.height = size;
        }
        const marker = new maplibregl.Marker({ element: el, draggable: showAll })
          .setLngLat([w.lng, w.lat])
          .addTo(map);

        // hover: quick detail tooltip with ETA · click: full stop modal
        el.addEventListener('mouseenter', () => {
          const tl = dayTimeline(day, routedRef.current?.[day.id]);
          const s = tl.stops.find((x) => x.id === w.id);
          hoverPopupRef.current
            .setLngLat([w.lng, w.lat])
            .setHTML(`
              <div class="pp-name">${esc(w.name)}</div>
              <div class="pp-note">${day.dow} · ${s ? `ETA ${fmtTime(s.arrive)}` : ''}${w.fuel ? ' · FUEL' : ''}${w.kind === 'photo' ? ' · PHOTO' : ''}</div>
              ${w.note ? `<div class="pp-note">${esc(w.note)}</div>` : ''}
              <div class="pp-note">Click for details</div>`)
            .addTo(map);
        });
        el.addEventListener('mouseleave', () => hoverPopupRef.current?.remove());
        el.addEventListener('click', (ev) => {
          ev.stopPropagation();
          ev._wpHandled = true;
          hoverPopupRef.current?.remove();
          dispatch({ type: 'open_modal', modal: { type: 'stop', dayId: day.id, waypointId: w.id } });
        });

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
          ? <>Editing <b>{selectedDay.dow} {selectedDay.date.slice(5)}</b><span className="hint-more"> — click map to add a stop · drag markers · click stops & legs for details</span></>
          : <>Whole-trip view<span className="hint-more"> — hover a route for leg info, click for details, pick a day to edit</span></>}
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

function shortLeg(name) {
  if (!name) return '?';
  return name.length > 22 ? name.slice(0, 21) + '…' : name;
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
