import React, { useState } from 'react';
import { useTrip } from '../engine/store.js';
import { useT } from '../engine/settings.jsx';
import { SYNC_ENABLED, signIn, signOut, publishTrip, joinTrip, fetchTrip } from '../engine/supabase.js';

// Sharing, in Settings. Deliberately small: sign in, publish, or join with a
// code. Everything else about sync is invisible — the trip either has riders on
// it or it does not.
export default function SyncPanel({ sync }) {
  const { state, dispatch } = useTrip();
  const t = useT();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

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

  // Signed out: one field, one button. No passwords for anyone.
  if (!sync.user) {
    return (
      <div className="set-sync">
        <span className="set-label">{t('Share')}</span>
        <p className="set-note">{t('Sign in to share this trip with your riders. Every change syncs to everyone.')}</p>
        <div className="sync-row">
          <input
            type="email"
            value={email}
            placeholder={t('you@example.com')}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button
            className="btn gold"
            disabled={busy || !email.includes('@')}
            onClick={() => run(() => signIn(email), t('Check your email for the sign-in link.'))}
          >{t('Send link')}</button>
        </div>
        {note && <p className="set-note">{note}</p>}
      </div>
    );
  }

  const remote = state.remote;

  return (
    <div className="set-sync">
      <span className="set-label">{t('Share')}</span>

      {remote?.joinCode ? (
        <>
          <p className="set-note">{t('Riders join with this code. Everything they change appears here.')}</p>
          <div className="join-code">{remote.joinCode}</div>
          <p className="set-note">
            {sync.status === 'live' && t('Live')}
            {sync.status === 'syncing' && `${t('Syncing')} · ${sync.pending}`}
            {sync.status === 'error' && `${t('Waiting for signal')} · ${sync.pending}`}
            {sync.status === 'offline' && t('Offline')}
          </p>
        </>
      ) : (
        <>
          <div className="sync-row">
            <button
              className="btn gold"
              disabled={busy}
              onClick={() => run(async () => {
                const { id, joinCode } = await publishTrip(state.trip, state.trip.meta.title);
                dispatch({ type: 'set_remote', remote: { tripId: id, joinCode, seq: 0 } });
              }, t('Shared. Send the code to your riders.'))}
            >{t('Share this trip')}</button>
          </div>
          <div className="sync-row">
            <input
              value={code}
              placeholder={t('Join code')}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
            <button
              className="btn"
              disabled={busy || code.trim().length < 4}
              onClick={() => run(async () => {
                const tripId = await joinTrip(code, null);
                const { row, ops } = await fetchTrip(tripId);
                // Adopt the shared trip wholesale, then replay anything after
                // the snapshot — this device's own copy is not the truth now.
                dispatch({ type: 'load_trip', trip: row.snapshot });
                if (ops.length) {
                  dispatch({ type: 'apply_ops', ops: ops.flatMap((r) => r.ops), remote: true });
                }
                dispatch({
                  type: 'set_remote',
                  remote: { tripId, joinCode: row.join_code, seq: ops.at(-1)?.seq ?? row.snapshot_seq },
                });
              }, t('Joined.'))}
            >{t('Join')}</button>
          </div>
        </>
      )}

      {note && <p className="set-note">{note}</p>}
      <button className="btn set-signout" onClick={() => signOut()}>{t('Sign out')}</button>
    </div>
  );
}
