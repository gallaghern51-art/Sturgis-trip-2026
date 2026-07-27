import React, { useState } from 'react';
import { useSettings, useT } from '../engine/settings.jsx';

// Language + theme, per device. Both apply instantly; nothing to save.
export default function SettingsModal({ onClose }) {
  const { lang, theme, units, shields, set } = useSettings();
  const t = useT();
  const [devOpen, setDevOpen] = useState(false);

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
              <button className={lang === 'en' ? 'active' : ''} onClick={() => set({ lang: 'en' })}>🇺🇸 {t('English')}</button>
              <button className={lang === 'es' ? 'active' : ''} onClick={() => set({ lang: 'es' })}>🇨🇱 {t('Spanish')}</button>
            </div>
          </div>
          <div className="set-row">
            <span className="set-label">{t('Theme')}</span>
            <div className="set-seg">
              <button className={theme === 'dark' ? 'active' : ''} onClick={() => set({ theme: 'dark' })}>◐ {t('Dark')}</button>
              <button className={theme === 'light' ? 'active' : ''} onClick={() => set({ theme: 'light' })}>◑ {t('Light')}</button>
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
              {devOpen ? '▾' : '▸'} {t('Developer')}
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
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
