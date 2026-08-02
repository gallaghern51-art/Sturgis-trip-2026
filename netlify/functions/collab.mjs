// Collaborate mode backend: one shared-trip record per share, stored in
// Netlify Blobs (store "collab-shares"). Road-captain governance:
//   - the captain owns the working trip and pushes it;
//   - riders join by invite link, send proposals (op batches), comments, votes;
//   - the captain moves the share draft → review → published.
// Auth is possession of a key: the captain key is returned once at create,
// member keys at join. No accounts in v1 — this upgrades to real auth later
// without changing the shapes.

// Local dev runs these functions inside the vite process, where Blobs has no
// site context — a module-level Map keeps the whole flow testable with two
// browser tabs against one dev server. The import is lazy and every Blobs
// failure falls back to the Map, so a missing module or env never 500s.
const devMem = new Map();
const memStore = {
  get: async (k, opts) => {
    const v = devMem.get(k);
    return v == null ? null : opts?.type === 'json' ? JSON.parse(v) : v;
  },
  setJSON: async (k, v) => { devMem.set(k, JSON.stringify(v)); },
};
let blobsMod;
async function store() {
  if (blobsMod === undefined) {
    try { blobsMod = await import('@netlify/blobs'); } catch { blobsMod = null; }
  }
  if (blobsMod) {
    try { return blobsMod.getStore({ name: 'collab-shares', consistency: 'strong' }); } catch { /* fall through */ }
  }
  return memStore;
}

const uid = (p) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
});

const MAX_TRIP_BYTES = 900_000; // a trip JSON is ~50-150 KB; anything near a MB is abuse
const MAX_TEXT = 2000;
const MAX_MEMBERS = 24;
const MAX_LIST = 200; // proposals + comments cap, oldest resolved trimmed first

function memberByKey(share, key) {
  return share.members.find((m) => m.key === key) ?? null;
}

function publicState(share, me) {
  // keys never leave the record except your own (implied by possession)
  return {
    rev: share.rev,
    status: share.status,
    title: share.title,
    updatedAt: share.updatedAt,
    trip: share.trip,
    joinCode: me?.role === 'captain' ? share.joinCode : undefined,
    members: share.members.map((m) => ({ id: m.id, name: m.name, role: m.role, vote: m.vote ?? null, joinedAt: m.joinedAt })),
    proposals: share.proposals,
    comments: share.comments,
    me: me ? { id: me.id, name: me.name, role: me.role } : null,
  };
}

async function load(shareId) {
  if (!/^sh[a-z0-9]+$/.test(String(shareId ?? ''))) return null;
  const s = await store();
  try {
    return await s.get(`share/${shareId}`, { type: 'json' });
  } catch {
    return memStore.get(`share/${shareId}`, { type: 'json' });
  }
}

async function save(shareId, share) {
  share.updatedAt = new Date().toISOString();
  const s = await store();
  try {
    await s.setJSON(`share/${shareId}`, share);
  } catch {
    await memStore.setJSON(`share/${shareId}`, share);
  }
}

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'POST only' });
  let body;
  try { body = await req.json(); } catch { return json(400, { error: 'bad json' }); }
  const { action } = body ?? {};

  try {
    if (action === 'create') {
      const { trip, name } = body;
      if (!trip?.days?.length) return json(400, { error: 'trip required' });
      if (JSON.stringify(trip).length > MAX_TRIP_BYTES) return json(413, { error: 'trip too large' });
      const shareId = uid('sh');
      const captain = {
        id: uid('m'), key: uid('k'), name: String(name ?? 'Road captain').slice(0, 60),
        role: 'captain', joinedAt: new Date().toISOString(), vote: null,
      };
      const share = {
        rev: 1, status: 'draft',
        title: trip.meta?.title ?? 'Trip',
        joinCode: uid('j').slice(-6),
        trip, members: [captain], proposals: [], comments: [],
      };
      await save(shareId, share);
      return json(200, { shareId, key: captain.key, state: publicState(share, captain) });
    }

    const { shareId, key } = body;
    if (action === 'join') {
      const share = await load(shareId);
      if (!share) return json(404, { error: 'no such share' });
      if (body.joinCode !== share.joinCode) return json(403, { error: 'bad invite' });
      if (share.members.length >= MAX_MEMBERS) return json(409, { error: 'crew is full' });
      const m = {
        id: uid('m'), key: uid('k'), name: String(body.name ?? 'Rider').slice(0, 60),
        role: 'rider', joinedAt: new Date().toISOString(), vote: null,
      };
      share.members.push(m);
      share.rev += 1;
      await save(shareId, share);
      return json(200, { key: m.key, state: publicState(share, m) });
    }

    // everything below requires membership
    const share = await load(shareId);
    if (!share) return json(404, { error: 'no such share' });
    const me = memberByKey(share, key);
    if (!me) return json(403, { error: 'not a member' });
    const captainOnly = () => (me.role === 'captain' ? null : json(403, { error: 'captain only' }));

    switch (action) {
      case 'pull': {
        if (body.sinceRev != null && body.sinceRev === share.rev) return json(200, { unchanged: true, rev: share.rev });
        return json(200, { state: publicState(share, me) });
      }
      case 'push_trip': {
        const deny = captainOnly();
        if (deny) return deny;
        if (!body.trip?.days?.length) return json(400, { error: 'trip required' });
        if (JSON.stringify(body.trip).length > MAX_TRIP_BYTES) return json(413, { error: 'trip too large' });
        share.trip = body.trip;
        share.title = body.trip.meta?.title ?? share.title;
        share.rev += 1;
        await save(shareId, share);
        return json(200, { rev: share.rev });
      }
      case 'propose': {
        const { ops, summary } = body.proposal ?? {};
        if (!Array.isArray(ops) || !ops.length) return json(400, { error: 'ops required' });
        share.proposals.push({
          id: uid('p'), authorId: me.id, authorName: me.name,
          summary: String(summary ?? '').slice(0, MAX_TEXT), ops,
          status: 'open', at: new Date().toISOString(),
        });
        if (share.proposals.length > MAX_LIST) {
          const keep = share.proposals.filter((p) => p.status === 'open');
          share.proposals = [...share.proposals.filter((p) => p.status !== 'open').slice(-40), ...keep].slice(-MAX_LIST);
        }
        share.rev += 1;
        await save(shareId, share);
        return json(200, { rev: share.rev });
      }
      case 'resolve_proposal': {
        const deny = captainOnly();
        if (deny) return deny;
        const p = share.proposals.find((x) => x.id === body.proposalId);
        if (!p) return json(404, { error: 'no such proposal' });
        p.status = body.result === 'applied' ? 'applied' : 'declined';
        share.rev += 1;
        await save(shareId, share);
        return json(200, { rev: share.rev });
      }
      case 'comment': {
        const text = String(body.text ?? '').trim().slice(0, MAX_TEXT);
        if (!text) return json(400, { error: 'text required' });
        share.comments.push({ id: uid('c'), authorId: me.id, authorName: me.name, text, dayId: body.dayId ?? null, at: new Date().toISOString() });
        share.comments = share.comments.slice(-MAX_LIST);
        share.rev += 1;
        await save(shareId, share);
        return json(200, { rev: share.rev });
      }
      case 'vote': {
        me.vote = body.vote === 'in'
          ? { v: 'in', note: '', at: new Date().toISOString() }
          : body.vote === 'concern'
            ? { v: 'concern', note: String(body.note ?? '').slice(0, MAX_TEXT), at: new Date().toISOString() }
            : null;
        share.rev += 1;
        await save(shareId, share);
        return json(200, { rev: share.rev });
      }
      case 'set_status': {
        const deny = captainOnly();
        if (deny) return deny;
        if (!['draft', 'review', 'published'].includes(body.status)) return json(400, { error: 'bad status' });
        share.status = body.status;
        // calling a fresh review clears stale votes so the tally means this plan
        if (body.status === 'review') for (const m of share.members) m.vote = null;
        share.rev += 1;
        await save(shareId, share);
        return json(200, { rev: share.rev });
      }
      case 'remove_member': {
        const deny = captainOnly();
        if (deny) return deny;
        const idx = share.members.findIndex((m) => m.id === body.memberId && m.role !== 'captain');
        if (idx < 0) return json(404, { error: 'no such member' });
        share.members.splice(idx, 1);
        share.rev += 1;
        await save(shareId, share);
        return json(200, { rev: share.rev });
      }
      default:
        return json(400, { error: `unknown action ${action}` });
    }
  } catch (e) {
    return json(500, { error: String(e?.message ?? e) });
  }
};
