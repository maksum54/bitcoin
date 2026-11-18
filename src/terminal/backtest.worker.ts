/// <reference lib="webworker" />
import type { Candle } from '../lib/terminal';
import { backtest, monteCarlo, optimize, type Range, type Strategy } from './backtest';

export type WorkerReq =
  | { id: number; kind: 'run'; candles: Candle[]; strategy: Strategy }
  | { id: number; kind: 'optimize'; candles: Candle[]; strategy: Strategy; ranges: Range[] }
  | { id: number; kind: 'markets'; sets: { sym: string; candles: Candle[] }[]; strategy: Strategy };

/** A request without its id (spread over each kind of request). */
export type WorkerMsg = WorkerReq extends infer R ? (R extends WorkerReq ? Omit<R, 'id'> : never) : never;

self.onmessage = (e: MessageEvent<WorkerReq>) => {
  const m = e.data;
  try {
    if (m.kind === 'run') {
      const report = backtest(m.candles, m.strategy);
      self.postMessage({ id: m.id, report, mc: monteCarlo(report.trades) });
    } else if (m.kind === 'optimize') {
      self.postMessage({ id: m.id, opt: optimize(m.candles, m.strategy, m.ranges) });
    } else {
      const rows = m.sets.map((s) => {
        const r = backtest(s.candles, m.strategy);
        return { sym: s.sym, netPct: r.netPct, buyHoldPct: r.buyHoldPct, maxDD: r.maxDD, trades: r.trades.length, winRate: r.winRate, profitFactor: r.profitFactor };
      });
      self.postMessage({ id: m.id, markets: rows });
    }
  } catch (err) {
    self.postMessage({ id: m.id, error: String(err) });
  }
};
