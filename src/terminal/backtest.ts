import type { Candle } from '../lib/terminal';
import { bollinger, donchian, ema, macd, rsi, type Series } from './indicators';

export type Cond =
  | { k: 'emaCross'; fast: number; slow: number; dir: 'up' | 'down' }
  | { k: 'priceEma'; n: number; dir: 'above' | 'below' }
  | { k: 'rsi'; n: number; op: 'crossUp' | 'crossDown' | 'above' | 'below'; level: number }
  | { k: 'macd'; dir: 'up' | 'down' }
  | { k: 'bb'; n: number; mult: number; op: 'closeAbove' | 'closeBelow' }
  | { k: 'breakout'; n: number; dir: 'high' | 'low' };

export interface Strategy {
  name: string;
  side: 'long' | 'short';
  /** All must be true at a bar's close to enter at the next open. */
  entry: Cond[];
  /** Any true at a close exits at the next open. */
  exit: Cond[];
  slPct: number | null;
  tpPct: number | null;
  feePct: number; // per side, %
  slipPct: number; // per fill, %
  lev: number;
  /** Funding per 8 hours, %, paid by longs (received by shorts) while positive. */
  fundingPct: number;
  capital: number;
}

export const BINANCE_PERP_COSTS = { feePct: 0.05, slipPct: 0.02, fundingPct: 0.01 };

export const TEMPLATES: Strategy[] = [
  { name: 'EMA 9/21 cross', side: 'long', entry: [{ k: 'emaCross', fast: 9, slow: 21, dir: 'up' }], exit: [{ k: 'emaCross', fast: 9, slow: 21, dir: 'down' }], slPct: 3, tpPct: null, lev: 1, capital: 10_000, ...BINANCE_PERP_COSTS },
  { name: 'RSI 30 bounce', side: 'long', entry: [{ k: 'rsi', n: 14, op: 'crossUp', level: 30 }], exit: [{ k: 'rsi', n: 14, op: 'above', level: 70 }], slPct: 4, tpPct: 6, lev: 1, capital: 10_000, ...BINANCE_PERP_COSTS },
  { name: 'Trend + MACD', side: 'long', entry: [{ k: 'priceEma', n: 200, dir: 'above' }, { k: 'macd', dir: 'up' }], exit: [{ k: 'macd', dir: 'down' }], slPct: 2.5, tpPct: 5, lev: 1, capital: 10_000, ...BINANCE_PERP_COSTS },
  { name: 'Donchian 20 breakout', side: 'long', entry: [{ k: 'breakout', n: 20, dir: 'high' }], exit: [{ k: 'breakout', n: 10, dir: 'low' }], slPct: null, tpPct: null, lev: 1, capital: 10_000, ...BINANCE_PERP_COSTS },
  { name: 'Bollinger fade short', side: 'short', entry: [{ k: 'bb', n: 20, mult: 2, op: 'closeAbove' }], exit: [{ k: 'priceEma', n: 20, dir: 'below' }], slPct: 2, tpPct: 3, lev: 1, capital: 10_000, ...BINANCE_PERP_COSTS },
];

export interface BtTrade {
  side: 'long' | 'short';
  entryT: number;
  exitT: number;
  entry: number;
  exit: number;
  pnl: number; // money, after fees and funding
  pct: number; // pnl / equity at entry, %
  reason: 'signal' | 'sl' | 'tp' | 'liquidation' | 'end';
}

export interface Report {
  trades: BtTrade[];
  equity: { t: number; e: number; dd: number }[];
  netPct: number;
  buyHoldPct: number;
  winRate: number;
  profitFactor: number;
  maxDD: number; // %, positive
  avgPct: number;
  exposure: number; // share of bars in a position
  fees: number;
  funding: number;
  months: { m: string; pct: number }[];
}

/** Cached indicator arrays for one candle set. */
class Ctx {
  close: number[];
  private cache = new Map<string, Series>();
  constructor(public c: Candle[]) {
    this.close = c.map((x) => x.c);
  }
  get(key: string, make: () => Series): Series {
    let s = this.cache.get(key);
    if (!s) this.cache.set(key, (s = make()));
    return s;
  }
}

const cross = (a: Series, b: Series | number, i: number, up: boolean) => {
  const b0 = typeof b === 'number' ? b : b[i - 1];
  const b1 = typeof b === 'number' ? b : b[i];
  if (i < 1 || a[i - 1] == null || a[i] == null || b0 == null || b1 == null) return false;
  return up ? a[i - 1]! <= b0 && a[i]! > b1 : a[i - 1]! >= b0 && a[i]! < b1;
};

export function evalCond(cond: Cond, x: Ctx, i: number): boolean {
  const c = x.close;
  switch (cond.k) {
    case 'emaCross': {
      const f = x.get(`ema${cond.fast}`, () => ema(c, cond.fast));
      const s = x.get(`ema${cond.slow}`, () => ema(c, cond.slow));
      return cross(f, s, i, cond.dir === 'up');
    }
    case 'priceEma': {
      const e = x.get(`ema${cond.n}`, () => ema(c, cond.n))[i];
      return e != null && (cond.dir === 'above' ? c[i] > e : c[i] < e);
    }
    case 'rsi': {
      const r = x.get(`rsi${cond.n}`, () => rsi(c, cond.n));
      if (cond.op === 'crossUp') return cross(r, cond.level, i, true);
      if (cond.op === 'crossDown') return cross(r, cond.level, i, false);
      return r[i] != null && (cond.op === 'above' ? r[i]! > cond.level : r[i]! < cond.level);
    }
    case 'macd': {
      const m = x.get('macd', () => macd(c).macd);
      const s = x.get('macdSig', () => macd(c).signal);
      return cross(m, s, i, cond.dir === 'up');
    }
    case 'bb': {
      const key = `bb${cond.n}_${cond.mult}`;
      const up = x.get(`${key}u`, () => bollinger(c, cond.n, cond.mult).upper)[i];
      const lo = x.get(`${key}l`, () => bollinger(c, cond.n, cond.mult).lower)[i];
      return cond.op === 'closeAbove' ? up != null && c[i] > up : lo != null && c[i] < lo;
    }
    case 'breakout': {
      const d = x.get(`dc${cond.n}${cond.dir}`, () => (cond.dir === 'high' ? donchian(x.c, cond.n).hi : donchian(x.c, cond.n).lo))[i];
      return d != null && (cond.dir === 'high' ? c[i] > d : c[i] < d);
    }
  }
}

const FUNDING_MS = 8 * 3_600_000;
const MMR = 0.004;

/**
 * Runs a strategy over candles. Signals are read at each bar's close and filled at the
 * next bar's open (with slippage). Stops, targets and liquidation are checked inside each
 * bar; when a bar reaches both the stop and the target, the stop is assumed to come first.
 */
export function backtest(c: Candle[], st: Strategy): Report {
  const x = new Ctx(c);
  const long = st.side === 'long';
  const dir = long ? 1 : -1;
  const fee = st.feePct / 100;
  const slip = st.slipPct / 100;
  let cash = st.capital;
  let pos: { i: number; t: number; price: number; qty: number; eq: number; funding: number } | null = null;
  let wantIn = false;
  let wantOut = false;
  let fees = 0;
  let funding = 0;
  let inBars = 0;
  const trades: BtTrade[] = [];
  const equity: Report['equity'] = [];
  let peak = st.capital;

  const close = (price: number, t: number, reason: BtTrade['reason']) => {
    if (!pos) return;
    const f = pos.qty * price * fee;
    fees += f;
    const gross = (price - pos.price) * pos.qty * dir;
    const pnl = reason === 'liquidation' ? -pos.eq : gross - f - pos.qty * pos.price * fee - pos.funding;
    cash = reason === 'liquidation' ? cash - pos.eq + 0 : cash + gross - f - pos.funding;
    if (reason === 'liquidation') cash = Math.max(0, cash);
    trades.push({ side: st.side, entryT: pos.t, exitT: t, entry: pos.price, exit: price, pnl, pct: (pnl / pos.eq) * 100, reason });
    pos = null;
  };

  for (let i = 0; i < c.length; i++) {
    const b = c[i];
    if (i > 0) {
      if (wantOut && pos) close(b.o * (1 - dir * slip), b.t, 'signal');
      if (wantIn && !pos && cash > 0) {
        const price = b.o * (1 + dir * slip);
        const qty = (cash * st.lev) / price;
        const f = qty * price * fee;
        fees += f;
        cash -= f;
        pos = { i, t: b.t, price, qty, eq: cash, funding: 0 };
      }
      wantIn = wantOut = false;
      if (pos) {
        inBars++;
        const p = pos.price;
        const sl = st.slPct ? p * (1 - (dir * st.slPct) / 100) : null;
        const tp = st.tpPct ? p * (1 + (dir * st.tpPct) / 100) : null;
        const liq = st.lev > 1 ? p * (1 - dir * (1 / st.lev - MMR)) : long ? null : p * 2;
        const lo = b.l;
        const hi = b.h;
        const hit = (lvl: number | null, adverse: boolean) => lvl != null && (adverse === long ? lo <= lvl : hi >= lvl);
        // Gaps: if the bar opens past a level, fill at the open.
        const fillAt = (lvl: number, adverse: boolean) => (adverse === long ? Math.min(lvl, b.o) : Math.max(lvl, b.o));
        if (liq != null && hit(liq, true) && (sl == null || (long ? liq >= sl : liq <= sl))) close(liq, b.t, 'liquidation');
        else if (sl != null && hit(sl, true)) close(fillAt(sl, true) * (1 - dir * slip), b.t, 'sl');
        else if (tp != null && hit(tp, false)) close(i === pos.i ? tp : fillAt(tp, false), b.t, 'tp');
      }
      if (pos && st.fundingPct) {
        const prev = c[i - 1].t;
        const n = Math.floor(b.t / FUNDING_MS) - Math.floor(prev / FUNDING_MS);
        if (n > 0) {
          const amt = pos.qty * b.o * (st.fundingPct / 100) * n * dir;
          pos.funding += amt;
          funding += amt;
        }
      }
    }
    // Mark to market at the close.
    const e = pos ? cash + (b.c - pos.price) * pos.qty * dir - pos.funding : cash;
    peak = Math.max(peak, e);
    equity.push({ t: b.t, e, dd: peak > 0 ? ((peak - e) / peak) * 100 : 0 });
    // Signals at the close for the next bar.
    if (i < c.length - 1) {
      if (!pos && st.entry.length && st.entry.every((cd) => evalCond(cd, x, i))) wantIn = true;
      else if (pos && st.exit.some((cd) => evalCond(cd, x, i))) wantOut = true;
    }
  }
  if (pos && c.length) close(c[c.length - 1].c, c[c.length - 1].t, 'end');
  if (equity.length) equity[equity.length - 1].e = cash;

  const wins = trades.filter((t) => t.pnl > 0);
  const gain = wins.reduce((s, t) => s + t.pnl, 0);
  const loss = -trades.filter((t) => t.pnl <= 0).reduce((s, t) => s + t.pnl, 0);
  return {
    trades,
    equity,
    netPct: ((cash - st.capital) / st.capital) * 100,
    buyHoldPct: c.length ? ((c[c.length - 1].c - c[0].o) / c[0].o) * 100 * dir : 0,
    winRate: trades.length ? wins.length / trades.length : 0,
    profitFactor: loss ? gain / loss : gain ? Infinity : 0,
    maxDD: Math.max(0, ...equity.map((p) => p.dd)),
    avgPct: trades.length ? trades.reduce((s, t) => s + t.pct, 0) / trades.length : 0,
    exposure: c.length ? inBars / c.length : 0,
    fees,
    funding,
    months: monthly(equity),
  };
}

/** Return per calendar month (UTC) from the equity curve. */
export function monthly(eq: { t: number; e: number }[]): { m: string; pct: number }[] {
  const out: { m: string; pct: number }[] = [];
  let start = eq[0]?.e ?? 0;
  let cur = '';
  let last = start;
  for (const p of eq) {
    const d = new Date(p.t);
    const m = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    if (m !== cur) {
      if (cur) out.push({ m: cur, pct: start ? ((last - start) / start) * 100 : 0 });
      cur = m;
      start = last;
    }
    last = p.e;
  }
  if (cur) out.push({ m: cur, pct: start ? ((last - start) / start) * 100 : 0 });
  return out;
}

/** Seeded random numbers, so a Monte Carlo run is repeatable. */
export function rng(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

export interface MonteCarlo {
  runs: number;
  final: [number, number, number]; // 5th, 50th, 95th percentile return, %
  maxDD: [number, number, number];
}

/** Resamples trade returns (with replacement) to see the spread of outcomes. */
export function monteCarlo(trades: BtTrade[], runs = 1000, seed = 7): MonteCarlo | null {
  if (trades.length < 2) return null;
  const r = rng(seed);
  const finals: number[] = [];
  const dds: number[] = [];
  for (let k = 0; k < runs; k++) {
    let e = 1;
    let peak = 1;
    let dd = 0;
    for (let i = 0; i < trades.length; i++) {
      e *= 1 + trades[Math.floor(r() * trades.length)].pct / 100;
      e = Math.max(0, e);
      peak = Math.max(peak, e);
      dd = Math.max(dd, (peak - e) / peak);
    }
    finals.push((e - 1) * 100);
    dds.push(dd * 100);
  }
  const q = (a: number[], p: number) => a.sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(p * a.length))];
  return { runs, final: [q(finals, 0.05), q(finals, 0.5), q(finals, 0.95)], maxDD: [q(dds, 0.05), q(dds, 0.5), q(dds, 0.95)] };
}

/* ------------------------------------------------------------------ */
/* Optimizer                                                           */
/* ------------------------------------------------------------------ */

/** A numeric field of the strategy: "slPct", "tpPct" or "entry.0.fast" etc. */
export type ParamPath = string;

export function numericParams(st: Strategy): ParamPath[] {
  const out: ParamPath[] = [];
  for (const list of ['entry', 'exit'] as const)
    st[list].forEach((cd, i) => {
      for (const [k, v] of Object.entries(cd)) if (typeof v === 'number') out.push(`${list}.${i}.${k}`);
    });
  return [...out, 'slPct', 'tpPct'];
}

export function getParam(st: Strategy, path: ParamPath): number | null {
  const [a, i, k] = path.split('.');
  if (!i) return (st[a as 'slPct'] as number | null) ?? null;
  const v = (st[a as 'entry'][Number(i)] as Record<string, unknown> | undefined)?.[k];
  return typeof v === 'number' ? v : null;
}

export function setParam(st: Strategy, path: ParamPath, v: number): Strategy {
  const [a, i, k] = path.split('.');
  if (!i) return { ...st, [a]: v };
  const list = st[a as 'entry'].map((cd, j) => (j === Number(i) ? ({ ...cd, [k]: v } as Cond) : cd));
  return { ...st, [a]: list };
}

export interface Range {
  path: ParamPath;
  from: number;
  to: number;
  step: number;
}

const values = (r: Range) => {
  const out: number[] = [];
  if (!(r.step > 0) || r.to < r.from) return [r.from];
  for (let v = r.from; v <= r.to + 1e-9 && out.length < 25; v += r.step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
};

export interface OptResult {
  params: Record<ParamPath, number>;
  inSample: { netPct: number; maxDD: number; trades: number; profitFactor: number };
  outSample: { netPct: number; maxDD: number; trades: number; profitFactor: number };
}

/**
 * Tries every combination of up to two parameters on the first `split` of the bars,
 * ranks by return there, and reports each one's result on the held-out rest.
 */
export function optimize(c: Candle[], st: Strategy, ranges: Range[], split = 0.7, top = 10): OptResult[] {
  const cut = Math.floor(c.length * split);
  const a = c.slice(0, cut);
  const b = c.slice(cut);
  const grid: Record<ParamPath, number>[] = [{}];
  for (const r of ranges.slice(0, 2)) {
    const next: Record<ParamPath, number>[] = [];
    for (const g of grid) for (const v of values(r)) next.push({ ...g, [r.path]: v });
    grid.splice(0, grid.length, ...next);
  }
  const pick = (r: Report) => ({ netPct: r.netPct, maxDD: r.maxDD, trades: r.trades.length, profitFactor: r.profitFactor });
  const res = grid.map((params) => {
    let s = st;
    for (const [p, v] of Object.entries(params)) s = setParam(s, p, v);
    return { params, s, ins: backtest(a, s) };
  });
  res.sort((x, y) => y.ins.netPct - x.ins.netPct);
  return res.slice(0, top).map((r) => ({ params: r.params, inSample: pick(r.ins), outSample: pick(backtest(b, r.s)) }));
}
