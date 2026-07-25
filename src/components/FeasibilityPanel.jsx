import React from 'react';
import { useTrip } from '../engine/store.js';
import { tripFeasibility, fmtTime, fmtDur, gradeFor } from '../engine/timeline.js';
import { tripSummary } from '../engine/tripEngine.js';
import { PHASES } from '../data/seedTrip.js';

export default function FeasibilityPanel() {
  const { state, dispatch, routedLegsByDay } = useTrip();
  const { trip, scenarios } = state;
  const feas = tripFeasibility(trip, routedLegsByDay);
  const summary = tripSummary(trip, routedLegsByDay);

  return (
    <div>
      <div className="day-head">
        <div className="eyebrow">Engine-computed · routed miles · timed stop-by-stop</div>
        <h2>Feasibility study</h2>
        <div className="datebar">
          <span className={`grade grade-${feas.grade}`}>{feas.grade}</span>
          <span className="chip">{feas.overall}/100 overall</span>
          <span className="chip">{Math.round(summary.totalMiles)} mi routed</span>
        </div>
      </div>

      <div className="section">
        <h3>Day by day</h3>
        {trip.days.map((d) => {
          const p = feas.perDay.find((x) => x.id === d.id);
          const tl = p.timeline;
          const fails = p.issues.filter((i) => i.level === 'fail');
          const warns = p.issues.filter((i) => i.level === 'warn');
          const oks = p.issues.filter((i) => i.level === 'ok');
          return (
            <div key={d.id} className="feas-day">
              <button className="feas-head" onClick={() => dispatch({ type: 'select_day', dayId: d.id })}>
                <span className="ph" style={{ background: PHASES[d.phase]?.color }} />
                <span className="fd-date">{d.dow} 8/{d.date.slice(8).replace(/^0/, '')}</span>
                <span className="fd-title">{d.title}</span>
                <span className="fd-times">{fmtTime(tl.departMin)} → {fmtTime(tl.endMin)} · {fmtDur(tl.durMin)}</span>
                <span className={`grade grade-${gradeFor(p.score)}`}>{gradeFor(p.score)}</span>
              </button>
              {[...fails, ...warns].map((i, k) => (
                <div key={k} className={`warning${i.level === 'fail' ? ' danger' : ''}`}>⚠ {i.text}</div>
              ))}
              {oks.map((i, k) => (
                <div key={`ok${k}`} className="feas-ok">✓ {i.text}</div>
              ))}
            </div>
          );
        })}
      </div>

      <div className="section">
        <h3>Saved permutations <span className="cnt">{scenarios.length}</span></h3>
        {scenarios.length === 0 && (
          <p style={{ fontSize: 12.5, color: 'var(--ink-dim)' }}>
            None yet. Use “Save scenario” in the top bar — or ask the optimizer to rebuild the trip
            and save the result — then compare permutations here and swap between them.
          </p>
        )}
        {scenarios.length > 0 && (
          <table className="scen-table">
            <thead>
              <tr><th>Plan</th><th>Miles</th><th>Feas.</th><th></th><th></th></tr>
            </thead>
            <tbody>
              <tr className="current">
                <td>Current working plan</td>
                <td>{Math.round(summary.totalMiles)}</td>
                <td><span className={`grade grade-${feas.grade}`}>{feas.grade} {feas.overall}</span></td>
                <td colSpan={2} />
              </tr>
              {scenarios.map((s) => {
                const sf = tripFeasibility(s.trip, routedLegsByDay);
                const ss = tripSummary(s.trip, routedLegsByDay);
                return (
                  <tr key={s.id}>
                    <td>{s.name}<div className="scen-date">{new Date(s.savedAt).toLocaleDateString()} {new Date(s.savedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</div></td>
                    <td>{Math.round(ss.totalMiles)}</td>
                    <td><span className={`grade grade-${sf.grade}`}>{sf.grade} {sf.overall}</span></td>
                    <td><button className="btn" onClick={() => { if (confirm(`Load “${s.name}” as the working plan? Current plan goes on the undo stack.`)) dispatch({ type: 'load_scenario', id: s.id }); }}>Load</button></td>
                    <td><button className="btn danger-ghost" onClick={() => { if (confirm(`Delete scenario “${s.name}”?`)) dispatch({ type: 'delete_scenario', id: s.id }); }}>✕</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <p style={{ fontSize: 12, color: 'var(--ink-faint)', marginTop: 14 }}>
        Method: departure times from each day's plan, routed leg durations (OSRM, +15% group pace),
        planned time-on-ground at every stop, checked against hard gates (park entrances, Piccola 1:00,
        bike return), the 180/200-mi fuel range, daylight (~8:30 PM), and booking status. Scenario rows
        use cached routing where available and field-guide mileage otherwise.
      </p>
    </div>
  );
}
