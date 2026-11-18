import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { TerminalData } from '../lib/useTerminal';
import { PAPER_SYMBOLS, type PaperSymbol } from './paper';
import { openSocket } from './socket';
import { FlowWindow, LIQ_FEEDS, TRADE_FEEDS, type Liq } from './venues';

/** The live BTC/USDT data shared by every Terminal view. */
export const TermCtx = createContext<TerminalData | null>(null);
export const useTerm = () => useContext(TermCtx)!;

/** Feeds that run for the whole Terminal tab (chart markers, paper trading). */
export const LiveCtx = createContext<{ liqs: Liq[]; liqLive: Record<string, boolean>; marks: Partial<Record<PaperSymbol, number>> }>({ liqs: [], liqLive: {}, marks: {} });
export const useLive = () => useContext(LiveCtx);

/** Liquidations of BTC perpetuals on Binance, Bybit and OKX, newest first. */
export function useLiquidations(max = 300) {
  const [liqs, setLiqs] = useState<Liq[]>([]);
  const [live, setLive] = useState<Record<string, boolean>>({});
  useEffect(() => {
    let buf: Liq[] = [];
    const closers = LIQ_FEEDS.map((f) =>
      openSocket({
        url: f.url,
        subscribe: f.subscribe,
        ping: f.ping,
        onStatus: (on) => setLive((s) => ({ ...s, [f.name]: on })),
        onMessage: (raw) => {
          const r = f.parse(raw);
          if (r?.liqs?.length) buf.push(...r.liqs);
        },
      }),
    );
    const id = setInterval(() => {
      if (!buf.length) return;
      const add = buf.sort((a, b) => b.t - a.t);
      buf = [];
      setLiqs((s) => [...add, ...s].slice(0, max));
    }, 500);
    return () => {
      clearInterval(id);
      closers.forEach((c) => c());
    };
  }, [max]);
  return { liqs, live };
}

export interface VenueFlow {
  id: string;
  name: string;
  market: 'spot' | 'perp';
  live: boolean;
  w: FlowWindow;
  last?: number;
}

/** Taker flow per exchange and market, refreshed once a second. */
export function useVenueFlow() {
  const venues = useMemo<VenueFlow[]>(() => TRADE_FEEDS.map((f) => ({ id: f.id, name: f.name, market: f.market, live: false, w: new FlowWindow() })), []);
  const [, setTick] = useState(0);
  useEffect(() => {
    const closers = TRADE_FEEDS.map((f, i) =>
      openSocket({
        url: f.url,
        subscribe: f.subscribe,
        ping: f.ping,
        onStatus: (on) => (venues[i].live = on),
        onMessage: (raw) => {
          const r = f.parse(raw);
          if (!r?.trades) return;
          for (const t of r.trades) venues[i].w.add(t);
          if (r.trades.length) venues[i].last = r.trades[r.trades.length - 1].p;
        },
      }),
    );
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => {
      clearInterval(id);
      closers.forEach((c) => c());
    };
  }, [venues]);
  return venues;
}

/** Mark prices of the paper-trading perpetuals (Binance futures, every second). */
export function useMarkPrices(): Partial<Record<PaperSymbol, number>> {
  const [marks, setMarks] = useState<Partial<Record<PaperSymbol, number>>>({});
  const buf = useRef<Partial<Record<PaperSymbol, number>>>({});
  useEffect(() => {
    const streams = PAPER_SYMBOLS.map((s) => `${s.toLowerCase()}@markPrice@1s`).join('/');
    const close = openSocket({
      url: `wss://fstream.binance.com/stream?streams=${streams}`,
      onMessage: (raw) => {
        try {
          const m = JSON.parse(raw) as { data?: { s?: string; p?: string } };
          const sym = m.data?.s as PaperSymbol | undefined;
          const p = parseFloat(m.data?.p ?? '');
          if (sym && PAPER_SYMBOLS.includes(sym) && Number.isFinite(p)) buf.current[sym] = p;
        } catch {
          /* ignore */
        }
      },
    });
    const id = setInterval(() => {
      if (Object.keys(buf.current).length) {
        const b = buf.current;
        buf.current = {};
        setMarks((m) => ({ ...m, ...b }));
      }
    }, 1000);
    return () => {
      clearInterval(id);
      close();
    };
  }, []);
  return marks;
}
