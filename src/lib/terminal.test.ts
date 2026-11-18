import { describe, expect, it } from 'vitest';
import {
  cumulative,
  decodeStream,
  flow,
  groupBook,
  imbalance,
  mergeCandle,
  niceTicks,
  parseBook,
  parseKline,
  pushTrades,
  spread,
  stepDigits,
  streamUrl,
  type Candle,
  type Trade,
} from './terminal';

const c = (t: number, close = 100): Candle => ({ t, o: 100, h: 110, l: 90, c: close, v: 1 });

describe('candles', () => {
  it('parses a REST kline row', () => {
    expect(parseKline([1700000000000, '1.5', '2', '1', '1.8', '10.5', 0, '0', 1, '0', '0', '0'])).toEqual({ t: 1700000000000, o: 1.5, h: 2, l: 1, c: 1.8, v: 10.5 });
    expect(parseKline(['x'])).toBeNull();
    expect(parseKline([1, 'a', 'b', 'c', 'd', 'e'])).toBeNull();
  });

  it('updates the forming candle and appends new ones', () => {
    const list = [c(1), c(2)];
    expect(mergeCandle(list, c(2, 105))).toEqual([c(1), c(2, 105)]);
    expect(mergeCandle(list, c(3))).toEqual([c(1), c(2), c(3)]);
    expect(mergeCandle(list, c(3), 2)).toEqual([c(2), c(3)]);
    // A late update for an older candle replaces it in place; an unknown old one is ignored.
    expect(mergeCandle(list, c(1, 99))).toEqual([c(1, 99), c(2)]);
    expect(mergeCandle(list, c(0))).toBe(list);
    expect(mergeCandle([], c(5))).toEqual([c(5)]);
  });
});

describe('order book', () => {
  const book = parseBook({
    lastUpdateId: 1,
    bids: [['99.5', '1'], ['100.2', '2'], ['99.9', '0.5'], ['98', '0']],
    asks: [['101.7', '1'], ['100.4', '3'], ['bad', '1']],
  })!;

  it('sorts sides best first and drops empty or bad levels', () => {
    expect(book.bids.map((l) => l.p)).toEqual([100.2, 99.9, 99.5]);
    expect(book.asks.map((l) => l.p)).toEqual([100.4, 101.7]);
    expect(parseBook({ bids: [], asks: [] })).toBeNull();
  });

  it('groups bids down and asks up so buckets never cross', () => {
    const g = groupBook(book, 1);
    expect(g.bids).toEqual([{ p: 100, q: 2 }, { p: 99, q: 1.5 }]);
    expect(g.asks).toEqual([{ p: 101, q: 3 }, { p: 102, q: 1 }]);
    expect(groupBook(book, 1, 1).bids).toHaveLength(1);
  });

  it('computes spread, imbalance and running totals', () => {
    const s = spread(book)!;
    expect(s.abs).toBeCloseTo(0.2);
    expect(s.mid).toBeCloseTo(100.3);
    expect(imbalance(book)).toBeCloseTo(3.5 / 7.5);
    expect(cumulative(book.bids)).toEqual([2, 2.5, 3.5]);
    expect(spread({ bids: [], asks: book.asks })).toBeNull();
  });
});

describe('trades', () => {
  const tr = (id: number, q: number, buy: boolean): Trade => ({ id, p: 100, q, t: id, buy });

  it('keeps newest first without duplicates', () => {
    const list = pushTrades([], [tr(1, 1, true), tr(2, 1, false)]);
    expect(list.map((t) => t.id)).toEqual([2, 1]);
    expect(pushTrades(list, [tr(2, 1, false), tr(3, 1, true)]).map((t) => t.id)).toEqual([3, 2, 1]);
    expect(pushTrades(list, [tr(3, 1, true)], 2).map((t) => t.id)).toEqual([3, 2]);
  });

  it('sums taker flow', () => {
    expect(flow([tr(1, 2, true), tr(2, 0.5, false), tr(3, 1, true)])).toEqual({ buy: 3, sell: 0.5, net: 2.5 });
  });
});

describe('stream', () => {
  it('builds the combined stream url', () => {
    expect(streamUrl('5m')).toBe('wss://data-stream.binance.vision/stream?streams=btcusdt@aggTrade/btcusdt@depth20@100ms/btcusdt@kline_5m/btcusdt@ticker');
  });

  it('decodes each message kind', () => {
    expect(decodeStream(JSON.stringify({ stream: 'btcusdt@aggTrade', data: { a: 7, p: '100', q: '0.1', T: 5, m: true } }))).toEqual({
      kind: 'trade',
      trade: { id: 7, p: 100, q: 0.1, t: 5, buy: false },
    });
    expect(decodeStream(JSON.stringify({ stream: 'btcusdt@depth20@100ms', data: { bids: [['1', '1']], asks: [['2', '1']] } }))?.kind).toBe('book');
    expect(decodeStream(JSON.stringify({ stream: 'btcusdt@kline_1m', data: { k: { t: 1, o: '1', h: '2', l: '0.5', c: '1.5', v: '3' } } }))).toEqual({
      kind: 'kline',
      candle: { t: 1, o: 1, h: 2, l: 0.5, c: 1.5, v: 3 },
    });
    expect(decodeStream(JSON.stringify({ stream: 'btcusdt@ticker', data: { c: '1', P: '-2.5', h: '2', l: '0.5', v: '10', q: '20' } }))).toEqual({
      kind: 'ticker',
      ticker: { last: 1, changePct: -2.5, high: 2, low: 0.5, vol: 10, quoteVol: 20 },
    });
    expect(decodeStream('not json')).toBeNull();
    expect(decodeStream(JSON.stringify({ stream: 'x@other', data: {} }))).toBeNull();
  });
});

describe('helpers', () => {
  it('picks decimals for a step', () => {
    expect([0.01, 0.1, 1, 10, 100].map(stepDigits)).toEqual([2, 1, 0, 0, 0]);
  });

  it('makes nice ticks', () => {
    expect(niceTicks(0, 10, 5)).toEqual([0, 2, 4, 6, 8, 10]);
    expect(niceTicks(95_123, 96_877, 4)).toEqual([95_500, 96_000, 96_500]);
    expect(niceTicks(5, 5)).toEqual([5]);
  });
});
