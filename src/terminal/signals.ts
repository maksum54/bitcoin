import type { Candle } from '../lib/terminal';
import { ema, rsi } from './indicators';

export interface Pivot {
  i: number;
  p: number;
  kind: 'high' | 'low';
}

/** Swing highs / lows: a bar higher (lower) than `left` bars before and `right` bars after. */
export function pivots(c: Candle[], left = 3, right = 3): Pivot[] {
  const out: Pivot[] = [];
  for (let i = left; i < c.length - right; i++) {
    let hi = true;
    let lo = true;
    for (let j = i - left; j <= i + right; j++) {
      if (j === i) continue;
      if (c[j].h >= c[i].h) hi = false;
      if (c[j].l <= c[i].l) lo = false;
    }
    if (hi) out.push({ i, p: c[i].h, kind: 'high' });
    if (lo) out.push({ i, p: c[i].l, kind: 'low' });
  }
  return out.sort((a, b) => a.i - b.i);
}

export interface ThreeDrive {
  dir: 'bull' | 'bear'; // bull = three falling drives (expect a bounce)
  drives: Pivot[]; // the three drive pivots
  /** RSI did not confirm the third drive (divergence). */
  divergence: boolean;
  barsAgo: number;
}

/**
 * Three drives: three pushes in one direction, each a new extreme, with corrections
 * between them and the pushes of similar size (each within 0.5–2× of the one before).
 * Only patterns whose third drive is among the last `recent` bars are returned.
 */
export function threeDrives(c: Candle[], recent = 8, left = 3, right = 2): ThreeDrive | null {
  if (c.length < 30) return null;
  const pv = pivots(c, left, right);
  const r = rsi(
    c.map((x) => x.c),
    14,
  );
  for (const dir of ['bear', 'bull'] as const) {
    const kind = dir === 'bear' ? 'high' : 'low';
    const other = dir === 'bear' ? 'low' : 'high';
    const ext = pv.filter((p) => p.kind === kind);
    if (ext.length < 3) continue;
    const [d1, d2, d3] = ext.slice(-3);
    if (c.length - 1 - d3.i > recent + right) continue;
    const better = (a: number, b: number) => (dir === 'bear' ? b > a : b < a);
    if (!better(d1.p, d2.p) || !better(d2.p, d3.p)) continue;
    // A correction between each pair of drives.
    const corr = (a: Pivot, b: Pivot) => pv.filter((p) => p.kind === other && p.i > a.i && p.i < b.i);
    const c1 = corr(d1, d2);
    const c2 = corr(d2, d3);
    if (!c1.length || !c2.length) continue;
    const pick = (ps: Pivot[]) => ps.reduce((m, p) => (dir === 'bear' ? (p.p < m.p ? p : m) : p.p > m.p ? p : m));
    const r1 = Math.abs(d2.p - pick(c1).p);
    const r2 = Math.abs(d3.p - pick(c2).p);
    const ratio = r2 / r1;
    if (!(ratio >= 0.5 && ratio <= 2)) continue;
    // Spacing roughly even.
    const s1 = d2.i - d1.i;
    const s2 = d3.i - d2.i;
    if (s2 / s1 < 0.33 || s2 / s1 > 3) continue;
    const r2v = r[d2.i];
    const r3v = r[d3.i];
    const divergence = r2v != null && r3v != null && (dir === 'bear' ? r3v < r2v : r3v > r2v);
    return { dir, drives: [d1, d2, d3], divergence, barsAgo: c.length - 1 - d3.i };
  }
  return null;
}

export type SignalKind = 'threeDriveBull' | 'threeDriveBear' | 'rsiOversold' | 'rsiOverbought' | 'goldenCross' | 'deathCross';

export interface Signal {
  kind: SignalKind;
  detail?: string;
}

/** All signals found on the latest bars of a market. */
export function scanCandles(c: Candle[]): Signal[] {
  const out: Signal[] = [];
  const td = threeDrives(c);
  if (td) out.push({ kind: td.dir === 'bull' ? 'threeDriveBull' : 'threeDriveBear', detail: td.divergence ? 'RSI div' : undefined });
  const closes = c.map((x) => x.c);
  const r = rsi(closes, 14);
  const last = r[r.length - 1];
  if (last != null && last <= 30) out.push({ kind: 'rsiOversold', detail: last.toFixed(0) });
  if (last != null && last >= 70) out.push({ kind: 'rsiOverbought', detail: last.toFixed(0) });
  const f = ema(closes, 50);
  const s = ema(closes, 200);
  for (let i = Math.max(1, c.length - 3); i < c.length; i++) {
    if (f[i - 1] == null || s[i - 1] == null || f[i] == null || s[i] == null) continue;
    if (f[i - 1]! <= s[i - 1]! && f[i]! > s[i]!) out.push({ kind: 'goldenCross' });
    if (f[i - 1]! >= s[i - 1]! && f[i]! < s[i]!) out.push({ kind: 'deathCross' });
  }
  return out;
}

const SKIP = /^(USDC|FDUSD|TUSD|BUSD|USDP|DAI|EUR|AEUR|EURI|USD1|XUSD|PAXG|WBTC|WBETH|BFUSD)USDT$|(UP|DOWN|BULL|BEAR)USDT$/;

/** The busiest USDT markets from a 24h ticker list, without stablecoins and leveraged tokens. */
export function topSymbols(tickers: { symbol: string; quoteVolume: string }[], n: number): string[] {
  return tickers
    .filter((t) => t.symbol.endsWith('USDT') && !SKIP.test(t.symbol))
    .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
    .slice(0, n)
    .map((t) => t.symbol);
}
