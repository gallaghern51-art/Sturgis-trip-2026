// Translate a batch of trip strings. This is what makes the app work in another
// language for a trip nobody hand-translated — an AI-generated ride through
// Patagonia gets the same treatment as the bundled Sturgis guide.
//
// The client chunks and calls this repeatedly (see src/engine/translate.js) so
// each request stays well inside the host's synchronous 10s ceiling. Chunking
// on the client also means partial progress is kept: a failed chunk costs that
// chunk, not the whole trip.

import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-sonnet-5';
const MAX_STRINGS = 80;

const SYSTEM = `You translate motorcycle trip itineraries. You are given a JSON array of source strings and a target language. Return a translation for every string, in the same order, via the emit_translations tool.

Leave these EXACTLY as written, mid-sentence and all:
- Place names, towns, states, parks, and business names (Missoula, Yellowstone, Dirty Annie's, The Pollard Hotel)
- Road numbers and highway names (I-90, US-14/16/20, MT-135, Going-to-the-Sun Road)
- Street addresses, phone numbers, URLs, times, dates, prices, elevations, distances and their units
- Trademarks and brand names (Harley-Davidson, EagleRider, Garmin)

Translate everything else — the prose, the reasoning, the trade-offs, the instructions — into natural, idiomatic language a rider would actually use, not a literal word-for-word rendering. Keep the register: these are terse field-guide notes, not marketing copy. Preserve the original punctuation style, including the em-dashes and interpuncts that separate clauses.

If a string is nothing but a proper noun, an address, or a number, return it unchanged.`;

const TOOL = {
  name: 'emit_translations',
  description: 'Return one translation per source string, in the same order.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['translations'],
    properties: {
      translations: {
        type: 'array',
        description: 'Same length and order as the input array.',
        items: { type: 'string' },
      },
    },
  },
};

const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
});

export default async function handler(req) {
  if (req.method !== 'POST') return json(405, { error: 'POST only' });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return json(500, { error: 'ANTHROPIC_API_KEY is not set on this site' });

  let body;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'body must be JSON' });
  }

  const { strings, language } = body ?? {};
  if (!Array.isArray(strings) || !strings.length) return json(400, { error: 'strings[] required' });
  if (strings.length > MAX_STRINGS) return json(400, { error: `at most ${MAX_STRINGS} strings per request` });
  if (!language) return json(400, { error: 'language required' });

  try {
    const client = new Anthropic({ apiKey: key });
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system: SYSTEM,
      tools: [TOOL],
      tool_choice: { type: 'tool', name: 'emit_translations' },
      messages: [{
        role: 'user',
        content: `Target language: ${language}\n\nStrings:\n${JSON.stringify(strings, null, 1)}`,
      }],
    });

    const call = res.content.find((b) => b.type === 'tool_use');
    const out = call?.input?.translations;
    if (!Array.isArray(out) || out.length !== strings.length) {
      return json(502, { error: `model returned ${out?.length ?? 0} translations for ${strings.length} strings` });
    }

    // Key by source string so the client can merge straight into the trip cache.
    const map = {};
    strings.forEach((src, i) => {
      const t = out[i];
      if (typeof t === 'string' && t.trim()) map[src] = t;
    });
    return json(200, { translations: map });
  } catch (err) {
    return json(502, { error: err?.message ?? 'translation failed' });
  }
}
