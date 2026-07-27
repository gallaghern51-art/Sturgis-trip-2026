import React from 'react';
import { useSettings, useT } from '../engine/settings.jsx';

// Language + theme, per device. Both apply instantly; nothing to save.
export default function SettingsModal({ onClose }) {
  const { lang, theme, set } = useSettings();
  const t = useT();

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
          <p className="set-note">
            {t('Applies on this device only. Trip text and AI answers stay in the language they were written in — ask the optimizer in Spanish and it answers in Spanish.')}
          </p>
        </div>
      </div>
    </div>
  );
}
