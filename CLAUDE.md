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
- `src/engine/routing.js` — planning routes via OSRM public server, road-snapped geometry + leg durations (+15% group pace), cached in localStorage keyed by the day's coordinate string. Legs are looked up by `legKey(a, b)` (4-decimal lat/lng) — moving a waypoint invalidates naturally. **Nav routing (`routeDaySteps`/`routeFrom`) tries Google Routes first** through `netlify/functions/google-route.mjs` (traffic-aware, `TRAFFIC_AWARE` = Pro SKU billing; needs `GOOGLE_MAPS_API_KEY` in Netlify env) and falls back to OSRM on any failure with a 5–30 min backoff — under plain `vite` dev the function 404s and everything runs on OSRM. Google step durations are static; the client spreads the traffic-aware total across steps proportionally. Google-sourced step caches expire after 15 min (traffic staleness); OSRM-sourced ones are arrays and cache forever.
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
- **Basemaps** (`src/engine/basemaps.js`, shared by MapView and RideMode): when `VITE_GOOGLE_MAPS_KEY` is set at build time, Google Map Tiles (hybrid satellite + roadmap; 2-week sessions cached in `moto.gtiles.v1`, created client-side) headline the switcher and Ride Mode — 100k tiles/month free, so watch usage if the whole group rides on it. Without the key: Esri hybrid satellite (z19) default plus streets(liberty)/dark/light — everything falls back to these automatically on any Google failure. `ensureTerrain(map, on)`: 3D terrain + hillshade from AWS terrarium DEM (free, no key); MapView has a 3D toggle; re-asserted from `drawAll` so it survives `setStyle`.
- **Highway shields**: downloaded, with a local override. `RoadShield.jsx` tries `public/shields/<ROUTE>.svg|png|webp` first, then `netlify/functions/shield.mjs`, which resolves the route on Wikimedia Commons and proxies it with a 1-year immutable CDN + browser cache (fetched once per route, offline thereafter). Commons already returns the real state designs — Wyoming's bucking horse, South Dakota's outline, Idaho's silhouette — and names files inconsistently per state (`I-90.svg`, `US 20.svg`, `MT-84.svg`, `SD 87.svg`, `California 1.svg`), so the function tries five conventions in one batched title lookup plus a search fallback: measured 25/25 across 20 states. **`public/shields/` is an owner-managed override folder — never delete it or its contents.** The filename is the route key; there is deliberately no route→filename map in source. No drawn fallback: when both sources miss, the number is set as plain type rather than faking a sign. `vite.config.js` serves `/.netlify/functions/*` in dev via `netlifyFunctionsInDev()`, so `npm run dev` behaves like production — do not reintroduce workarounds premised on functions being absent locally.
- **Place search**: `geocode.js` → `google-places` function (Places New Text Search, server key, day-biased) with Nominatim fallback. The AI planner has a `search_places` tool (agentic loop in `planner-core.mjs` `runChat`, max 4 rounds, budget-aware) so proposed stops carry verified coordinates.
- **MapView route rendering is Google-grade**: glow + dark casing + phase-colored line + white direction chevrons (`route-arrow` image added via canvas, re-added on `styleimagemissing`), zoom-interpolated widths, waypoint name labels while editing a day (`.wp-label`), imperial ScaleControl + GeolocateControl. `window.__map` is exposed in dev builds for console debugging.
- **Ride Mode** (`src/components/RideMode.jsx`) is a full nav app: own MapLibre map, course-up chase camera (pitch 55, zoom breathes with speed and tightens before turns, padding keeps the puck low), blue heading puck **map-matched to the route** (within 30 m the puck snaps onto the line and takes the road bearing — effect on `[fix]`, not the raw GPS callback), cased route line whose traveled portion dims behind you (line-gradient, sources need `lineMetrics: true`), OSRM turn-by-turn via `routeDaySteps()` (cache `moto.stepsCache.v2` — steps carry `sec` for live ETA math), **live rerouting**: off-route is measured against routed geometry (0.12 mi, decaying 3-fix counter, 20 s cooldown) → `routeFrom(pos, remainingWps)` redraws a bright live route over the ghosted plan and voice-announces; ETA block = clock + remaining step seconds. Voice at 1 mi / ¼ mi / on-turn, mute, plan delta, gate projections, wake-lock, route Overview button. `warmTilesAhead()` in `basemaps.js` prefetches Esri satellite+road tiles ~12 mi down the route every 15 s (plain raster URLs → warming the HTTP cache makes MapLibre hit instantly); nav map runs `maxTileCacheSize: 1024`. ETAs are traffic-aware when `GOOGLE_MAPS_API_KEY` is configured (see routing.js note), static OSM speeds otherwise. Known limits: needs foregrounded tab (no background GPS), no offline tiles.
- **Phone navigation is ONE surface** (redundancy audit, July 28): a single horizontally-scrolling bottom bar — Map · Dashboard · Planner · Optimizer · Feasibility · Budget · Packing · Settings — each destination exactly once. The Dashboard is the trip's status board (deep-linking status chips) + Trip file drawer only; it must NOT relaunch pages the bar already holds. Ride lives solely on the masthead RIDE button. Gate projections render inside the Ride HUD card (`.rb-gates`), never as a floating pill. Before adding any control, check the label does not already exist on another surface.
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
