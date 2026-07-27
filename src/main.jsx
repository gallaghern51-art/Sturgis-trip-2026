import React from 'react';
import { createRoot } from 'react-dom/client';
import 'maplibre-gl/dist/maplibre-gl.css';
import './styles/app.css';
import App from './App.jsx';
import { SettingsProvider } from './engine/settings.jsx';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <SettingsProvider>
      <App />
    </SettingsProvider>
  </React.StrictMode>
);
