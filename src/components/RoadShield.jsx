import React, { useEffect, useState } from 'react';

// Real signage, for any route, with nobody hunting for images.
//
// The shield comes from the `shield` function, which resolves it on Wikimedia
// Commons and caches it at the edge for a year (see netlify/functions/shield.mjs).
// There is no bundled artwork and no route → filename map to keep up to date:
// a road this app has never seen draws correctly the first time it is routed.
//
// The text chip is the DEFAULT, not the fallback, and the artwork replaces it
// only once it has actually decoded. Rendering the <img> first and catching its
// error meant a broken-image glyph flashed in the turn banner on every miss —
// and on `vite dev`, where the function does not run, on every single render.
export default function RoadShield({ road, className = '' }) {
  const label = `${road.prefix}-${road.num}`;
  const src = `/.netlify/functions/shield?route=${encodeURIComponent(label)}`;
  const [art, setArt] = useState(null);
  const dim = road.inherited ? ' inherited' : '';

  useEffect(() => {
    let alive = true;
    const img = new Image();
    img.onload = () => { if (alive && img.naturalWidth > 0) setArt(src); };
    img.onerror = () => { if (alive) setArt(null); };
    img.src = src;
    return () => { alive = false; };
  }, [src]);

  if (art) {
    return <img className={`shield-img${dim} ${className}`.trim()} src={art} alt={label} title={label} />;
  }
  return <i className={`shield ${road.kind}${dim} ${className}`.trim()}>{label}</i>;
}
