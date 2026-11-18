/**
 * Live market data for the Terminal tab: candles, order book and trade tape for BTC/USDT,
 * from Binance's public market-data endpoints (no account or API key).
 * Everything here is pure so it can be tested without a network.
 */
import { parseDiff, type Diff } from '../terminal/orderbook';

export const REST = 'https://data-api.binance.vision/api/v3';
export const WS = 'wss://data-stream.binance.vision/stream';
export const SYMBOL = 'BTCUSDT';

export const INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1d'] as const;
export type Interval = (typeof INTERVALS)[number];

export interface Candle {
  t: number; // open time, ms
  o: number;
  h: number;
  l: number;
  c: number;
  v: number; // base volume (BTC)
}

export interface Level {
  p: number;
  q: number;
}

export interface Book {
  bids: Level[]; // best (highest) first
  asks: Level[]; // best (lowest) first
}

export interface Trade {
  id: number;
  p: number;
  q: number;
  t: number;
  /** true when the taker bought (aggressive buy). */
  buy: boolean;
}

export interface Ticker {
  last: number;
  changePct: number;
  high: number;
  low: number;
  vol: number; // BTC
  quoteVol: number; // USDT
}

const n = (v: unknown) => {
  const x = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(x) ? x : NaN;
};

/** One row of GET /klines: [openTime, open, high, low, close, volume, ...]. */
export function parseKline(row: unknown): Candle | null {
  if (!Array.isArray(row) || row.length < 6) return null;
  const c = { t: n(row[0]), o: n(row[1]), h: n(row[2]), l: n(row[3]), c: n(row[4]), v: n(row[5]) };
  return Object.values(c).every(Number.isFinite) ? c : null;
}

/** The `k` object of a kline stream event. */
export function parseKlineEvent(k: unknown): Candle | null {
  if (!k || typeof k !== 'object') return null;
  const o = k as Record<string, unknown>;
  const c = { t: n(o.t), o: n(o.o), h: n(o.h), l: n(o.l), c: n(o.c), v: n(o.v) };
  return Object.values(c).every(Number.isFinite) ? c : null;
}

/** Replaces the forming candle or appends a new one, keeping at most `max` candles. */
export function mergeCandle(list: Candle[], c: Candle, max = 1000): Candle[] {
  const last = list[list.length - 1];
  if (last && c.t < last.t) {
    const i = list.findIndex((x) => x.t === c.t);
    if (i < 0) return list;
    const next = list.slice();
    next[i] = c;
    return next;
  }
  const next = last && last.t === c.t ? [...list.slice(0, -1), c] : [...list, c];
  return next.length > max ? next.slice(next.length - max) : next;
}

const levels = (rows: unknown): Level[] =>
  Array.isArray(rows)
    ? rows
        .map((r) => (Array.isArray(r) ? { p: n(r[0]), q: n(r[1]) } : null))
        .filter((l): l is Level => !!l && Number.isFinite(l.p) && Number.isFinite(l.q) && l.q > 0)
    : [];

/** A partial book depth event ({bids, asks}) or a REST depth snapshot. */
export function parseBook(d: unknown): Book | null {
  if (!d || typeof d !== 'object') return null;
  const o = d as Record<string, unknown>;
  const bids = levels(o.bids ?? o.b).sort((a, b) => b.p - a.p);
  const asks = levels(o.asks ?? o.a).sort((a, b) => a.p - b.p);
  return bids.length || asks.length ? { bids, asks } : null;
}

/** An aggTrade event. `m` = buyer is the maker, so the taker sold. */
export function parseTrade(d: unknown): Trade | null {
  if (!d || typeof d !== 'object') return null;
  const o = d as Record<string, unknown>;
  const tr = { id: n(o.a), p: n(o.p), q: n(o.q), t: n(o.T) };
  if (!Object.values(tr).every(Number.isFinite)) return null;
  return { ...tr, buy: o.m === false };
}

/** A 24hrTicker event. */
export function parseTicker(d: unknown): Ticker | null {
  if (!d || typeof d !== 'object') return null;
  const o = d as Record<string, unknown>;
  const tk = { last: n(o.c), changePct: n(o.P), high: n(o.h), low: n(o.l), vol: n(o.v), quoteVol: n(o.q) };
  return Object.values(tk).every(Number.isFinite) ? tk : null;
}

/**
 * Groups book levels into price buckets of `step` (bids rounded down, asks rounded up,
 * so a bucket never crosses the spread) and keeps the best `depth` buckets.
 */
export function groupBook(book: Book, step: number, depth = 12): Book {
  const group = (ls: Level[], side: 'bid' | 'ask') => {
    const m = new Map<number, number>();
    for (const l of ls) {
      const k = step > 0 ? (side === 'bid' ? Math.floor(l.p / step) : Math.ceil(l.p / step)) * step : l.p;
      const key = Math.round(k * 1e8) / 1e8;
      m.set(key, (m.get(key) ?? 0) + l.q);
    }
    const out = [...m].map(([p, q]) => ({ p, q }));
    out.sort((a, b) => (side === 'bid' ? b.p - a.p : a.p - b.p));
    return out.slice(0, depth);
  };
  return { bids: group(book.bids, 'bid'), asks: group(book.asks, 'ask') };
}

/** Running totals from the best price outward (for depth bars). */
export function cumulative(ls: Level[]): number[] {
  let s = 0;
  return ls.map((l) => (s += l.q));
}

export function spread(book: Book): { abs: number; pct: number; mid: number } | null {
  const b = book.bids[0]?.p;
  const a = book.asks[0]?.p;
  if (b == null || a == null) return null;
  const mid = (a + b) / 2;
  return { abs: a - b, pct: ((a - b) / mid) * 100, mid };
}

/** Share of the top of the book that is bids (0..1); above 0.5 = more resting buy interest. */
export function imbalance(book: Book): number | null {
  const b = book.bids.reduce((s, l) => s + l.q, 0);
  const a = book.asks.reduce((s, l) => s + l.q, 0);
  return a + b > 0 ? b / (a + b) : null;
}

/** Taker buy and sell volume in the trades given, and the net (buy − sell). */
export function flow(trades: Trade[]): { buy: number; sell: number; net: number } {
  let buy = 0;
  let sell = 0;
  for (const t of trades) (t.buy ? (buy += t.q) : (sell += t.q));
  return { buy, sell, net: buy - sell };
}

/** Adds new trades to the front (newest first), dropping duplicates, keeping at most `max`. */
export function pushTrades(list: Trade[], incoming: Trade[], max = 200): Trade[] {
  if (!incoming.length) return list;
  const seen = new Set(list.map((t) => t.id));
  const fresh = incoming.filter((t) => !seen.has(t.id)).sort((a, b) => b.id - a.id);
  return [...fresh, ...list].slice(0, max);
}

/** Price decimals to show for a grouping step (0.01 → 2, 10 → 0). */
export const stepDigits = (step: number) => (step >= 1 ? 0 : Math.min(8, Math.ceil(-Math.log10(step) - 1e-9)));

/** "Nice" price ticks between lo and hi, about `count` of them. */
export function niceTicks(lo: number, hi: number, count = 5): number[] {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const f = raw / mag;
  const step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v / step) * step);
  return out;
}

/** Combined stream URL for the symbol and candle interval. */
export function streamUrl(interval: Interval, symbol = SYMBOL): string {
  const s = symbol.toLowerCase();
  return `${WS}?streams=${[`${s}@aggTrade`, `${s}@depth@100ms`, `${s}@kline_${interval}`, `${s}@ticker`].join('/')}`;
}

export type StreamMsg =
  | { kind: 'trade'; trade: Trade }
  | { kind: 'book'; book: Book }
  | { kind: 'diff'; diff: Diff }
  | { kind: 'kline'; candle: Candle }
  | { kind: 'ticker'; ticker: Ticker };

/** Decodes one combined-stream message ({stream, data}). */
export function decodeStream(raw: string): StreamMsg | null {
  let m: { stream?: string; data?: Record<string, unknown> };
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  const s = m.stream ?? '';
  const d = m.data;
  if (!d) return null;
  if (s.endsWith('@aggTrade')) {
    const trade = parseTrade(d);
    return trade && { kind: 'trade', trade };
  }
  if (s.includes('@depth') && d.e === 'depthUpdate') {
    const diff = parseDiff(d);
    return diff && { kind: 'diff', diff };
  }
  if (s.includes('@depth')) {
    const book = parseBook(d);
    return book && { kind: 'book', book };
  }
  if (s.includes('@kline_')) {
    const candle = parseKlineEvent(d.k);
    return candle && { kind: 'kline', candle };
  }
  if (s.endsWith('@ticker')) {
    const ticker = parseTicker(d);
    return ticker && { kind: 'ticker', ticker };
  }
  return null;
}
