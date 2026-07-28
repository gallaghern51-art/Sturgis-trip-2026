import React, { useEffect, useState } from 'react';

// Real signage, downloaded, for every route. One source and no artwork in the
// repo: the `shield` function resolves the route on Wikimedia Commons and the
// answer is cached immutably for a year at the CDN and in the browser, so a
// road is fetched once and is then available offline like any other asset.
// See netlify/functions/shield.mjs.
//
// If Commons genuinely has nothing, the route number renders as plain type.
// It is deliberately NOT drawn into a shield shape — a hand-made lozenge in
// roughly the right colours is worse than honest text, because it reads as
// signage while being wrong.
export default function RoadShield({ road, className = '' }) {
  const label = `${road.prefix}-${road.num}`;
  const [art, setArt] = useState(null);
  const dim = road.inherited ? ' inherited' : '';

  useEffect(() => {
    let alive = true;
    setArt(null);
    const src = `/.netlify/functions/shield?route=${encodeURIComponent(label)}`;
    const img = new Image();
    img.onload = () => { if (alive && img.naturalWidth > 0) setArt(src); };
    img.src = src;
    return () => { alive = false; };
  }, [label]);

  if (art) {
    return <img className={`shield-img${dim} ${className}`.trim()} src={art} alt={label} title={label} />;
  }
  return <i className={`shield-text${dim} ${className}`.trim()}>{label}</i>;
}
