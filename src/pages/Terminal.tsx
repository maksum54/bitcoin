import { lazy, Suspense, useCallback, useMemo } from 'react';
import { Card, ErrorBox, Loading, Seg, Stat } from '../components/ui';
import { compact, num, pct } from '../lib/format';
import { useApp, type Key } from '../lib/i18n';
import { money } from '../lib/money';
import { useStored } from '../lib/storage';
import { cumulative, flow, groupBook, imbalance, INTERVALS, spread, stepDigits, type Book, type Interval, type Trade } from '../lib/terminal';
import { useTerminal, type Status } from '../lib/useTerminal';

const CandleChart = lazy(() => import('../components/CandleChart'));

const INTERVAL_MS: Record<Interval, number> = { '1m': 60e3, '5m': 300e3, '15m': 900e3, '1h': 3600e3, '4h': 14400e3, '1d': 86400e3 };
const STEPS = [0.01, 1, 10, 100] as const;
const BIG_TRADE = 1; // BTC

export default function Terminal() {
  const { t, lang, ccy, fx } = useApp();
  const [interval, setIv] = useStored<Interval>('term.interval', '15m');
  const [step, setStep] = useStored<number>('term.step', 10);
  const iv: Interval = INTERVALS.includes(interval) ? interval : '15m';
  const d = useTerminal(iv);
  const last = d.trades[0]?.p ?? d.ticker?.last ?? d.candles[d.candles.length - 1]?.c;
  // Price colour follows the side of the latest trade (a background flash every 100 ms is too busy).
  const tick = d.trades[0] ? (d.trades[0].buy ? 'text-up' : 'text-down') : '';
  const fmt = useCallback((v: number) => num(v, lang, 2), [lang]);

  return (
    <div className="stagger grid gap-4">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-xs text-muted">
              BTC/USDT · Binance <StatusDot status={d.status} />
            </div>
            <div className={`num -mx-1 px-1 text-3xl font-bold transition-colors ${tick}`}>{last ? num(last, lang, 2) : '—'}</div>
            {last && ccy === 'idr' && fx > 0 && <div className="num text-sm text-muted">≈ {money(last * fx, 'idr', lang, 0)}</div>}
          </div>
          <Seg value={iv} onChange={setIv} options={INTERVALS.map((v) => ({ v, label: v }))} />
        </div>
        {d.ticker && (
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label={t('t.change24')} value={pct(d.ticker.changePct, lang)} tone={d.ticker.changePct >= 0 ? 'up' : 'down'} />
            <Stat label={t('t.high24')} value={num(d.ticker.high, lang, 2)} />
            <Stat label={t('t.low24')} value={num(d.ticker.low, lang, 2)} />
            <Stat label={t('t.vol24')} value={`${compact(d.ticker.vol, lang)} BTC`} sub={`${compact(d.ticker.quoteVol, lang)} USDT`} />
          </div>
        )}
        <div className="mt-3 h-[22rem] sm:h-[28rem]">
          {d.error ? (
            <ErrorBox msg={t('t.error')} />
          ) : !d.candles.length ? (
            <Loading rows={5} />
          ) : (
            <Suspense fallback={<Loading rows={5} />}>
              <CandleChart candles={d.candles} intervalMs={INTERVAL_MS[iv]} fmt={fmt} lang={lang} />
            </Suspense>
          )}
        </div>
        <p className="mt-2 text-xs text-muted">{t('t.chartHint')}</p>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t('t.book')} right={<Seg value={step} onChange={setStep} options={STEPS.map((v) => ({ v, label: String(v) }))} />}>
          {d.book ? <OrderBook book={d.book} step={step} /> : <Loading rows={6} />}
        </Card>
        <Card title={t('t.tape')}>{d.trades.length ? <Tape trades={d.trades} /> : <Loading rows={6} />}</Card>
      </div>

      <p className="text-xs text-muted">{t('t.note')}</p>
    </div>
  );
}

function StatusDot({ status }: { status: Status }) {
  const { t } = useApp();
  return (
    <span className={`inline-flex items-center gap-1 ${status === 'live' ? 'text-up' : 'text-accent'}`}>
      <span className={`live-dot ${status === 'live' ? '' : 'stale'}`} aria-hidden />
      {t(`t.status.${status}` as Key)}
    </span>
  );
}

function OrderBook({ book, step }: { book: Book; step: number }) {
  const { t, lang } = useApp();
  const g = useMemo(() => groupBook(book, step, 10), [book, step]);
  const bidCum = cumulative(g.bids);
  const askCum = cumulative(g.asks);
  const max = Math.max(bidCum[bidCum.length - 1] ?? 0, askCum[askCum.length - 1] ?? 0) || 1;
  const sp = spread(book);
  const imb = imbalance(book);
  const digits = stepDigits(step);
  const asks = g.asks.map((l, i) => ({ ...l, cum: askCum[i] })).reverse();
  const bids = g.bids.map((l, i) => ({ ...l, cum: bidCum[i] }));

  const Row = ({ p, q, cum, side }: { p: number; q: number; cum: number; side: 'bid' | 'ask' }) => (
    <div className="relative grid grid-cols-3 px-1 py-[3px] text-xs">
      <span
        className={`absolute inset-y-0 right-0 ${side === 'bid' ? 'bg-up/15' : 'bg-down/15'} transition-[width] duration-200`}
        style={{ width: `${(cum / max) * 100}%` }}
        aria-hidden
      />
      <span className={`num relative ${side === 'bid' ? 'text-up' : 'text-down'}`}>{num(p, lang, digits)}</span>
      <span className="num relative text-right">{q.toFixed(4)}</span>
      <span className="num relative text-right text-muted">{cum.toFixed(3)}</span>
    </div>
  );

  return (
    <div>
      <div className="grid grid-cols-3 px-1 pb-1 text-[11px] text-muted">
        <span>{t('t.price')} (USDT)</span>
        <span className="text-right">{t('t.size')} (BTC)</span>
        <span className="text-right">{t('t.total')}</span>
      </div>
      {asks.map((l) => (
        <Row key={`a${l.p}`} {...l} side="ask" />
      ))}
      <div className="my-1 flex items-center justify-between rounded-lg bg-card2 px-2 py-1.5 text-xs">
        <span className="text-muted">{t('t.spread')}</span>
        <span className="num">{sp ? `${num(sp.abs, lang, 2)} (${num(sp.pct, lang, 5)}%)` : '—'}</span>
      </div>
      {bids.map((l) => (
        <Row key={`b${l.p}`} {...l} side="bid" />
      ))}
      {imb != null && (
        <div className="mt-3">
          <div className="mb-1 flex justify-between text-[11px] text-muted">
            <span className="text-up">
              {t('t.bids')} {Math.round(imb * 100)}%
            </span>
            <span className="text-down">
              {Math.round((1 - imb) * 100)}% {t('t.asks')}
            </span>
          </div>
          <div className="flex h-2 overflow-hidden rounded-full bg-down/60">
            <div className="h-full bg-up transition-[width] duration-300" style={{ width: `${imb * 100}%` }} />
          </div>
        </div>
      )}
    </div>
  );
}

function Tape({ trades }: { trades: Trade[] }) {
  const { t, lang } = useApp();
  const f = flow(trades);
  const total = f.buy + f.sell || 1;
  const timeFmt = useMemo(() => new Intl.DateTimeFormat(lang === 'id' ? 'id-ID' : 'en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }), [lang]);

  return (
    <div>
      <div className="mb-3">
        <div className="mb-1 flex justify-between text-[11px]">
          <span className="text-up">
            {t('t.buy')} {f.buy.toFixed(3)}
          </span>
          <span className={f.net >= 0 ? 'text-up' : 'text-down'}>
            {t('t.net')} {f.net >= 0 ? '+' : ''}
            {f.net.toFixed(3)} BTC
          </span>
          <span className="text-down">
            {f.sell.toFixed(3)} {t('t.sell')}
          </span>
        </div>
        <div className="flex h-2 overflow-hidden rounded-full bg-down/60">
          <div className="h-full bg-up transition-[width] duration-300" style={{ width: `${(f.buy / total) * 100}%` }} />
        </div>
        <p className="mt-1 text-[11px] text-muted">{t('t.flowNote', { n: trades.length })}</p>
      </div>
      <div className="grid grid-cols-3 px-1 pb-1 text-[11px] text-muted">
        <span>{t('t.price')}</span>
        <span className="text-right">{t('t.size')} (BTC)</span>
        <span className="text-right">{t('t.time')}</span>
      </div>
      <div className="max-h-[22rem] overflow-y-auto">
        {trades.slice(0, 60).map((tr) => (
          <div key={tr.id} className={`grid grid-cols-3 rounded px-1 py-[3px] text-xs ${tr.q >= BIG_TRADE ? (tr.buy ? 'bg-up/15 font-semibold' : 'bg-down/15 font-semibold') : ''}`}>
            <span className={`num ${tr.buy ? 'text-up' : 'text-down'}`}>{num(tr.p, lang, 2)}</span>
            <span className="num text-right">{tr.q.toFixed(4)}</span>
            <span className="num text-right text-muted">{timeFmt.format(tr.t)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
