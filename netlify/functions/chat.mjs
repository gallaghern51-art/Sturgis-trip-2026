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

// Netlify sync functions cap at ~10s; streaming responses can run much longer.
// Both modes return NDJSON lines: {type:'delta'|'done'|'error', ...}. A heartbeat
// keeps bytes flowing while the model works.
function streamResponse(run) {
  const enc = new TextEncoder();
  const body = new ReadableStream({
    async start(controller) {
      const send = (obj) => controller.enqueue(enc.encode(JSON.stringify(obj) + '\n'));
      send({ type: 'start' });
      const beat = setInterval(() => { try { send({ type: 'beat' }); } catch { /* closed */ } }, 4000);
      try {
        await run(send);
      } catch (err) {
        send({ type: 'error', message: String(err?.message ?? err) });
      } finally {
        clearInterval(beat);
        controller.close();
      }
    },
  });
  return new Response(body, { headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache' } });
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
    const response = await stream.finalMessage();
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
  const client = new Anthropic();

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
    const response = await stream.finalMessage();
    if (response.stop_reason === 'refusal') {
      send({ type: 'done', text: 'The optimizer declined that request. Try rephrasing it.', proposal: null });
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
