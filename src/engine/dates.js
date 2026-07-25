// Date helpers: trips own a startDate; day dates cascade from position.

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

export function dowOf(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

// Short calendar label like "8/9" from an ISO date.
export function fmtDayDate(iso) {
  if (!iso) return '';
  return `${+iso.slice(5, 7)}/${+iso.slice(8, 10)}`;
}

export function fmtLongDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

// Re-pin every day's date/dow to startDate + index. Call after any day add/remove/reorder
// or startDate change.
export function cascadeDates(trip) {
  const start = trip.meta.startDate;
  if (!start) return trip;
  trip.days.forEach((d, i) => {
    d.date = addDays(start, i);
    d.dow = dowOf(d.date);
  });
  trip.meta.nights = Math.max(0, trip.days.length - 1);
  return trip;
}
