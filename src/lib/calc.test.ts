import { describe, expect, it } from 'vitest';
import { backtestDca, computePortfolio, halving, planMonths, priceAt, projectPlan, type Tx } from './calc';
import { parseBtc, parseIdr } from '../components/ui';
import { classifyQuery } from './api';
import { classify, mergeNews, parseRss } from '../../server/news';
import { toWhale } from '../../server/whales';

const tx = (p: Partial<Tx>): Tx => ({ id: Math.random().toString(), date: '2027-01-01', type: 'buy', btc: 0, priceIdr: 0, feeIdr: 0, ...p });

describe('computePortfolio (average cost)', () => {
  it('handles buys, a partial sell and fees', () => {
    const s = computePortfolio(
      [
        tx({ date: '2027-01-01', btc: 0.01, priceIdr: 1_000_000_000, feeIdr: 30_000 }),
        tx({ date: '2027-02-01', btc: 0.01, priceIdr: 1_500_000_000, feeIdr: 0 }),
        tx({ date: '2027-03-01', type: 'sell', btc: 0.01, priceIdr: 2_000_000_000, feeIdr: 20_000 }),
      ],
      2_000_000_000,
    );
    // cost after buys = 10,030,000 + 15,000,000 = 25,030,000 for 0.02 BTC → avg 1,251,500,000
    expect(s.btc).toBeCloseTo(0.01, 10);
    expect(s.costBasis).toBeCloseTo(12_515_000, 4);
    expect(s.realized).toBeCloseTo(20_000_000 - 20_000 - 12_515_000, 4);
    expect(s.value).toBeCloseTo(20_000_000, 4);
    expect(s.unrealized).toBeCloseTo(20_000_000 - 12_515_000, 4);
    expect(s.fees).toBe(50_000);
  });

  it('ignores selling more than held and resets when flat', () => {
    const s = computePortfolio(
      [tx({ btc: 0.5, priceIdr: 100 }), tx({ date: '2027-02-01', type: 'sell', btc: 1, priceIdr: 200 })],
      300,
    );
    expect(s.btc).toBe(0);
    expect(s.costBasis).toBe(0);
    expect(s.realized).toBeCloseTo(50, 8);
  });
});

describe('DCA', () => {
  const hist = [
    { t: new Date(2020, 0, 1).getTime(), p: 100 },
    { t: new Date(2020, 1, 1).getTime(), p: 50 },
    { t: new Date(2020, 2, 1).getTime(), p: 200 },
  ];
  it('priceAt returns last price at or before t', () => {
    expect(priceAt(hist, new Date(2020, 0, 15).getTime())).toBe(100);
    expect(priceAt(hist, new Date(2019, 0, 1).getTime())).toBeNull();
  });
  it('backtests monthly buys', () => {
    const r = backtestDca(hist, 100, hist[0].t, hist[2].t, 1)!;
    expect(r.points).toHaveLength(3);
    expect(r.invested).toBe(300);
    expect(r.btc).toBeCloseTo(1 + 2 + 0.5, 10);
    expect(r.value).toBeCloseTo(700, 8);
    expect(r.lumpSumValue).toBeCloseTo(600, 8);
  });
  it('projects a flat scenario exactly', () => {
    const p = projectPlan({ monthlyIdr: 1_000_000, startMonth: '2000-01', months: 12, day: 1, feePct: 0 }, 1_000_000_000, 0, 'flat');
    expect(p.invested).toBe(12_000_000);
    expect(p.btc).toBeCloseTo(0.012, 10);
    expect(p.value).toBeCloseTo(12_000_000, 4);
  });
  it('lists plan months across a year boundary', () => {
    expect(planMonths({ monthlyIdr: 1, startMonth: '2027-11', months: 3, day: 1, feePct: 0 })).toEqual(['2027-11', '2027-12', '2028-01']);
  });
  it('computes the next halving', () => {
    const h = halving(900_000);
    expect(h.next).toBe(1_050_000);
    expect(h.blocksLeft).toBe(150_000);
    expect(h.nextSubsidy).toBe(1.5625);
  });
});

describe('number parsing', () => {
  it('parses rupiah with thousands separators', () => {
    expect(parseIdr('1.000.000')).toBe(1_000_000);
    expect(parseIdr('1,000,000')).toBe(1_000_000);
    expect(parseIdr('250.000')).toBe(250_000);
    expect(parseIdr('1500000')).toBe(1_500_000);
    expect(parseIdr('')).toBeNaN();
  });
  it('parses BTC decimals with dot or comma', () => {
    expect(parseBtc('0.005')).toBe(0.005);
    expect(parseBtc('0,005')).toBe(0.005);
    expect(parseBtc('abc')).toBeNaN();
  });
});

describe('explorer query detection', () => {
  it('detects kinds', () => {
    expect(classifyQuery('840000')?.kind).toBe('height');
    expect(classifyQuery('bc1qgdjqv0av3q56jvd82tkdjpy7gdp9ut8tlqmgrpmv24sq90ecnvqqjwvw97')?.kind).toBe('address');
    expect(classifyQuery('34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo')?.kind).toBe('address');
    expect(classifyQuery('a'.repeat(64))?.kind).toBe('tx');
    expect(classifyQuery('00000000' + 'b'.repeat(56))?.kind).toBe('blockhash');
    expect(classifyQuery('hello')).toBeNull();
  });
});

describe('news classification', () => {
  it('tags institutional buys and sells', () => {
    expect(classify('Bitcoin ETFs record $500M inflows as BlackRock IBIT leads')).toEqual({ category: 'institution', flow: 'buy' });
    expect(classify('Hedge fund sells entire bitcoin stake, 13F shows')).toEqual({ category: 'institution', flow: 'sell' });
    expect(classify('Spot bitcoin ETF outflows hit $1B')).toEqual({ category: 'institution', flow: 'sell' });
    expect(classify('Strategy acquires 10,000 BTC')).toEqual({ category: 'institution', flow: 'buy' });
  });
  it('tags whale news and plain market news', () => {
    expect(classify('Dormant Satoshi-era whale moves 2,000 BTC').category).toBe('whale');
    expect(classify('Bitcoin price consolidates near support')).toEqual({ category: 'market', flow: null });
    expect(classify('A new trading strategy for bitcoin').category).toBe('market');
  });

  it('parses RSS, strips Google News source suffix and dedupes', () => {
    const xml = `<?xml version="1.0"?><rss><channel>
      <item><title><![CDATA[ETF inflows surge - Reuters]]></title><link>https://a</link><pubDate>Mon, 02 Nov 2026 10:00:00 GMT</pubDate><source url="https://reuters.com">Reuters</source></item>
      <item><title>Whale wallet moved 5,000 BTC - CoinDesk</title><link>https://b</link><pubDate>Mon, 02 Nov 2026 11:00:00 GMT</pubDate><source url="https://coindesk.com">CoinDesk</source></item>
    </channel></rss>`;
    const items = parseRss(xml, { name: 'Google News', url: '', lang: 'en', google: true });
    expect(items.map((i) => [i.title, i.source, i.category, i.flow])).toEqual([
      ['ETF inflows surge', 'Reuters', 'institution', 'buy'],
      ['Whale wallet moved 5,000 BTC', 'CoinDesk', 'whale', null],
    ]);
    const merged = mergeNews([items, items]);
    expect(merged).toHaveLength(2);
    expect(merged[0].title).toBe('Whale wallet moved 5,000 BTC'); // newest first
  });
});

describe('whale detection', () => {
  const big = {
    hash: 'h',
    time: 1_700_000_000,
    inputs: [{ prev_out: { addr: 'bc1qunknown', value: 600e8 } }],
    out: [
      { addr: '34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo', value: 550e8 },
      { addr: 'bc1qchange', value: 49.9e8 },
    ],
  };
  it('flags large transfers into a known exchange wallet', () => {
    const w = toWhale(big, 100, true, 900_000)!;
    expect(w.btc).toBeCloseTo(599.9, 4);
    expect(w.flow).toBe('exchange_in');
    expect(w.to[0].label).toBe('Binance (cold)');
  });
  it('skips small transactions and coinbase', () => {
    expect(toWhale(big, 1000, true, 1)).toBeNull();
    expect(toWhale({ ...big, inputs: [{}] }, 1, true, 1)).toBeNull();
  });
});
