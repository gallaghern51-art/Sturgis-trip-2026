import React, { useEffect, useState } from 'react';
import {
  fetchDayConditions, conditionKind, conditionColor,
  tempColor, precipColor, windColor,
} from '../engine/conditions.js';

// Icons follow Apple's weather glyphs: each part carries its own color rather
// than the whole glyph taking the condition hue. A gray cloud with blue drops
// reads as rain instantly and stays legible on the black base — a single-hue
// glyph, and single-hue label text, did not.
const CLOUD_C = '#C9CFD8';
const SUN_C = '#FFD60A';
const DROP_C = '#4AA8FF';
const SNOW_C = '#EAF7FF';
const FOG_C = '#AEB4BD';

const S = (color, w = 1.6) => ({
  fill: 'none', stroke: color, strokeWidth: w, strokeLinecap: 'round', strokeLinejoin: 'round',
});
const CLOUD = <path d="M6.5 18h10a3.5 3.5 0 0 0 .3-7 5 5 0 0 0-9.5-1.2A3.9 3.9 0 0 0 6.5 18Z" {...S(CLOUD_C)} />;

function Sun({ r = 4.2 }) {
  return (
    <>
      <circle cx="12" cy="12" r={r} {...S(SUN_C, 1.8)} />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => {
        const rad = (a * Math.PI) / 180;
        const [x1, y1] = [12 + Math.cos(rad) * (r + 2.2), 12 + Math.sin(rad) * (r + 2.2)];
        const [x2, y2] = [12 + Math.cos(rad) * (r + 4.4), 12 + Math.sin(rad) * (r + 4.4)];
        return <line key={a} x1={x1} y1={y1} x2={x2} y2={y2} {...S(SUN_C, 1.8)} />;
      })}
    </>
  );
}

const drops = (xs) => xs.map((x) => (
  <line key={x} x1={x} y1="20" x2={x - 1} y2="22.6" {...S(DROP_C, 1.8)} />
));

const ICONS = {
  clear: <Sun />,
  mostlyClear: <Sun r={3.8} />,
  partly: (
    <>
      <circle cx="9.2" cy="8.4" r="3.3" {...S(SUN_C, 1.7)} />
      <path d="M8 19h8.5a3.2 3.2 0 0 0 0-6.4 4.6 4.6 0 0 0-8.8-.6A3.5 3.5 0 0 0 8 19Z" {...S(CLOUD_C)} />
    </>
  ),
  overcast: CLOUD,
  fog: (
    <>
      <path d="M6.5 14h10a3.5 3.5 0 0 0 .3-7 5 5 0 0 0-9.5-1.2A3.9 3.9 0 0 0 6.5 14Z" {...S(FOG_C)} />
      <line x1="5" y1="18" x2="19" y2="18" {...S(FOG_C, 1.8)} />
      <line x1="7.5" y1="21.5" x2="16.5" y2="21.5" {...S(FOG_C, 1.8)} />
    </>
  ),
  drizzle: <>{CLOUD}{drops([10.5, 14.5])}</>,
  rain: <>{CLOUD}{drops([9.5, 13, 16.5])}</>,
  heavyRain: <>{CLOUD}{drops([8.5, 12, 15.5, 19])}</>,
  showers: <>{CLOUD}{drops([10, 15])}</>,
  sleet: (
    <>
      {CLOUD}
      {drops([9.5])}
      <path d="M13.6 21.4h2.8M15 20v2.8" {...S(SNOW_C, 1.8)} />
    </>
  ),
  snow: (
    <>
      {CLOUD}
      <path d="M8.6 21.4h2.6M9.9 20.1v2.6" {...S(SNOW_C, 1.8)} />
      <path d="M13.8 21.4h2.6M15.1 20.1v2.6" {...S(SNOW_C, 1.8)} />
    </>
  ),
  storm: (
    <>
      {CLOUD}
      <path d="M13.2 19.4 10.6 23.2h2.9l-1 2.6" {...S(SUN_C, 1.8)} />
    </>
  ),
  unknown: <line x1="8" y1="12" x2="16" y2="12" {...S(FOG_C, 1.8)} />,
};

export default function ConditionsCard({ day }) {
  const [cond, setCond] = useState(null);

  useEffect(() => {
    let dead = false;
    setCond(null);
    fetchDayConditions(day).then((c) => { if (!dead) setCond(c ?? { unavailable: true }); });
    return () => { dead = true; };
  }, [day.id, day.date]); // eslint-disable-line react-hooks/exhaustive-deps

  const ready = cond && !cond.unavailable;
  const kind = ready ? conditionKind(cond.code) : 'unknown';

  return (
    <div className="section">
      <h3>Conditions <span className="cnt">{day.date} · Open-Meteo</span></h3>
      {!cond && <div className="cond-card">checking forecast…</div>}
      {cond?.unavailable && (
        <div className="cond-card dim">
          Forecast not in range yet — Open-Meteo covers ~16 days out. Check back closer to the date.
        </div>
      )}
      {ready && (
        <div className="cond-card wx" style={{ '--cond': conditionColor(cond.code) }}>
          <svg className="wx-icon" viewBox="0 0 24 26" aria-hidden="true">{ICONS[kind]}</svg>
          <div className="wx-head">
            <span className="wx-summary">{cond.summary}</span>
            <span className="cond-at">near {cond.at}</span>
          </div>
          {/* Apple's forecast-row range: low, gradient span, high. */}
          <div className="wx-range">
            <span className="wx-lo">{cond.lo}°</span>
            <span
              className="wx-bar"
              style={{ background: `linear-gradient(90deg, ${tempColor(cond.lo)}, ${tempColor(cond.hi)})` }}
            />
            <span className="wx-hi">{cond.hi}°</span>
          </div>
          <div className="wx-metrics">
            {cond.precip != null && (
              <span className="cond-item"><i style={{ color: precipColor(cond.precip), fontStyle: 'normal' }}>☂</i> {cond.precip}%</span>
            )}
            <span className="cond-item">wind <b style={{ color: windColor(cond.wind) }}>{cond.wind}</b> mph</span>
            <span className="cond-item wx-sun">☀ {cond.sunrise} → {cond.sunset}</span>
          </div>
        </div>
      )}
    </div>
  );
}
