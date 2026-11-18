import type { Candle } from '../lib/terminal';

/** One value per candle; null where the indicator has no value yet. */
export type Series = (number | null)[];

export function sma(v: number[], n: number): Series {
  const out: Series = new Array(v.length).fill(null);
  let s = 0;
  for (let i = 0; i < v.length; i++) {
    s += v[i];
    if (i >= n) s -= v[i - n];
    if (i >= n - 1) out[i] = s / n;
  }
  return out;
}

/** Exponential moving average, seeded with the simple average of the first n values. */
export function ema(v: number[], n: number): Series {
  const out: Series = new Array(v.length).fill(null);
  if (v.length < n || n < 1) return out;
  const k = 2 / (n + 1);
  let e = 0;
  for (let i = 0; i < n; i++) e += v[i];
  e /= n;
  out[n - 1] = e;
  for (let i = n; i < v.length; i++) out[i] = e = v[i] * k + e * (1 - k);
  return out;
}

/** EMA over a series that starts with nulls. */
function emaOf(s: Series, n: number): Series {
  const start = s.findIndex((x) => x != null);
  if (start < 0) return s.map(() => null);
  const tail = ema(s.slice(start) as number[], n);
  return [...new Array(start).fill(null), ...tail];
}

/** Wilder's RSI. */
export function rsi(v: number[], n = 14): Series {
  const out: Series = new Array(v.length).fill(null);
  if (v.length <= n) return out;
  let g = 0;
  let l = 0;
  for (let i = 1; i <= n; i++) {
    const d = v[i] - v[i - 1];
    if (d > 0) g += d;
    else l -= d;
  }
  g /= n;
  l /= n;
  out[n] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  for (let i = n + 1; i < v.length; i++) {
    const d = v[i] - v[i - 1];
    g = (g * (n - 1) + Math.max(0, d)) / n;
    l = (l * (n - 1) + Math.max(0, -d)) / n;
    out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  return out;
}

/** Stochastic RSI: %K (smoothed) and %D, 0..100. */
export function stochRsi(v: number[], n = 14, stoch = 14, kS = 3, dS = 3): { k: Series; d: Series } {
  const r = rsi(v, n);
  const raw: Series = r.map((x, i) => {
    if (x == null || i < n + stoch - 1) return null;
    let lo = Infinity;
    let hi = -Infinity;
    for (let j = i - stoch + 1; j <= i; j++) {
      lo = Math.min(lo, r[j]!);
      hi = Math.max(hi, r[j]!);
    }
    return hi === lo ? 50 : ((x - lo) / (hi - lo)) * 100;
  });
  const smooth = (s: Series, m: number): Series => {
    const start = s.findIndex((x) => x != null);
    if (start < 0) return s;
    const tail = sma(s.slice(start) as number[], m);
    return [...new Array(start).fill(null), ...tail];
  };
  const clamp = (s: Series) => s.map((x) => (x == null ? null : Math.min(100, Math.max(0, x))));
  const k = clamp(smooth(raw, kS));
  return { k, d: clamp(smooth(k, dS)) };
}

export function macd(v: number[], fast = 12, slow = 26, signal = 9): { macd: Series; signal: Series; hist: Series } {
  const f = ema(v, fast);
  const s = ema(v, slow);
  const m: Series = v.map((_, i) => (f[i] != null && s[i] != null ? f[i]! - s[i]! : null));
  const sig = emaOf(m, signal);
  return { macd: m, signal: sig, hist: m.map((x, i) => (x != null && sig[i] != null ? x - sig[i]! : null)) };
}

export function bollinger(v: number[], n = 20, mult = 2): { mid: Series; upper: Series; lower: Series } {
  const mid = sma(v, n);
  const upper: Series = new Array(v.length).fill(null);
  const lower: Series = new Array(v.length).fill(null);
  for (let i = n - 1; i < v.length; i++) {
    const m = mid[i]!;
    let s = 0;
    for (let j = i - n + 1; j <= i; j++) s += (v[j] - m) ** 2;
    const sd = Math.sqrt(s / n);
    upper[i] = m + mult * sd;
    lower[i] = m - mult * sd;
  }
  return { mid, upper, lower };
}

/** Average true range (Wilder). */
export function atr(c: Candle[], n = 14): Series {
  const out: Series = new Array(c.length).fill(null);
  if (c.length <= n) return out;
  const tr = c.map((x, i) => (i ? Math.max(x.h - x.l, Math.abs(x.h - c[i - 1].c), Math.abs(x.l - c[i - 1].c)) : x.h - x.l));
  let a = 0;
  for (let i = 1; i <= n; i++) a += tr[i];
  a /= n;
  out[n] = a;
  for (let i = n + 1; i < c.length; i++) out[i] = a = (a * (n - 1) + tr[i]) / n;
  return out;
}

export function keltner(c: Candle[], n = 20, mult = 2): { mid: Series; upper: Series; lower: Series } {
  const mid = ema(
    c.map((x) => x.c),
    n,
  );
  const a = atr(c, n);
  return {
    mid,
    upper: mid.map((m, i) => (m != null && a[i] != null ? m + mult * a[i]! : null)),
    lower: mid.map((m, i) => (m != null && a[i] != null ? m - mult * a[i]! : null)),
  };
}

/** VWAP that restarts at each UTC day. */
export function vwap(c: Candle[]): Series {
  let day = -1;
  let pv = 0;
  let vol = 0;
  return c.map((x) => {
    const d = Math.floor(x.t / 86_400_000);
    if (d !== day) {
      day = d;
      pv = 0;
      vol = 0;
    }
    pv += ((x.h + x.l + x.c) / 3) * x.v;
    vol += x.v;
    return vol > 0 ? pv / vol : null;
  });
}

export interface VolumeProfile {
  lo: number;
  step: number;
  bins: number[];
  poc: number; // bin index
  vaLo: number; // bin index
  vaHi: number;
}

/** Index range around the busiest bin holding `share` of the total (value area). */
export function valueArea(bins: number[], share = 0.7): { poc: number; lo: number; hi: number } {
  let poc = 0;
  for (let i = 1; i < bins.length; i++) if (bins[i] > bins[poc]) poc = i;
  const total = bins.reduce((a, b) => a + b, 0);
  let lo = poc;
  let hi = poc;
  let sum = bins[poc] ?? 0;
  while (sum < total * share && (lo > 0 || hi < bins.length - 1)) {
    const up = hi < bins.length - 1 ? bins[hi + 1] : -1;
    const dn = lo > 0 ? bins[lo - 1] : -1;
    if (up >= dn) sum += bins[++hi];
    else sum += bins[--lo];
  }
  return { poc, lo, hi };
}

/** Volume at price: each candle's volume spread evenly over its high–low range. */
export function volumeProfile(c: Candle[], rows = 40): VolumeProfile | null {
  if (!c.length) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (const x of c) {
    lo = Math.min(lo, x.l);
    hi = Math.max(hi, x.h);
  }
  const step = (hi - lo) / rows || 1;
  const bins = new Array(rows).fill(0);
  for (const x of c) {
    const a = Math.min(rows - 1, Math.floor((x.l - lo) / step));
    const b = Math.min(rows - 1, Math.floor((x.h - lo) / step));
    const share = x.v / (b - a + 1);
    for (let i = a; i <= b; i++) bins[i] += share;
  }
  const va = valueArea(bins);
  return { lo, step, bins, poc: va.poc, vaLo: va.lo, vaHi: va.hi };
}

/** Highest high / lowest low over the previous n bars (not including the current one). */
export function donchian(c: Candle[], n: number): { hi: Series; lo: Series } {
  const hi: Series = new Array(c.length).fill(null);
  const lo: Series = new Array(c.length).fill(null);
  for (let i = n; i < c.length; i++) {
    let h = -Infinity;
    let l = Infinity;
    for (let j = i - n; j < i; j++) {
      h = Math.max(h, c[j].h);
      l = Math.min(l, c[j].l);
    }
    hi[i] = h;
    lo[i] = l;
  }
  return { hi, lo };
}
