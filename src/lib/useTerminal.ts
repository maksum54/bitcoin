import { useEffect, useMemo, useRef, useState } from 'react';
import { LocalBook } from '../terminal/orderbook';
import { FootprintStore } from '../terminal/profile';
import { openSocket } from '../terminal/socket';
import { decodeStream, mergeCandle, parseKline, parseTrade, pushTrades, REST, streamUrl, SYMBOL, type Book, type Candle, type Interval, type Ticker, type Trade } from './terminal';

export type Status = 'connecting' | 'live' | 'reconnecting' | 'paused';

export interface TerminalData {
  candles: Candle[];
  book: Book | null;
  trades: Trade[];
  ticker: Ticker | null;
  status: Status;
  error: boolean;
  /** Every trade as it arrives (the `trades` list keeps only the newest 200). */
  onTrades: (cb: (t: Trade[]) => void) => () => void;
  /** 1-minute / $1 footprint built from the trades since the tab opened (plus a short backfill). */
  footprint: FootprintStore;
  /** Bumps when the footprint store changes (once per flush). */
  footVersion: number;
}

const FLUSH_MS = 250;
/** BTC/USDT ticks are $0.01, so a useful DOM needs thousands of levels. */
const BOOK_LEVELS = 5000;
const BACKFILL_PAGES = 6;

export async function fetchCandles(interval: Interval | string, limit = 500, symbol = SYMBOL, endTime?: number, signal?: AbortSignal): Promise<Candle[]> {
  const q = `symbol=${symbol}&interval=${interval}&limit=${Math.min(1000, limit)}${endTime ? `&endTime=${endTime}` : ''}`;
  const r = await fetch(`${REST}/klines?${q}`, { signal });
  if (!r.ok) throw new Error(`klines ${r.status}`);
  const rows: unknown = await r.json();
  return Array.isArray(rows) ? rows.map(parseKline).filter((c): c is Candle => !!c) : [];
}

/** Up to `bars` candles, paging back 1000 at a time. */
export async function fetchHistory(interval: Interval | string, bars: number, symbol = SYMBOL, signal?: AbortSignal): Promise<Candle[]> {
  let out: Candle[] = [];
  let end: number | undefined;
  while (out.length < bars) {
    const page = await fetchCandles(interval, Math.min(1000, bars - out.length), symbol, end, signal);
    if (!page.length) break;
    out = [...page, ...out];
    end = page[0].t - 1;
    if (page.length < 1000 && out.length < bars) break;
  }
  return out;
}

/** The latest few thousand trades, so the footprint has something to show at once. */
async function backfillTrades(signal: AbortSignal): Promise<Trade[]> {
  const get = async (q: string) => {
    const r = await fetch(`${REST}/aggTrades?symbol=${SYMBOL}&limit=1000${q}`, { signal });
    if (!r.ok) throw new Error(`aggTrades ${r.status}`);
    const rows: unknown = await r.json();
    return Array.isArray(rows) ? rows.map(parseTrade).filter((t): t is Trade => !!t) : [];
  };
  let all = await get('');
  for (let i = 1; i < BACKFILL_PAGES && all.length; i++) {
    const page = await get(`&fromId=${Math.max(0, all[0].id - 1000)}`);
    if (!page.length || page[0].id >= all[0].id) break;
    all = [...page.filter((t) => t.id < all[0].id), ...all];
  }
  return all;
}

/**
 * Streams BTC/USDT candles, the full order book, trades and the 24h ticker from Binance.
 * Updates are batched into one React render every 250 ms.
 */
export function useTerminal(interval: Interval): TerminalData {
  const listeners = useRef(new Set<(t: Trade[]) => void>());
  const footprint = useMemo(() => new FootprintStore(), []);
  const [state, setState] = useState({ candles: [] as Candle[], book: null as Book | null, trades: [] as Trade[], ticker: null as Ticker | null, status: 'connecting' as Status, error: false, footVersion: 0 });
  const pending = useRef({ candles: [] as Candle[], trades: [] as Trade[], ticker: null as Ticker | null, bookDirty: false });

  // Footprint backfill once.
  useEffect(() => {
    const ctrl = new AbortController();
    backfillTrades(ctrl.signal)
      .then((ts) => {
        for (const t of ts) footprint.add(t);
        setState((s) => ({ ...s, footVersion: s.footVersion + 1 }));
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [footprint]);

  useEffect(() => {
    let ctrl = new AbortController();
    const book = new LocalBook();
    let snapBusy = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    pending.current = { candles: [], trades: [], ticker: null, bookDirty: false };
    setState((s) => ({ ...s, candles: [], book: null, status: 'connecting', error: false }));

    const loadHistory = () => {
      ctrl.abort();
      ctrl = new AbortController();
      fetchCandles(interval, 500, SYMBOL, undefined, ctrl.signal)
        .then((hist) =>
          setState((s) => {
            let merged = hist;
            for (const c of s.candles) if (!hist.length || c.t >= hist[hist.length - 1].t) merged = mergeCandle(merged, c);
            return { ...s, candles: merged, error: false };
          }),
        )
        .catch((e) => {
          if ((e as Error).name !== 'AbortError') setState((s) => ({ ...s, error: !s.candles.length }));
        });
    };

    const loadSnapshot = () => {
      if (snapBusy) return;
      snapBusy = true;
      book.reset();
      fetch(`${REST}/depth?symbol=${SYMBOL}&limit=5000`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`depth ${r.status}`))))
        .then((snap) => {
          snapBusy = false;
          if (book.snapshot(snap) === 'gap') loadSnapshot();
          else pending.current.bookDirty = true;
        })
        .catch((e) => {
          snapBusy = false;
          if ((e as Error).name !== 'AbortError') retryTimer = setTimeout(loadSnapshot, 3000);
        });
    };

    const close = openSocket({
      url: streamUrl(interval),
      onStatus: (live) => setState((s) => ({ ...s, status: live ? 'live' : document.visibilityState === 'hidden' ? 'paused' : 'reconnecting' })),
      onReopen: () => {
        loadHistory();
        loadSnapshot();
      },
      onMessage: (raw) => {
        const m = decodeStream(raw);
        if (!m) return;
        const p = pending.current;
        if (m.kind === 'trade') p.trades.push(m.trade);
        else if (m.kind === 'diff') {
          if (book.push(m.diff) === 'gap') loadSnapshot();
          else if (book.ready) p.bookDirty = true;
        } else if (m.kind === 'kline') p.candles.push(m.candle);
        else if (m.kind === 'ticker') p.ticker = m.ticker;
      },
    });

    let flushes = 0;
    const flush = setInterval(() => {
      const p = pending.current;
      if (!p.candles.length && !p.trades.length && !p.bookDirty && !p.ticker) return;
      pending.current = { candles: [], trades: [], ticker: null, bookDirty: false };
      if (p.trades.length) {
        for (const t of p.trades) footprint.add(t);
        for (const cb of listeners.current) cb(p.trades);
      }
      if (++flushes % 40 === 0) book.trim(8000);
      const top = p.bookDirty ? book.top(BOOK_LEVELS) : null;
      setState((s) => {
        let candles = s.candles;
        for (const c of p.candles) candles = mergeCandle(candles, c);
        return {
          ...s,
          candles,
          trades: pushTrades(s.trades, p.trades),
          book: top ?? s.book,
          ticker: p.ticker ?? s.ticker,
          footVersion: p.trades.length ? s.footVersion + 1 : s.footVersion,
        };
      });
    }, FLUSH_MS);

    loadHistory();
    loadSnapshot();

    return () => {
      ctrl.abort();
      clearTimeout(retryTimer);
      clearInterval(flush);
      close();
    };
  }, [interval, footprint]);

  const onTrades = useMemo(
    () => (cb: (t: Trade[]) => void) => {
      listeners.current.add(cb);
      return () => void listeners.current.delete(cb);
    },
    [],
  );

  return { ...state, onTrades, footprint };
}
