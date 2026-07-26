// Poll endpoint for background planner jobs. Cheap and boring on purpose —
// the client hits it about once a second while a job runs.

import { getStore } from '@netlify/blobs';

const JOB_STORE = 'planner-jobs';

export default async (req) => {
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return Response.json({ error: 'id required' }, { status: 400 });

  let record = null;
  try {
    record = await getStore(JOB_STORE).get(id, { type: 'json' });
  } catch (err) {
    // Blobs unavailable is a deployment problem, not a job problem — say which,
    // so the client can fall back to the streaming transport instead of
    // polling a store that will never answer.
    return Response.json({ status: 'unavailable', message: String(err?.message ?? err) }, { status: 503 });
  }

  // No record yet means the background function has not claimed the job. That
  // is normal for the first poll or two, and indistinguishable from a job that
  // never started — the client's own timeout resolves the difference.
  return Response.json(record ?? { status: 'pending' }, {
    headers: { 'Cache-Control': 'no-store' },
  });
};
