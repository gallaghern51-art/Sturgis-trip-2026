// App-wide settings: language (en/es) and theme (dark/light), persisted per
// browser in moto.settings.v1. The theme lands as data-theme on <html> so CSS
// variable overrides do the work; language flows through t() below.
//
// t() covers the app CHROME — buttons, headings, labels. Trip content (day
// summaries, waypoint notes, module prose) is data written by the group and
// renders as authored; the optimizer answers in whatever language it's asked.

import React, { createContext, useContext, useEffect, useState } from 'react';

const KEY = 'moto.settings.v1';
const DEFAULTS = { lang: 'en', theme: 'dark' };

function load() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...DEFAULTS }; }
}

const SettingsContext = createContext({ ...DEFAULTS, set: () => {} });

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(load);

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
    try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* full */ }
  }, [settings]);

  const set = (patch) => setSettings((s) => ({ ...s, ...patch }));
  return <SettingsContext.Provider value={{ ...settings, set }}>{children}</SettingsContext.Provider>;
}

export const useSettings = () => useContext(SettingsContext);

// ---- chrome dictionary ----
// Keyed by the English string so call sites stay readable: t('Feasibility').
// Missing keys fall back to English rather than breaking the UI.

const ES = {
  // masthead / menu
  'Menu': 'Menú',
  'Trip controls': 'Controles del viaje',
  'New trip': 'Nuevo viaje',
  'Delete current trip': 'Eliminar viaje actual',
  'Save current as scenario': 'Guardar como escenario',
  'Trips': 'Viajes',
  'Scenarios': 'Escenarios',
  'Load': 'Cargar',
  'Plan': 'Plan',
  'Feasibility': 'Factibilidad',
  'Budget': 'Presupuesto',
  'Ride': 'Rodar',
  'Undo': 'Deshacer',
  'Export': 'Exportar',
  'Import': 'Importar',
  'Reset': 'Restablecer',
  'Optimizer': 'Optimizador',
  'Hide': 'Ocultar',
  'Packing': 'Equipaje',
  'Settings': 'Ajustes',
  'Map': 'Mapa',
  'Trip': 'Viaje',
  'riders': 'motociclistas',
  'days': 'días',
  // day panel
  'Day': 'Día',
  'of': 'de',
  'Depart': 'Salida',
  'End': 'Fin',
  'Miles': 'Millas',
  'Ride hrs': 'Hrs en ruta',
  'Stop hrs': 'Hrs parado',
  'Longest fuel gap': 'Mayor tramo sin gasolina',
  'Hard constraints': 'Restricciones duras',
  'Route & stops': 'Ruta y paradas',
  'drag ⠿ to reorder · tap to zoom the map · ⓘ for details': 'arrastra ⠿ para reordenar · toca para acercar el mapa · ⓘ para detalles',
  'Conditions': 'Condiciones',
  'Optional modules': 'Módulos opcionales',
  'Food': 'Comida',
  'Photo stops': 'Paradas de foto',
  'Lodging': 'Alojamiento',
  'Operations': 'Operaciones',
  'click ✎ to edit': 'toca ✎ para editar',
  'total': 'total',
  // packing
  'Packing list': 'Lista de equipaje',
  'Per rider — saves on this device only, so each rider checks off their own.': 'Por motociclista — se guarda solo en este dispositivo, cada uno marca la suya.',
  'packed': 'listo',
  'Uncheck all': 'Desmarcar todo',
  'Close': 'Cerrar',
  // settings
  'Language': 'Idioma',
  'English': 'Inglés',
  'Spanish': 'Español',
  'Theme': 'Tema',
  'Dark': 'Oscuro',
  'Light': 'Claro',
  'Applies on this device only. Trip text and AI answers stay in the language they were written in — ask the optimizer in Spanish and it answers in Spanish.': 'Se aplica solo en este dispositivo. El texto del viaje y las respuestas de la IA quedan en el idioma en que fueron escritos — pregúntale al optimizador en español y responde en español.',
  // misc chrome
  'Feasibility studies': 'Estudios de factibilidad',
  'The whole trip at a glance': 'El viaje completo de un vistazo',
  'nights': 'noches',
};

export function useT() {
  const { lang } = useSettings();
  return (s) => (lang === 'es' ? (ES[s] ?? s) : s);
}
