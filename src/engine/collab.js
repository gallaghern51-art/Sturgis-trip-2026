// Collaborate-mode client: membership records + the collab function's API.
// Membership (which share a library trip belongs to, and your key/role in it)
// lives in localStorage per device — same posture as chat and packing checks.

const KEY = 'moto.collab.v1';

function readAll() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
}
function writeAll(map) {
  try { localStorage.setItem(KEY, JSON.stringify(map)); } catch { /* full — non-fatal */ }
}

export function collabFor(tripId) {
  return readAll()[tripId] ?? null;
}
// An invite link tapped twice must reopen the trip, not join a second copy.
export function tripIdForShare(shareId) {
  const map = readAll();
  return Object.keys(map).find((tripId) => map[tripId]?.shareId === shareId) ?? null;
}
export function saveCollab(tripId, rec) {
  const map = readAll();
  map[tripId] = rec;
  writeAll(map);
}
export function clearCollab(tripId) {
  const map = readAll();
  delete map[tripId];
  writeAll(map);
}

export async function collabApi(payload) {
  const res = await fetch('/.netlify/functions/collab', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `collab ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export function inviteLink(shareId, joinCode) {
  return `${location.origin}${location.pathname}?join=${shareId}.${joinCode}`;
}

export function parseJoinParam() {
  const m = /[?&]join=(sh[a-z0-9]+)\.([a-z0-9]+)/.exec(location.search);
  return m ? { shareId: m[1], joinCode: m[2] } : null;
}
