import { useEffect, useMemo, useRef, useState } from 'react';
import { Btn, Card, Loading, Seg } from '../../components/ui';
import { num } from '../../lib/format';
import { useApp } from '../../lib/i18n';
import { useStored } from '../../lib/storage';
import { flow, groupBook, imbalance, spread, stepDigits, type Book, type Trade } from '../../lib/terminal';
import { useTerm } from '../data';
import { execute, newAccount, placeLimit, TAKER_FEE, type PaperState } from '../paper';

const STEPS = [1, 5, 10, 25, 50, 100] as const;
const ROWS = 18;
const PULL_WINDOW_S = 10;

export default function DomView() {
  const { t } = useApp();
  const d = useTerm();
  const [step, setStep] = useStored<number>('term.domStep', 10);
  const [big, setBig] = useStored<number>('term.bigTrade', 1);

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <Card title="DOM" right={<Seg value={step} onChange={setStep} options={STEPS.map((v) => ({ v, label: `$${v}` }))} />}>
        {d.book ? <Ladder book={d.book} step={step} /> : <Loading rows={8} />}
      </Card>
      <Card title={t('t.tape')} right={<Seg value={big} onChange={setBig} options={[0.5, 1, 5, 10].map((v) => ({ v, label: `≥${v}` }))} />}>
        {d.trades.length ? <Tape trades={d.trades} big={big} /> : <Loading rows={8} />}
      </Card>
    </div>
  );
}

function Ladder({ book, step }: { book: Book; step: number }) {
  const { t, lang } = useApp();
  const { footprint, footVersion } = useTerm();
  const g = useMemo(() => groupBook(book, step, ROWS * 3), [book, step]);
  const sp = spread(book);
  const imb = imbalance(groupBook(book, step, 10));
  const digits = stepDigits(step);
  const [paper, setPaper] = useStored<PaperState>('paper', newAccount());
  const [qty, setQty] = useStored<number>('term.domQty', 0.01);
  const [lev, setLev] = useStored<number>('term.domLev', 10);
  const [picked, setPicked] = useState<number | null>(null);
  const [msg, setMsg] = useState('');

  // Price ladder around the mid.
  const mid = sp?.mid ?? g.bids[0]?.p ?? 0;
  const center = Math.round(mid / step) * step;
  const prices = Array.from({ length: ROWS * 2 + 1 }, (_, i) => Math.round((center + (ROWS - i) * step) * 1e8) / 1e8);
  const bidAt = new Map(g.bids.map((l) => [l.p, l.q]));
  const askAt = new Map(g.asks.map((l) => [l.p, l.q]));

  // Traded volume at price since the tab opened (from the footprint recorder), refreshed every ~2 s.
  const slot = Math.floor(Date.now() / 2000);
  const traded = useMemo(() => {
    const m = new Map<number, { buy: number; sell: number }>();
    for (const b of footprint.bars.values())
      for (const [p, c] of b.cells) {
        const k = Math.round(Math.floor(p / step) * step * 1e8) / 1e8;
        const cur = m.get(k) ?? { buy: 0, sell: 0 };
        cur.buy += c.ask;
        cur.sell += c.bid;
        m.set(k, cur);
      }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [footprint, step, slot, footVersion > 0]);

  // Pull / stack: resting size now vs ~10 s ago, per price.
  const hist = useRef<{ at: number; step: number; sizes: Map<number, number> }[]>([]);
  useEffect(() => {
    const now = Date.now();
    const h = hist.current;
    if (h.length && h[h.length - 1].step !== step) h.length = 0;
    if (!h.length || now - h[h.length - 1].at >= 1000) {
      const sizes = new Map<number, number>();
      for (const l of g.bids) sizes.set(l.p, l.q);
      for (const l of g.asks) sizes.set(l.p, l.q);
      h.push({ at: now, step, sizes });
      while (h.length > PULL_WINDOW_S + 1) h.shift();
    }
  }, [g, step]);
  const past = hist.current[0];

  const maxSize = Math.max(1e-9, ...prices.map((p) => Math.max(bidAt.get(p) ?? 0, askAt.get(p) ?? 0)));
  const maxTraded = Math.max(1e-9, ...prices.map((p) => (traded.get(p)?.buy ?? 0) + (traded.get(p)?.sell ?? 0)));

  const order = (side: 'buy' | 'sell', price: number | null) => {
    if (!(qty > 0)) return;
    const next = price == null ? execute(paper, 'BTCUSDT', side, qty, side === 'buy' ? book.asks[0]?.p ?? mid : book.bids[0]?.p ?? mid, lev, TAKER_FEE, 'market') : placeLimit(paper, { sym: 'BTCUSDT', side, price, qty, lev });
    if (!next) return setMsg(t('x.paper.noMargin'));
    setPaper(next);
    setMsg(price == null ? t('x.paper.filled') : t('x.paper.placed', { side: side === 'buy' ? t('t.buy') : t('t.sell'), price: num(price, lang, digits) }));
    setPicked(null);
  };

  return (
    <div>
      <div className="mb-2 grid grid-cols-[1fr_1fr_auto] items-end gap-2 text-xs">
        <label>
          <span className="text-muted">{t('x.paper.qty')} (BTC)</span>
          <input type="number" inputMode="decimal" step="0.001" min="0" value={qty} onChange={(e) => setQty(+e.target.value)} className="!py-1 !text-sm" />
        </label>
        <label>
          <span className="text-muted">{t('x.paper.lev')}</span>
          <input type="number" inputMode="numeric" min="1" max="50" value={lev} onChange={(e) => setLev(Math.min(50, Math.max(1, Math.round(+e.target.value))))} className="!py-1 !text-sm" />
        </label>
        <span className="flex gap-1">
          <Btn className="!bg-up !px-2 !py-1.5 text-xs !text-white" onClick={() => order('buy', null)}>
            {t('t.buy')} MKT
          </Btn>
          <Btn className="!bg-down !px-2 !py-1.5 text-xs !text-white" onClick={() => order('sell', null)}>
            {t('t.sell')} MKT
          </Btn>
        </span>
      </div>
      {msg && <p className="anim-slide-down mb-2 text-xs text-accent">{msg}</p>}

      <div className="grid grid-cols-[1fr_1.1fr_1fr_1.2fr_0.8fr] px-1 pb-1 text-[10px] text-muted sm:text-[11px]">
        <span className="text-right">{t('t.bids')}</span>
        <span className="text-center">{t('t.price')}</span>
        <span>{t('t.asks')}</span>
        <span>{t('x.traded')}</span>
        <span className="text-right">Pull/Stack</span>
      </div>
      <div className="overflow-hidden rounded-lg border border-line">
        {prices.map((p) => {
          const bq = bidAt.get(p) ?? 0;
          const aq = askAt.get(p) ?? 0;
          const tr = traded.get(p);
          const now = bq || aq;
          const before = past?.sizes.get(p) ?? 0;
          const ps = past ? now - before : 0;
          const isBest = p === g.bids[0]?.p || p === g.asks[0]?.p;
          return (
            <div key={p}>
              <button
                onClick={() => setPicked(picked === p ? null : p)}
                className={`grid w-full grid-cols-[1fr_1.1fr_1fr_1.2fr_0.8fr] items-center border-b border-line/60 px-1 py-[2px] text-left text-[11px] last:border-0 hover:bg-card2 sm:text-xs ${isBest ? 'font-semibold' : ''} ${picked === p ? 'bg-accent/10' : ''}`}
              >
                <span className="relative text-right">
                  {bq > 0 && <span className="absolute inset-y-0 right-0 bg-up/20" style={{ width: `${(bq / maxSize) * 100}%` }} aria-hidden />}
                  <span className="num relative text-up">{bq ? bq.toFixed(3) : ''}</span>
                </span>
                <span className={`num text-center ${aq ? 'text-down' : bq ? 'text-up' : 'text-muted'}`}>{num(p, lang, digits)}</span>
                <span className="relative">
                  {aq > 0 && <span className="absolute inset-y-0 left-0 bg-down/20" style={{ width: `${(aq / maxSize) * 100}%` }} aria-hidden />}
                  <span className="num relative text-down">{aq ? aq.toFixed(3) : ''}</span>
                </span>
                <span className="flex h-3 items-center gap-1">
                  {tr && (
                    <>
                      <span className="flex h-2 overflow-hidden rounded-sm" style={{ width: `${((tr.buy + tr.sell) / maxTraded) * 70}%` }}>
                        <span className="bg-up/70" style={{ width: `${(tr.buy / (tr.buy + tr.sell)) * 100}%` }} />
                        <span className="flex-1 bg-down/70" />
                      </span>
                      <span className="num text-[10px] text-muted">{(tr.buy + tr.sell).toFixed(1)}</span>
                    </>
                  )}
                </span>
                <span className={`num text-right text-[10px] ${ps > 0.0005 ? 'text-up' : ps < -0.0005 ? 'text-down' : 'text-muted'}`}>{Math.abs(ps) > 0.0005 ? `${ps > 0 ? '+' : ''}${ps.toFixed(2)}` : ''}</span>
              </button>
              {picked === p && (
                <div className="anim-slide-down flex items-center justify-center gap-2 bg-card2 px-2 py-1.5 text-xs">
                  <span className="text-muted">{t('x.paper.limitAt', { price: num(p, lang, digits) })}</span>
                  <Btn className="!bg-up !px-2 !py-1 text-xs !text-white" onClick={() => order('buy', p)}>
                    {t('t.buy')}
                  </Btn>
                  <Btn className="!bg-down !px-2 !py-1 text-xs !text-white" onClick={() => order('sell', p)}>
                    {t('t.sell')}
                  </Btn>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex items-center justify-between text-xs">
        <span className="text-muted">
          {t('t.spread')} <span className="num text-fg">{sp ? num(sp.abs, lang, 2) : '—'}</span>
        </span>
        {imb != null && (
          <span className="flex w-1/2 items-center gap-2">
            <span className="text-up">{Math.round(imb * 100)}%</span>
            <span className="flex h-2 flex-1 overflow-hidden rounded-full bg-down/60">
              <span className="bg-up" style={{ width: `${imb * 100}%` }} />
            </span>
            <span className="text-down">{Math.round((1 - imb) * 100)}%</span>
          </span>
        )}
      </div>
      <p className="mt-2 text-[11px] text-muted">{t('x.domNote')}</p>
    </div>
  );
}

export function Tape({ trades, big }: { trades: Trade[]; big: number }) {
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
        <p className="mt-1 text-[11px] text-muted">{t('x.flowNote', { n: trades.length, big })}</p>
      </div>
      <div className="grid grid-cols-3 px-1 pb-1 text-[11px] text-muted">
        <span>{t('t.price')}</span>
        <span className="text-right">{t('t.size')} (BTC)</span>
        <span className="text-right">{t('t.time')}</span>
      </div>
      <div className="max-h-[34rem] overflow-y-auto">
        {trades.slice(0, 120).map((tr) => (
          <div key={tr.id} className={`grid grid-cols-3 rounded px-1 py-[3px] text-xs ${tr.q >= big ? (tr.buy ? 'bg-up/20 font-semibold' : 'bg-down/20 font-semibold') : ''}`}>
            <span className={`num ${tr.buy ? 'text-up' : 'text-down'}`}>{num(tr.p, lang, 2)}</span>
            <span className="num text-right">{tr.q.toFixed(4)}</span>
            <span className="num text-right text-muted">{timeFmt.format(tr.t)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
