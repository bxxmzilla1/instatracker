/** App-wide schedule timezone (Philippines, UTC+8, no DST). */
export const APP_TIMEZONE = 'Asia/Manila';

/** YYYY-MM-DD for a timestamp in Philippines time. */
export function toDateKeyPH(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms));
}

/** Value for `<input type="datetime-local">` interpreted as Philippines time. */
export function toDatetimeLocalPH(ms: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

/** Parse datetime-local string as Philippines time → epoch ms. */
export function parseDatetimeLocalPH(value: string): number {
  if (!value) return NaN;
  const normalized = value.length === 16 ? `${value}:00` : value;
  return new Date(`${normalized}+08:00`).getTime();
}

export function shiftDateKeyPH(key: string, days: number): string {
  const base = parseDatetimeLocalPH(`${key}T12:00`);
  return toDateKeyPH(base + days * 86_400_000);
}

export function formatDatePH(ms: number): string {
  return new Date(ms).toLocaleDateString('en-PH', {
    timeZone: APP_TIMEZONE,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatTimePH(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-PH', {
    timeZone: APP_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDateTimePH(ms: number): string {
  return new Date(ms).toLocaleString('en-PH', {
    timeZone: APP_TIMEZONE,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
