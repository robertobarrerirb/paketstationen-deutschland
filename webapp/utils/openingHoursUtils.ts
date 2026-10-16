import { OpeningHours } from '@/types/pakketpunten';

export type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

/** Monday first, as written by the pipeline (scripts/common.py DAY_KEYS). Labels: t(`day.${key}`). */
export const DAY_KEYS: DayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

/** The pipeline writes "closed"; the UI shows t('hours.closed'). */
export const CLOSED = 'closed';

// JS Date.getDay(): 0=Sun..6=Sat → 'mon'..'sun'
export function dayKeyForDate(d: Date): DayKey {
  const js = d.getDay();
  return DAY_KEYS[(js + 6) % 7];
}

export function minutesForDate(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

export function parseHHMM(s: string): number | null {
  const m = s.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

interface Window {
  start: number;
  end: number;
}

// Parse "09:00 - 18:00" or "09:00 - 12:00, 13:00 - 18:00" → list of windows.
// Returns null if no recognisable window is found.
function parseWindows(value: string): Window[] | null {
  if (!value || /closed|ferm|chiuso/i.test(value)) return [];
  const matches = [...value.matchAll(/(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})/g)];
  if (matches.length === 0) return null;
  const windows: Window[] = [];
  for (const m of matches) {
    const start = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    const end = parseInt(m[3], 10) * 60 + parseInt(m[4], 10);
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      windows.push({ start, end });
    }
  }
  return windows;
}

/**
 * Check whether a point is open at (day, minuteOfDay).
 *
 * Returns:
 *   true  → definitely open at that time
 *   false → definitely closed
 *   null  → unknown (no data, or unparseable free-text format)
 */
export function isOpenAt(
  hours: OpeningHours | null | undefined,
  day: DayKey,
  minuteOfDay: number,
): boolean | null {
  if (hours == null) return null;

  if (typeof hours === 'string') {
    const windows = parseWindows(hours);
    if (windows == null) return null;
    if (windows.length === 0) return false;
    // String form has no day info → assume the same window applies every day.
    return windows.some((w) => minuteOfDay >= w.start && minuteOfDay < w.end);
  }

  const dayValue = hours[day];
  if (dayValue == null) return null;
  const windows = parseWindows(dayValue);
  if (windows == null) return null;
  if (windows.length === 0) return false;
  return windows.some((w) => minuteOfDay >= w.start && minuteOfDay < w.end);
}
