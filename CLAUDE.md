# CLAUDE.md

**Roadbook** — multi-trip AI motorcycle trip planning platform (React SPA + Netlify Functions). Born as the Sturgis 2026 field-guide app; the Sturgis trip now lives on as seed data / template. Live at https://sturgis-2026-trip.netlify.app.

## Commands

```bash
npm run dev      # Vite dev server on port 5199
npm run build    # production build → dist/
```

There is no test suite or linter configured. Verify changes by building and exercising the UI; the engine functions in `src/engine/` are pure and easy to check in isolation.

## Deploys

Pushes to `main` auto-deploy via Netlify CI (site `sturgis-2026-trip`, team GalCode). `npx netlify deploy --prod --dir dist --functions netlify/functions` still works as a manual fallback. `ANTHROPIC_API_KEY` is set in the Netlify site env — functions read it at deploy time.

**Others also work on this repo via GitHub PRs. Always `git pull --rebase` before pushing, and read what came in — remote work has restructured whole subsystems before.**

## Architecture

State flows one way: **every trip mutation is an op** (`src/engine/ops.js`) applied by the pure `applyOps(trip, ops)`; the reducer in `src/engine/store.js` persists to localStorage and maintains undo. The UI and the AI optimizer emit the *same op vocabulary* — if you add an editing capability, add it as an op, wire it into `describeOps`, and expose it in the function's tool schema so the AI can use it too.

- `src/engine/store.js` — trip library (`moto.trips.v1` in localStorage): multiple trips, per-trip scenarios, active-trip working copy, undo stack.
- `src/engine/tripEngine.js` — miles/hours/fuel-gap warnings. Bike range comes from `trip.meta.range` (`tripRange()`), never hardcode 180/200.
- `src/engine/timeline.js` — minute-by-minute day simulation (depart → routed leg minutes → dwell → ETAs), hard-gate checks (`day.gates`), feasibility scores/grades.
- `src/engine/dates.js` — `cascadeDates(trip)` re-pins every `day.date/dow` from `meta.startDate` + index. Call it after any day add/remove/reorder or startDate change (ops already do).
- `src/engine/routing.js` — OSRM public server, road-snapped geometry + leg durations (+15% group pace), cached in localStorage keyed by the day's coordinate string. Legs are looked up by `legKey(a, b)` (4-decimal lat/lng) — moving a waypoint invalidates naturally.
- `src/engine/splits.js` — break-point recommendations for loops and long days.
- `src/engine/exporters.js` — GPX (waypoint names carry planned ETAs — keep that; riders use it for schedule checks) and ICS (assumes UTC-6/Mountain Time — known limitation).
- `src/engine/geocode.js` — Nominatim search (free tier: keep request volume debounced/low).
- `src/engine/stream.js` — `readPlannerStream(res, onLine)` reads the functions' NDJSON.

## AI planner functions

Shared model logic lives in `netlify/lib/planner-core.mjs` (`runChat`, `runGenerate`, budgets). Three transports:

- `netlify/functions/chat.mjs` — streams NDJSON (`{type: start|delta|building|beat|done|error, ms}`). The host severs streams at ~58s; heartbeats every 2s keep bytes flowing. **Never convert these functions to plain buffered JSON responses — Netlify kills synchronous functions at 10s.**
- `netlify/functions/planner-background.mjs` — Netlify *background* function (the `-background` suffix is load-bearing): 15-minute ceiling, answers 202, reports progress into Netlify Blobs store `planner-jobs` (~1 write/sec coalesced).
- `netlify/functions/planner-status.mjs` — poll endpoint for background jobs; emits the same event shapes as the stream so the client reads either transport identically.

Model: `claude-sonnet-5` (deliberate cost choice — don't upgrade without asking). Chat mode returns text + a `propose_trip_changes` tool call (ops + `saveAs`/`overwriteScenarioId` for scenario writes); generate mode (`mode:'generate'`) returns a full trip via the `generate_trip` tool, which the client re-ids and date-cascades in `NewTripModal`. The client sends digests (`tripDigest` + `feasibilityDigest` + `splitsDigest`) plus full trip JSON and the scenario list — keep digests in sync with engine changes so the AI reasons from real numbers.

## Current state (session notes — July 25, 2026)

Where things stand so a fresh session can pick up without archaeology:

- **Brand:** the app is **Roadbook** (masthead, PWA manifest + icon in `public/`, dynamic `document.title`). The Sturgis 2026 trip is only seed data / the template option / the Reset target.
- **Default basemap is hybrid satellite** (Esri imagery + roads + place labels). All basemap styles live in `src/engine/basemaps.js`, shared by MapView and RideMode. MapView inits with `STYLE_SATELLITE`.
- **Ride Mode** (`src/components/RideMode.jsx`) is a full nav app: own MapLibre map, course-up follow camera (padding keeps the puck low), blue heading puck (`.nav-puck`, `rotationAlignment: 'map'`), route line, OSRM turn-by-turn via `routeDaySteps()` in `routing.js` (cache `moto.stepsCache.v1`), voice guidance at 1 mi / ¼ mi / on-turn via speechSynthesis with mute, ahead/behind-plan delta (clock − plan-time-at-position), gate projections, wake-lock. Known limits: needs foregrounded tab (no background GPS), no offline tiles, no live rerouting when off-route (shows an off-route banner instead).
- **AI chat persists per trip** on the library record; the deployed functions run the three-transport planner (see below) with `claude-sonnet-5`.
- **Deploys are GitHub CI** — push to `main` auto-deploys. The Netlify env has `ANTHROPIC_API_KEY`.
- Engine truth vs seed data: routed totals ~2,730 mi for the Sturgis trip; the field guide's own mile markers under-count (Missoula→Bozeman is ~203 mi, not 110).
- Roadmap candidates discussed with the owner, not yet built: Supabase sync + shareable trips (owner already runs Supabase for another project), offline tile cache/service worker, ride track recording with actual-vs-plan replay, live rerouting in Ride Mode, native wrapper (Capacitor) for background GPS.

## Conventions & gotchas

- Design system: dark "asphalt" field-guide aesthetic, CSS vars in `src/styles/app.css` (`--asphalt-*`, `--outbound/--rally/--return`, Barlow Condensed display / IBM Plex Mono data). Phase colors come from `PHASES` in `seedTrip.js`; on the light basemap MapView substitutes `LIGHT_SAFE` colors.
- `MapView` re-registers nothing on style switch: layers are re-added by `scheduleDraw` via `drawAllRef` (a ref to the latest closure — React StrictMode double-mounts the map, and init-time handlers would otherwise capture stale state). Keep new map event handlers going through refs.
- Mobile: `src/hooks/useMediaQuery.js` drives a tabbed one-pane layout; the map lives in a hidden tab and relies on the ResizeObserver in MapView to `resize()` when shown.
- Waypoints: `kind` ∈ start/via/fuel/photo/end, `fuel: true` drives fuel-gap math, `dwell` minutes override `DWELL_DEFAULT`. `mile` is legacy field-guide mileage — null it when coordinates change (`update_waypoint` from the location editor already does).
- Chat history persists per trip on the library record (`rec.chat`, capped 60 messages) — ChatPanel hydrates on trip switch and dispatches `save_chat`.
- `src/components/RideMode.jsx` — GPS HUD: projects `watchPosition` fixes onto the day's waypoint legs (`planPosition`), delta vs plan = clock − planned-minutes-at-position; wake-lock held while open. PWA manifest in `public/`.
- localStorage keys: `moto.trips.v1` (library), `moto.budget.v1`, `sturgis.routeCache.v1` (OSRM), `sturgis.conditions.v1` (weather). Legacy `sturgis.trip.v2`/`sturgis.scenarios.v1` migrate on first load — don't remove the migration until well after Aug 2026.
- The seed Sturgis trip (`src/data/seedTrip.js`) doubles as the "template" option in NewTripModal and the Reset target. Its documented mileage is known-low vs routed reality (e.g. Missoula→Bozeman is ~203 mi, not 110) — the engine's routed numbers are the truth.
