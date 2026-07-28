import React, { useEffect, useState } from 'react';

// Real signage, for any route, with nobody hunting for images.
//
// Two sources, tried in order, both of them real artwork:
//
//   1. public/shields/<ROUTE>.svg — the files already in the repo. Named by
//      route key, so they need no lookup table: the filename IS the key. These
//      load instantly, work offline, and work under `vite dev`.
//   2. the `shield` function — resolves anything else on Wikimedia Commons and
//      caches it at the edge for a year (netlify/functions/shield.mjs). This is
//      what makes a road the app has never seen draw correctly the first time
//      it is routed, without anyone adding a file.
//
// The text chip is the DEFAULT and only survives when both miss. Rendering an
// <img> first and catching its error flashed a broken-image glyph on every miss.
const LOCAL = (label) => `/shields/${label}.svg`;
const REMOTE = (label) => `/.netlify/functions/shield?route=${encodeURIComponent(label)}`;

export default function RoadShield({ road, className = '' }) {
  const label = `${road.prefix}-${road.num}`;
  const [art, setArt] = useState(null);
  const dim = road.inherited ? ' inherited' : '';

  useEffect(() => {
    let alive = true;
    setArt(null);
    const tryNext = (sources) => {
      if (!alive || !sources.length) return;
      const [src, ...rest] = sources;
      const img = new Image();
      img.onload = () => { if (alive) (img.naturalWidth > 0 ? setArt(src) : tryNext(rest)); };
      img.onerror = () => tryNext(rest);
      img.src = src;
    };
    tryNext([LOCAL(label), REMOTE(label)]);
    return () => { alive = false; };
  }, [label]);

  if (art) {
    return <img className={`shield-img${dim} ${className}`.trim()} src={art} alt={label} title={label} />;
  }
  return <i className={`shield ${road.kind}${dim} ${className}`.trim()}>{label}</i>;
}
