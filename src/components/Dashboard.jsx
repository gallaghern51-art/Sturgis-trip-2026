import React from 'react';
import { useTrip } from '../engine/store.js';
import { tripFeasibility } from '../engine/timeline.js';
import { fmtLongDate } from '../engine/dates.js';
import { translationCoverage } from '../i18n/collect.js';
import { useT, useTT, useUnits, useSettings } from '../engine/settings.jsx';

// The hub. The top bar had grown to eleven controls of five different kinds —
// view switches, file actions, modals, settings, and Ride — all weighted the
// same. This gives them one home, grouped by what they are for, and each card
// carries live state so it is a status board as much as a launcher.

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
  const u = useUnits();
  const { lang } = useSettings();

  const feas = tripFeasibility(trip, routedLegsByDay);
  const openBookings = (trip.reserveNow ?? []).filter((r) => !r.done).length;
  const dangerDays = summary.perDay.filter((p) => p.warnings.some((w) => w.level === 'danger')).length;
  const first = trip.days[0];
  const last = trip.days[trip.days.length - 1];
  const coverage = lang === 'en' ? null : translationCoverage(trip, lang);

  return (
    <div className="dashboard">
      <div className="day-head">
        <div className="eyebrow">{tt(trip.meta.subtitle)}</div>
        <h2>{trip.meta.title}</h2>
        <div className="datebar">
          <span className="chip">{first?.dow} {fmtLongDate(first?.date ?? trip.meta.startDate)} → {last?.dow} {fmtLongDate(last?.date ?? trip.meta.startDate)}</span>
          <span className="chip">{u.mi(summary.totalMiles)}</span>
          <span className="chip">{trip.days.length} {t('days')}</span>
          <span className="chip">{trip.meta.riders} {t('riders')}</span>
        </div>
      </div>

      {trip.meta.summary && <p className="trip-summary">{tt(trip.meta.summary)}</p>}

      <div className="section">
        <h3>{t('Plan the trip')}</h3>
        <div className="dash-grid">
          <Card
            label={t('Planner')}
            meta={`${trip.days.length} ${t('days')} · ${u.mi(summary.totalMiles)}`}
            note={t('Day by day, stops, food, lodging')}
            onClick={() => onOpen('plan')}
          />
          <Card
            label={t('Feasibility')}
            meta={`${feas.grade} · ${feas.overall}/100`}
            note={dangerDays ? `${dangerDays} ${t('days need attention')}` : t('No hard failures')}
            accent={dangerDays ? 'warn' : ''}
            onClick={() => onOpen('feas')}
          />
          <Card
            label={t('Budget')}
            meta={`${trip.meta.riders} ${t('riders')}`}
            note={t('Fuel, lodging, food, tickets')}
            onClick={() => onOpen('budget')}
          />
          <Card
            label={t('Optimizer')}
            meta={t('AI')}
            note={t('Ask for changes, preview, apply')}
            accent="accent"
            onClick={() => onOpen('optimizer')}
          />
        </div>
      </div>

      <div className="section">
        <h3>{t('Get ready')}</h3>
        <div className="dash-grid">
          <Card
            label={t('Packing list')}
            note={t('Per rider, saved on this device')}
            onClick={() => onOpen('packing')}
          />
          <Card
            label={t('Reserve these now')}
            meta={openBookings ? `${openBookings} ${t('open')}` : t('All booked')}
            note={t('Bookings still to make')}
            accent={openBookings ? 'warn' : ''}
            onClick={() => onOpen('bookings')}
          />
          <Card
            label={t('Ride')}
            meta={t('GPS')}
            note={t('Turn-by-turn, ahead or behind plan')}
            accent="primary"
            onClick={() => onOpen('ride')}
          />
          <Card
            label={t('Settings')}
            meta={coverage && coverage.missing.length ? `${coverage.done}/${coverage.total}` : undefined}
            note={t('Language, theme, units')}
            onClick={() => onOpen('settings')}
          />
        </div>
      </div>

      <div className="section">
        <h3>{t('Trip file')}</h3>
        <div className="dash-grid">
          <Card label={t('Export')} note={t('Save this trip as JSON')} onClick={() => onOpen('export')} />
          <Card label={t('Import')} note={t('Load a trip from JSON')} onClick={() => onOpen('import')} />
          <Card label={t('New trip')} note={t('From scratch, a description, or the template')} onClick={() => onOpen('new')} />
          <Card label={t('Reset')} note={t('Back to the bundled template')} accent="danger" onClick={() => onOpen('reset')} />
        </div>
      </div>
    </div>
  );
}
