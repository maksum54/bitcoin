/**
 * Public trade and liquidation feeds from several exchanges, normalised to BTC sizes.
 * Message shapes follow each exchange's public WebSocket documentation.
 */

export interface VTrade {
  p: number;
  q: number; // BTC
  buy: boolean; // taker bought
  t: number;
}

export interface Liq {
  venue: string;
  /** Which position was liquidated: a long (forced sell) or a short (forced buy). */
  side: 'long' | 'short';
  p: number;
  q: number; // BTC
  usd: number;
  t: number;
}

export interface Feed {
  id: string;
  name: string;
  market: 'spot' | 'perp';
  url: string;
  subscribe?: unknown[];
  ping?: { ms: number; msg: string };
  parse: (raw: string) => { trades?: VTrade[]; liqs?: Liq[] } | null;
}

/** OKX BTC-USDT-SWAP: one contract = 0.01 BTC. */
const OKX_CT = 0.01;

const json = (raw: string): Record<string, unknown> | null => {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null; // "pong" and other plain-text keepalives
  }
};
const f = (v: unknown) => parseFloat(String(v));
const ok = (...xs: number[]) => xs.every(Number.isFinite);

export function parseBinanceTrade(raw: string): { trades: VTrade[] } | null {
  const d = json(raw);
  if (!d || d.e !== 'aggTrade') return null;
  const tr = { p: f(d.p), q: f(d.q), buy: d.m === false, t: Number(d.T) };
  return ok(tr.p, tr.q, tr.t) ? { trades: [tr] } : null;
}

export function parseBybitTrades(raw: string): { trades: VTrade[] } | null {
  const d = json(raw);
  if (!d || typeof d.topic !== 'string' || !d.topic.startsWith('publicTrade.') || !Array.isArray(d.data)) return null;
  const trades = (d.data as Record<string, unknown>[])
    .map((x) => ({ p: f(x.p), q: f(x.v), buy: x.S === 'Buy', t: Number(x.T) }))
    .filter((x) => ok(x.p, x.q, x.t));
  return { trades };
}

export function parseOkxTrades(raw: string, contract = 1): { trades: VTrade[] } | null {
  const d = json(raw);
  const arg = d?.arg as Record<string, unknown> | undefined;
  if (!d || arg?.channel !== 'trades' || !Array.isArray(d.data)) return null;
  const trades = (d.data as Record<string, unknown>[])
    .map((x) => ({ p: f(x.px), q: f(x.sz) * contract, buy: x.side === 'buy', t: Number(x.ts) }))
    .filter((x) => ok(x.p, x.q, x.t));
  return { trades };
}

/** Coinbase `side` is the maker's side, so a "sell" match is a taker buy. */
export function parseCoinbase(raw: string): { trades: VTrade[] } | null {
  const d = json(raw);
  if (!d || (d.type !== 'match' && d.type !== 'last_match')) return null;
  const tr = { p: f(d.price), q: f(d.size), buy: d.side === 'sell', t: Date.parse(String(d.time)) };
  return ok(tr.p, tr.q, tr.t) ? { trades: [tr] } : null;
}

/** Binance futures forceOrder: S = SELL means a long was liquidated. */
export function parseBinanceLiq(raw: string): { liqs: Liq[] } | null {
  const d = json(raw);
  const o = d?.o as Record<string, unknown> | undefined;
  if (!d || d.e !== 'forceOrder' || !o) return null;
  const p = f(o.ap) || f(o.p);
  const q = f(o.z) || f(o.q);
  const t = Number(o.T);
  if (!ok(p, q, t)) return null;
  return { liqs: [{ venue: 'Binance', side: o.S === 'SELL' ? 'long' : 'short', p, q, usd: p * q, t }] };
}

/** Bybit allLiquidation: S = Buy means a long position was liquidated. */
export function parseBybitLiq(raw: string): { liqs: Liq[] } | null {
  const d = json(raw);
  if (!d || typeof d.topic !== 'string' || !d.topic.startsWith('allLiquidation.') || !Array.isArray(d.data)) return null;
  const liqs = (d.data as Record<string, unknown>[])
    .map((x): Liq => {
      const p = f(x.p);
      const q = f(x.v);
      return { venue: 'Bybit', side: x.S === 'Buy' ? 'long' : 'short', p, q, usd: p * q, t: Number(x.T) };
    })
    .filter((x) => ok(x.p, x.q, x.t));
  return { liqs };
}

/** OKX liquidation-orders (all swaps): keep BTC-USDT-SWAP; a forced sell closes a long. */
export function parseOkxLiq(raw: string): { liqs: Liq[] } | null {
  const d = json(raw);
  const arg = d?.arg as Record<string, unknown> | undefined;
  if (!d || arg?.channel !== 'liquidation-orders' || !Array.isArray(d.data)) return null;
  const liqs: Liq[] = [];
  for (const x of d.data as Record<string, unknown>[]) {
    if (x.instId !== 'BTC-USDT-SWAP' || !Array.isArray(x.details)) continue;
    for (const y of x.details as Record<string, unknown>[]) {
      const p = f(y.bkPx);
      const q = f(y.sz) * OKX_CT;
      const t = Number(y.ts);
      const side = y.posSide === 'long' || y.posSide === 'short' ? y.posSide : y.side === 'sell' ? 'long' : 'short';
      if (ok(p, q, t)) liqs.push({ venue: 'OKX', side, p, q, usd: p * q, t });
    }
  }
  return { liqs };
}

const BYBIT_PING = { ms: 20_000, msg: JSON.stringify({ op: 'ping' }) };
const OKX_PING = { ms: 25_000, msg: 'ping' };
const OKX_WS = 'wss://ws.okx.com:8443/ws/v5/public';

export const TRADE_FEEDS: Feed[] = [
  { id: 'binance-spot', name: 'Binance', market: 'spot', url: 'wss://data-stream.binance.vision/ws/btcusdt@aggTrade', parse: parseBinanceTrade },
  { id: 'binance-perp', name: 'Binance', market: 'perp', url: 'wss://fstream.binance.com/ws/btcusdt@aggTrade', parse: parseBinanceTrade },
  { id: 'bybit-spot', name: 'Bybit', market: 'spot', url: 'wss://stream.bybit.com/v5/public/spot', subscribe: [{ op: 'subscribe', args: ['publicTrade.BTCUSDT'] }], ping: BYBIT_PING, parse: parseBybitTrades },
  { id: 'bybit-perp', name: 'Bybit', market: 'perp', url: 'wss://stream.bybit.com/v5/public/linear', subscribe: [{ op: 'subscribe', args: ['publicTrade.BTCUSDT'] }], ping: BYBIT_PING, parse: parseBybitTrades },
  { id: 'okx-spot', name: 'OKX', market: 'spot', url: OKX_WS, subscribe: [{ op: 'subscribe', args: [{ channel: 'trades', instId: 'BTC-USDT' }] }], ping: OKX_PING, parse: (r) => parseOkxTrades(r) },
  { id: 'okx-perp', name: 'OKX', market: 'perp', url: OKX_WS, subscribe: [{ op: 'subscribe', args: [{ channel: 'trades', instId: 'BTC-USDT-SWAP' }] }], ping: OKX_PING, parse: (r) => parseOkxTrades(r, OKX_CT) },
  { id: 'coinbase-spot', name: 'Coinbase', market: 'spot', url: 'wss://ws-feed.exchange.coinbase.com', subscribe: [{ type: 'subscribe', product_ids: ['BTC-USD'], channels: ['matches'] }], parse: parseCoinbase },
];

export const LIQ_FEEDS: Feed[] = [
  { id: 'binance-liq', name: 'Binance', market: 'perp', url: 'wss://fstream.binance.com/ws/btcusdt@forceOrder', parse: parseBinanceLiq },
  { id: 'bybit-liq', name: 'Bybit', market: 'perp', url: 'wss://stream.bybit.com/v5/public/linear', subscribe: [{ op: 'subscribe', args: ['allLiquidation.BTCUSDT'] }], ping: BYBIT_PING, parse: parseBybitLiq },
  { id: 'okx-liq', name: 'OKX', market: 'perp', url: OKX_WS, subscribe: [{ op: 'subscribe', args: [{ channel: 'liquidation-orders', instType: 'SWAP' }] }], ping: OKX_PING, parse: parseOkxLiq },
];

/** Per-second buckets of taker buy / sell volume, for rolling windows. */
export class FlowWindow {
  private secs = new Map<number, { buy: number; sell: number }>();
  constructor(private keepSec = 3600) {}
  add(tr: VTrade) {
    const s = Math.floor(tr.t / 1000);
    const b = this.secs.get(s) ?? { buy: 0, sell: 0 };
    if (tr.buy) b.buy += tr.q;
    else b.sell += tr.q;
    this.secs.set(s, b);
    if (this.secs.size > this.keepSec + 120) {
      const min = s - this.keepSec;
      for (const k of this.secs.keys()) if (k < min) this.secs.delete(k);
    }
  }
  sum(windowSec: number, now = Date.now()) {
    const min = Math.floor(now / 1000) - windowSec;
    let buy = 0;
    let sell = 0;
    for (const [k, b] of this.secs) {
      if (k <= min) continue;
      buy += b.buy;
      sell += b.sell;
    }
    return { buy, sell, net: buy - sell };
  }
  /** Net per minute, oldest first, for a small chart. */
  perMinute(minutes: number, now = Date.now()): number[] {
    const cur = Math.floor(now / 60_000);
    const out = new Array(minutes).fill(0);
    for (const [k, b] of this.secs) {
      const i = minutes - 1 - (cur - Math.floor(k / 60));
      if (i >= 0 && i < minutes) out[i] += b.buy - b.sell;
    }
    return out;
  }
}
