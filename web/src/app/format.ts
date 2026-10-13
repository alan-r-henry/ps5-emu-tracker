const nf = new Intl.NumberFormat('en');

export const fmt = (n: number | null | undefined): string =>
  n == null || Number.isNaN(n) ? '—' : nf.format(n);

export const pct = (share: number | null | undefined, digits = 1): string =>
  share == null || Number.isNaN(share) ? '—' : `${(share * 100).toFixed(digits)}%`;

export const signed = (n: number, f: (v: number) => string): string =>
  (n > 0 ? '+' : n < 0 ? '−' : '±') + f(Math.abs(n));

const asDate = (iso: string): Date => new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);

export const shortDate = (iso: string): string =>
  asDate(iso).toLocaleDateString('en', { month: 'short', day: 'numeric', timeZone: 'UTC' });

export const longDate = (iso: string): string =>
  asDate(iso).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

export const stamp = (iso: string): string =>
  asDate(iso).toLocaleString('en', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC',
  });

export const utcDay = (d: Date): string => d.toISOString().slice(0, 10);

export const daysBefore = (iso: string, n: number): string =>
  utcDay(new Date(asDate(iso).getTime() - n * 864e5));

export function timeAgo(then: Date, now: Date): string {
  const s = Math.max(0, Math.round((now.getTime() - then.getTime()) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

/** Round, evenly spaced ticks from 0 up to at least `max`. */
export function niceTicks(max: number, count = 4): number[] {
  if (!(max > 0)) return [0, 1];
  const raw = max / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const err = raw / pow;
  const step = Math.max(1, (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1) * pow);
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let t = 0; t <= top + step / 2; t += step) ticks.push(Math.round(t));
  return ticks;
}
