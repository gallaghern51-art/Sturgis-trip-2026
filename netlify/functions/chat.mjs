// Trip optimizer chat — Netlify Function proxying the Anthropic API.
// The client sends the conversation + a live trip digest + the full trip JSON;
// Claude replies with analysis and, when appropriate, a structured edit proposal
// via the propose_trip_changes tool that the app can preview and apply.

import Anthropic from '@anthropic-ai/sdk';

const SYSTEM = `You are the planning brain of a motorcycle trip planner — the tool riders use to plan multi-day trips end to end (routes, stops, fuel, lodging, meals, timing). The active trip's identity, dates, riders, bike range, and constraints all come from the provided trip state — read them there, never assume.

You receive the CURRENT trip state plus engine-computed metrics, a stop-by-stop timeline simulation, and a FEASIBILITY STUDY with hard-gate ETA checks, fuel-range analysis against the trip's configured bike range, and per-day scores. Ground every recommendation in that data.

You are authorized to restructure the ENTIRE trip when asked: reorder days, add or remove days, move stops across days, add or remove stops, retime departures, change lodging and meals, adjust trip settings — emit everything as one op list. Waypoint dwell minutes are editable via update_waypoint patch {dwell: N}; departure time via set_day_field field "depart" (e.g. "7:30 AM"); lodging via update_lodging patch {name, status: booked|reserve|none, where, note}; day dates cascade from meta.startDate automatically when days are added/removed/reordered.

SCENARIOS: the app stores named trip permutations. You receive the current scenario list (ids + names). Rules:
- Whenever you produce a route optimization or any restructure bigger than a one-stop tweak, ALWAYS set "saveAs" to a short descriptive name (e.g. "Balanced Monday", "Badlands swap") so the result is saved as a new permutation automatically.
- When the user refers to editing/updating an EXISTING scenario by name, set "overwriteScenarioId" to that scenario's id instead of saveAs. Ops always apply to the current working trip; the result is then written into that scenario.
- Never reuse a name already in the list for saveAs — pick a distinct one.

BREAKING UP LOOPS AND LONG DAYS: the digest includes engine-computed break-point recommendations (best split stop, miles/time either side). When asked where or how to break a day or loop up, ground your answer in those; you may refine them (e.g. a better overnight town, a lunch-anchored decision point). Days are pinned to calendar dates, so "splitting" a day means moving stops onto neighboring days, retiming departures, cutting stops, or converting a loop to a shorter out-and-back — say which and show the math.

Non-negotiables unless the user explicitly overrides them:
- Days flagged "anchor" in the trip data are protected — trim anywhere else first.
- Hard time gates in the trip data (day.gates) are commitments, not suggestions.
- Fuel discipline uses the trip's configured range (meta.range). Flag any gap beyond it.
- Group realities scale with rider count: more bikes park slower, eat slower, and fuel slower. Wildlife corridors at dawn/dusk are ridden slow.

TIME BUDGET — the server cuts any reply off after about a minute, and a cut-off answer is worth nothing:
- Produce ONE scenario per reply. When asked for several, build the single most valuable one now with full ops, name the others in one sentence each, and offer to build the next on request.
- Keep op lists to what the change actually requires. Never restate days you are not changing.
- If a request genuinely cannot fit — a ground-up rebuild of every day, or four permutations at once — say so in one line and deliver the first slice instead of starting something that will be severed mid-answer.

NAMING DAYS — this matters, riders do not think in ids:
- NEVER write a raw day id (d3, d8, day_xyz) in prose. Ids belong in tool ops only.
- Refer to a day by its leg: the weekday, the date, and the day's title — e.g. "Fri 8/14 — Lead → Little Bighorn → Red Lodge". Shorten the title to its endpoints if it is long, but always keep the weekday and date.
- On later mentions in the same paragraph a short form is fine ("the Beartooth day", "Friday"), as long as the full leg name appeared first.
- The same applies to stops and modules: name them, never their ids.

How to respond:
- Be direct and honest about trade-offs, in the voice of the field guide: state the cost of every option ("this buys you X but costs you Y").
- When the user asks you to rework, reorder, add, or remove something, USE the propose_trip_changes tool with concrete ops referencing real ids from the trip JSON. Keep the accompanying text short — the proposal card shows the ops.
- When the user asks a question or for analysis, answer in text only. Do not propose changes nobody asked for.
- Waypoints need lat/lng when added; use accurate coordinates for real places.`;

const TOOL = {
  name: 'propose_trip_changes',
  description:
    'Propose a set of edits to the trip. The user previews and applies them in the app. Reference real day/waypoint/module ids from the provided trip JSON.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['summary', 'ops'],
    properties: {
      summary: { type: 'string', description: 'One-sentence summary of what this change set does and its main trade-off.' },
      saveAs: { type: 'string', description: 'Short scenario name. REQUIRED whenever this proposal is a route optimization or multi-day restructure — the app saves the applied result as a new named permutation. Omit only for trivial single-stop tweaks.' },
      overwriteScenarioId: { type: 'string', description: 'Set instead of saveAs when the user asked to edit/update an existing scenario — the id from the provided scenario list. The applied result overwrites that scenario.' },
      ops: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            op: {
              type: 'string',
              enum: ['reorder_days', 'add_day', 'remove_day', 'reorder_waypoints', 'move_waypoint', 'add_waypoint', 'remove_waypoint', 'update_waypoint', 'set_day_field', 'toggle_module', 'set_reservation_done', 'update_meal', 'remove_meal', 'update_lodging', 'set_meta'],
            },
            dayId: { type: 'string' },
            dayIds: { type: 'array', items: { type: 'string' } },
            waypointId: { type: 'string' },
            waypointIds: { type: 'array', items: { type: 'string' } },
            fromDayId: { type: 'string' },
            toDayId: { type: 'string' },
            index: { type: 'integer' },
            waypoint: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                note: { type: 'string' },
                lat: { type: 'number' },
                lng: { type: 'number' },
                kind: { type: 'string', enum: ['start', 'via', 'fuel', 'photo', 'end'] },
                fuel: { type: 'boolean' },
                mile: { type: ['number', 'null'] },
              },
            },
            patch: { type: 'object' },
            field: { type: 'string' },
            value: {},
            moduleId: { type: 'string' },
            enabled: { type: 'boolean' },
            reservationId: { type: 'string' },
            done: { type: 'boolean' },
            meal: { type: 'string', enum: ['breakfast', 'lunch', 'dinner'] },
            day: { type: 'object', description: 'For add_day: {title, phase, depart, summary}. Dates cascade automatically.' },
          },
          required: ['op'],
        },
      },
    },
  },
};

// Square-zero trip generation: describe a trip, get a complete structured itinerary.
const GENERATE_SYSTEM = `You are the itinerary builder for a motorcycle trip planning app. From the rider's description, produce a COMPLETE, realistic multi-day motorcycle itinerary via the generate_trip tool.

Rules:
- Real places, accurate lat/lng (4+ decimals). Route days along roads riders actually take; favor the famous riding roads of the region when they fit.
- 4–10 waypoints per riding day: start point, the best scenic/riding stops (kind "photo"), fuel stops every 100–150 miles in real towns (kind "fuel", fuel: true), lunch-town stops, and the day's end point. First waypoint kind "start", last kind "end".
- Keep daily distance realistic: 150–300 mi for scenic days, up to 450 for transit days, and note it in the summary.
- Every day gets: an honest one-to-two-sentence summary (trade-offs included), a depart time, lunch and dinner meal entries with real restaurant-quality picks when you know them (or the honest "best option in town" note), and lodging (real town + property suggestion, status "reserve").
- Phases: use "outbound" for the way out, "rally" for event/destination days, "return" for the way home, "prep" for travel/arrival days.
- Respect the rider count and requested day count exactly.`;

const GENERATE_TOOL = {
  name: 'generate_trip',
  description: 'Emit the complete generated itinerary.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['trip'],
    properties: {
      trip: {
        type: 'object',
        additionalProperties: false,
        required: ['meta', 'days'],
        properties: {
          meta: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              subtitle: { type: 'string' },
              riders: { type: 'integer' },
              fuelRule: { type: 'string' },
            },
          },
          days: {
            type: 'array',
            items: {
              type: 'object',
              required: ['title', 'waypoints'],
              properties: {
                title: { type: 'string' },
                phase: { type: 'string', enum: ['prep', 'outbound', 'rally', 'return'] },
                depart: { type: 'string', description: 'e.g. "8:00 AM"' },
                summary: { type: 'string' },
                anchor: { type: 'boolean' },
                constraints: { type: 'array', items: { type: 'string' } },
                waypoints: {
                  type: 'array',
                  items: {
                    type: 'object',
                    required: ['name', 'lat', 'lng'],
                    properties: {
                      name: { type: 'string' },
                      lat: { type: 'number' },
                      lng: { type: 'number' },
                      kind: { type: 'string', enum: ['start', 'via', 'fuel', 'photo', 'end'] },
                      fuel: { type: 'boolean' },
                      dwell: { type: 'number' },
                      note: { type: 'string' },
                    },
                  },
                },
                meals: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      meal: { type: 'string', enum: ['breakfast', 'lunch', 'dinner'] },
                      name: { type: 'string' }, where: { type: 'string' }, note: { type: 'string' }, alt: { type: 'string' },
                    },
                  },
                },
                lodging: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', enum: ['booked', 'reserve', 'none'] },
                    name: { type: 'string' }, where: { type: 'string' }, note: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};

// Netlify sync functions cap at ~10s; streaming responses can run much longer,
// but not forever. If the platform kills the function mid-answer the socket just
// closes and the client is left with no idea why — so every path here has to end
// with a terminal line of our own, ahead of any external deadline.
// Measured on this site: the host severs the stream at ~58s. Sit just under it
// so the model gets nearly the whole window and we still own the ending —
// past the cap the socket dies and no explanation reaches the rider.
// Raise PLANNER_BUDGET_MS only alongside the site's function timeout.
const BUDGET_MS = Number(process.env.PLANNER_BUDGET_MS) || 50000;

// Both modes return NDJSON lines: {type:'delta'|'building'|'done'|'error', ...}.
// A heartbeat keeps bytes flowing while the model works.
function streamResponse(run) {
  const enc = new TextEncoder();
  const body = new ReadableStream({
    async start(controller) {
      let closed = false;
      const t0 = Date.now();
      // enqueue throws once the stream is torn down. A failed send must never be
      // the thing that takes down the error handler below — that turns a
      // reportable failure into a silent truncated stream.
      // Every line carries elapsed ms. If the platform severs the stream, the
      // last line the client received tells it how long the function survived —
      // that number is the platform's real cap, which is otherwise invisible.
      const send = (obj) => {
        if (closed) return false;
        try {
          controller.enqueue(enc.encode(JSON.stringify({ ...obj, ms: Date.now() - t0 }) + '\n'));
          return true;
        } catch {
          closed = true;
          return false;
        }
      };
      send({ type: 'start' });
      const beat = setInterval(() => send({ type: 'beat' }), 2000);
      try {
        await run(send);
      } catch (err) {
        send({ type: 'error', message: friendlyError(err) });
      } finally {
        clearInterval(beat);
        closed = true;
        try { controller.close(); } catch { /* already torn down */ }
      }
    },
  });
  return new Response(body, { headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache' } });
}

// Upstream failures arrive as raw status + JSON body. Riders get a sentence.
function friendlyError(err) {
  const status = err?.status;
  if (status === 429) return 'The optimizer is rate limited right now — wait a minute and try again.';
  if (status === 529 || status === 503) return 'The model service is busy right now. Try again in a moment.';
  if (status === 401 || status === 403) return 'The Anthropic API key on this site was rejected — check it in the Netlify environment settings.';
  if (status >= 500) return 'The model service errored out. Try again in a moment.';
  return String(err?.message ?? err);
}

// Race the model against our own budget. Losing the race is a normal outcome we
// can explain; being killed by the platform is not.
function withDeadline(stream, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try { stream.abort(); } catch { /* already finished */ }
      const err = new Error('planner deadline exceeded');
      err.code = 'deadline';
      reject(err);
    }, ms);
    stream.finalMessage().then(
      (msg) => { clearTimeout(timer); resolve(msg); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

// Tool arguments stream as input_json_delta and reasoning as thinking_delta —
// neither fires a 'text' event, so a big restructure is otherwise complete dead
// air. Track all three phases: it drives the progress readout, and when the
// budget runs out it tells us how far the model actually got.
function reportToolProgress(stream, send) {
  const seen = { chars: 0, thinking: 0, text: 0 };
  let lastPing = 0;
  stream.on('streamEvent', (event) => {
    if (event?.type !== 'content_block_delta') return;
    const delta = event.delta ?? {};
    if (delta.type === 'thinking_delta') {
      seen.thinking += delta.thinking?.length ?? 0;
    } else if (delta.type === 'text_delta') {
      seen.text += delta.text?.length ?? 0;
      return; // already streamed to the client as a 'delta'
    } else if (delta.type === 'input_json_delta') {
      seen.chars += delta.partial_json?.length ?? 0;
    } else {
      return;
    }
    const total = seen.chars + seen.thinking;
    if (total - lastPing >= 400) {
      lastPing = total;
      send({ type: 'building', chars: seen.chars, thinking: seen.thinking });
    }
  });
  return seen;
}

// What to tell the rider when the budget runs out, based on how far it got.
function deadlineMessage(seen) {
  if (seen.chars > 0) {
    return 'The change set was too large to finish in the time the server allows. Ask for one day, or one leg, at a time and apply them in sequence.';
  }
  if (seen.text > 0) {
    return 'The optimizer answered partway, then ran out of time before it could write the changes. Ask it to change one day at a time.';
  }
  if (seen.thinking > 0) {
    return 'The optimizer was still working through the trip when time ran out. Ask for one scenario, or one day, rather than several at once.';
  }
  return 'The optimizer ran out of time without starting — the model service is likely slow right now. Try again in a moment.';
}

function handleGenerate(client, body) {
  const { prompt, basics = {} } = body;
  if (!prompt) return Response.json({ error: 'prompt required' }, { status: 400 });
  const ask = `Build this motorcycle trip:\n\n"${prompt}"\n\nBasics (respect exactly): name: ${basics.name || '(you pick a good one)'}, start date: ${basics.startDate}, days: ${basics.numDays}, riders: ${basics.riders}. Use the generate_trip tool.`;
  return streamResponse(async (send) => {
    const stream = client.messages.stream({
      model: 'claude-sonnet-5',
      max_tokens: 16000,
      output_config: { effort: 'medium' },
      system: GENERATE_SYSTEM,
      tools: [GENERATE_TOOL],
      tool_choice: { type: 'tool', name: 'generate_trip' },
      messages: [{ role: 'user', content: ask }],
    });
    reportToolProgress(stream, send);
    let response;
    try {
      response = await withDeadline(stream, BUDGET_MS);
    } catch (err) {
      if (err?.code !== 'deadline') throw err;
      send({
        type: 'error',
        message: 'The builder ran out of time before the itinerary was complete. Try fewer days, or a shorter description.',
      });
      return;
    }
    if (response.stop_reason === 'refusal') {
      send({ type: 'error', message: 'The builder declined that request — try rephrasing.' });
      return;
    }
    const block = response.content.find((b) => b.type === 'tool_use' && b.name === 'generate_trip');
    if (!block?.input?.trip) send({ type: 'error', message: 'No itinerary produced — try a more specific description.' });
    else send({ type: 'done', trip: block.input.trip });
  });
}

export default async (req) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'POST only' }, { status: 405 });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: 'not_configured', message: 'ANTHROPIC_API_KEY is not set on this Netlify site.' }, { status: 503 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'invalid JSON' }, { status: 400 });
  }
  // The SDK retries 429/529 silently, honouring retry-after — which on a rate
  // limit can be tens of seconds of no stream events at all, indistinguishable
  // from a slow model. Bound it so the real error surfaces instead of the
  // budget expiring with nothing to show for it.
  const client = new Anthropic({ maxRetries: 1 });

  if (body.mode === 'generate') {
    return handleGenerate(client, body);
  }

  const { messages = [], tripDigest = '', tripJson = null, scenarios = [] } = body;
  if (!Array.isArray(messages) || !messages.length) {
    return Response.json({ error: 'messages required' }, { status: 400 });
  }

  // Trip context rides in the first user turn so the conversation stays clean.
  const contextBlock = `<trip_state_digest>\n${tripDigest}\n</trip_state_digest>\n\n<saved_scenarios>\n${JSON.stringify(scenarios)}\n</saved_scenarios>\n\n<trip_json>\n${JSON.stringify(tripJson)}\n</trip_json>`;
  const apiMessages = messages.map((m, i) => {
    if (i === 0 && m.role === 'user') {
      return { role: 'user', content: `${contextBlock}\n\n${m.content}` };
    }
    return { role: m.role, content: m.content };
  });

  return streamResponse(async (send) => {
    const stream = client.messages.stream({
      model: 'claude-sonnet-5',
      max_tokens: 8000,
      output_config: { effort: 'medium' },
      system: SYSTEM,
      tools: [TOOL],
      messages: apiMessages,
    });
    stream.on('text', (t) => send({ type: 'delta', text: t }));
    const progress = reportToolProgress(stream, send);
    let response;
    try {
      response = await withDeadline(stream, BUDGET_MS);
    } catch (err) {
      if (err?.code !== 'deadline') throw err;
      // A half-written op list can't be applied, but the rider should know
      // which phase ran long rather than that "something went wrong".
      send({ type: 'error', message: deadlineMessage(progress) });
      return;
    }
    if (response.stop_reason === 'refusal') {
      send({ type: 'done', text: 'The optimizer declined that request. Try rephrasing it.', proposal: null });
      return;
    }
    if (response.stop_reason === 'max_tokens') {
      // The tool arguments are truncated JSON at this point — unusable.
      send({
        type: 'error',
        message: 'The answer hit its length limit before it was complete. Ask for a smaller change set — one day at a time applies cleanly.',
      });
      return;
    }
    let text = '';
    let proposal = null;
    for (const block of response.content) {
      if (block.type === 'text') text += block.text;
      if (block.type === 'tool_use' && block.name === 'propose_trip_changes') proposal = block.input;
    }
    send({ type: 'done', text: text.trim(), proposal });
  });
};
