// Job records for the background planner (Netlify Blobs store "planner-jobs").
//
// Reads are strong-consistency on purpose: the client polls about once a
// second and gives up on the whole background transport if a fresh claim
// write stays invisible past its timeout — an eventually-consistent read can
// serve a stale record well past that window and push a job that is actually
// running onto the much smaller streaming budget.
//
// Local dev runs the functions inside the vite process, where Blobs has no
// site context — a module-level Map keeps the background transport testable
// locally: planner-background and planner-status both load this one module in
// the same dev-server process, so they share the Map (same pattern as
// collab.mjs). In production getStore succeeds and the Map is never touched.
const devMem = new Map();
const memStore = {
  get: async (k, opts) => {
    const v = devMem.get(k);
    return v == null ? null : opts?.type === 'json' ? JSON.parse(v) : v;
  },
  setJSON: async (k, v) => { devMem.set(k, JSON.stringify(v)); },
};

let blobsMod;
export async function jobStore() {
  if (blobsMod === undefined) {
    try { blobsMod = await import('@netlify/blobs'); } catch { blobsMod = null; }
  }
  if (blobsMod) {
    try { return blobsMod.getStore({ name: 'planner-jobs', consistency: 'strong' }); } catch { /* no Blobs env — dev */ }
  }
  return memStore;
}
