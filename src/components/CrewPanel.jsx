import React, { useEffect, useState } from 'react';
import { useTrip } from '../engine/store.js';
import { describeOps } from '../engine/ops.js';
import { inviteLink } from '../engine/collab.js';
import { useT, useTT } from '../engine/settings.jsx';

// Collaborate mode. Road-captain governance: the captain owns the working
// plan; riders edit in their local sandbox and send the session as a proposal
// (the same ops + summary shape the AI uses — one proposal system); comments
// carry recommendations; a review collects votes; the captain publishes.
// Votes are advisory and visible — consensus with a tiebreaker, the way a
// ride group actually works.

const fmtWhen = (iso) => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export default function CrewPanel() {
  const { state, dispatch, collab } = useTrip();
  const t = useT();
  const tt = useTT();
  const { info, crew, busy, error } = collab;
  const [name, setName] = useState('');
  const [comment, setComment] = useState('');
  const [concernOpen, setConcernOpen] = useState(false);
  const [note, setNote] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => { if (info) collab.refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- not shared yet: the pitch + the one action ----
  if (!info) {
    return (
      <div className="crew-panel">
        <div className="section">
          <h3>{t('Ride together')}</h3>
          <p className="crew-pitch">
            {t('Share this trip with the crew. Riders join from a link, make edits that arrive as proposals, drop recommendations, and vote when the plan is ready. You stay road captain — the plan publishes when you say it does.')}
          </p>
          <div className="crew-start">
            <input
              placeholder={t('Your name — shown to the crew')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) collab.start(name.trim()); }}
            />
            <button className="btn gold" disabled={!name.trim() || busy} onClick={() => collab.start(name.trim())}>
              {busy ? t('Starting…') : t('Start sharing')}
            </button>
          </div>
          {error && <div className="warning danger">⚠ {error}</div>}
        </div>
      </div>
    );
  }

  if (!crew) {
    return (
      <div className="crew-panel">
        <p className="prep-empty">{error ? `⚠ ${error}` : t('Reaching the crew…')}</p>
        {error && <button className="btn" onClick={() => collab.refresh()}>{t('Retry')}</button>}
      </div>
    );
  }

  const me = crew.me;
  const isCaptain = me?.role === 'captain';
  const riders = crew.members.filter((m) => m.role !== 'captain');
  const inCount = riders.filter((m) => m.vote?.v === 'in').length;
  const concerns = riders.filter((m) => m.vote?.v === 'concern');
  const openProposals = crew.proposals.filter((p) => p.status === 'open');
  const unsent = state.opLog.length;

  const statusLine = crew.status === 'draft'
    ? t('Planning is open — edit, propose, recommend.')
    : crew.status === 'review'
      ? t('The captain called the vote. Say whether you\'re in.')
      : t('The plan is published. Prep continues; the route is locked.');

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink(info.shareId, crew.joinCode));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable — the link is visible to select */ }
  };

  const sendProposal = () => {
    const ops = state.opLog;
    if (!ops.length) return;
    const summary = describeOps(state.trip, ops).slice(0, 4).join(' · ');
    collab.act('propose', { proposal: { ops, summary } }).then(() => {
      // the edits live in the proposal now — fall back onto the group plan
      dispatch({ type: 'sync_trip', trip: crew.trip });
      dispatch({ type: 'collab_mark' });
    });
  };

  const discardLocal = () => {
    dispatch({ type: 'sync_trip', trip: crew.trip });
    dispatch({ type: 'collab_mark' });
  };

  const applyProposal = (p) => {
    dispatch({ type: 'apply_ops', ops: p.ops }); // captain's auto-push syncs it out
    collab.act('resolve_proposal', { proposalId: p.id, result: 'applied' });
  };

  return (
    <div className="crew-panel">
      <div className="section">
        <h3>
          {t('Crew')} <span className="cnt">{crew.members.length}</span>
          <span className={`crew-status st-${crew.status}`}>{t(crew.status === 'draft' ? 'DRAFT' : crew.status === 'review' ? 'VOTING' : 'PUBLISHED')}</span>
        </h3>
        <p className="crew-line">{statusLine}</p>

        {isCaptain && (
          <div className="crew-captain-row">
            {crew.status === 'draft' && (
              <button className="btn gold" onClick={() => collab.act('set_status', { status: 'review' })}>{t('Call the vote')}</button>
            )}
            {crew.status === 'review' && (
              <>
                <span className="crew-tally">{inCount}/{riders.length} {t('in')}{concerns.length ? ` · ${concerns.length} ${t('concerns')}` : ''}</span>
                <button className="btn gold" onClick={() => collab.act('set_status', { status: 'published' })}>{t('Publish the plan')}</button>
                <button className="btn" onClick={() => collab.act('set_status', { status: 'draft' })}>{t('Back to planning')}</button>
              </>
            )}
            {crew.status === 'published' && (
              <button className="btn" onClick={() => collab.act('set_status', { status: 'draft' })}>{t('Reopen planning')}</button>
            )}
          </div>
        )}

        {isCaptain && crew.status !== 'published' && crew.joinCode && (
          <div className="crew-invite">
            <input readOnly value={inviteLink(info.shareId, crew.joinCode)} onFocus={(e) => e.target.select()} />
            <button className="btn" onClick={copyLink}>{copied ? t('Copied ✓') : t('Copy invite')}</button>
          </div>
        )}
      </div>

      {/* a rider's unsent edit session */}
      {!isCaptain && unsent > 0 && (
        <div className="section crew-unsent">
          <h3>{t('Your changes')} <span className="cnt">{unsent}</span></h3>
          <ul className="crew-ops">
            {describeOps(state.trip, state.opLog).slice(0, 5).map((d, i) => <li key={i}>{d}</li>)}
            {unsent > 5 && <li>…</li>}
          </ul>
          <div className="crew-btn-row">
            <button className="btn gold" onClick={sendProposal}>{t('Send to the captain')}</button>
            <button className="btn" onClick={discardLocal}>{t('Discard & resync')}</button>
          </div>
        </div>
      )}

      {/* the vote */}
      {crew.status === 'review' && !isCaptain && (
        <div className="section">
          <h3>{t('Your vote')}</h3>
          <div className="crew-btn-row">
            <button
              className={`btn${me?.vote?.v === 'in' ? ' gold' : ''}`}
              onClick={() => collab.act('vote', { vote: 'in' })}
            >✓ {t('I\'m in')}</button>
            <button
              className={`btn${me?.vote?.v === 'concern' ? ' danger-ghost' : ''}`}
              onClick={() => setConcernOpen((v) => !v)}
            >{t('I have concerns')}</button>
          </div>
          {concernOpen && (
            <div className="crew-concern">
              <input
                placeholder={t('What worries you — day, distance, budget…')}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <button
                className="btn"
                disabled={!note.trim()}
                onClick={() => { collab.act('vote', { vote: 'concern', note: note.trim() }); setConcernOpen(false); setNote(''); }}
              >{t('Send')}</button>
            </div>
          )}
        </div>
      )}

      {/* who's aboard */}
      <div className="section">
        <h3>{t('Riders')}</h3>
        {crew.members.map((m) => (
          <div key={m.id} className="crew-member">
            <span className={`cm-role${m.role === 'captain' ? ' cap' : ''}`}>{m.role === 'captain' ? '★' : '●'}</span>
            <span className="cm-name">{m.name}{m.id === me?.id ? ` (${t('you')})` : ''}</span>
            {m.vote?.v === 'in' && <span className="cm-vote in">✓ {t('in')}</span>}
            {m.vote?.v === 'concern' && <span className="cm-vote concern" title={m.vote.note}>⚠ {t('concerns')}</span>}
            {isCaptain && m.role !== 'captain' && (
              <button className="mini-edit" title={t('Remove from crew')} onClick={() => collab.act('remove_member', { memberId: m.id })}>✕</button>
            )}
          </div>
        ))}
        {concerns.length > 0 && isCaptain && (
          <ul className="crew-concern-list">
            {concerns.map((m) => <li key={m.id}><b>{m.name}</b> — {m.vote.note || t('no note')}</li>)}
          </ul>
        )}
      </div>

      {/* proposals — the same shape the AI sends */}
      <div className="section">
        <h3>{t('Proposals')} <span className="cnt">{openProposals.length} {t('open')}</span></h3>
        {crew.proposals.length === 0 && <p className="prep-empty">{t('None yet. Rider edits arrive here for the captain\'s call.')}</p>}
        {[...crew.proposals].reverse().slice(0, 12).map((p) => (
          <div key={p.id} className={`crew-proposal ${p.status}`}>
            <div className="cp-head">
              <b>{p.authorName}</b>
              <span className="cp-when">{fmtWhen(p.at)}</span>
              {p.status !== 'open' && <span className={`cp-st ${p.status}`}>{t(p.status === 'applied' ? 'applied' : 'declined')}</span>}
            </div>
            {p.summary && <div className="cp-summary">{p.summary}</div>}
            {p.status === 'open' && (
              <ul className="crew-ops">
                {describeOps(state.trip, p.ops).slice(0, 6).map((d, i) => <li key={i}>{d}</li>)}
              </ul>
            )}
            {isCaptain && p.status === 'open' && (
              <div className="crew-btn-row">
                <button className="btn gold" onClick={() => applyProposal(p)}>{t('Apply')}</button>
                <button className="btn" onClick={() => collab.act('resolve_proposal', { proposalId: p.id, result: 'declined' })}>{t('Decline')}</button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* recommendations */}
      <div className="section">
        <h3>{t('Recommendations')}</h3>
        {crew.comments.length === 0 && <p className="prep-empty">{t('Nothing yet — routes, roadhouses, must-sees.')}</p>}
        {[...crew.comments].reverse().slice(0, 20).map((c) => (
          <div key={c.id} className="crew-comment">
            <b>{c.authorName}</b> <span className="cp-when">{fmtWhen(c.at)}</span>
            <div>{c.text}</div>
          </div>
        ))}
        <div className="crew-concern">
          <input
            placeholder={t('Recommend a road, a stop, a change…')}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && comment.trim()) { collab.act('comment', { text: comment.trim() }); setComment(''); } }}
          />
          <button className="btn" disabled={!comment.trim()} onClick={() => { collab.act('comment', { text: comment.trim() }); setComment(''); }}>{t('Send')}</button>
        </div>
      </div>
    </div>
  );
}
