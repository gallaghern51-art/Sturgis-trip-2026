import React, { useEffect, useState } from 'react';
import {
  fetchDayConditions, conditionKind, conditionColor,
  tempColor, precipColor, windColor,
} from '../engine/conditions.js';

// Inline SVG rather than emoji: these inherit the condition color via
// currentColor, where emoji glyphs would render in their own fixed palette.
const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' };
const CLOUD = <path d="M6.5 18h10a3.5 3.5 0 0 0 .3-7 5 5 0 0 0-9.5-1.2A3.9 3.9 0 0 0 6.5 18Z" {...S} />;

function Sun({ r = 4 }) {
  return (
    <>
      <circle cx="12" cy="12" r={r} {...S} />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => {
        const rad = (a * Math.PI) / 180;
        const [x1, y1] = [12 + Math.cos(rad) * (r + 2.2), 12 + Math.sin(rad) * (r + 2.2)];
        const [x2, y2] = [12 + Math.cos(rad) * (r + 4.4), 12 + Math.sin(rad) * (r + 4.4)];
        return <line key={a} x1={x1} y1={y1} x2={x2} y2={y2} {...S} />;
      })}
    </>
  );
}

const ICONS = {
  clear: <Sun />,
  mostlyClear: <Sun r={3.6} />,
  partly: (
    <>
      <circle cx="9" cy="8.5" r="3.2" {...S} />
      <path d="M8 19h8.5a3.2 3.2 0 0 0 0-6.4 4.6 4.6 0 0 0-8.8-.6A3.5 3.5 0 0 0 8 19Z" {...S} />
    </>
  ),
  overcast: CLOUD,
  fog: (
    <>
      <path d="M6.5 14h10a3.5 3.5 0 0 0 .3-7 5 5 0 0 0-9.5-1.2A3.9 3.9 0 0 0 6.5 14Z" {...S} />
      <line x1="5" y1="18" x2="19" y2="18" {...S} />
      <line x1="7.5" y1="21" x2="16.5" y2="21" {...S} />
    </>
  ),
  drizzle: (
    <>
      {CLOUD}
      <line x1="10" y1="20.5" x2="9.4" y2="22" {...S} />
      <line x1="14" y1="20.5" x2="13.4" y2="22" {...S} />
    </>
  ),
  rain: (
    <>
      {CLOUD}
      <line x1="9.5" y1="20" x2="8.5" y2="22.5" {...S} />
      <line x1="13" y1="20" x2="12" y2="22.5" {...S} />
      <line x1="16.5" y1="20" x2="15.5" y2="22.5" {...S} />
    </>
  ),
  heavyRain: (
    <>
      {CLOUD}
      <line x1="8.5" y1="19.5" x2="7.2" y2="23" {...S} />
      <line x1="12" y1="19.5" x2="10.7" y2="23" {...S} />
      <line x1="15.5" y1="19.5" x2="14.2" y2="23" {...S} />
      <line x1="19" y1="19.5" x2="17.7" y2="23" {...S} />
    </>
  ),
  showers: (
    <>
      {CLOUD}
      <line x1="10" y1="20" x2="9" y2="22.5" {...S} />
      <line x1="15" y1="20" x2="14" y2="22.5" {...S} />
    </>
  ),
  sleet: (
    <>
      {CLOUD}
      <line x1="9.5" y1="20" x2="8.5" y2="22.5" {...S} />
      <path d="M13.6 21.6h2.8M15 20.2v2.8" {...S} />
    </>
  ),
  snow: (
    <>
      {CLOUD}
      <path d="M8.6 21.4h2.6M9.9 20.1v2.6" {...S} />
      <path d="M13.8 21.4h2.6M15.1 20.1v2.6" {...S} />
    </>
  ),
  storm: (
    <>
      {CLOUD}
      <path d="M13 19.5 10.5 23h3l-1 2.5" {...S} />
    </>
  ),
  unknown: <line x1="8" y1="12" x2="16" y2="12" {...S} />,
};

export default function ConditionsCard({ day }) {
  const [cond, setCond] = useState(null);

  useEffect(() => {
    let dead = false;
    setCond(null);
    fetchDayConditions(day).then((c) => { if (!dead) setCond(c ?? { unavailable: true }); });
    return () => { dead = true; };
  }, [day.id, day.date]); // eslint-disable-line react-hooks/exhaustive-deps

  const kind = cond && !cond.unavailable ? conditionKind(cond.code) : 'unknown';
  const accent = cond && !cond.unavailable ? conditionColor(cond.code) : null;

  return (
    <div className="section">
      <h3>Conditions <span className="cnt">{day.date} · Open-Meteo</span></h3>
      {!cond && <div className="cond-card">checking forecast…</div>}
      {cond?.unavailable && (
        <div className="cond-card dim">
          Forecast not in range yet — Open-Meteo covers ~16 days out. Check back closer to the date.
        </div>
      )}
      {cond && !cond.unavailable && (
        <div className="cond-card wx" style={{ '--cond': accent }}>
          <svg className="wx-icon" viewBox="0 0 24 26" aria-hidden="true">{ICONS[kind]}</svg>
          <div className="wx-head">
            <span className="wx-summary">{cond.summary}</span>
            <span className="cond-at">near {cond.at}</span>
          </div>
          <span className="wx-temp">
            <b style={{ color: tempColor(cond.hi) }}>{cond.hi}°</b>
            <i style={{ color: tempColor(cond.lo) }}>{cond.lo}°</i>
          </span>
          <div className="wx-metrics">
            {cond.precip != null && (
              <span className="cond-item" style={{ color: precipColor(cond.precip) }}>☂ {cond.precip}%</span>
            )}
            <span className="cond-item" style={{ color: windColor(cond.wind) }}>wind {cond.wind} mph</span>
            <span className="cond-item wx-sun">☀ {cond.sunrise} → {cond.sunset}</span>
          </div>
        </div>
      )}
    </div>
  );
}
