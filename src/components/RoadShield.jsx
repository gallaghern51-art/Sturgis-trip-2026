import React from 'react';
import { SHIELD_ART } from '../engine/roads.js';

// Real signage artwork where we have it (public/shields), a drawn chip in the
// right shape where we do not. Shared by the day panel and the Ride Mode turn
// banner so a route looks the same whether you are planning it or riding it.
export default function RoadShield({ road, className = '' }) {
  const label = `${road.prefix}-${road.num}`;
  const art = SHIELD_ART[road.key];
  const dim = road.inherited ? ' inherited' : '';
  if (art) {
    return (
      <img
        className={`shield-img${dim} ${className}`.trim()}
        src={`/shields/${art}`}
        alt={label}
        title={label}
        loading="lazy"
      />
    );
  }
  return <i className={`shield ${road.kind}${dim} ${className}`.trim()}>{label}</i>;
}
