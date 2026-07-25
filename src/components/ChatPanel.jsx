import React, { useEffect, useRef, useState } from 'react';
import { useTrip } from '../engine/store.js';
import { tripDigest } from '../engine/tripEngine.js';
import { feasibilityDigest } from '../engine/timeline.js';
import { splitsDigest } from '../engine/splits.js';
import { describeOps } from '../engine/ops.js';
import { readPlannerStream } from '../engine/stream.js';

const SUGGESTIONS = [
  'Run a full feasibility read — where does this plan break?',
  'Where should we break up the loops and the long days?',
  'Rebuild the trip to fix every failed gate and save it as "Fixed gates"',
  'Give me a lower-mileage permutation of the whole trip, save as "Relaxed"',
];

export default function ChatPanel({ onClose }) {
  const { state, dispatch, routedLegsByDay } = useTrip();
  const [messages, setMessages] = useState([]); // {role, content}
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [building, setBuilding] = useState(0); // chars of tool JSON streamed so far
  const [setupNeeded, setSetupNeeded] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy, state.pendingProposal]);

  // Questions queued from elsewhere in the app (feasibility break-up recs) auto-send.
  useEffect(() => {
    if (state.chatAsk && !busy) {
      const text = state.chatAsk;
      dispatch({ type: 'clear_chat_ask' });
      send(text);
    }
  }, [state.chatAsk]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async (text) => {
    const content = (text ?? input).trim();
    if (!content || busy) return;
    setInput('');
    const next = [...messages, { role: 'user', content }];
    setMessages(next);
    setBusy(true);
    setBuilding(0);
    dispatch({ type: 'clear_proposal' });
    try {
      const res = await fetch('/.netlify/functions/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Local failure notices are UI artifacts, not conversation — replaying
          // them just invites the model to retry whatever already failed.
          messages: next.filter((m) => !m.local),
          tripDigest: `${tripDigest(state.trip, routedLegsByDay)}\n\n${feasibilityDigest(state.trip, routedLegsByDay)}\n\n${splitsDigest(state.trip, routedLegsByDay)}`,
          tripJson: state.trip,
          scenarios: state.scenarios.map((s) => ({ id: s.id, name: s.name, savedAt: s.savedAt })),
        }),
      });
      // streamed NDJSON: deltas render live, 'done' carries text + proposal
      let live = '';
      let started = false;
      const data = await readPlannerStream(res, (obj) => {
        if (obj.type === 'building') setBuilding(obj.chars);
        if (obj.type === 'delta') {
          live += obj.text;
          if (!started) {
            started = true;
            setMessages((m) => [...m, { role: 'assistant', content: live, streaming: true }]);
          } else {
            setMessages((m) => m.map((x, i) => (i === m.length - 1 && x.streaming ? { ...x, content: live } : x)));
          }
        }
      });
      const finalText = data.text || '(proposed changes below)';
      setMessages((m) => {
        const rest = m[m.length - 1]?.streaming ? m.slice(0, -1) : m;
        return [...rest, { role: 'assistant', content: finalText }];
      });
      if (data.proposal?.ops?.length) {
        dispatch({ type: 'set_proposal', proposal: data.proposal });
      }
    } catch (err) {
      if (err.code === 'not_configured') {
        setSetupNeeded(true);
        setMessages((m) => [...m, { role: 'assistant', local: true, content: 'The optimizer needs an Anthropic API key configured on Netlify before it can run — see the note below.' }]);
      } else {
        setMessages((m) => {
          // Drop the half-streamed reply — partial text reads as an answer.
          const rest = m[m.length - 1]?.streaming ? m.slice(0, -1) : m;
          return [...rest, { role: 'assistant', local: true, content: err.message }];
        });
        // Hand the question back rather than making them retype it.
        setInput((cur) => cur || content);
      }
    } finally {
      setBusy(false);
      setBuilding(0);
    }
  };

  const applyProposal = () => {
    const { ops, saveAs, overwriteScenarioId } = state.pendingProposal;
    dispatch({ type: 'apply_ops', ops });
    const target = state.scenarios.find((s) => s.id === overwriteScenarioId);
    if (target) dispatch({ type: 'overwrite_scenario', id: target.id });
    else if (saveAs) dispatch({ type: 'save_scenario', name: saveAs });
    dispatch({ type: 'clear_proposal' });
    setMessages((m) => [...m, {
      role: 'assistant',
      content: target
        ? `Applied and updated scenario “${target.name}” — compare permutations in the Feasibility view.`
        : saveAs
          ? `Applied and saved as “${saveAs}” — compare permutations in the Feasibility view, Undo reverses the working plan.`
          : 'Applied. The map, timeline, and feasibility have recomputed — Undo reverses it if it reads wrong.',
    }]);
  };

  const proposal = state.pendingProposal;

  return (
    <div className="chat-panel">
      <div className="chat-head">
        <span className="t">Trip <i>Optimizer</i></span>
        <button className="btn" onClick={onClose}>✕</button>
      </div>
      <div className="chat-msgs" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="msg ai">
            I hold the whole plan — every waypoint, booking, fuel stop, and constraint — plus the live metrics from your edits. Ask for analysis, or tell me to rework the trip and I'll propose concrete changes you can preview and apply.
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role === 'user' ? 'user' : 'ai'}`}>{m.content}</div>
        ))}
        {busy && (
          <div className="msg ai">
            <span className="thinking">
              {building > 0
                ? `drafting changes… ${building.toLocaleString()} characters`
                : 'analyzing the route…'}
            </span>
          </div>
        )}
      </div>

      {proposal && (
        <div className="proposal">
          <div className="p-title">Proposed changes{proposal.saveAs ? ` → saves as “${proposal.saveAs}”` : ''}</div>
          <div style={{ fontSize: 13, color: 'var(--ink)', marginTop: 4 }}>{proposal.summary}</div>
          <ul>
            {describeOps(state.trip, proposal.ops).map((d, i) => <li key={i}>{d}</li>)}
          </ul>
          <div className="p-actions">
            <button className="btn gold" onClick={applyProposal}>Apply</button>
            <button className="btn" onClick={() => dispatch({ type: 'clear_proposal' })}>Dismiss</button>
          </div>
        </div>
      )}

      {setupNeeded && (
        <div className="chat-setup">
          <b>One-time setup:</b> in the Netlify dashboard for this site, add an environment variable
          named <code>ANTHROPIC_API_KEY</code> (from console.anthropic.com), then redeploy. Everything
          else in the app works without it.
        </div>
      )}

      {messages.length === 0 && (
        <div className="chat-suggest">
          {SUGGESTIONS.map((s) => (
            <button key={s} onClick={() => send(s)}>{s}</button>
          ))}
        </div>
      )}

      <div className="chat-input">
        <textarea
          value={input}
          placeholder="Ask, or tell me to rework the trip…"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button className="btn gold" onClick={() => send()} disabled={busy}>Send</button>
      </div>
    </div>
  );
}
