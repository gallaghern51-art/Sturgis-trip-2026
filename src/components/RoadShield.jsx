import React, { useState } from 'react';

// Real signage, for any route, with nobody hunting for images.
//
// The shield comes from the `shield` function, which resolves it on Wikimedia
// Commons and caches it at the edge for a year (see netlify/functions/shield.mjs).
// There is no bundled artwork and no route → filename map to keep up to date:
// a road this app has never seen draws correctly the first time it is routed.
//
// The text chip is the honest fallback for the handful Commons has nothing for,
// and for local `vite dev`, where the function is not running.
export default function RoadShield({ road, className = '' }) {
  const [failed, setFailed] = useState(false);
  const label = `${road.prefix}-${road.num}`;
  const dim = road.inherited ? ' inherited' : '';

  if (failed) {
    return <i className={`shield ${road.kind}${dim} ${className}`.trim()}>{label}</i>;
  }
  return (
    <img
      className={`shield-img${dim} ${className}`.trim()}
      src={`/.netlify/functions/shield?route=${encodeURIComponent(label)}`}
      alt={label}
      title={label}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}
