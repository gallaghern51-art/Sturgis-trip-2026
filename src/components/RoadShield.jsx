import React, { useEffect, useState } from 'react';

// Real signage for every route, downloaded — with a local override.
//
// Order, first hit wins:
//
//   1. public/shields/<ROUTE>.svg|png|webp — the override folder. Anything
//      dropped in there beats the download, no code change and no list: the
//      filename IS the route key. For routes where Commons is wrong, missing,
//      or has a worse drawing than one you sourced yourself.
//   2. the `shield` function — resolves the route on Wikimedia Commons and
//      caches it immutably for a year at the CDN and in the browser, so a road
//      is fetched once and is offline after that. This already returns the real
//      state designs: Wyoming's bucking horse, South Dakota's state outline,
//      Idaho's silhouette, Montana's square.
//
// If both miss, the route number is set as plain type. It is deliberately NOT
// drawn into a shield shape — a hand-made lozenge in roughly the right colours
// reads as signage while being wrong, which is worse than honest text.
const SOURCES = (label) => [
  `/shields/${label}.svg`,
  `/shields/${label}.png`,
  `/shields/${label}.webp`,
  `/.netlify/functions/shield?route=${encodeURIComponent(label)}`,
];

export default function RoadShield({ road, className = '' }) {
  const label = `${road.prefix}-${road.num}`;
  const [art, setArt] = useState(null);
  const dim = road.inherited ? ' inherited' : '';

  useEffect(() => {
    let alive = true;
    setArt(null);
    const tryNext = ([src, ...rest]) => {
      if (!alive || !src) return;
      const img = new Image();
      img.onload = () => { if (alive) (img.naturalWidth > 0 ? setArt(src) : tryNext(rest)); };
      img.onerror = () => tryNext(rest);
      img.src = src;
    };
    tryNext(SOURCES(label));
    return () => { alive = false; };
  }, [label]);

  if (art) {
    return <img className={`shield-img${dim} ${className}`.trim()} src={art} alt={label} title={label} />;
  }
  return <i className={`shield-text${dim} ${className}`.trim()}>{label}</i>;
}
