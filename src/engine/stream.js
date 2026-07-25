// Read an NDJSON streaming response from the planner function.
// Calls onLine for every parsed line; returns the final 'done' payload.
// Throws on {type:'error'} lines and non-streamed error bodies (e.g. 503 setup).

export async function readPlannerStream(res, onLine) {
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('ndjson')) {
    // non-streamed path: config errors etc. arrive as plain JSON
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.message || `HTTP ${res.status}`);
      err.code = data.error;
      err.status = res.status;
      throw err;
    }
    return data;
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let done = null;
  let sawWork = false; // any real output at all, vs. a stream that died cold
  for (;;) {
    const { value, done: eof } = await reader.read();
    if (eof) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let obj;
      try { obj = JSON.parse(line); } catch { continue; }
      if (obj.type === 'error') throw new Error(obj.message || 'planner error');
      if (obj.type === 'done') done = obj;
      if (obj.type === 'delta' || obj.type === 'building') sawWork = true;
      onLine?.(obj);
    }
  }
  if (!done) {
    // The server emits a terminal line on every path it controls, so reaching
    // EOF without one means the connection itself was severed — almost always
    // the function being killed on a long answer.
    const err = new Error(
      sawWork
        ? 'The optimizer was cut off partway through its answer — the request ran longer than the server allows. Ask for one day, or one leg, at a time.'
        : 'The connection to the optimizer dropped before it answered. Check your signal and try again.'
    );
    err.code = 'stream_truncated';
    throw err;
  }
  return done;
}
