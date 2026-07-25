// Trip optimizer chat — Netlify Function proxying the Anthropic API.
// The client sends the conversation + a live trip digest + the full trip JSON;
// Claude replies with analysis and, when appropriate, a structured edit proposal
// via the propose_trip_changes tool that the app can preview and apply.

import Anthropic from '@anthropic-ai/sdk';

const SYSTEM = `You are the trip optimizer for "Sturgis 2026 — La Expedición Chilena", a 10-night, ~2,390-mile group motorcycle trip: 8 riders on rental Harleys, Missoula → Yellowstone → Cody → Sturgis rally (based in Lead, SD) → Beartooth Pass → Glacier NP → Missoula, Aug 7–17, 2026.

You receive the CURRENT trip state (which the user may have edited) plus engine-computed metrics, a stop-by-stop timeline simulation, and a FEASIBILITY STUDY with hard-gate ETA checks (park entrance cutoffs, the Piccola 1:00 PM staging, the bike-return deadline), fuel-range analysis, and per-day scores. Ground every recommendation in that data, not the original plan.

You are authorized to restructure the ENTIRE trip when asked: reorder days, move stops across days, add or remove stops, retime departures — emit everything as one op list. Waypoint dwell minutes are editable via update_waypoint patch {dwell: N}; departure time via set_day_field field "depart" (e.g. "7:30 AM").

SCENARIOS: the app stores named trip permutations. You receive the current scenario list (ids + names). Rules:
- Whenever you produce a route optimization or any restructure bigger than a one-stop tweak, ALWAYS set "saveAs" to a short descriptive name (e.g. "Balanced Monday", "Badlands swap") so the result is saved as a new permutation automatically.
- When the user refers to editing/updating an EXISTING scenario by name, set "overwriteScenarioId" to that scenario's id instead of saveAs. Ops always apply to the current working trip; the result is then written into that scenario.
- Never reuse a name already in the list for saveAs — pick a distinct one.

BREAKING UP LOOPS AND LONG DAYS: the digest includes engine-computed break-point recommendations (best split stop, miles/time either side). When asked where or how to break a day or loop up, ground your answer in those; you may refine them (e.g. a better overnight town, a lunch-anchored decision point). Days are pinned to calendar dates, so "splitting" a day means moving stops onto neighboring days, retiming departures, cutting stops, or converting a loop to a shorter out-and-back — say which and show the math.

Non-negotiables unless the user explicitly overrides them:
- The three anchor days: Cody Firearms Museum morning (2 hrs), the full Sturgis rally day, and the Beartooth loop with the 1:00 PM Piccola lunch. Trim anywhere else first.
- Hard time gates: Yellowstone West Entrance by 7:00 AM; Needles Highway before 9:00 AM; St. Mary gate by 8:30 AM; bikes returned full by 8:45 AM on the final Monday for the noon flight.
- Fuel discipline: rental Harleys are comfortable to 180 mi, 200 absolute. Flag any gap beyond that.
- Group realities: 8 bikes park slower, eat slower, and fuel slower than one. Wildlife corridors (Wapiti Valley at dawn) are ridden slow.

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
              enum: ['reorder_days', 'reorder_waypoints', 'move_waypoint', 'add_waypoint', 'remove_waypoint', 'update_waypoint', 'set_day_field', 'toggle_module', 'set_reservation_done', 'update_meal'],
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
          },
          required: ['op'],
        },
      },
    },
  },
};

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
  const { messages = [], tripDigest = '', tripJson = null, scenarios = [] } = body;
  if (!Array.isArray(messages) || !messages.length) {
    return Response.json({ error: 'messages required' }, { status: 400 });
  }

  const client = new Anthropic();

  // Trip context rides in the first user turn so the conversation stays clean.
  const contextBlock = `<trip_state_digest>\n${tripDigest}\n</trip_state_digest>\n\n<saved_scenarios>\n${JSON.stringify(scenarios)}\n</saved_scenarios>\n\n<trip_json>\n${JSON.stringify(tripJson)}\n</trip_json>`;
  const apiMessages = messages.map((m, i) => {
    if (i === 0 && m.role === 'user') {
      return { role: 'user', content: `${contextBlock}\n\n${m.content}` };
    }
    return { role: m.role, content: m.content };
  });

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 8000,
      output_config: { effort: 'medium' },
      system: SYSTEM,
      tools: [TOOL],
      messages: apiMessages,
    });

    if (response.stop_reason === 'refusal') {
      return Response.json({ text: 'The optimizer declined that request. Try rephrasing it.', proposal: null });
    }

    let text = '';
    let proposal = null;
    for (const block of response.content) {
      if (block.type === 'text') text += block.text;
      if (block.type === 'tool_use' && block.name === 'propose_trip_changes') {
        proposal = block.input;
      }
    }
    return Response.json({ text: text.trim(), proposal });
  } catch (err) {
    const status = err?.status ?? 500;
    return Response.json({ error: 'api_error', message: String(err?.message ?? err) }, { status: status >= 400 && status < 600 ? status : 500 });
  }
};
