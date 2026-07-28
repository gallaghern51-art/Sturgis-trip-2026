import React from 'react';
import { useTrip } from '../engine/store.js';
import { tripFeasibility } from '../engine/timeline.js';
import { fmtLongDate } from '../engine/dates.js';
import { useT, useTT } from '../engine/settings.jsx';

// The trip's home: identity, health, and the file drawer — and deliberately
// nothing else. Every PAGE lives in the bottom bar exactly once; the cards
// that used to relaunch Planner/Feasibility/Budget/Optimizer/Packing/Settings
// from here were a second copy of that bar, and Ride a second copy of the
// masthead button. The two status chips deep-link because they are statuses,
// not menu entries — tapping "2 days need attention" opens feasibility the way
// tapping a notification opens the thing it is about.

function Card({ onClick, label, meta, note, accent }) {
  return (
    <button className={`dash-card${accent ? ` ${accent}` : ''}`} onClick={onClick}>
      <span className="dc-label">{label}</span>
      {meta && <span className="dc-meta">{meta}</span>}
      {note && <span className="dc-note">{note}</span>}
    </button>
  );
}

export default function Dashboard({ onOpen }) {
  const { state, summary, routedLegsByDay } = useTrip();
  const { trip } = state;
  const t = useT();
  const tt = useTT();

  const feas = tripFeasibility(trip, routedLegsByDay);
  const openBookings = (trip.reserveNow ?? []).filter((r) => !r.done).length;
  const dangerDays = summary.perDay.filter((p) => p.warnings.some((w) => w.level === 'danger')).length;
  const first = trip.days[0];
  const last = trip.days[trip.days.length - 1];

  return (
    <div className="dashboard">
      <div className="day-head">
        <div className="eyebrow">{tt(trip.meta.subtitle)}</div>
        <h2>{trip.meta.title}</h2>
        {/* No miles/riders/days chips: the masthead two inches up already says
            that. The dates are here because it does not. */}
        <div className="datebar">
          <span className="chip">{first?.dow} {fmtLongDate(first?.date ?? trip.meta.startDate)} → {last?.dow} {fmtLongDate(last?.date ?? trip.meta.startDate)}</span>
          <span
            className={`chip link ${dangerDays ? 'warn' : 'ok'}`}
            role="button"
            tabIndex={0}
            onClick={() => onOpen('feas')}
            onKeyDown={(e) => e.key === 'Enter' && onOpen('feas')}
          >
            {feas.grade} · {feas.overall}/100{dangerDays ? ` · ${dangerDays} ${t('days need attention')}` : ''}
          </span>
          {openBookings > 0 && (
            <span
              className="chip link warn"
              role="button"
              tabIndex={0}
              onClick={() => onOpen('bookings')}
              onKeyDown={(e) => e.key === 'Enter' && onOpen('bookings')}
            >
              {openBookings} {t('open')} · {t('Reserve these now')}
            </span>
          )}
        </div>
      </div>

      {trip.meta.summary && <p className="trip-summary">{tt(trip.meta.summary)}</p>}

      <div className="section">
        <h3>{t('Trip file')}</h3>
        <div className="dash-grid">
          <Card label={t('New trip')} note={t('From scratch, a description, or the template')} onClick={() => onOpen('new')} />
          <Card
            label={t('Scenarios')}
            meta={state.scenarios.length ? `${state.scenarios.length} ${t('saved')}` : undefined}
            note={t('Save this plan as a named permutation')}
            onClick={() => onOpen('save-scenario')}
          />
          {state.lib.trips.length > 1 && (
            <Card
              label={t('Switch trip')}
              meta={`${state.lib.trips.length} ${t('in the library')}`}
              note={t('Change which trip you are planning')}
              onClick={() => onOpen('switch-trip')}
            />
          )}
          <Card label={t('Export')} note={t('Save this trip as JSON')} onClick={() => onOpen('export')} />
          <Card label={t('Import')} note={t('Load a trip from JSON')} onClick={() => onOpen('import')} />
          <Card label={t('Reset')} note={t('Back to the bundled template')} accent="danger" onClick={() => onOpen('reset')} />
        </div>
      </div>
    </div>
  );
}
