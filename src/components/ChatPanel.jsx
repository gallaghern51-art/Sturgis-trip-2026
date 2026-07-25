import React, { useEffect, useRef, useState } from 'react';
import { useTrip } from '../engine/store.js';
import { tripDigest } from '../engine/tripEngine.js';
import { feasibilityDigest } from '../engine/timeline.js';
import { describeOps } from '../engine/ops.js';

const SUGGESTIONS = [
  'Run a full feasibility read — where does this plan break?',
  'Rebuild the trip to fix every failed gate and save it as "Fixed gates"',
  'Give me a lower-mileage permutation of the whole trip, save as "Relaxed"',
  'Fit the Badlands in — show me the honest trade-off',
];

export default function ChatPanel({ onClose }) {
  const { state, dispatch, routedLegsByDay } = useTrip();
  const [messages, setMessages] = useState([]); // {role, content}
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [setupNeeded, setSetupNeeded] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy, state.pendingProposal]);

  const send = async (text) => {
    const content = (text ?? input).trim();
    if (!content || busy) return;
    setInput('');
    const next = [...messages, { role: 'user', content }];
    setMessages(next);
    setBusy(true);
    dispatch({ type: 'clear_proposal' });
    try {
      const res = await fetch('/.netlify/functions/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: next,
          tripDigest: `${tripDigest(state.trip, routedLegsByDay)}\n\n${feasibilityDigest(state.trip, routedLegsByDay)}`,
          tripJson: state.trip,
          scenarios: state.scenarios.map((s) => ({ id: s.id, name: s.name, savedAt: s.savedAt })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 503 && data.error === 'not_configured') {
        setSetupNeeded(true);
        setMessages((m) => [...m, { role: 'assistant', content: 'The optimizer needs an Anthropic API key configured on Netlify before it can run — see the note below.' }]);
        return;
      }
      if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
      setMessages((m) => [...m, { role: 'assistant', content: data.text || '(proposed changes below)' }]);
      if (data.proposal?.ops?.length) {
        dispatch({ type: 'set_proposal', proposal: data.proposal });
      }
    } catch (err) {
      setMessages((m) => [...m, { role: 'assistant', content: `Something went wrong: ${err.message}. Try again.` }]);
    } finally {
      setBusy(false);
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
        {busy && <div className="msg ai"><span className="thinking">analyzing the route…</span></div>}
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
