import { lazy, Suspense, useEffect, useRef } from 'react';
import { Loading, Stat } from '../components/ui';
import { compact, num, pct } from '../lib/format';
import { useApp, type Key } from '../lib/i18n';
import { money } from '../lib/money';
import { load, save, useStored } from '../lib/storage';
import { INTERVALS, REST, type Candle, type Interval } from '../lib/terminal';
import { useTerminal, type Status } from '../lib/useTerminal';
import { LiveCtx, TermCtx, useLiquidations, useMarkPrices } from '../terminal/data';
import { settle, type Position } from '../terminal/journal';
import { newAccount, onPrice, PAPER_SYMBOLS, type PaperState } from '../terminal/paper';

const ChartView = lazy(() => import('../terminal/views/ChartView'));
const DomView = lazy(() => import('../terminal/views/DomView'));
const ProfileView = lazy(() => import('../terminal/views/ProfileView'));
const FlowView = lazy(() => import('../terminal/views/FlowView'));
const SignalsView = lazy(() => import('../terminal/views/SignalsView'));
const JournalView = lazy(() => import('../terminal/views/JournalView'));
const PaperView = lazy(() => import('../terminal/views/PaperView'));
const BacktestView = lazy(() => import('../terminal/views/BacktestView'));

export const VIEWS = ['chart', 'dom', 'profile', 'flow', 'signals', 'journal', 'paper', 'backtest'] as const;
export type View = (typeof VIEWS)[number];
const VIEW_ICON: Record<View, string> = { chart: '🕯️', dom: '📚', profile: '🧱', flow: '💥', signals: '📡', journal: '📓', paper: '🎯', backtest: '🧪' };

export default function Terminal() {
  const { t, lang, ccy, fx } = useApp();
  const [interval] = useStored<Interval>('term.interval', '15m');
  const [rawView, setView] = useStored<View>('term.view', 'chart');
  const view: View = VIEWS.includes(rawView) ? rawView : 'chart';
  const iv: Interval = INTERVALS.includes(interval) ? interval : '15m';
  const d = useTerminal(iv);
  const liq = useLiquidations();
  const marks = useMarkPrices();
  usePaperRunner(marks);
  useJournalRunner();

  const last = d.trades[0]?.p ?? d.ticker?.last ?? d.candles[d.candles.length - 1]?.c;
  const tick = d.trades[0] ? (d.trades[0].buy ? 'text-up' : 'text-down') : '';

  return (
    <TermCtx.Provider value={d}>
      <LiveCtx.Provider value={{ liqs: liq.liqs, liqLive: liq.live, marks }}>
        <div className="grid gap-3">
          <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
            <div>
              <div className="flex items-center gap-2 text-xs text-muted">
                BTC/USDT · Binance <StatusDot status={d.status} />
              </div>
              <div className={`num text-2xl font-bold transition-colors sm:text-3xl ${tick}`}>
                {last ? num(last, lang, 2) : '—'}
                {last && ccy === 'idr' && fx > 0 && <span className="ml-2 text-sm font-normal text-muted">≈ {money(last * fx, 'idr', lang, 0)}</span>}
              </div>
            </div>
            {d.ticker && (
              <div className="grid basis-full grid-cols-4 gap-1.5 sm:max-w-xl sm:flex-1 sm:basis-auto [&_.text-base]:text-sm">
                <Stat label={t('t.change24')} value={pct(d.ticker.changePct, lang)} tone={d.ticker.changePct >= 0 ? 'up' : 'down'} />
                <Stat label={t('t.high24')} value={compact(d.ticker.high, lang)} />
                <Stat label={t('t.low24')} value={compact(d.ticker.low, lang)} />
                <Stat label={t('t.vol24')} value={compact(d.ticker.vol, lang)} />
              </div>
            )}
          </div>

          <nav className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 [scrollbar-width:none]" aria-label={t('x.views')}>
            {VIEWS.map((v) => (
              <button
                key={v}
                aria-pressed={view === v}
                onClick={() => setView(v)}
                className={`press shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium ${view === v ? 'border-accent bg-accent text-accent-fg' : 'border-line text-muted hover:text-fg'}`}
              >
                <span aria-hidden>{VIEW_ICON[v]}</span> {t(`x.view.${v}` as Key)}
              </button>
            ))}
          </nav>

          <div key={view} className="anim-page">
            <Suspense fallback={<Loading rows={6} />}>
              {view === 'chart' && <ChartView />}
              {view === 'dom' && <DomView />}
              {view === 'profile' && <ProfileView />}
              {view === 'flow' && <FlowView />}
              {view === 'signals' && <SignalsView />}
              {view === 'journal' && <JournalView />}
              {view === 'paper' && <PaperView />}
              {view === 'backtest' && <BacktestView />}
            </Suspense>
          </div>
          <p className="text-xs text-muted">{t('t.note')}</p>
        </div>
      </LiveCtx.Provider>
    </TermCtx.Provider>
  );
}

export function StatusDot({ status }: { status: Status }) {
  const { t } = useApp();
  return (
    <span className={`inline-flex items-center gap-1 ${status === 'live' ? 'text-up' : 'text-accent'}`}>
      <span className={`live-dot ${status === 'live' ? '' : 'stale'}`} aria-hidden />
      {t(`t.status.${status}` as Key)}
    </span>
  );
}

/** Applies each new mark price to the paper account: liquidations, stops, targets, limit fills. */
function usePaperRunner(marks: Partial<Record<(typeof PAPER_SYMBOLS)[number], number>>) {
  useEffect(() => {
    const s0 = load<PaperState>('paper', newAccount());
    if (!Object.keys(s0.positions).length && !s0.orders.length) return;
    let s = s0;
    for (const sym of PAPER_SYMBOLS) if (marks[sym]) s = onPrice(s, sym, marks[sym]!);
    if (s !== s0) save('paper', s);
  }, [marks]);
}

/** Every minute, settles pending / open journal positions against 1-minute candles. */
function useJournalRunner() {
  const busy = useRef(false);
  useEffect(() => {
    const run = async () => {
      if (busy.current || document.visibilityState === 'hidden') return;
      const ps = load<Position[]>('journal', []);
      const active = ps.filter((p) => p.status === 'pending' || p.status === 'open');
      if (!active.length) return;
      busy.current = true;
      try {
        const from = Math.min(...active.map((p) => p.checkedTo ?? p.createdAt));
        const candles: Candle[] = [];
        let start = Math.floor(from / 60_000) * 60_000;
        for (let page = 0; page < 10 && start < Date.now(); page++) {
          const r = await fetch(`${REST}/klines?symbol=BTCUSDT&interval=1m&startTime=${start}&limit=1000`);
          if (!r.ok) break;
          const rows = (await r.json()) as unknown[][];
          if (!rows.length) break;
          for (const x of rows) candles.push({ t: +x[0]!, o: +x[1]!, h: +x[2]!, l: +x[3]!, c: +x[4]!, v: +x[5]! });
          start = candles[candles.length - 1].t + 60_000;
          if (rows.length < 1000) break;
        }
        if (!candles.length) return;
        const lastT = candles[candles.length - 1].t;
        const latest = load<Position[]>('journal', []);
        const next = latest.map((p) => {
          if (p.status !== 'pending' && p.status !== 'open') return p;
          const from = p.checkedTo ?? p.createdAt;
          const s = settle(p, candles.filter((c) => c.t + 60_000 > from), 60_000);
          return s.status === 'pending' || s.status === 'open' ? { ...s, checkedTo: lastT } : s;
        });
        save('journal', next);
      } catch {
        /* try again next minute */
      } finally {
        busy.current = false;
      }
    };
    run();
    const id = setInterval(run, 60_000);
    // Re-check soon after a new position is drawn (not after this runner's own saves).
    const onChange = (e: Event) => {
      if ((e as CustomEvent).detail !== 'journal') return;
      if (load<Position[]>('journal', []).some((p) => (p.status === 'pending' || p.status === 'open') && p.checkedTo == null)) setTimeout(run, 500);
    };
    window.addEventListener('btc-storage', onChange);
    return () => {
      clearInterval(id);
      window.removeEventListener('btc-storage', onChange);
    };
  }, []);
}
