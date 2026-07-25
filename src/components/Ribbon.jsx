import React from 'react';
import { useTrip } from '../engine/store.js';
import { PHASES } from '../data/seedTrip.js';
import { fmtDayDate } from '../engine/dates.js';

export default function Ribbon() {
  const { state, dispatch, summary } = useTrip();
  const { trip, selectedDayId } = state;

  return (
    <nav className="ribbon" aria-label="Trip days">
      <button
        className={`seg overview-seg${selectedDayId === null ? ' active' : ''}`}
        onClick={() => dispatch({ type: 'select_day', dayId: null })}
      >
        Trip
      </button>
      {trip.days.map((d, i) => {
        const per = summary.perDay.find((p) => p.id === d.id);
        const worst = per?.warnings.some((w) => w.level === 'danger')
          ? 'danger'
          : per?.warnings.length ? 'warn' : null;
        const color = PHASES[d.phase]?.color ?? '#888';
        const dateNum = fmtDayDate(d.date);
        return (
          <button
            key={d.id}
            className={`seg${selectedDayId === d.id ? ' active' : ''}${d.anchor ? ' anchor' : ''}`}
            style={{ '--seg-color': color }}
            onClick={() => dispatch({ type: 'select_day', dayId: d.id })}
            title={d.title}
          >
            <span className="bar" />
            <span className="dw">{d.dow} {dateNum}{d.anchor ? ' ★' : ''}</span>
            <div className="ttl">{shortTitle(d)}</div>
            <div className="mi">{per ? `${per.miles} mi · ${(per.rideHours + per.stopHours).toFixed(0)}h` : `${d.miles} mi`}</div>
            {worst && <span className={`warn-dot${worst === 'warn' ? ' w' : ''}`} />}
          </button>
        );
      })}
    </nav>
  );
}

function shortTitle(d) {
  const t = d.title;
  return t.length > 26 ? t.slice(0, 25) + '…' : t;
}
