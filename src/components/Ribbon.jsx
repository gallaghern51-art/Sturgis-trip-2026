import React, { useEffect, useRef } from 'react';
import { useTrip } from '../engine/store.js';
import { PHASES } from '../data/seedTrip.js';
import { fmtDayDate } from '../engine/dates.js';
import { useT, useTT, useUnits } from '../engine/settings.jsx';

export default function Ribbon() {
  const { state, dispatch, summary } = useTrip();
  const { trip, selectedDayId } = state;
  const ref = useRef(null);
  const t = useT();
  const tt = useTT();
  const u = useUnits();

  // The ribbon is the day switcher on a phone, where it always overflows —
  // keep the selected day in view when the selection changes from elsewhere.
  useEffect(() => {
    const el = ref.current?.querySelector('.seg.active');
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [selectedDayId]);

  return (
    <nav className="ribbon" aria-label="Trip days" ref={ref}>
      <button
        className={`seg overview-seg${selectedDayId === null ? ' active' : ''}`}
        onClick={() => dispatch({ type: 'select_day', dayId: null })}
      >
        {t('Trip')}
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
            <span className="dw">{d.dow} {dateNum}{d.anchor ? ' ★' : ''}<i className="dnum">D{i + 1}</i></span>
            <div className="ttl">{shortTitle({ ...d, title: tt(d.title) })}</div>
            <div className="mi">{per ? `${u.mi(per.miles)} · ${(per.rideHours + per.stopHours).toFixed(0)}h` : u.mi(d.miles)}</div>
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
