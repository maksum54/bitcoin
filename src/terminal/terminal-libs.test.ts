import { describe, expect, it } from 'vitest';
import type { Candle } from '../lib/terminal';
import { backtest, getParam, monteCarlo, monthly, numericParams, optimize, setParam, TEMPLATES, type Strategy } from './backtest';
import { atr, bollinger, ema, macd, rsi, sma, stochRsi, valueArea, volumeProfile, vwap } from './indicators';
import { byDay, groupStats, plannedR, resultR, settle, stats, validPosition, type Position } from './journal';
import { LocalBook } from './orderbook';
import { cancelOrder, closePosition, equity, execute, liqPrice, MAKER_FEE, newAccount, onPrice, placeLimit, setBrackets, TAKER_FEE } from './paper';
import { autoStep, FootprintStore, footprintBars, sessionStart, tpoProfiles } from './profile';
import { pivots, scanCandles, threeDrives, topSymbols } from './signals';
import { FlowWindow, parseBinanceLiq, parseBybitLiq, parseBybitTrades, parseCoinbase, parseOkxLiq, parseOkxTrades } from './venues';

const H = 3_600_000;
const bar = (t: number, o: number, h: number, l: number, c: number, v = 1): Candle => ({ t, o, h, l, c, v });
/** Candles following a list of closes, each with a ±1 wick. */
const fromCloses = (cs: number[], step = H, t0 = Date.UTC(2026, 0, 1)) => cs.map((c, i) => bar(t0 + i * step, c, c + 1, c - 1, c));

describe('indicators', () => {
  it('sma / ema', () => {
    expect(sma([1, 2, 3, 4], 2)).toEqual([null, 1.5, 2.5, 3.5]);
    const e = ema([1, 2, 3, 4, 5], 3);
    expect(e.slice(0, 2)).toEqual([null, null]);
    expect(e[2]).toBe(2);
    expect(e[3]).toBe(3);
    expect(ema([1], 3)).toEqual([null]);
  });

  it('rsi is 100 on a straight rise and ~50 on alternation', () => {
    const up = Array.from({ length: 20 }, (_, i) => i);
    expect(rsi(up, 14)[19]).toBe(100);
    const zig = Array.from({ length: 40 }, (_, i) => (i % 2 ? 1 : 0));
    expect(rsi(zig, 14)[39]!).toBeGreaterThan(40);
    expect(rsi(zig, 14)[39]!).toBeLessThan(60);
  });

  it('macd, bollinger, stoch rsi, atr shapes', () => {
    const v = Array.from({ length: 80 }, (_, i) => 100 + Math.sin(i / 5) * 10);
    const m = macd(v);
    expect(m.macd[24]).toBeNull();
    expect(m.macd[25]).not.toBeNull();
    expect(m.signal[33]).not.toBeNull();
    const b = bollinger(v, 20, 2);
    expect(b.upper[19]!).toBeGreaterThan(b.mid[19]!);
    expect(b.lower[19]!).toBeLessThan(b.mid[19]!);
    const s = stochRsi(v);
    const k = s.k.filter((x) => x != null) as number[];
    expect(k.length).toBeGreaterThan(0);
    expect(Math.min(...k)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...k)).toBeLessThanOrEqual(100);
    expect(atr(fromCloses(v), 14)[14]!).toBeGreaterThan(0);
  });

  it('vwap restarts each UTC day', () => {
    const d = Date.UTC(2026, 0, 1);
    const w = vwap([bar(d, 10, 10, 10, 10, 1), bar(d + H, 20, 20, 20, 20, 1), bar(d + 24 * H, 50, 50, 50, 50, 2)]);
    expect(w).toEqual([10, 15, 50]);
  });

  it('value area and volume profile', () => {
    expect(valueArea([1, 2, 10, 3, 1], 0.7)).toEqual({ poc: 2, lo: 2, hi: 3 });
    const vp = volumeProfile([bar(0, 100, 110, 100, 105, 10), bar(1, 105, 106, 104, 105, 10)], 10)!;
    expect(vp.bins.reduce((a, b) => a + b, 0)).toBeCloseTo(20);
    expect(vp.lo + vp.poc * vp.step).toBeGreaterThanOrEqual(104);
  });
});

describe('order book sync', () => {
  const snap = { lastUpdateId: 10, bids: [['100', '1'] as [string, string]], asks: [['101', '1'] as [string, string]] };

  it('buffers until the snapshot, drops old diffs, applies the rest', () => {
    const b = new LocalBook();
    expect(b.push({ U: 5, u: 9, b: [['99', '5']], a: [] })).toBe('buffered');
    expect(b.push({ U: 10, u: 12, b: [['100', '0'], ['99.5', '2']], a: [] })).toBe('buffered');
    expect(b.snapshot(snap)).toBe('ok');
    expect(b.top().bids).toEqual([{ p: 99.5, q: 2 }]);
    expect(b.push({ U: 13, u: 13, b: [], a: [['101', '0'], ['102', '3']] })).toBe('ok');
    expect(b.top().asks).toEqual([{ p: 102, q: 3 }]);
    expect(b.lastId).toBe(13);
  });

  it('reports a gap and stops until a new snapshot', () => {
    const b = new LocalBook();
    b.snapshot(snap);
    expect(b.push({ U: 20, u: 21, b: [], a: [] })).toBe('gap');
    expect(b.ready).toBe(false);
    const c = new LocalBook();
    c.push({ U: 15, u: 16, b: [], a: [] });
    expect(c.snapshot(snap)).toBe('gap');
  });
});

describe('market profile', () => {
  it('builds a daily TPO with POC, value area, singles and poor extremes', () => {
    const d = Date.UTC(2026, 0, 5);
    const m = 30 * 60_000;
    const cs = [bar(d, 100, 104, 100, 103), bar(d + m, 103, 104, 101, 102), bar(d + 2 * m, 102, 102, 101, 102), bar(d + 3 * m, 102, 110, 102, 109), bar(d + 24 * H, 1, 1, 1, 1)];
    const [p, next] = tpoProfiles(cs, 1);
    expect(next.start).toBe(d + 24 * H);
    expect(p.rows.find((r) => r.p === 102)!.letters).toBe('ABCD');
    expect(p.poc).toBe(102);
    expect(p.vaLo).toBeLessThanOrEqual(102);
    expect(p.vaHi).toBeGreaterThanOrEqual(102);
    expect(p.singles).toContain(106);
    expect(p.poorHigh).toBe(false);
    expect(p.poorLow).toBe(false);
    expect(p.high).toBe(110);
  });

  it('weeks start on Monday', () => {
    const wed = Date.UTC(2026, 0, 7, 15);
    expect(new Date(sessionStart(wed, 'week')).getUTCDay()).toBe(1);
    expect(autoStep(95_000, 97_000, 40)).toBe(50);
  });

  it('footprint store aggregates trades into bars and cells', () => {
    const s = new FootprintStore();
    const t0 = Date.UTC(2026, 0, 1, 10);
    s.add({ id: 2, p: 100.5, q: 1, t: t0 + 5000, buy: true });
    s.add({ id: 1, p: 100.2, q: 2, t: t0 + 1000, buy: false }); // older, arrives late
    s.add({ id: 2, p: 100.5, q: 1, t: t0 + 5000, buy: true }); // duplicate
    s.add({ id: 3, p: 112, q: 0.5, t: t0 + 60_000, buy: true });
    const [b1, b2] = footprintBars(s, 60_000, 1);
    expect(b1.o).toBe(100.2);
    expect(b1.c).toBe(100.5);
    expect(b1.cells).toEqual([{ p: 100, bid: 2, ask: 1 }]);
    expect(b1.delta).toBe(-1);
    expect(b2.vol).toBe(0.5);
    const [m] = footprintBars(s, 5 * 60_000, 10);
    expect(m.cells.map((c) => c.p)).toEqual([110, 100]);
    expect(m.delta).toBe(-0.5);
    expect(m.poc).toBe(100);
  });
});

describe('venues', () => {
  it('parses trades from each exchange', () => {
    expect(parseBybitTrades(JSON.stringify({ topic: 'publicTrade.BTCUSDT', data: [{ T: 1, p: '100', v: '0.5', S: 'Sell' }] }))!.trades).toEqual([{ p: 100, q: 0.5, buy: false, t: 1 }]);
    expect(parseOkxTrades(JSON.stringify({ arg: { channel: 'trades' }, data: [{ px: '100', sz: '20', side: 'buy', ts: '2' }] }), 0.01)!.trades).toEqual([{ p: 100, q: 0.2, buy: true, t: 2 }]);
    expect(parseCoinbase(JSON.stringify({ type: 'match', price: '100', size: '1', side: 'sell', time: '2026-01-01T00:00:00Z' }))!.trades[0].buy).toBe(true);
    expect(parseOkxTrades('pong')).toBeNull();
  });

  it('parses liquidations and which side was hit', () => {
    expect(parseBinanceLiq(JSON.stringify({ e: 'forceOrder', o: { S: 'SELL', p: '99', ap: '100', q: '2', z: '2', T: 5 } }))!.liqs[0]).toEqual({ venue: 'Binance', side: 'long', p: 100, q: 2, usd: 200, t: 5 });
    expect(parseBybitLiq(JSON.stringify({ topic: 'allLiquidation.BTCUSDT', data: [{ T: 1, s: 'BTCUSDT', S: 'Sell', v: '1', p: '50' }] }))!.liqs[0].side).toBe('short');
    const okx = parseOkxLiq(JSON.stringify({ arg: { channel: 'liquidation-orders' }, data: [{ instId: 'ETH-USDT-SWAP', details: [] }, { instId: 'BTC-USDT-SWAP', details: [{ side: 'buy', posSide: 'net', sz: '100', bkPx: '100', ts: '3' }] }] }))!;
    expect(okx.liqs).toEqual([{ venue: 'OKX', side: 'short', p: 100, q: 1, usd: 100, t: 3 }]);
  });

  it('sums flow over rolling windows', () => {
    const w = new FlowWindow();
    const now = 10_000_000;
    w.add({ p: 1, q: 2, buy: true, t: now - 30_000 });
    w.add({ p: 1, q: 1, buy: false, t: now - 5_000 });
    w.add({ p: 1, q: 5, buy: true, t: now - 200_000 });
    expect(w.sum(60, now)).toEqual({ buy: 2, sell: 1, net: 1 });
    expect(w.sum(300, now).buy).toBe(7);
    expect(w.perMinute(5, now).reduce((a, b) => a + b, 0)).toBe(6);
  });
});

describe('signals', () => {
  it('finds pivots', () => {
    const c = fromCloses([1, 2, 3, 10, 3, 2, 1, 2, 3]);
    expect(pivots(c, 2, 2).filter((p) => p.kind === 'high').map((p) => p.i)).toEqual([3]);
  });

  it('detects three rising drives', () => {
    const cs = [
      ...[50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65],
      ...[66, 70, 74, 78, 80, 77, 74, 71, 72, 76, 80, 84, 86, 83, 80, 77, 78, 82, 86, 90, 92, 89, 86, 83],
    ];
    const td = threeDrives(fromCloses(cs), 8, 3, 2);
    expect(td?.dir).toBe('bear');
    expect(td!.drives.map((d) => d.p)).toEqual([81, 87, 93]);
    expect(scanCandles(fromCloses(cs)).some((s) => s.kind === 'threeDriveBear')).toBe(true);
  });

  it('picks the busiest real markets', () => {
    const t = [
      { symbol: 'BTCUSDT', quoteVolume: '100' },
      { symbol: 'USDCUSDT', quoteVolume: '500' },
      { symbol: 'ETHUSDT', quoteVolume: '50' },
      { symbol: 'ETHBTC', quoteVolume: '900' },
      { symbol: 'BTCUPUSDT', quoteVolume: '400' },
    ];
    expect(topSymbols(t, 5)).toEqual(['BTCUSDT', 'ETHUSDT']);
  });
});

describe('journal', () => {
  const base: Position = { id: '1', side: 'long', entry: 100, sl: 95, tp: 110, risk: 50, createdAt: 0, strategy: 'test', note: '', status: 'pending' };

  it('validates and computes R', () => {
    expect(validPosition(base)).toBe(true);
    expect(validPosition({ ...base, sl: 105 })).toBe(false);
    expect(validPosition({ ...base, side: 'short', sl: 105, tp: 90 })).toBe(true);
    expect(plannedR(base)).toBe(2);
  });

  it('fills at entry, then settles at target or stop', () => {
    const c = [bar(H, 104, 105, 101, 102), bar(2 * H, 102, 103, 99, 100), bar(3 * H, 100, 111, 99, 110)];
    const won = settle(base, c, H);
    expect(won.status).toBe('win');
    expect(won.filledAt).toBe(2 * H);
    expect(resultR(won)).toBe(2);
    expect(settle(base, c.slice(0, 2), H).status).toBe('open');
    expect(settle(base, c.slice(0, 1), H).status).toBe('pending');
    // Same bar touches stop and target → loss.
    expect(settle({ ...base, status: 'open' }, [bar(H, 100, 111, 94, 100)], H).status).toBe('loss');
  });

  it('builds stats, calendar and groups', () => {
    const ps: Position[] = [
      { ...base, id: 'a', status: 'win', closedAt: Date.UTC(2026, 0, 1, 12) },
      { ...base, id: 'b', status: 'loss', closedAt: Date.UTC(2026, 0, 2, 12), side: 'short', sl: 105, tp: 90, strategy: 'x' },
      { ...base, id: 'c', status: 'open' },
    ];
    const s = stats(ps);
    expect(s.trades).toBe(2);
    expect(s.totalR).toBe(1);
    expect(s.totalMoney).toBe(50);
    expect(s.profitFactor).toBe(2);
    expect(s.equity.map((e) => e.r)).toEqual([2, 1]);
    expect([...byDay(ps).values()].map((d) => d.r)).toEqual([2, -1]);
    expect(groupStats(ps, (p) => p.side).map((g) => g.key)).toEqual(['long', 'short']);
  });
});

describe('paper trading', () => {
  it('opens, adds, reduces and closes with fees and P&L', () => {
    let s = execute(newAccount(), 'BTCUSDT', 'buy', 1, 100, 10, TAKER_FEE, 'market')!;
    expect(s.positions.BTCUSDT).toMatchObject({ qty: 1, entry: 100, margin: 10 });
    expect(s.balance).toBeCloseTo(100_000 - 10 - 0.05);
    s = execute(s, 'BTCUSDT', 'buy', 1, 110, 10, TAKER_FEE, 'market')!;
    expect(s.positions.BTCUSDT!.entry).toBe(105);
    s = execute(s, 'BTCUSDT', 'sell', 1, 115, 10, TAKER_FEE, 'market')!;
    expect(s.fills[0].pnl).toBe(10);
    expect(s.positions.BTCUSDT!.qty).toBe(1);
    s = closePosition(s, 'BTCUSDT', 105);
    expect(s.positions.BTCUSDT).toBeUndefined();
    expect(s.balance).toBeCloseTo(100_000 + 10 - (100 + 110 + 115 + 105) * TAKER_FEE);
  });

  it('flips a position and refuses orders without margin', () => {
    let s = execute(newAccount(), 'ETHUSDT', 'sell', 2, 100, 5, 0, 'market')!;
    s = execute(s, 'ETHUSDT', 'buy', 3, 90, 5, 0, 'market')!;
    expect(s.positions.ETHUSDT).toMatchObject({ qty: 1, entry: 90 });
    expect(s.fills[0].pnl).toBe(20);
    expect(execute(newAccount(), 'BTCUSDT', 'buy', 100, 100_000, 1, 0, 'market')).toBeNull();
  });

  it('fills limits, triggers stop / target and liquidates', () => {
    let s = placeLimit(newAccount(), { sym: 'BTCUSDT', side: 'buy', price: 95, qty: 1, lev: 10 });
    s = onPrice(s, 'BTCUSDT', 96);
    expect(s.orders).toHaveLength(1);
    s = onPrice(s, 'BTCUSDT', 94);
    expect(s.orders).toHaveLength(0);
    expect(s.positions.BTCUSDT!.entry).toBe(95);
    expect(s.fills[0].fee).toBeCloseTo(95 * MAKER_FEE);
    const withTp = setBrackets(s, 'BTCUSDT', 90, 100);
    expect(onPrice(withTp, 'BTCUSDT', 101).fills[0].reason).toBe('tp');
    expect(onPrice(withTp, 'BTCUSDT', 89).fills[0].reason).toBe('sl');
    const liq = liqPrice(s.positions.BTCUSDT!);
    expect(liq).toBeCloseTo(95 * (1 - 0.1 + 0.004));
    const after = onPrice(s, 'BTCUSDT', liq - 1);
    expect(after.positions.BTCUSDT).toBeUndefined();
    expect(after.fills[0]).toMatchObject({ reason: 'liquidation', pnl: -9.5 });
    expect(equity(s, { BTCUSDT: 100 })).toBeCloseTo(s.balance + 9.5 + 5);
    expect(cancelOrder(placeLimit(newAccount(), { sym: 'SOLUSDT', side: 'sell', price: 1, qty: 1, lev: 1 }), 'nope').orders).toHaveLength(1);
  });
});

describe('backtest', () => {
  const st: Strategy = { name: 't', side: 'long', entry: [{ k: 'priceEma', n: 3, dir: 'above' }], exit: [{ k: 'priceEma', n: 3, dir: 'below' }], slPct: null, tpPct: null, feePct: 0, slipPct: 0, fundingPct: 0, lev: 1, capital: 1000 };

  it('enters at the next open after a signal and exits on the exit signal', () => {
    const c = fromCloses([10, 10, 10, 12, 14, 16, 12, 8, 8]);
    const r = backtest(c, st);
    expect(r.trades).toHaveLength(1);
    const t = r.trades[0];
    expect(t.entryT).toBe(c[4].t);
    expect(t.entry).toBe(c[4].o);
    expect(t.exitT).toBe(c[7].t);
    expect(t.exit).toBe(c[7].o);
    expect(r.netPct).toBeCloseTo((8 / 14 - 1) * 100);
  });

  it('stops out, with the stop winning a bar that hits both', () => {
    const c = [bar(0, 10, 10, 10, 10), bar(H, 10, 10, 10, 10), bar(2 * H, 10, 10, 10, 11), bar(3 * H, 11, 13, 9, 11)];
    const r = backtest(c, { ...st, entry: [{ k: 'priceEma', n: 2, dir: 'above' }], exit: [], slPct: 10, tpPct: 10 });
    expect(r.trades[0].reason).toBe('sl');
    expect(r.trades[0].exit).toBeCloseTo(9.9);
  });

  it('charges fees and funding', () => {
    const c = fromCloses([10, 10, 10, 12, 14, 16, 18, 20, 22], 8 * H);
    const r = backtest(c, { ...st, feePct: 0.1, fundingPct: 0.01, exit: [] });
    expect(r.fees).toBeGreaterThan(0);
    expect(r.funding).toBeGreaterThan(0);
    expect(r.trades[0].reason).toBe('end');
  });

  it('reports months, Monte Carlo and optimizes on held-out bars', () => {
    expect(monthly([{ t: Date.UTC(2026, 0, 1), e: 100 }, { t: Date.UTC(2026, 0, 31), e: 110 }, { t: Date.UTC(2026, 1, 2), e: 99 }]).map((m) => Math.round(m.pct))).toEqual([10, -10]);
    const trades = [5, -2, 3, -1].map((pct) => ({ side: 'long' as const, entryT: 0, exitT: 0, entry: 1, exit: 1, pnl: pct, pct, reason: 'signal' as const }));
    const mc = monteCarlo(trades, 200)!;
    expect(mc.final[0]).toBeLessThanOrEqual(mc.final[1]);
    expect(mc.final[1]).toBeLessThanOrEqual(mc.final[2]);
    const tpl = TEMPLATES[0];
    expect(numericParams(tpl)).toContain('entry.0.fast');
    expect(getParam(setParam(tpl, 'entry.0.fast', 5), 'entry.0.fast')).toBe(5);
    expect(getParam(setParam(tpl, 'slPct', 7), 'slPct')).toBe(7);
    const c = fromCloses(Array.from({ length: 300 }, (_, i) => 100 + Math.sin(i / 8) * 10 + i * 0.05));
    const res = optimize(c, tpl, [{ path: 'entry.0.fast', from: 5, to: 9, step: 2 }, { path: 'slPct', from: 2, to: 4, step: 1 }], 0.7, 5);
    expect(res).toHaveLength(5);
    expect(res[0].inSample.netPct).toBeGreaterThanOrEqual(res[4].inSample.netPct);
  });
});
