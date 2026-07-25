import React, { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { TripContext, reducer, initialState } from './engine/store.js';
import { routeDay } from './engine/routing.js';
import { tripSummary } from './engine/tripEngine.js';
import Ribbon from './components/Ribbon.jsx';
import MapView from './components/MapView.jsx';
import DayPanel from './components/DayPanel.jsx';
import OverviewPanel from './components/OverviewPanel.jsx';
import ChatPanel from './components/ChatPanel.jsx';
import DetailModal from './components/DetailModal.jsx';
import FeasibilityPanel from './components/FeasibilityPanel.jsx';
import BudgetPanel from './components/BudgetPanel.jsx';

export default function App() {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const [routes, setRoutes] = useState({}); // dayId -> {legs, geometry}
  const [chatOpen, setChatOpen] = useState(true);
  const [view, setView] = useState('plan'); // plan | feas | budget
  const fileRef = useRef(null);

  // Route every day whenever its waypoint sequence changes.
  const routeSignature = state.trip.days
    .map((d) => d.id + ':' + d.waypoints.map((w) => `${w.lat.toFixed(4)},${w.lng.toFixed(4)}`).join(';'))
    .join('|');
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const day of state.trip.days) {
        const r = await routeDay(day);
        if (cancelled) return;
        setRoutes((prev) => ({ ...prev, [day.id]: r }));
      }
    })();
    return () => { cancelled = true; };
  }, [routeSignature]); // eslint-disable-line react-hooks/exhaustive-deps

  const routedLegsByDay = useMemo(() => {
    const out = {};
    for (const [id, r] of Object.entries(routes)) out[id] = r.legs;
    return out;
  }, [routes]);

  const summary = useMemo(() => tripSummary(state.trip, routedLegsByDay), [state.trip, routedLegsByDay]);
  const selectedDay = state.trip.days.find((d) => d.id === state.selectedDayId) ?? null;

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(state.trip, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'sturgis-2026-trip.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const importJson = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const trip = JSON.parse(await file.text());
      if (!trip?.days?.length) throw new Error('not a trip file');
      dispatch({ type: 'import', trip });
    } catch (err) {
      alert(`Could not import: ${err.message}`);
    }
    e.target.value = '';
  };

  return (
    <TripContext.Provider value={{ state, dispatch, routes, routedLegsByDay, summary }}>
      <div className="app">
        <header className="masthead">
          <h1>STURGIS <span className="yr">2026</span></h1>
          <span className="sub">La Expedición Chilena · {Math.round(summary.totalMiles)} mi · {state.trip.meta.riders} riders · Aug 7–17</span>
          <span className="spacer" />
          <div className="actions">
            <select
              className="scen-select"
              value=""
              onChange={(e) => {
                const v = e.target.value;
                if (v === '__save') {
                  const name = prompt('Name this trip permutation:');
                  if (name) dispatch({ type: 'save_scenario', name });
                } else if (v) {
                  if (confirm('Load this saved permutation as the working plan? Current plan goes on the undo stack.')) dispatch({ type: 'load_scenario', id: v });
                }
                e.target.value = '';
              }}
            >
              <option value="">Scenarios ({state.scenarios.length})…</option>
              <option value="__save">＋ Save current as scenario</option>
              {state.scenarios.map((s) => <option key={s.id} value={s.id}>Load: {s.name}</option>)}
            </select>
            <button className="btn" onClick={() => { setView(view === 'feas' ? 'plan' : 'feas'); dispatch({ type: 'select_day', dayId: null }); }}>{view === 'feas' ? 'Plan' : 'Feasibility'}</button>
            <button className="btn" onClick={() => { setView(view === 'budget' ? 'plan' : 'budget'); dispatch({ type: 'select_day', dayId: null }); }}>{view === 'budget' ? 'Plan' : 'Budget'}</button>
            <button className="btn" onClick={() => dispatch({ type: 'undo' })} disabled={!state.history.length}>Undo</button>
            <button className="btn" onClick={exportJson}>Export</button>
            <button className="btn" onClick={() => fileRef.current?.click()}>Import</button>
            <input ref={fileRef} type="file" accept=".json" style={{ display: 'none' }} onChange={importJson} />
            <button className="btn danger-ghost" onClick={() => { if (confirm('Reset the whole trip to the original field guide?')) dispatch({ type: 'reset' }); }}>Reset</button>
            <button className="btn gold" onClick={() => setChatOpen((v) => !v)}>{chatOpen ? 'Hide' : ''} Optimizer</button>
          </div>
        </header>
        <Ribbon />
        <div className={`main${chatOpen ? ' chat-open' : ''}`}>
          <MapView />
          <aside className="side">
            <div className="side-inner">
              {selectedDay ? <DayPanel day={selectedDay} /> : view === 'feas' ? <FeasibilityPanel /> : view === 'budget' ? <BudgetPanel /> : <OverviewPanel routes={routes} />}
            </div>
          </aside>
          {chatOpen && <ChatPanel onClose={() => setChatOpen(false)} />}
        </div>
        <DetailModal />
      </div>
    </TripContext.Provider>
  );
}
