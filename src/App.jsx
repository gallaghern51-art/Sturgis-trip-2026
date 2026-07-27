import React, { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { TripContext, reducer, initialState } from './engine/store.js';
import { routeDay } from './engine/routing.js';
import { tripSummary } from './engine/tripEngine.js';
import { useIsMobile } from './hooks/useMediaQuery.js';
import Ribbon from './components/Ribbon.jsx';
import MapView from './components/MapView.jsx';
import DayPanel from './components/DayPanel.jsx';
import OverviewPanel from './components/OverviewPanel.jsx';
import ChatPanel from './components/ChatPanel.jsx';
import DetailModal from './components/DetailModal.jsx';
import NewTripModal from './components/NewTripModal.jsx';
import RideMode from './components/RideMode.jsx';
import FeasibilityPanel from './components/FeasibilityPanel.jsx';
import BudgetPanel from './components/BudgetPanel.jsx';
import PackingList from './components/PackingList.jsx';
import SettingsModal from './components/SettingsModal.jsx';
import { useAutoTranslate } from './engine/autoTranslate.js';
import { useT, useUnits } from './engine/settings.jsx';

// Masthead flags: the crew (US ride, Chilean riders) plus the four states the
// route crosses. Assets live in public/flags — the user supplied them.
const CREW_FLAGS = [
  { src: '/flags/us.webp', alt: 'USA', title: 'United States' },
  { src: '/flags/cl.webp', alt: 'CHI', title: 'Chile' },
];
const STATE_FLAGS = [
  { src: '/flags/mt.svg', alt: 'MT', title: 'Montana' },
  { src: '/flags/id.svg', alt: 'ID', title: 'Idaho' },
  { src: '/flags/wy.svg', alt: 'WY', title: 'Wyoming' },
  { src: '/flags/sd.svg', alt: 'SD', title: 'South Dakota' },
];

// Language selection is the whole instruction: this watches for a language the
// trip is not translated into yet and fills it in, showing progress rather than
// asking for a click. Lives inside TripContext.Provider so it can read the trip.
function TranslationStatus() {
  const { progress } = useAutoTranslate();
  if (!progress) return null;
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <span className="xlate-pill" title={`${progress.done}/${progress.total}`}>
      <span className="xlate-bar"><i style={{ width: `${pct}%` }} /></span>
      translating {progress.done}/{progress.total}
    </span>
  );
}

export default function App() {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const [routes, setRoutes] = useState({}); // dayId -> {legs, geometry}
  const [chatOpen, setChatOpen] = useState(true);
  const [view, setView] = useState('plan'); // plan | feas | budget
  const [newTripOpen, setNewTripOpen] = useState(false);
  const [rideOpen, setRideOpen] = useState(false);
  const [packingOpen, setPackingOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const t = useT();
  const u = useUnits();
  const isMobile = useIsMobile();
  const [mobileTab, setMobileTab] = useState('map'); // map | panel | chat
  const [menuOpen, setMenuOpen] = useState(false);
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

  // On a phone the side panel and the optimizer are tabs, not columns. The chat
  // stays mounted behind the other tabs so a conversation survives tab switches.
  const openChat = () => (isMobile ? setMobileTab('chat') : setChatOpen(true));
  const closeChat = () => (isMobile ? setMobileTab('map') : setChatOpen(false));
  // Anything that jumps the reader into the side panel (a modal's "open this
  // day", a feasibility row) has to bring the panel on screen on mobile.
  const showPanel = () => { if (isMobile) setMobileTab('panel'); };
  const ui = { isMobile, mobileTab, setMobileTab, showPanel };

  useEffect(() => { if (!isMobile) setMenuOpen(false); }, [isMobile]);

  // A queued optimizer question (from a feasibility recommendation) opens the chat.
  useEffect(() => {
    if (state.chatAsk) openChat();
  }, [state.chatAsk]); // eslint-disable-line react-hooks/exhaustive-deps

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

  useEffect(() => {
    document.title = `${state.trip.meta.title} · Roadbook`;
  }, [state.trip.meta.title]);

  const panelLabel = selectedDay ? selectedDay.dow : view === 'feas' ? 'Feasibility' : view === 'budget' ? 'Budget' : 'Trip';

  return (
    <TripContext.Provider value={{ state, dispatch, routes, routedLegsByDay, summary, ui }}>
      <div className={`app${isMobile ? ' mobile' : ''}`}>
        <header className="masthead">
          <div className="mast-id">
            <h1 className="brand">ROAD<span className="yr">BOOK</span></h1>
            <span className="sub">
              {state.trip.meta.title} · {u.mi(summary.totalMiles)} · {state.trip.meta.riders} {t('riders')} · {state.trip.days.length} {t('days')}
              <span className="mast-flags">
                {CREW_FLAGS.map((f) => <img key={f.alt} className="flag crew" src={f.src} alt={f.alt} title={f.title} loading="lazy" />)}
                {/* state flags only make sense on the Sturgis route */}
                {/STURGIS/i.test(state.trip.meta.title) && (
                  <span className="state-flags">
                    {STATE_FLAGS.map((f) => <img key={f.alt} className="flag" src={f.src} alt={f.alt} title={f.title} loading="lazy" />)}
                  </span>
                )}
              </span>
              <TranslationStatus />
            </span>
          </div>
          <span className="spacer" />
          <button
            className="btn menu-btn"
            aria-expanded={menuOpen}
            aria-controls="mast-actions"
            onClick={() => setMenuOpen((v) => !v)}
          >☰ {t('Menu')}</button>
          <div
            id="mast-actions"
            className={`actions${menuOpen ? ' open' : ''}`}
            onClick={(e) => { if (e.target.closest?.('button')) setMenuOpen(false); }}
          >
            <div className="sheet-head">
              <span className="sheet-title">{t('Trip controls')}</span>
              <button className="btn" aria-label="Close menu" onClick={() => setMenuOpen(false)}>✕</button>
            </div>
            <select
              className="scen-select"
              aria-label="Trips"
              value=""
              onChange={(e) => {
                const v = e.target.value;
                setMenuOpen(false);
                if (v === '__new') setNewTripOpen(true);
                else if (v === '__delete') {
                  if (state.lib.trips.length > 1 && confirm(`Delete trip “${state.trip.meta.title}” and all its scenarios? This cannot be undone.`)) {
                    dispatch({ type: 'delete_trip', id: state.lib.activeId });
                  }
                } else if (v) dispatch({ type: 'switch_trip', id: v });
                e.target.value = '';
              }}
            >
              <option value="">{t('Trips')} ({state.lib.trips.length})…</option>
              <option value="__new">＋ {t('New trip')}</option>
              {state.lib.trips.map((t) => (
                <option key={t.id} value={t.id}>{t.id === state.lib.activeId ? '● ' : ''}{t.name}</option>
              ))}
              {state.lib.trips.length > 1 && <option value="__delete">{t('Delete current trip')}</option>}
            </select>
            <select
              className="scen-select"
              aria-label="Scenarios"
              value=""
              onChange={(e) => {
                const v = e.target.value;
                setMenuOpen(false);
                if (v === '__save') {
                  const name = prompt('Name this trip permutation:');
                  if (name) dispatch({ type: 'save_scenario', name });
                } else if (v) {
                  if (confirm('Load this saved permutation as the working plan? Current plan goes on the undo stack.')) dispatch({ type: 'load_scenario', id: v });
                }
                e.target.value = '';
              }}
            >
              <option value="">{t('Scenarios')} ({state.scenarios.length})…</option>
              <option value="__save">＋ {t('Save current as scenario')}</option>
              {state.scenarios.map((s) => <option key={s.id} value={s.id}>{t('Load')}: {s.name}</option>)}
            </select>
            {/* Optimizer belongs with the other panel switches — it is a view of
                the trip, not a file action. */}
            <div className="viewtabs">
              {[['plan', 'Plan'], ['feas', 'Feasibility'], ['budget', 'Budget']].map(([v, label]) => (
                <button key={v} className={view === v ? 'active' : ''} onClick={() => { setView(v); dispatch({ type: 'select_day', dayId: null }); showPanel(); }}>{t(label)}</button>
              ))}
              <button className={`opt-tab${chatOpen ? ' active' : ''}`} onClick={() => setChatOpen((v) => !v)}>{t('Optimizer')}</button>
            </div>
            {/* Trip admin, then Ride last so the one button you press at a
                kickstand sits at the end of the row and reads as the action. */}
            <button className="btn" onClick={() => setPackingOpen(true)}>{t('Packing')}</button>
            <button className="btn" onClick={() => dispatch({ type: 'undo' })} disabled={!state.history.length}>{t('Undo')}</button>
            <button className="btn" onClick={exportJson}>{t('Export')}</button>
            <button className="btn" onClick={() => fileRef.current?.click()}>{t('Import')}</button>
            <input ref={fileRef} type="file" accept=".json" style={{ display: 'none' }} onChange={importJson} />
            <button className="btn danger-ghost" onClick={() => { if (confirm('Reset this trip to the original Sturgis field guide template?')) dispatch({ type: 'reset' }); }}>{t('Reset')}</button>
            <button className="btn" onClick={() => setSettingsOpen(true)}>{t('Settings')}</button>
            <button className="btn primary ride-btn" onClick={() => { setMenuOpen(false); setRideOpen(true); }}>
              <svg viewBox="0 0 16 16" className="play-tri" aria-hidden="true"><path d="M4 2.5v11l9.5-5.5z" fill="currentColor" /></svg>
              {t('Ride')}
            </button>
          </div>
        </header>
        {menuOpen && <div className="sheet-backdrop" onClick={() => setMenuOpen(false)} />}
        <Ribbon />
        <div className={`main${!isMobile && chatOpen ? ' chat-open' : ''}`} data-tab={mobileTab}>
          <MapView />
          <aside className="side">
            <div className="side-inner">
              {selectedDay ? <DayPanel day={selectedDay} /> : view === 'feas' ? <FeasibilityPanel /> : view === 'budget' ? <BudgetPanel /> : <OverviewPanel routes={routes} />}
            </div>
          </aside>
          {(isMobile || chatOpen) && <ChatPanel onClose={closeChat} />}
        </div>
        {isMobile && (
          <nav className="tabnav" aria-label="Views">
            <button className={mobileTab === 'map' ? 'active' : ''} onClick={() => setMobileTab('map')} aria-current={mobileTab === 'map'}>{t('Map')}</button>
            <button className={mobileTab === 'panel' ? 'active' : ''} onClick={() => setMobileTab('panel')} aria-current={mobileTab === 'panel'}>{t(panelLabel)}</button>
            <button className={mobileTab === 'chat' ? 'active' : ''} onClick={() => setMobileTab('chat')} aria-current={mobileTab === 'chat'}>{t('Optimizer')}</button>
          </nav>
        )}
        <DetailModal />
        {newTripOpen && <NewTripModal onClose={() => setNewTripOpen(false)} />}
        {rideOpen && <RideMode onClose={() => setRideOpen(false)} />}
        {packingOpen && <PackingList onClose={() => setPackingOpen(false)} />}
        {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      </div>
    </TripContext.Provider>
  );
}
