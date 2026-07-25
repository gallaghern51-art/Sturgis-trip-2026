import React, { useEffect, useState } from 'react';
import { fetchDayConditions } from '../engine/conditions.js';

export default function ConditionsCard({ day }) {
  const [cond, setCond] = useState(null);

  useEffect(() => {
    let dead = false;
    setCond(null);
    fetchDayConditions(day).then((c) => { if (!dead) setCond(c ?? { unavailable: true }); });
    return () => { dead = true; };
  }, [day.id, day.date]); // eslint-disable-line react-hooks/exhaustive-deps

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
        <div className="cond-card">
          <span className="cond-main">{cond.summary}</span>
          <span className="cond-item"><b>{cond.hi}°</b> / {cond.lo}°F</span>
          {cond.precip != null && <span className="cond-item">☂ {cond.precip}%</span>}
          <span className="cond-item">wind {cond.wind} mph</span>
          <span className="cond-item">☀ {cond.sunrise} → {cond.sunset}</span>
          <span className="cond-at">near {cond.at}</span>
        </div>
      )}
    </div>
  );
}
