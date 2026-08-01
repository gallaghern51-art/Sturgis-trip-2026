import React, { useEffect, useState } from 'react';
import {
  fetchDayConditions, conditionKind, conditionColor,
  tempColor, precipColor, windColor,
} from '../engine/conditions.js';
import { useT, useTT, useUnits } from '../engine/settings.jsx';
import WeatherIcon from './WeatherIcon.jsx';

export default function ConditionsCard({ day }) {
  const [cond, setCond] = useState(null);
  const t = useT();
  const tt = useTT();
  const u = useUnits();

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
      <h3>{t('Conditions')} <span className="cnt">{day.date} · Open-Meteo</span></h3>
      {!cond && <div className="cond-card">{t('checking forecast…')}</div>}
      {cond?.unavailable && (
        <div className="cond-card dim">
          {t('Forecast not in range yet — Open-Meteo covers ~16 days out. Check back closer to the date.')}
        </div>
      )}
      {ready && (
        <div className="cond-card wx" style={{ '--cond': conditionColor(cond.code) }}>
          <WeatherIcon code={cond.code} className="wx-icon" />
          <div className="wx-head">
            <span className="wx-summary">{t(cond.summary)}</span>
            <span className="cond-at">{t('near')} {tt(cond.at)}</span>
          </div>
          {/* Apple's forecast-row range: low, gradient span, high. */}
          <div className="wx-range">
            <span className="wx-lo">{u.temp(cond.lo)}</span>
            <span
              className="wx-bar"
              style={{ background: `linear-gradient(90deg, ${tempColor(cond.lo)}, ${tempColor(cond.hi)})` }}
            />
            <span className="wx-hi">{u.temp(cond.hi)}</span>
          </div>
          <div className="wx-metrics">
            {cond.precip != null && (
              <span className="cond-item"><i style={{ color: precipColor(cond.precip), fontStyle: 'normal' }}>☂</i> {cond.precip}%</span>
            )}
            <span className="cond-item">{t('wind')} <b style={{ color: windColor(cond.wind) }}>{u.speed(cond.wind)}</b></span>
            <span className="cond-item wx-sun">☀ {cond.sunrise} → {cond.sunset}</span>
          </div>
        </div>
      )}
    </div>
  );
}
