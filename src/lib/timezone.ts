/** Browser-local timezone (IANA name, e.g. America/New_York). */
export function getAppTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** Short label for the local timezone (e.g. PST, GMT+8). */
export function getTimezoneLabel(): string {
  const parts = new Intl.DateTimeFormat(undefined, {
    timeZoneName: 'short',
  }).formatToParts(new Date());
  return parts.find((p) => p.type === 'timeZoneName')?.value ?? getAppTimezone();
}

/** YYYY-MM-DD for a timestamp in the user's local timezone. */
export function toDateKey(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Value for `<input type="datetime-local">` in the user's local timezone. */
export function toDatetimeLocal(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Current local date & time formatted for `<input type="datetime-local">`. */
export function nowDatetimeLocal(): string {
  return toDatetimeLocal(Date.now());
}

/** Parse datetime-local string as local time → epoch ms. */
export function parseDatetimeLocal(value: string): number {
  if (!value) return NaN;
  const normalized = value.length === 16 ? `${value}:00` : value;
  return new Date(normalized).getTime();
}

export function shiftDateKey(key: string, days: number): string {
  const base = parseDatetimeLocal(`${key}T12:00`);
  return toDateKey(base + days * 86_400_000);
}

export function formatDateLocal(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatTimeLocal(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDateTimeLocal(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
