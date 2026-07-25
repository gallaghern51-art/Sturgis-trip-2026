import React, { useEffect, useState } from 'react';
import { useTrip } from '../engine/store.js';
import { tripSummary } from '../engine/tripEngine.js';

const KEY = 'sturgis.budget.v1';
const DEFAULTS = { gas: 3.6, mpg: 45, riders: 8, lodging: 95, food: 75, tickets: 150, misc: 200 };

export default function BudgetPanel() {
  const { state, routedLegsByDay } = useTrip();
  const { trip } = state;
  const [b, setB] = useState(() => {
    try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return DEFAULTS; }
  });
  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(b)); } catch { /* full */ }
  }, [b]);

  const summary = tripSummary(trip, routedLegsByDay);
  const nights = trip.meta.nights ?? 10;
  const days = trip.days.length;

  const perDay = trip.days.map((d) => {
    const miles = summary.perDay.find((p) => p.id === d.id)?.miles ?? d.miles;
    const gallons = miles / Math.max(1, b.mpg);
    return { d, miles, gallons, fuelRider: gallons * b.gas, fuelGroup: gallons * b.gas * b.riders };
  });
  const fuelRider = perDay.reduce((a, r) => a + r.fuelRider, 0);
  const lodgingRider = nights * b.lodging;
  const foodRider = days * b.food;
  const perRider = fuelRider + lodgingRider + foodRider + Number(b.tickets) + Number(b.misc);
  const $ = (n) => `$${Math.round(n).toLocaleString()}`;

  const num = (k) => ({
    type: 'number', value: b[k], min: 0, step: k === 'gas' ? 0.05 : 1,
    onChange: (e) => setB({ ...b, [k]: parseFloat(e.target.value) || 0 }),
  });

  return (
    <div>
      <div className="day-head">
        <div className="eyebrow">Fuel from routed miles · everything else adjustable</div>
        <h2>Budget & fuel</h2>
        <div className="datebar">
          <span className="chip">≈ {$(perRider)} per rider</span>
          <span className="chip">≈ {$(perRider * b.riders)} group total</span>
        </div>
      </div>

      <div className="section">
        <h3>Assumptions</h3>
        <div className="budget-grid">
          <label className="fld">Gas $/gal<input {...num('gas')} /></label>
          <label className="fld">MPG<input {...num('mpg')} /></label>
          <label className="fld">Riders<input {...num('riders')} /></label>
          <label className="fld">Lodging $/night/rider<input {...num('lodging')} /></label>
          <label className="fld">Food $/day/rider<input {...num('food')} /></label>
          <label className="fld">Tickets $/rider<input {...num('tickets')} /></label>
          <label className="fld">Misc $/rider<input {...num('misc')} /></label>
        </div>
      </div>

      <div className="section">
        <h3>Fuel by day <span className="cnt">{Math.round(summary.totalMiles)} routed mi · {b.mpg} mpg · ${b.gas.toFixed(2)}/gal</span></h3>
        <table className="scen-table">
          <thead><tr><th>Day</th><th>Miles</th><th>Gal/bike</th><th>$/rider</th><th>$ group</th></tr></thead>
          <tbody>
            {perDay.map(({ d, miles, gallons, fuelRider: fr, fuelGroup }) => (
              <tr key={d.id}>
                <td>{d.dow} 8/{d.date.slice(8).replace(/^0/, '')} <span className="scen-date">{d.title.slice(0, 30)}</span></td>
                <td>{Math.round(miles)}</td>
                <td>{gallons.toFixed(1)}</td>
                <td>{$(fr)}</td>
                <td>{$(fuelGroup)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="section">
        <h3>Per-rider total</h3>
        <table className="scen-table">
          <tbody>
            <tr><td>Fuel ({Math.round(summary.totalMiles)} mi)</td><td>{$(fuelRider)}</td></tr>
            <tr><td>Lodging ({nights} nights × ${b.lodging})</td><td>{$(lodgingRider)}</td></tr>
            <tr><td>Food ({days} days × ${b.food})</td><td>{$(foodRider)}</td></tr>
            <tr><td>Tickets (Buffalo Chip, museums, passes)</td><td>{$(b.tickets)}</td></tr>
            <tr><td>Misc / buffer</td><td>{$(b.misc)}</td></tr>
            <tr className="current"><td><b>Total per rider</b></td><td><b>{$(perRider)}</b></td></tr>
          </tbody>
        </table>
        <p style={{ fontSize: 12, color: 'var(--ink-faint)', marginTop: 10 }}>
          Plus the field guide's cash rule: $200/rider in small bills for rally week, and the $80
          America the Beautiful pass (covers Yellowstone, Glacier, Little Bighorn, Devils Tower).
        </p>
      </div>
    </div>
  );
}
