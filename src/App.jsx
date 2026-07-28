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
import Dashboard from './components/Dashboard.jsx';
import { useAutoTranslate } from './engine/autoTranslate.js';
import { useT, useTT, useUnits } from './engine/settings.jsx';

// The phone's bottom bar: every page once, related work adjacent. Map first,
// the hub, then planning (Planner and Optimizer share an elbow), then the
// checks, then prep. Ride is NOT here — it is the masthead's one action.
const SEATS = [
  ['map', 'Map'],
  ['dash', 'Dashboard'],
  ['plan', 'Planner'],
  ['optimizer', 'Optimizer'],
  ['feas', 'Feasibility'],
  ['budget', 'Budget'],
  ['packing', 'Packing'],
  ['settings', 'Settings'],
];

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
  const [view, setView] = useState('dash'); // dash | plan | feas | budget
  const [newTripOpen, setNewTripOpen] = useState(false);
  const [rideOpen, setRideOpen] = useState(false);
  const [packingOpen, setPackingOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const t = useT();
  const tt = useTT();
  const u = useUnits();
  const isMobile = useIsMobile();
  const [mobileTab, setMobileTab] = useState('map'); // map | panel | chat
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


  // Every dashboard card routes through here, so the hub stays declarative and
  // there is one list of what the app can be asked to do.
  const openTarget = (target) => {
    switch (target) {
      case 'dash': case 'plan': case 'feas': case 'budget':
        setView(target); dispatch({ type: 'select_day', dayId: null }); showPanel(); break;
      case 'optimizer':
        setChatOpen(true); if (isMobile) setMobileTab('chat'); break;
      case 'packing': setPackingOpen(true); break;
      case 'settings': setSettingsOpen(true); break;
      case 'ride': setRideOpen(true); break;
      case 'new': setNewTripOpen(true); break;
      case 'export': exportJson(); break;
      case 'import': fileRef.current?.click(); break;
      // Bookings live on the trip overview, so send the rider to it rather than
      // duplicating the list in a second place.
      case 'bookings': setView('plan'); dispatch({ type: 'select_day', dayId: null }); showPanel(); break;
      case 'reset':
        if (confirm('Reset this trip to the bundled Sturgis template? Your edits to this trip are discarded.')) dispatch({ type: 'reset' });
        break;
      case 'save-scenario': {
        const name = prompt('Name this trip permutation:');
        if (name) dispatch({ type: 'save_scenario', name });
        break;
      }
      case 'switch-trip': {
        // A prompt is honest for a handful of trips; it becomes a picker when the
        // library is big enough to need one.
        const others = state.lib.trips.filter((x) => x.id !== state.lib.activeId);
        if (!others.length) return;
        const list = others.map((x, i) => `${i + 1}. ${x.name}`).join('\n');
        const pick = prompt(`Switch to which trip?\n\n${list}`);
        const idx = Number(pick) - 1;
        if (others[idx]) dispatch({ type: 'switch_trip', id: others[idx].id });
        break;
      }
      default: break;
    }
  };

  // One name for the current view, shown in the bar and on the mobile tab.
  const viewLabel = selectedDay ? tt(selectedDay.title)
    : view === 'dash' ? 'Dashboard'
    : view === 'feas' ? 'Feasibility'
    : view === 'budget' ? 'Budget'
    : 'Planner';
  // Which seat in the bottom bar is lit. Packing and Settings are modals over
  // the current view, so they never take the light; an open day belongs to the
  // Planner.
  const seatActive = mobileTab === 'map' ? 'map'
    : mobileTab === 'chat' ? 'optimizer'
    : selectedDay ? 'plan'
    : view;
  const activeSeatRef = useRef(null);
  useEffect(() => {
    activeSeatRef.current?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [seatActive]);

  return (
    <TripContext.Provider value={{ state, dispatch, routes, routedLegsByDay, summary, ui }}>
      <div className={`app${isMobile ? ' mobile' : ''}`}>
        <header className="masthead">
          <div className="mast-id">
            <h1 className="brand">
              <button
                onClick={() => { setView('dash'); dispatch({ type: 'select_day', dayId: null }); showPanel(); }}
                title={t('Dashboard')}
              >ROAD<span className="yr">BOOK</span></button>
            </h1>
            <span className="sub">
              {/* title and stats are separate spans so a narrow screen breaks
                  between them rather than mid-phrase ("7 / RIDERS") */}
              <span className="mast-trip">{state.trip.meta.title}</span>
              <span className="mast-stats">
                {u.mi(summary.totalMiles)} · {state.trip.meta.riders} {t('riders')} · {state.trip.days.length} {t('days')}
              </span>
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
          {/* Navigation lives on the dashboard, not here. Five view tabs up top
              duplicated five dashboard cards; the brand is the way home and the
              hub is the switcher. What is left is contextual: Undo appears only
              when there is something to undo, and Ride is the app's one action. */}
          <div className="actions">
            <input ref={fileRef} type="file" accept=".json" style={{ display: 'none' }} onChange={importJson} />
            {state.history.length > 0 && (
              <button className="btn" onClick={() => dispatch({ type: 'undo' })}>{t('Undo')}</button>
            )}
            <span className="mast-where">{t(viewLabel)}</span>
            <button className="btn primary ride-btn" onClick={() => setRideOpen(true)}>
              <svg viewBox="0 0 16 16" className="play-tri" aria-hidden="true"><path d="M4 2.5v11l9.5-5.5z" fill="currentColor" /></svg>
              {t('Ride')}
            </button>
          </div>
        </header>
        <Ribbon />
        <div className={`main${!isMobile && chatOpen ? ' chat-open' : ''}`} data-tab={mobileTab}>
          <MapView />
          <aside className="side">
            <div className="side-inner">
              {/* The hub has to be reachable from anywhere it sent you. On a
                  phone the bottom tab renames itself to the current view, so
                  without this there is no way back to the dashboard at all. */}
              {/* Desktop only: the phone has the hub in its tab bar, so this
                  would be a second way to the same place in a smaller target. */}
              {!isMobile && (view !== 'dash' || selectedDay) && (
                <button
                  className="back-to-dash"
                  onClick={() => { setView('dash'); dispatch({ type: 'select_day', dayId: null }); showPanel(); }}
                >‹ {t('Dashboard')}</button>
              )}
              {selectedDay ? <DayPanel day={selectedDay} />
                : view === 'dash' ? <Dashboard onOpen={openTarget} />
                : view === 'feas' ? <FeasibilityPanel />
                : view === 'budget' ? <BudgetPanel />
                : <OverviewPanel routes={routes} />}
            </div>
          </aside>
          {(isMobile || chatOpen) && <ChatPanel onClose={closeChat} />}
        </div>
        {isMobile && (
          /* The phone's ONE navigation surface. Every destination appears here
             exactly once and nowhere else — the dashboard is the trip's status
             board and file drawer, not a second copy of this list, and the
             masthead RIDE button is the one way into navigation. Seats scroll
             sideways; the active one is kept in view. */
          <nav className="tabnav" aria-label="Views">
            {SEATS.map(([key, label]) => (
              <button
                key={key}
                ref={seatActive === key ? activeSeatRef : null}
                className={seatActive === key ? 'active' : ''}
                aria-current={seatActive === key}
                onClick={() => (key === 'map' ? setMobileTab('map') : openTarget(key))}
              >{t(label)}</button>
            ))}
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
