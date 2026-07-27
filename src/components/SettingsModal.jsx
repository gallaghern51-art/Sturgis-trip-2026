import React, { useState } from 'react';
import { useSettings, useT } from '../engine/settings.jsx';
import { useTrip } from '../engine/store.js';
import { translationCoverage } from '../i18n/collect.js';
import { translateTrip } from '../engine/translate.js';

// Language + theme, per device. Both apply instantly; nothing to save.
export default function SettingsModal({ onClose }) {
  const { lang, theme, units, shields, set } = useSettings();
  const t = useT();
  const [devOpen, setDevOpen] = useState(false);
  const { state, dispatch } = useTrip();
  const [busy, setBusy] = useState(null); // {done,total} while a run is going
  const [note, setNote] = useState('');
  const coverage = translationCoverage(state.trip, 'es');

  // Fills trip.i18n.es for whatever this trip is missing. Works the same for an
  // AI-generated trip as for the bundled one — nothing here knows about Sturgis.
  const runTranslate = async () => {
    setNote('');
    setBusy({ done: 0, total: coverage.missing.length });
    try {
      const { translations, failed } = await translateTrip(state.trip, 'es', setBusy);
      dispatch({ type: 'save_translations', lang: 'es', translations });
      setNote(failed ? `${failed} ${t('strings could not be translated — run again to retry them.')}` : t('Done.'));
    } catch (err) {
      setNote(err?.message ?? String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal settings" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{t('Settings')}</h3>
          <button className="btn" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="set-row">
            <span className="set-label">{t('Language')}</span>
            <div className="set-seg">
              <button className={lang === 'en' ? 'active' : ''} onClick={() => set({ lang: 'en' })}>{t('English')}</button>
              <button className={lang === 'es' ? 'active' : ''} onClick={() => set({ lang: 'es' })}>{t('Spanish')}</button>
            </div>
          </div>
          {/* Content translation is a property of the TRIP, not of the app, so it
              is managed here per trip rather than shipped in source. */}
          <div className="set-xlate">
            <div className="set-xlate-head">
              <span className="set-label">{t('Trip text')}</span>
              <span className="set-xlate-count">
                {coverage.done}/{coverage.total} {t('translated to Spanish')}
              </span>
            </div>
            {coverage.missing.length > 0 ? (
              <>
                <button className="btn" disabled={!!busy} onClick={runTranslate}>
                  {busy
                    ? `${t('Translating')} ${busy.done}/${busy.total}…`
                    : `${t('Translate')} ${coverage.missing.length} ${t('remaining')}`}
                </button>
                <p className="set-note">
                  {t('Sends this trip\'s text to the optimizer for translation and stores the result on the trip, so it travels with export and import. Place names, road numbers and addresses are left as written.')}
                </p>
              </>
            ) : (
              <p className="set-note">{t('This trip is fully translated.')}</p>
            )}
            {note && <p className="set-note">{note}</p>}
          </div>

          <div className="set-row">
            <span className="set-label">{t('Theme')}</span>
            <div className="set-seg">
              <button className={theme === 'dark' ? 'active' : ''} onClick={() => set({ theme: 'dark' })}>{t('Dark')}</button>
              <button className={theme === 'light' ? 'active' : ''} onClick={() => set({ theme: 'light' })}>{t('Light')}</button>
            </div>
          </div>
          <div className="set-row">
            <span className="set-label">{t('Units')}</span>
            <div className="set-seg">
              <button className={units === 'imperial' ? 'active' : ''} onClick={() => set({ units: 'imperial' })}>{t('Imperial (mi, °F)')}</button>
              <button className={units === 'metric' ? 'active' : ''} onClick={() => set({ units: 'metric' })}>{t('Metric (km, °C)')}</button>
            </div>
          </div>
          <p className="set-note">
            {t('Applies on this device only. Trip text and AI answers stay in the language they were written in — ask the optimizer in Spanish and it answers in Spanish.')}
          </p>

          {/* Experiments live behind a fold so the everyday settings stay to
              three choices. Anything in here can be pulled without ceremony. */}
          <div className="set-dev">
            <button className="set-dev-toggle" aria-expanded={devOpen} onClick={() => setDevOpen((v) => !v)}>
              {devOpen ? '▾' : '▸'} {t('Developer tools')}
            </button>
            {devOpen && (
              <div className="set-dev-body">
                <div className="set-row">
                  <span className="set-label">{t('Highway shields')}</span>
                  <div className="set-seg">
                    <button className={shields ? 'active' : ''} onClick={() => set({ shields: true })}>{t('On')}</button>
                    <button className={!shields ? 'active' : ''} onClick={() => set({ shields: false })}>{t('Off')}</button>
                  </div>
                </div>
                <p className="set-note">{t('Route shields under each stop. Experimental — remove it if it reads as clutter.')}</p>
                <div className="set-build">
                  <span className="set-label">{t('Build')}</span>
                  <code>
                    {__APP_PR__ ? `PR #${__APP_PR__} · ` : ''}
                    {__APP_BRANCH__ ? `${__APP_BRANCH__} · ` : ''}
                    {__APP_COMMIT__} · v{__APP_VERSION__} · {__APP_BUILT__}
                  </code>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
