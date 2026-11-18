import type { Candle, Trade } from '../lib/terminal';
import { valueArea } from './indicators';

/* ------------------------------------------------------------------ */
/* Market profile (TPO)                                                */
/* ------------------------------------------------------------------ */

export type Session = 'day' | 'week';

export interface TpoRow {
  p: number; // bucket low price
  letters: string;
}

export interface TpoProfile {
  start: number; // session start, ms
  rows: TpoRow[]; // low → high
  poc: number; // price
  vaLo: number;
  vaHi: number;
  open: number;
  close: number;
  high: number;
  low: number;
  /** Bucket prices with one TPO inside the profile (not at its extremes). */
  singles: number[];
  /** True when the high / low bucket has two or more TPOs (an unfinished auction). */
  poorHigh: boolean;
  poorLow: boolean;
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXabcdefghijklmnopqrstuvwxyz';

export const sessionStart = (t: number, s: Session) => {
  const day = Math.floor(t / 86_400_000) * 86_400_000;
  if (s === 'day') return day;
  const dow = (new Date(day).getUTCDay() + 6) % 7; // Monday = 0
  return day - dow * 86_400_000;
};

/** Builds one profile per session from 30-minute candles (one letter per period). */
export function tpoProfiles(c: Candle[], step: number, session: Session = 'day'): TpoProfile[] {
  const groups = new Map<number, Candle[]>();
  for (const x of c) {
    const s = sessionStart(x.t, session);
    if (!groups.has(s)) groups.set(s, []);
    groups.get(s)!.push(x);
  }
  const out: TpoProfile[] = [];
  for (const [start, cs] of groups) {
    const rows = new Map<number, string>();
    cs.forEach((x, i) => {
      // Daily: a letter per 30 min; weekly: a letter per day.
      const li = session === 'day' ? i : Math.floor((x.t - start) / 86_400_000);
      const letter = LETTERS[li % LETTERS.length];
      for (let b = Math.floor(x.l / step); b <= Math.floor(x.h / step); b++) {
        const s = rows.get(b) ?? '';
        if (!s.endsWith(letter)) rows.set(b, s + letter);
      }
    });
    const keys = [...rows.keys()].sort((a, b) => a - b);
    const list = keys.map((k) => ({ p: Math.round(k * step * 1e8) / 1e8, letters: rows.get(k)! }));
    const va = valueArea(list.map((r) => r.letters.length));
    // POC tie → the one closest to the middle of the range.
    const maxN = list[va.poc].letters.length;
    const mid = (list.length - 1) / 2;
    let poc = va.poc;
    list.forEach((r, i) => r.letters.length === maxN && Math.abs(i - mid) < Math.abs(poc - mid) && (poc = i));
    out.push({
      start,
      rows: list,
      poc: list[poc].p,
      vaLo: list[va.lo].p,
      vaHi: list[va.hi].p,
      open: cs[0].o,
      close: cs[cs.length - 1].c,
      high: Math.max(...cs.map((x) => x.h)),
      low: Math.min(...cs.map((x) => x.l)),
      singles: list.filter((r, i) => i > 0 && i < list.length - 1 && r.letters.length === 1).map((r) => r.p),
      poorHigh: list.length > 1 && list[list.length - 1].letters.length >= 2,
      poorLow: list.length > 1 && list[0].letters.length >= 2,
    });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** A bucket size giving about `rows` rows over the price range. */
export function autoStep(lo: number, hi: number, rows = 40): number {
  const raw = (hi - lo) / rows;
  if (!(raw > 0)) return 1;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const f = raw / mag;
  return (f < 1.5 ? 1 : f < 3.5 ? 2.5 : f < 7.5 ? 5 : 10) * mag;
}

/* ------------------------------------------------------------------ */
/* Footprint                                                           */
/* ------------------------------------------------------------------ */

export interface Cell {
  bid: number; // volume sold by takers (hit the bid)
  ask: number; // volume bought by takers (lifted the ask)
}

/** Base store: 1-minute bars with $1 price cells, built from trades. */
export interface MinuteBar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  cells: Map<number, Cell>;
  /** Running delta within the bar: its high and low. */
  maxDelta: number;
  minDelta: number;
  delta: number;
  firstT: number;
  lastT: number;
}

export class FootprintStore {
  bars = new Map<number, MinuteBar>();
  constructor(private keepMs = 6 * 3_600_000) {}

  add(tr: Trade) {
    const t = Math.floor(tr.t / 60_000) * 60_000;
    let b = this.bars.get(t);
    if (!b) {
      b = { t, o: tr.p, h: tr.p, l: tr.p, c: tr.p, cells: new Map(), maxDelta: 0, minDelta: 0, delta: 0, firstT: tr.t, lastT: tr.t };
      this.bars.set(t, b);
      this.prune(t);
    }
    if (this.ids.has(tr.id)) return;
    this.ids.add(tr.id);
    if (this.ids.size > 400_000) this.ids = new Set([...this.ids].slice(-200_000));
    // Backfill and live trades can arrive out of order: open/close follow trade time.
    if (tr.t < b.firstT) {
      b.firstT = tr.t;
      b.o = tr.p;
    }
    if (tr.t >= b.lastT) {
      b.lastT = tr.t;
      b.c = tr.p;
    }
    b.h = Math.max(b.h, tr.p);
    b.l = Math.min(b.l, tr.p);
    const k = Math.floor(tr.p);
    const cell = b.cells.get(k) ?? { bid: 0, ask: 0 };
    if (tr.buy) cell.ask += tr.q;
    else cell.bid += tr.q;
    b.cells.set(k, cell);
    b.delta += tr.buy ? tr.q : -tr.q;
    b.maxDelta = Math.max(b.maxDelta, b.delta);
    b.minDelta = Math.min(b.minDelta, b.delta);
  }

  private ids = new Set<number>();

  private prune(now: number) {
    for (const t of this.bars.keys()) if (t < now - this.keepMs) this.bars.delete(t);
  }
}

export interface FootBar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  cells: { p: number; bid: number; ask: number }[]; // high → low
  vol: number;
  delta: number;
  maxDelta: number;
  minDelta: number;
  poc: number;
}

/** Regroups the 1-minute / $1 store into bars of `intervalMs` and cells of `step` dollars. */
export function footprintBars(store: FootprintStore, intervalMs: number, step: number, maxBars = 60): FootBar[] {
  const groups = new Map<number, MinuteBar[]>();
  for (const b of [...store.bars.values()].sort((a, z) => a.t - z.t)) {
    const t = Math.floor(b.t / intervalMs) * intervalMs;
    if (!groups.has(t)) groups.set(t, []);
    groups.get(t)!.push(b);
  }
  const out: FootBar[] = [];
  for (const [t, bs] of groups) {
    const cells = new Map<number, Cell>();
    let delta = 0;
    let maxDelta = 0;
    let minDelta = 0;
    for (const b of bs) {
      for (const [p, c] of b.cells) {
        const k = Math.floor(p / step) * step;
        const cur = cells.get(k) ?? { bid: 0, ask: 0 };
        cur.bid += c.bid;
        cur.ask += c.ask;
        cells.set(k, cur);
      }
      maxDelta = Math.max(maxDelta, delta + b.maxDelta);
      minDelta = Math.min(minDelta, delta + b.minDelta);
      delta += b.delta;
    }
    const list = [...cells].map(([p, c]) => ({ p, ...c })).sort((a, z) => z.p - a.p);
    let poc = list[0]?.p ?? 0;
    let best = -1;
    for (const c of list) {
      if (c.bid + c.ask <= best) continue;
      best = c.bid + c.ask;
      poc = c.p;
    }
    out.push({
      t,
      o: bs[0].o,
      h: Math.max(...bs.map((b) => b.h)),
      l: Math.min(...bs.map((b) => b.l)),
      c: bs[bs.length - 1].c,
      cells: list,
      vol: list.reduce((s, c) => s + c.bid + c.ask, 0),
      delta,
      maxDelta,
      minDelta,
      poc,
    });
  }
  return out.slice(-maxBars);
}
