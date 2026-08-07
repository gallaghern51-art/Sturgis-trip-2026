import React, { useEffect, useState } from 'react';
import { useTrip } from '../engine/store.js';
import { useT } from '../engine/settings.jsx';
import {
  SYNC_ENABLED, signIn, signInAnonymously, signOut,
  publishTrip, joinTrip, fetchTrip, fetchMembers,
} from '../engine/supabase.js';

// Sharing. Two doors, because the two people using them want different things.
//
//   Riders  tap Join, type a name and the code, and they are in. No email, no
//           password, no inbox — a rider on the side of a road in the Bighorns
//           should not have to reach an email client to see the trip, and two
//           of these riders are in Chile.
//   Owner   signs in with email, so the trip is recoverable on a new phone.
export default function SyncPanel({ sync }) {
  const { state, dispatch } = useTrip();
  const t = useT();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [members, setMembers] = useState([]);
  const remote = state.remote;

  useEffect(() => {
    if (!remote?.tripId || !sync.user) return;
    fetchMembers(remote.tripId).then(setMembers);
  }, [remote?.tripId, sync.user, sync.status]);

  if (!SYNC_ENABLED) {
    return (
      <div className="set-sync">
        <span className="set-label">{t('Share')}</span>
        <p className="set-note">{t('Sharing is not configured on this build.')}</p>
      </div>
    );
  }

  const run = async (fn, ok) => {
    setBusy(true); setNote('');
    try { await fn(); setNote(ok); } catch (e) { setNote(e.message || String(e)); }
    setBusy(false);
  };

  const adopt = async (tripId) => {
    const { row, ops } = await fetchTrip(tripId);
    // The shared copy is the truth now; this device's own is not.
    dispatch({ type: 'load_trip', trip: row.snapshot });
    if (ops.length) dispatch({ type: 'apply_ops', ops: ops.flatMap((r) => r.ops), remote: true });
    dispatch({
      type: 'set_remote',
      remote: { tripId, joinCode: row.join_code, seq: ops.at(-1)?.seq ?? row.snapshot_seq },
    });
  };

  // ---- already on a shared trip: show the code and who is on it ----
  if (remote?.joinCode && sync.user) {
    return (
      <div className="set-sync">
        <span className="set-label">{t('Share')}</span>
        <p className="set-note">{t('Riders join with this code. Everything they change appears here.')}</p>
        <div className="join-code">{remote.joinCode}</div>
        <p className={`sync-status ${sync.status}`}>
          {sync.status === 'live' && t('Live')}
          {sync.status === 'syncing' && `${t('Syncing')} · ${sync.pending}`}
          {sync.status === 'error' && `${t('Waiting for signal')} · ${sync.pending}`}
          {sync.status === 'offline' && t('Offline')}
        </p>
        {members.length > 0 && (
          <ul className="rider-list">
            {members.map((m) => (
              <li key={m.user_id}>{m.name || t('Rider')}</li>
            ))}
          </ul>
        )}
        <button className="btn set-signout" onClick={() => signOut()}>{t('Sign out')}</button>
      </div>
    );
  }

  return (
    <div className="set-sync">
      <span className="set-label">{t('Share')}</span>

      {/* Riders first: it is the path six of seven people take. */}
      <p className="set-note">{t('Joining a trip? Enter your name and the code the organiser sent.')}</p>
      <div className="sync-row">
        <input value={name} placeholder={t('Your name')} onChange={(e) => setName(e.target.value)} />
        <input
          className="code-in"
          value={code}
          placeholder={t('Join code')}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
        />
      </div>
      <div className="sync-row">
        <button
          className="btn gold"
          disabled={busy || code.trim().length < 4 || !name.trim()}
          onClick={() => run(async () => {
            if (!sync.user) await signInAnonymously(name.trim());
            const tripId = await joinTrip(code, name.trim());
            await adopt(tripId);
          }, t('Joined.'))}
        >{t('Join trip')}</button>
      </div>

      <div className="sync-or">{t('or')}</div>

      {/* Owner: a real account, because they own the trip. */}
      {sync.user && !sync.user.is_anonymous ? (
        <div className="sync-row">
          <button
            className="btn"
            disabled={busy}
            onClick={() => run(async () => {
              const { id, joinCode } = await publishTrip(state.trip, state.trip.meta.title);
              dispatch({ type: 'set_remote', remote: { tripId: id, joinCode, seq: 0 } });
            }, t('Shared. Send the code to your riders.'))}
          >{t('Share this trip')}</button>
        </div>
      ) : (
        <>
          <p className="set-note">{t('Organising the trip? Sign in by email so it is recoverable on a new phone.')}</p>
          <div className="sync-row">
            <input
              type="email"
              value={email}
              placeholder={t('you@example.com')}
              onChange={(e) => setEmail(e.target.value)}
            />
            <button
              className="btn"
              disabled={busy || !email.includes('@')}
              onClick={() => run(() => signIn(email), t('Check your email for the sign-in link.'))}
            >{t('Send link')}</button>
          </div>
        </>
      )}

      {note && <p className="set-note">{note}</p>}
      {sync.user && <button className="btn set-signout" onClick={() => signOut()}>{t('Sign out')}</button>}
    </div>
  );
}
