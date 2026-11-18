import { useEffect, useRef, useState } from 'react';
import { decodeStream, mergeCandle, parseKline, pushTrades, REST, streamUrl, SYMBOL, type Book, type Candle, type Interval, type Ticker, type Trade } from './terminal';

export type Status = 'connecting' | 'live' | 'reconnecting' | 'paused';

export interface TerminalData {
  candles: Candle[];
  book: Book | null;
  trades: Trade[];
  ticker: Ticker | null;
  status: Status;
  error: boolean;
}

const FLUSH_MS = 250;
const HIDDEN_CLOSE_MS = 30_000;

async function fetchCandles(interval: Interval, signal: AbortSignal): Promise<Candle[]> {
  const r = await fetch(`${REST}/klines?symbol=${SYMBOL}&interval=${interval}&limit=500`, { signal });
  if (!r.ok) throw new Error(`klines ${r.status}`);
  const rows: unknown = await r.json();
  return Array.isArray(rows) ? rows.map(parseKline).filter((c): c is Candle => !!c) : [];
}

/**
 * Streams BTC/USDT candles, book, trades and 24h ticker from Binance.
 * Updates are batched into one React render every 250 ms, the socket reconnects with
 * backoff, and it closes after 30 s in a hidden tab (and catches up when shown again).
 */
export function useTerminal(interval: Interval): TerminalData {
  const [state, setState] = useState<TerminalData>({ candles: [], book: null, trades: [], ticker: null, status: 'connecting', error: false });
  const pending = useRef<{ candles: Candle[]; book: Book | null; trades: Trade[]; ticker: Ticker | null }>({ candles: [], book: null, trades: [], ticker: null });

  useEffect(() => {
    let ws: WebSocket | null = null;
    let closed = false;
    let retry = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let hiddenTimer: ReturnType<typeof setTimeout> | undefined;
    let ctrl = new AbortController();
    pending.current = { candles: [], book: null, trades: [], ticker: null };
    setState({ candles: [], book: null, trades: [], ticker: null, status: 'connecting', error: false });

    const loadHistory = () => {
      ctrl.abort();
      ctrl = new AbortController();
      fetchCandles(interval, ctrl.signal)
        .then((hist) =>
          setState((s) => {
            // Keep any live candles newer than the history, then apply them on top.
            let merged = hist;
            for (const c of s.candles) if (!hist.length || c.t >= hist[hist.length - 1].t) merged = mergeCandle(merged, c);
            return { ...s, candles: merged, error: false };
          }),
        )
        .catch((e) => {
          if ((e as Error).name !== 'AbortError') setState((s) => ({ ...s, error: !s.candles.length }));
        });
    };

    const connect = () => {
      if (closed) return;
      setState((s) => ({ ...s, status: retry ? 'reconnecting' : 'connecting' }));
      const sock = new WebSocket(streamUrl(interval));
      ws = sock;
      sock.onopen = () => {
        retry = 0;
        setState((s) => ({ ...s, status: 'live', error: false }));
      };
      sock.onmessage = (ev) => {
        const m = decodeStream(String(ev.data));
        if (!m) return;
        const p = pending.current;
        if (m.kind === 'trade') p.trades.push(m.trade);
        else if (m.kind === 'book') p.book = m.book;
        else if (m.kind === 'kline') p.candles.push(m.candle);
        else p.ticker = m.ticker;
      };
      sock.onerror = () => sock.close();
      sock.onclose = () => {
        if (ws !== sock || closed) return;
        ws = null;
        if (document.visibilityState === 'hidden') {
          setState((s) => ({ ...s, status: 'paused' }));
          return;
        }
        const delay = Math.min(30_000, 1000 * 2 ** retry++);
        setState((s) => ({ ...s, status: 'reconnecting' }));
        retryTimer = setTimeout(() => {
          loadHistory();
          connect();
        }, delay);
      };
    };

    const flush = setInterval(() => {
      const p = pending.current;
      if (!p.candles.length && !p.trades.length && !p.book && !p.ticker) return;
      pending.current = { candles: [], book: null, trades: [], ticker: null };
      setState((s) => {
        let candles = s.candles;
        for (const c of p.candles) candles = mergeCandle(candles, c);
        return {
          ...s,
          candles,
          trades: pushTrades(s.trades, p.trades),
          book: p.book ?? s.book,
          ticker: p.ticker ?? s.ticker,
        };
      });
    }, FLUSH_MS);

    const onVisibility = () => {
      clearTimeout(hiddenTimer);
      if (document.visibilityState === 'hidden') {
        hiddenTimer = setTimeout(() => {
          const sock = ws;
          ws = null;
          sock?.close();
          setState((s) => ({ ...s, status: 'paused' }));
        }, HIDDEN_CLOSE_MS);
      } else if (!ws && !closed) {
        clearTimeout(retryTimer);
        retry = 0;
        loadHistory();
        connect();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    loadHistory();
    connect();

    return () => {
      closed = true;
      ctrl.abort();
      clearInterval(flush);
      clearTimeout(retryTimer);
      clearTimeout(hiddenTimer);
      document.removeEventListener('visibilitychange', onVisibility);
      const sock = ws;
      ws = null;
      sock?.close();
    };
  }, [interval]);

  return state;
}
