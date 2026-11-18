import type { Candle } from '../lib/terminal';

/**
 * A position drawn on the chart. It fills when price reaches the entry after it was
 * drawn, then settles at the target (win) or the stop (loss). When one bar touches
 * both, it counts as a loss — the cautious reading when the order inside the bar is unknown.
 */
export interface Position {
  id: string;
  side: 'long' | 'short';
  entry: number;
  sl: number;
  tp: number;
  /** Money at risk: a loss costs this, a win pays risk × R. */
  risk: number;
  createdAt: number;
  strategy: string;
  note: string;
  status: 'pending' | 'open' | 'win' | 'loss' | 'cancelled';
  filledAt?: number;
  closedAt?: number;
  /** Candles up to this time have been checked. */
  checkedTo?: number;
}

/** Reward-to-risk of the plan. */
export const plannedR = (p: Position) => Math.abs(p.tp - p.entry) / Math.abs(p.entry - p.sl) || 0;

/** Result in R once settled: +plannedR for a win, −1 for a loss, 0 otherwise. */
export const resultR = (p: Position) => (p.status === 'win' ? plannedR(p) : p.status === 'loss' ? -1 : 0);
export const resultMoney = (p: Position) => resultR(p) * p.risk;

export function validPosition(p: Pick<Position, 'side' | 'entry' | 'sl' | 'tp'>): boolean {
  if (![p.entry, p.sl, p.tp].every((x) => Number.isFinite(x) && x > 0)) return false;
  return p.side === 'long' ? p.sl < p.entry && p.entry < p.tp : p.tp < p.entry && p.entry < p.sl;
}

/** Walks candles (oldest first, any interval) and settles the position as far as they reach. */
export function settle(p: Position, candles: Candle[], intervalMs: number): Position {
  if (p.status !== 'pending' && p.status !== 'open') return p;
  const cur = { ...p };
  const long = p.side === 'long';
  for (const c of candles) {
    if (c.t + intervalMs <= p.createdAt) continue;
    if (cur.status === 'pending') {
      if (c.l <= p.entry && p.entry <= c.h) {
        cur.status = 'open';
        cur.filledAt = Math.max(c.t, p.createdAt);
        // On the fill bar only count the stop (cautious).
        if (long ? c.l <= p.sl : c.h >= p.sl) return { ...cur, status: 'loss', closedAt: cur.filledAt };
        continue;
      }
      continue;
    }
    const hitSl = long ? c.l <= p.sl : c.h >= p.sl;
    const hitTp = long ? c.h >= p.tp : c.l <= p.tp;
    if (hitSl) return { ...cur, status: 'loss', closedAt: c.t };
    if (hitTp) return { ...cur, status: 'win', closedAt: c.t };
  }
  return cur;
}

export interface JournalStats {
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalR: number;
  totalMoney: number;
  avgR: number;
  profitFactor: number;
  equity: { t: number; money: number; r: number }[];
}

export function stats(ps: Position[]): JournalStats {
  const done = ps.filter((p) => p.status === 'win' || p.status === 'loss').sort((a, b) => (a.closedAt ?? 0) - (b.closedAt ?? 0));
  let money = 0;
  let r = 0;
  let gain = 0;
  let loss = 0;
  const equity = done.map((p) => {
    const m = resultMoney(p);
    money += m;
    r += resultR(p);
    if (m > 0) gain += m;
    else loss -= m;
    return { t: p.closedAt ?? 0, money, r };
  });
  const wins = done.filter((p) => p.status === 'win').length;
  return {
    trades: done.length,
    wins,
    losses: done.length - wins,
    winRate: done.length ? wins / done.length : 0,
    totalR: r,
    totalMoney: money,
    avgR: done.length ? r / done.length : 0,
    profitFactor: loss ? gain / loss : gain ? Infinity : 0,
    equity,
  };
}

/** Settled result per local calendar day (YYYY-MM-DD). */
export function byDay(ps: Position[]): Map<string, { money: number; r: number; n: number }> {
  const m = new Map<string, { money: number; r: number; n: number }>();
  for (const p of ps) {
    if ((p.status !== 'win' && p.status !== 'loss') || !p.closedAt) continue;
    const d = new Date(p.closedAt);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const cur = m.get(k) ?? { money: 0, r: 0, n: 0 };
    cur.money += resultMoney(p);
    cur.r += resultR(p);
    cur.n++;
    m.set(k, cur);
  }
  return m;
}

/** Stats split by a key (side or strategy). */
export function groupStats(ps: Position[], key: (p: Position) => string): { key: string; s: JournalStats }[] {
  const g = new Map<string, Position[]>();
  for (const p of ps) {
    const k = key(p) || '—';
    if (!g.has(k)) g.set(k, []);
    g.get(k)!.push(p);
  }
  return [...g].map(([k, list]) => ({ key: k, s: stats(list) })).filter((x) => x.s.trades > 0);
}
