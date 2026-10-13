import { fmt } from './format';

export interface Point {
  date: string;
  value: number;
}

export type Forecast =
  | { kind: 'done' }
  | { kind: 'early'; days: number; needed: number }
  | { kind: 'flat'; window: number }
  | { kind: 'eta'; date: Date; perMonth: number; window: number };

const DAY = 86_400_000;
const MONTH_DAYS = 30.44;
const dayMs = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

/**
 * Straight-line projection: when `target` is reached if the pace over the last `windowDays` holds.
 * Needs `minDays` of history first, so a single burst of reports can't produce a date.
 */
export function project(points: Point[], target: number, windowDays = 90, minDays = 21): Forecast {
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const last = sorted.at(-1);
  if (!last) return { kind: 'early', days: 0, needed: minDays };
  if (last.value >= target) return { kind: 'done' };
  const from = sorted.find((p) => dayMs(p.date) >= dayMs(last.date) - windowDays * DAY)!;
  const span = (dayMs(last.date) - dayMs(sorted[0].date)) / DAY;
  if (span < minDays) return { kind: 'early', days: Math.round(span), needed: minDays };
  const days = (dayMs(last.date) - dayMs(from.date)) / DAY;
  const perDay = (last.value - from.value) / days;
  if (!(perDay > 0)) return { kind: 'flat', window: Math.round(days) };
  const date = new Date(dayMs(last.date) + ((target - last.value) / perDay) * DAY);
  return { kind: 'eta', date, perMonth: perDay * MONTH_DAYS, window: Math.round(days) };
}

/** "around March 2027" when it's close, "around 2041" when it isn't. */
export function when(f: Extract<Forecast, { kind: 'eta' }>): string {
  const year = f.date.getUTCFullYear();
  if (year > 2100) return 'after 2100';
  if (f.date.getTime() - Date.now() > 2 * 365 * DAY) return `around ${year}`;
  return `around ${f.date.toLocaleDateString('en', { month: 'long', year: 'numeric', timeZone: 'UTC' })}`;
}

export function pace(f: Extract<Forecast, { kind: 'eta' }>, unit: (n: number) => string): string {
  return `at ${unit(f.perMonth)} a month, the pace of the last ${fmt(f.window)} days`;
}
