import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Marker } from '../../components/CandleChart';
import { Btn, Card, ErrorBox, Field, Loading, Seg, Stat } from '../../components/ui';
import { dateTime, num, pct } from '../../lib/format';
import { useApp, type Key, type T } from '../../lib/i18n';
import { useStored } from '../../lib/storage';
import type { Candle } from '../../lib/terminal';
import { fetchHistory } from '../../lib/useTerminal';
import { getParam, numericParams, setParam, TEMPLATES, type Cond, type MonteCarlo, type OptResult, type Range, type Report, type Strategy } from '../backtest';
import type { WorkerMsg } from '../backtest.worker';

const CandleChart = lazy(() => import('../../components/CandleChart'));

const TF_MS: Record<string, number> = { '15m': 900e3, '1h': 3600e3, '4h': 14400e3, '1d': 86400e3 };
const BARS = [1000, 3000, 10000, 30000] as const;
const MARKETS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT'];

const NEW_COND: Record<Cond['k'], Cond> = {
  emaCross: { k: 'emaCross', fast: 9, slow: 21, dir: 'up' },
  priceEma: { k: 'priceEma', n: 50, dir: 'above' },
  rsi: { k: 'rsi', n: 14, op: 'crossUp', level: 30 },
  macd: { k: 'macd', dir: 'up' },
  bb: { k: 'bb', n: 20, mult: 2, op: 'closeAbove' },
  breakout: { k: 'breakout', n: 20, dir: 'high' },
};

/** One condition as words. */
export function condText(c: Cond, t: T): string {
  switch (c.k) {
    case 'emaCross':
      return t(c.dir === 'up' ? 'x.c.emaCrossUp' : 'x.c.emaCrossDown', { a: c.fast, b: c.slow });
    case 'priceEma':
      return t(c.dir === 'above' ? 'x.c.priceAbove' : 'x.c.priceBelow', { n: c.n });
    case 'rsi':
      return t(`x.c.rsi.${c.op}` as Key, { n: c.n, v: c.level });
    case 'macd':
      return t(c.dir === 'up' ? 'x.c.macdUp' : 'x.c.macdDown');
    case 'bb':
      return t(c.op === 'closeAbove' ? 'x.c.bbAbove' : 'x.c.bbBelow', { n: c.n, m: c.mult });
    case 'breakout':
      return t(c.dir === 'high' ? 'x.c.breakHigh' : 'x.c.breakLow', { n: c.n });
  }
}

/** The whole strategy as a sentence. */
export function describe(s: Strategy, t: T): string {
  const and = ` ${t('x.and')} `;
  const or = ` ${t('x.or')} `;
  const parts = [t(s.side === 'long' ? 'x.d.buy' : 'x.d.sell', { when: s.entry.map((c) => condText(c, t)).join(and) || '—' })];
  const exits = [...s.exit.map((c) => condText(c, t))];
  if (s.slPct) exits.push(t('x.d.sl', { v: s.slPct }));
  if (s.tpPct) exits.push(t('x.d.tp', { v: s.tpPct }));
  parts.push(exits.length ? t('x.d.exit', { when: exits.join(or) }) : t('x.d.noExit'));
  return parts.join(' ');
}

let reqId = 0;

export default function BacktestView() {
  const { t, lang } = useApp();
  const [st, setSt] = useStored<Strategy>('term.strategy', TEMPLATES[0]);
  const [tf, setTf] = useStored<string>('term.btTf', '1h');
  const [bars, setBars] = useStored<number>('term.btBars', 3000);
  const [sym, setSym] = useStored<string>('term.btSym', 'BTCUSDT');
  const [layout, setLayout] = useStored<'side' | 'under'>('term.btLayout', 'side');
  const [candles, setCandles] = useState<Candle[] | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [mc, setMc] = useState<MonteCarlo | null>(null);
  const [opt, setOpt] = useState<OptResult[] | null>(null);
  const [markets, setMarkets] = useState<{ sym: string; netPct: number; buyHoldPct: number; maxDD: number; trades: number; winRate: number; profitFactor: number }[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const worker = useRef<Worker | null>(null);
  const pendingReq = useRef(new Map<number, (d: unknown) => void>());

  useEffect(() => {
    const w = new Worker(new URL('../backtest.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e) => {
      const cb = pendingReq.current.get(e.data.id);
      pendingReq.current.delete(e.data.id);
      cb?.(e.data);
    };
    worker.current = w;
    return () => w.terminate();
  }, []);

  const ask = useCallback(<R,>(msg: WorkerMsg): Promise<R> => {
    const id = ++reqId;
    return new Promise((res) => {
      pendingReq.current.set(id, res as (d: unknown) => void);
      worker.current!.postMessage({ ...msg, id });
    });
  }, []);

  const loadData = useCallback(async () => {
    setBusy(t('x.bt.loading'));
    setError(false);
    try {
      const c = await fetchHistory(tf, bars, sym);
      setCandles(c);
      return c;
    } catch {
      setError(true);
      return null;
    } finally {
      setBusy(null);
    }
  }, [tf, bars, sym, t]);

  const key = `${tf}:${bars}:${sym}`;
  const dataKey = useRef('');

  const run = async () => {
    const c = candles?.length && key === dataKey.current ? candles : await loadData();
    dataKey.current = key;
    if (!c?.length) return;
    setBusy(t('x.bt.running'));
    const r = await ask<{ report: Report; mc: MonteCarlo | null }>({ kind: 'run', candles: c, strategy: st });
    setReport(r.report);
    setMc(r.mc);
    setBusy(null);
  };
  const params = numericParams(st);
  const [ranges, setRanges] = useState<Range[]>([]);
  useEffect(() => {
    const mk = (path: string): Range => {
      const v = getParam(st, path) ?? 2;
      return { path, from: Math.max(1, Math.round(v * 0.5)), to: Math.round(v * 1.5) || 2, step: Math.max(1, Math.round(v * 0.25)) };
    };
    // Prefer parameters that are set (a stop / target left empty has no value to vary).
    setRanges(params.filter((p) => getParam(st, p) != null).slice(0, 2).map(mk));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(params)]);

  const runOpt = async () => {
    const c = candles?.length && key === dataKey.current ? candles : await loadData();
    dataKey.current = key;
    if (!c?.length) return;
    setBusy(t('x.bt.optimizing'));
    const r = await ask<{ opt: OptResult[] }>({ kind: 'optimize', candles: c, strategy: st, ranges });
    setOpt(r.opt);
    setBusy(null);
  };

  const runMarkets = async () => {
    setBusy(t('x.bt.loading'));
    try {
      const sets = await Promise.all(MARKETS.map(async (m) => ({ sym: m, candles: await fetchHistory(tf, Math.min(bars, 5000), m) })));
      setBusy(t('x.bt.running'));
      const r = await ask<{ markets: NonNullable<typeof markets> }>({ kind: 'markets', sets, strategy: st });
      setMarkets(r.markets);
    } catch {
      setError(true);
    } finally {
      setBusy(null);
    }
  };

  const markers = useMemo<Marker[]>(() => {
    if (!report) return [];
    const long = st.side === 'long';
    return report.trades.flatMap((tr) => [
      { t: tr.entryT, p: long ? tr.entry * 0.997 : tr.entry * 1.003, shape: long ? 'up' : 'down', color: '#2563eb' } as Marker,
      { t: tr.exitT, p: long ? tr.exit * 1.003 : tr.exit * 0.997, shape: long ? 'down' : 'up', color: tr.pnl > 0 ? '#16a34a' : '#dc2626' } as Marker,
    ]);
  }, [report, st.side]);
  const fmt = useCallback((v: number) => num(v, lang, v >= 1000 ? 0 : 2), [lang]);

  const builder = (
    <Card title={t('x.bt.strategy')}>
      <div className="grid gap-2">
        <Field label={t('x.bt.template')}>
          <select value={TEMPLATES.findIndex((x) => x.name === st.name)} onChange={(e) => +e.target.value >= 0 && setSt(TEMPLATES[+e.target.value])}>
            <option value={-1}>{t('x.bt.custom')}</option>
            {TEMPLATES.map((x, i) => (
              <option key={x.name} value={i}>
                {x.name}
              </option>
            ))}
          </select>
        </Field>
        <Seg value={st.side} onChange={(side) => setSt({ ...st, side, name: t('x.bt.custom') })} options={[{ v: 'long', label: 'Long' }, { v: 'short', label: 'Short' }]} />
        <CondList title={t('x.bt.entryAll')} list={st.entry} set={(entry) => setSt({ ...st, entry, name: t('x.bt.custom') })} />
        <CondList title={t('x.bt.exitAny')} list={st.exit} set={(exit) => setSt({ ...st, exit, name: t('x.bt.custom') })} />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2">
          {(
            [
              ['slPct', 'Stop %'],
              ['tpPct', 'Target %'],
              ['feePct', t('x.bt.fee')],
              ['slipPct', t('x.bt.slip')],
              ['fundingPct', t('x.bt.funding')],
              ['lev', t('x.paper.lev')],
              ['capital', t('x.bt.capital')],
            ] as const
          ).map(([k, label]) => (
            <Field key={k} label={label}>
              <input
                type="number"
                inputMode="decimal"
                value={st[k] ?? ''}
                placeholder="—"
                onChange={(e) => {
                  const v = e.target.value === '' ? null : +e.target.value;
                  setSt({ ...st, [k]: k === 'slPct' || k === 'tpPct' ? (v && v > 0 ? v : null) : Math.max(k === 'lev' ? 1 : 0, v ?? 0) });
                }}
              />
            </Field>
          ))}
        </div>
        <p className="rounded-lg bg-card2 p-2 text-xs leading-relaxed">{describe(st, t)}</p>
        <div className="grid grid-cols-3 gap-1">
          <select value={sym} onChange={(e) => setSym(e.target.value)} className="!py-1.5 !text-sm">
            {MARKETS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
          <select value={tf} onChange={(e) => setTf(e.target.value)} className="!py-1.5 !text-sm">
            {Object.keys(TF_MS).map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
          <select value={bars} onChange={(e) => setBars(+e.target.value)} className="!py-1.5 !text-sm">
            {BARS.map((m) => (
              <option key={m} value={m}>
                {num(m, lang)} bar
              </option>
            ))}
          </select>
        </div>
        <Btn onClick={run} disabled={!!busy || !st.entry.length}>
          {busy ?? `▶ ${t('x.bt.run')}`}
        </Btn>
      </div>
    </Card>
  );

  const results = (
    <div className="grid min-w-0 content-start gap-3">
      {error && <ErrorBox onRetry={run} />}
      {!report && !busy && (
        <Card>
          <p className="py-6 text-center text-sm text-muted">{t('x.bt.hint')}</p>
        </Card>
      )}
      {busy && !report && <Loading rows={6} />}
      {report && candles && (
        <>
          <Card title={`${t('x.bt.report')} · ${sym} ${tf}`}>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label={t('x.bt.net')} value={pct(report.netPct, lang)} tone={report.netPct >= 0 ? 'up' : 'down'} sub={`${t('x.bt.bh')} ${pct(report.buyHoldPct, lang)}`} />
              <Stat label={t('x.bt.maxDD')} value={`-${num(report.maxDD, lang, 2)}%`} tone="down" />
              <Stat label={t('x.winRate')} value={`${num(report.winRate * 100, lang, 1)}%`} sub={`${report.trades.length} ${t('x.trades').toLowerCase()}`} />
              <Stat label="Profit factor" value={Number.isFinite(report.profitFactor) ? num(report.profitFactor, lang, 2) : '∞'} sub={`${t('x.bt.avg')} ${pct(report.avgPct, lang)}`} />
              <Stat label={t('x.bt.exposure')} value={`${num(report.exposure * 100, lang, 0)}%`} />
              <Stat label={t('x.bt.fees')} value={`$${num(report.fees, lang, 0)}`} />
              <Stat label={t('x.bt.funding')} value={`$${num(report.funding, lang, 0)}`} />
              <Stat label={t('x.bt.period')} value={`${new Date(candles[0].t).toLocaleDateString(lang, { month: 'short', year: '2-digit' })} – ${new Date(candles[candles.length - 1].t).toLocaleDateString(lang, { month: 'short', year: '2-digit' })}`} sub={`${num(candles.length, lang)} bar`} />
            </div>
            <div className="mt-3 h-80">
              <Suspense fallback={<Loading />}>
                <CandleChart candles={candles} intervalMs={TF_MS[tf]} fmt={fmt} lang={lang} markers={markers} />
              </Suspense>
            </div>
            <div className="mt-3 h-40">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={thin(report.equity, 600)} margin={{ left: 0, right: 0, top: 4, bottom: 0 }} syncId="bt">
                  <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} hide />
                  <YAxis tick={{ fill: 'var(--muted)', fontSize: 11 }} stroke="var(--line)" width={56} orientation="right" domain={['auto', 'auto']} tickFormatter={(v) => `$${num(v, lang, 0)}`} />
                  <Tooltip contentStyle={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 12, color: 'var(--fg)' }} labelFormatter={(v) => dateTime(v as number, lang)} formatter={(v, n) => [n === 'e' ? `$${num(v as number, lang, 0)}` : `-${num(v as number, lang, 2)}%`, n === 'e' ? t('x.equity') : 'DD']} />
                  <Area type="monotone" dataKey="e" stroke="var(--accent)" fill="var(--accent)" fillOpacity={0.12} strokeWidth={2} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="h-24">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={thin(report.equity, 600).map((p) => ({ ...p, dd: -p.dd }))} margin={{ left: 0, right: 0, top: 0, bottom: 0 }} syncId="bt">
                  <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} tickFormatter={(v) => new Date(v).toLocaleDateString(lang, { month: 'short', year: '2-digit' })} tick={{ fill: 'var(--muted)', fontSize: 11 }} stroke="var(--line)" minTickGap={50} />
                  <YAxis tick={{ fill: 'var(--muted)', fontSize: 11 }} stroke="var(--line)" width={56} orientation="right" tickFormatter={(v) => `${v.toFixed(0)}%`} />
                  <Area type="monotone" dataKey="dd" stroke="var(--down)" fill="var(--down)" fillOpacity={0.2} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <div className="grid gap-3 xl:grid-cols-2">
            <Card title={t('x.bt.months')}>
              <div className="grid grid-cols-4 gap-1 sm:grid-cols-6">
                {report.months.map((m) => (
                  <div key={m.m} className="rounded-md p-1 text-center text-[10px]" style={{ background: `color-mix(in srgb, var(${m.pct >= 0 ? '--up' : '--down'}) ${10 + Math.min(50, Math.abs(m.pct) * 3)}%, transparent)` }}>
                    <div className="text-muted">{m.m}</div>
                    <div className="num font-semibold">{pct(m.pct, lang)}</div>
                  </div>
                ))}
              </div>
            </Card>
            <Card title="Monte Carlo">
              {mc ? (
                <table className="w-full text-xs">
                  <thead className="text-muted">
                    <tr>
                      <th />
                      <th className="text-right font-normal">{t('x.bt.p5')}</th>
                      <th className="text-right font-normal">{t('x.bt.p50')}</th>
                      <th className="text-right font-normal">{t('x.bt.p95')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-t border-line">
                      <td className="py-1.5">{t('x.bt.net')}</td>
                      {mc.final.map((v, i) => (
                        <td key={i} className={`num text-right ${v >= 0 ? 'text-up' : 'text-down'}`}>
                          {pct(v, lang)}
                        </td>
                      ))}
                    </tr>
                    <tr className="border-t border-line">
                      <td className="py-1.5">{t('x.bt.maxDD')}</td>
                      {mc.maxDD.map((v, i) => (
                        <td key={i} className="num text-right text-down">
                          -{num(v, lang, 1)}%
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              ) : (
                <p className="text-xs text-muted">{t('x.bt.mcNeed')}</p>
              )}
              <p className="mt-2 text-[11px] text-muted">{t('x.bt.mcNote', { n: mc?.runs ?? 1000 })}</p>
            </Card>
          </div>

          <Card title={t('x.bt.optimizer')}>
            <div className="grid gap-2 sm:grid-cols-2">
              {ranges.map((r, i) => (
                <div key={i} className="grid grid-cols-4 gap-1">
                  <select value={r.path} onChange={(e) => setRanges(ranges.map((x, j) => (j === i ? { ...x, path: e.target.value } : x)))} className="!px-1 !py-1 !text-xs">
                    {params.map((p) => (
                      <option key={p}>{p}</option>
                    ))}
                  </select>
                  {(['from', 'to', 'step'] as const).map((k) => (
                    <input key={k} type="number" inputMode="decimal" aria-label={k} value={r[k]} onChange={(e) => setRanges(ranges.map((x, j) => (j === i ? { ...x, [k]: +e.target.value } : x)))} className="!px-1 !py-1 !text-xs" />
                  ))}
                </div>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Btn kind="ghost" onClick={runOpt} disabled={!!busy}>
                {t('x.bt.optimize')}
              </Btn>
              <Btn kind="ghost" onClick={runMarkets} disabled={!!busy}>
                {t('x.bt.otherMarkets')}
              </Btn>
            </div>
            {opt && (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-muted">
                    <tr>
                      <th className="py-1 text-left font-normal">{t('x.bt.params')}</th>
                      <th className="text-right font-normal">{t('x.bt.inSample')}</th>
                      <th className="text-right font-normal">DD</th>
                      <th className="text-right font-normal">{t('x.bt.outSample')}</th>
                      <th className="text-right font-normal">DD</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {opt.map((o, i) => (
                      <tr key={i} className="border-t border-line">
                        <td className="py-1">{Object.entries(o.params).map(([k, v]) => `${k.split('.').pop()}=${v}`).join(', ')}</td>
                        <td className={`num text-right ${o.inSample.netPct >= 0 ? 'text-up' : 'text-down'}`}>{pct(o.inSample.netPct, lang)}</td>
                        <td className="num text-right text-muted">{num(o.inSample.maxDD, lang, 1)}%</td>
                        <td className={`num text-right font-semibold ${o.outSample.netPct >= 0 ? 'text-up' : 'text-down'}`}>{pct(o.outSample.netPct, lang)}</td>
                        <td className="num text-right text-muted">{num(o.outSample.maxDD, lang, 1)}%</td>
                        <td className="text-right">
                          <button
                            className="text-accent"
                            onClick={() => {
                              let s = st;
                              for (const [k, v] of Object.entries(o.params)) s = setParam(s, k, v);
                              setSt({ ...s, name: t('x.bt.custom') });
                            }}
                          >
                            {t('x.bt.use')}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-1 text-[11px] text-muted">{t('x.bt.optNote')}</p>
              </div>
            )}
            {markets && (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-muted">
                    <tr>
                      <th className="py-1 text-left font-normal">{t('x.market')}</th>
                      <th className="text-right font-normal">{t('x.bt.net')}</th>
                      <th className="text-right font-normal">{t('x.bt.bh')}</th>
                      <th className="text-right font-normal">DD</th>
                      <th className="text-right font-normal">{t('x.trades')}</th>
                      <th className="text-right font-normal">Win</th>
                    </tr>
                  </thead>
                  <tbody>
                    {markets.map((m) => (
                      <tr key={m.sym} className="border-t border-line">
                        <td className="py-1">{m.sym}</td>
                        <td className={`num text-right font-semibold ${m.netPct >= 0 ? 'text-up' : 'text-down'}`}>{pct(m.netPct, lang)}</td>
                        <td className="num text-right text-muted">{pct(m.buyHoldPct, lang)}</td>
                        <td className="num text-right text-muted">{num(m.maxDD, lang, 1)}%</td>
                        <td className="num text-right">{m.trades}</td>
                        <td className="num text-right">{num(m.winRate * 100, lang, 0)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title={`${t('x.trades')} (${report.trades.length})`}>
            <div className="max-h-80 overflow-auto">
              <table className="w-full text-xs">
                <thead className="text-muted">
                  <tr>
                    <th className="py-1 text-left font-normal">{t('x.entry')}</th>
                    <th className="text-left font-normal">{t('x.exit')}</th>
                    <th className="text-right font-normal">{t('t.price')}</th>
                    <th className="pl-2 text-left font-normal">{t('x.reason')}</th>
                    <th className="text-right font-normal">%</th>
                  </tr>
                </thead>
                <tbody>
                  {[...report.trades].reverse().map((tr, i) => (
                    <tr key={i} className="border-t border-line">
                      <td className="py-1">{dateTime(tr.entryT, lang)}</td>
                      <td>{dateTime(tr.exitT, lang)}</td>
                      <td className="num text-right">
                        {fmt(tr.entry)} → {fmt(tr.exit)}
                      </td>
                      <td className="pl-2 text-muted">{t(`x.reason.${tr.reason}` as Key)}</td>
                      <td className={`num text-right ${tr.pct >= 0 ? 'text-up' : 'text-down'}`}>{pct(tr.pct, lang)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[11px] text-muted">{t('x.bt.note')}</p>
          </Card>
        </>
      )}
    </div>
  );

  return (
    <div className="grid gap-3">
      <div className="hidden justify-end lg:flex">
        <Seg value={layout} onChange={setLayout} options={[{ v: 'side', label: t('x.bt.side') }, { v: 'under', label: t('x.bt.under') }]} />
      </div>
      <div className={`grid gap-3 ${layout === 'side' ? 'lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]' : ''}`}>
        {layout === 'side' ? (
          <>
            {builder}
            {results}
          </>
        ) : (
          <>
            {results}
            {builder}
          </>
        )}
      </div>
    </div>
  );
}

/** Keeps the curve light for the chart. */
function thin<T>(a: T[], n: number): T[] {
  if (a.length <= n) return a;
  const k = a.length / n;
  return Array.from({ length: n }, (_, i) => a[Math.floor(i * k)]).concat(a[a.length - 1]);
}

function CondList({ title, list, set }: { title: string; list: Cond[]; set: (l: Cond[]) => void }) {
  const { t } = useApp();
  const upd = (i: number, c: Cond) => set(list.map((x, j) => (j === i ? c : x)));
  const numIn = (v: number, on: (n: number) => void) => <input type="number" inputMode="decimal" value={v} onChange={(e) => on(+e.target.value)} className="!w-16 !px-1 !py-1 !text-xs" />;
  const sel = <V extends string>(v: V, opts: [V, string][], on: (v: V) => void) => (
    <select value={v} onChange={(e) => on(e.target.value as V)} className="!w-auto !px-1 !py-1 !text-xs">
      {opts.map(([o, l]) => (
        <option key={o} value={o}>
          {l}
        </option>
      ))}
    </select>
  );
  return (
    <div>
      <div className="mb-1 text-xs text-muted">{title}</div>
      <div className="grid gap-1">
        {list.map((c, i) => (
          <div key={i} className="flex flex-wrap items-center gap-1 rounded-lg bg-card2 p-1.5">
            {sel(c.k, Object.keys(NEW_COND).map((k) => [k as Cond['k'], t(`x.ck.${k}` as Key)]), (k) => upd(i, NEW_COND[k]))}
            {c.k === 'emaCross' && (
              <>
                {numIn(c.fast, (fast) => upd(i, { ...c, fast }))}
                {numIn(c.slow, (slow) => upd(i, { ...c, slow }))}
                {sel(c.dir, [['up', '↑'], ['down', '↓']], (dir) => upd(i, { ...c, dir }))}
              </>
            )}
            {c.k === 'priceEma' && (
              <>
                {sel(c.dir, [['above', '>'], ['below', '<']], (dir) => upd(i, { ...c, dir }))}
                {numIn(c.n, (n) => upd(i, { ...c, n }))}
              </>
            )}
            {c.k === 'rsi' && (
              <>
                {numIn(c.n, (n) => upd(i, { ...c, n }))}
                {sel(c.op, [['crossUp', '↗'], ['crossDown', '↘'], ['above', '>'], ['below', '<']], (op) => upd(i, { ...c, op }))}
                {numIn(c.level, (level) => upd(i, { ...c, level }))}
              </>
            )}
            {c.k === 'macd' && sel(c.dir, [['up', '↑'], ['down', '↓']], (dir) => upd(i, { ...c, dir }))}
            {c.k === 'bb' && (
              <>
                {numIn(c.n, (n) => upd(i, { ...c, n }))}
                {numIn(c.mult, (mult) => upd(i, { ...c, mult }))}
                {sel(c.op, [['closeAbove', '> up'], ['closeBelow', '< low']], (op) => upd(i, { ...c, op }))}
              </>
            )}
            {c.k === 'breakout' && (
              <>
                {numIn(c.n, (n) => upd(i, { ...c, n }))}
                {sel(c.dir, [['high', '↑ high'], ['low', '↓ low']], (dir) => upd(i, { ...c, dir }))}
              </>
            )}
            <button className="ml-auto px-1 text-muted hover:text-down" onClick={() => set(list.filter((_, j) => j !== i))} aria-label={t('x.delete')}>
              ✕
            </button>
          </div>
        ))}
        <button className="rounded-lg border border-dashed border-line py-1 text-xs text-muted hover:text-fg" onClick={() => set([...list, NEW_COND.rsi])}>
          + {t('x.bt.addCond')}
        </button>
      </div>
    </div>
  );
}
