export type Lang = 'id' | 'en';

const loc = (l: Lang) => (l === 'id' ? 'id-ID' : 'en-US');

export const idr = (v: number, l: Lang = 'id', digits = 0) =>
  new Intl.NumberFormat(loc(l), { style: 'currency', currency: 'IDR', maximumFractionDigits: digits }).format(v);

export const usd = (v: number, l: Lang = 'id', digits = 0) =>
  new Intl.NumberFormat(loc(l), { style: 'currency', currency: 'USD', maximumFractionDigits: digits }).format(v);

export const num = (v: number, l: Lang = 'id', digits = 0) =>
  new Intl.NumberFormat(loc(l), { maximumFractionDigits: digits }).format(v);

export const btc = (v: number, l: Lang = 'id') =>
  `${new Intl.NumberFormat(loc(l), { maximumFractionDigits: 8 }).format(v)} BTC`;

export const pct = (v: number, l: Lang = 'id') =>
  `${v >= 0 ? '+' : ''}${new Intl.NumberFormat(loc(l), { maximumFractionDigits: 2 }).format(v)}%`;

export const compact = (v: number, l: Lang = 'id') =>
  new Intl.NumberFormat(loc(l), { notation: 'compact', maximumFractionDigits: 2 }).format(v);

export const dateTime = (v: string | number | Date, l: Lang = 'id') =>
  new Intl.DateTimeFormat(loc(l), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(v));

export const dateOnly = (v: string | number | Date, l: Lang = 'id') =>
  new Intl.DateTimeFormat(loc(l), { dateStyle: 'medium' }).format(new Date(v));

export const monthLabel = (v: string | number | Date, l: Lang = 'id') =>
  new Intl.DateTimeFormat(loc(l), { month: 'short', year: 'numeric' }).format(new Date(v));

export function ago(v: string | number | Date, l: Lang = 'id'): string {
  const s = Math.round((Date.now() - new Date(v).getTime()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(loc(l), { numeric: 'auto' });
  if (s < 60) return rtf.format(-s, 'second');
  if (s < 3600) return rtf.format(-Math.round(s / 60), 'minute');
  if (s < 86400) return rtf.format(-Math.round(s / 3600), 'hour');
  return rtf.format(-Math.round(s / 86400), 'day');
}

export const short = (s: string, n = 8) => (s.length > n * 2 + 1 ? `${s.slice(0, n)}…${s.slice(-n)}` : s);
