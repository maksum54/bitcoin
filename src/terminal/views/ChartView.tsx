import { lazy, Suspense, useCallback, useMemo, useState } from 'react';
import type { Band, HLine, Line, Marker, Pane, Zone } from '../../components/CandleChart';
import { Btn, Card, ErrorBox, Field, Loading, Seg } from '../../components/ui';
import { uid } from '../../lib/calc';
import { num } from '../../lib/format';
import { useApp, type Key } from '../../lib/i18n';
import { useStored } from '../../lib/storage';
import { INTERVALS, type Interval } from '../../lib/terminal';
import { useLive, useTerm } from '../data';
import { atr, bollinger, ema, keltner, macd, rsi, stochRsi, vwap } from '../indicators';
import { plannedR, validPosition, type Position } from '../journal';
import { liqPrice, newAccount, type PaperState } from '../paper';

const CandleChart = lazy(() => import('../../components/CandleChart'));

export const INTERVAL_MS: Record<Interval, number> = { '1m': 60e3, '5m': 300e3, '15m': 900e3, '1h': 3600e3, '4h': 14400e3, '1d': 86400e3 };
const EMA_COLORS = ['#3b82f6', '#a855f7', '#f59e0b'];

export interface IndSettings {
  ema: { on: boolean; n: number }[];
  bb: { on: boolean; n: number; mult: number };
  kc: { on: boolean; n: number; mult: number };
  vwap: { on: boolean };
  vp: { on: boolean };
  rsi: { on: boolean; n: number };
  stoch: { on: boolean; n: number };
  macd: { on: boolean; fast: number; slow: number; signal: number };
  liq: { on: boolean };
}

export const DEFAULT_IND: IndSettings = {
  ema: [
    { on: true, n: 21 },
    { on: true, n: 50 },
    { on: false, n: 200 },
  ],
  bb: { on: false, n: 20, mult: 2 },
  kc: { on: false, n: 20, mult: 2 },
  vwap: { on: false },
  vp: { on: false },
  rsi: { on: true, n: 14 },
  stoch: { on: false, n: 14 },
  macd: { on: false, fast: 12, slow: 26, signal: 9 },
  liq: { on: true },
};

type IndKey = 'ema0' | 'ema1' | 'ema2' | 'bb' | 'kc' | 'vwap' | 'vp' | 'rsi' | 'stoch' | 'macd' | 'liq';

export default function ChartView() {
  const { t, lang } = useApp();
  const d = useTerm();
  const { liqs } = useLive();
  const [interval, setIv] = useStored<Interval>('term.interval', '15m');
  const iv: Interval = INTERVALS.includes(interval) ? interval : '15m';
  const [stored, setInd] = useStored<IndSettings>('term.ind', DEFAULT_IND);
  const ind: IndSettings = { ...DEFAULT_IND, ...stored, ema: stored.ema?.length === 3 ? stored.ema : DEFAULT_IND.ema };
  const [picker, setPicker] = useState(false);
  const [journal, setJournal] = useStored<Position[]>('journal', []);
  const [paper] = useStored<PaperState>('paper', newAccount());
  const [tool, setTool] = useState<'long' | 'short' | null>(null);
  const [draft, setDraft] = useState<Position | null>(null);
  const fmt = useCallback((v: number) => num(v, lang, v >= 1000 ? 0 : 2), [lang]);
  const c = d.candles;

  const { lines, bands, panes } = useMemo(() => {
    const closes = c.map((x) => x.c);
    const lines: Line[] = [];
    const bands: Band[] = [];
    const panes: Pane[] = [];
    ind.ema.forEach((e, i) => e.on && lines.push({ values: ema(closes, e.n), color: EMA_COLORS[i] }));
    if (ind.bb.on) {
      const b = bollinger(closes, ind.bb.n, ind.bb.mult);
      bands.push({ upper: b.upper, lower: b.lower, color: '#06b6d4' });
      lines.push({ values: b.upper, color: '#06b6d4', width: 1 }, { values: b.lower, color: '#06b6d4', width: 1 }, { values: b.mid, color: '#06b6d4', width: 1, dash: [4, 3] });
    }
    if (ind.kc.on) {
      const k = keltner(c, ind.kc.n, ind.kc.mult);
      lines.push({ values: k.upper, color: '#ec4899', width: 1 }, { values: k.lower, color: '#ec4899', width: 1 }, { values: k.mid, color: '#ec4899', width: 1, dash: [4, 3] });
    }
    if (ind.vwap.on) lines.push({ values: vwap(c), color: '#eab308', width: 2 });
    if (ind.rsi.on) panes.push({ id: 'rsi', label: `RSI ${ind.rsi.n}`, lines: [{ values: rsi(closes, ind.rsi.n), color: '#a855f7' }], range: [0, 100], levels: [30, 50, 70] });
    if (ind.stoch.on) {
      const s = stochRsi(closes, ind.stoch.n);
      panes.push({ id: 'stoch', label: 'Stoch RSI', lines: [{ values: s.k, color: '#3b82f6' }, { values: s.d, color: '#f59e0b' }], range: [0, 100], levels: [20, 80] });
    }
    if (ind.macd.on) {
      const m = macd(closes, ind.macd.fast, ind.macd.slow, ind.macd.signal);
      panes.push({ id: 'macd', label: `MACD ${ind.macd.fast} ${ind.macd.slow} ${ind.macd.signal}`, lines: [{ values: m.macd, color: '#3b82f6' }, { values: m.signal, color: '#f59e0b' }], hist: { values: m.hist, up: '#16a34a', down: '#dc2626' } });
    }
    return { lines, bands, panes };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c, JSON.stringify(ind)]);

  const markers = useMemo<Marker[]>(() => {
    if (!ind.liq.on) return [];
    const maxUsd = Math.max(1, ...liqs.map((l) => l.usd));
    return liqs.map((l) => ({ t: l.t, p: l.p, shape: 'dot', color: l.side === 'long' ? '#dc2626' : '#16a34a', r: 3 + Math.sqrt(l.usd / maxUsd) * 9 }));
  }, [liqs, ind.liq.on]);

  const zones = useMemo<Zone[]>(() => {
    const z: Zone[] = journal.filter((p) => p.status !== 'cancelled').map((p) => ({ t0: p.createdAt, t1: p.closedAt, entry: p.entry, sl: p.sl, tp: p.tp, faded: p.status === 'win' || p.status === 'loss' }));
    if (draft) z.push({ t0: draft.createdAt, entry: draft.entry, sl: draft.sl, tp: draft.tp });
    return z;
  }, [journal, draft]);

  const hlines = useMemo<HLine[]>(() => {
    const out: HLine[] = [];
    const p = paper.positions.BTCUSDT;
    if (p) {
      out.push({ p: p.entry, color: p.qty > 0 ? '#16a34a' : '#dc2626', label: `${t('x.paper.pos')} ${p.qty > 0 ? 'LONG' : 'SHORT'} ${Math.abs(p.qty).toFixed(4)}` });
      out.push({ p: liqPrice(p), color: '#f97316', label: t('x.paper.liq') });
      if (p.sl) out.push({ p: p.sl, color: '#dc2626', label: 'SL' });
      if (p.tp) out.push({ p: p.tp, color: '#16a34a', label: 'TP' });
    }
    for (const o of paper.orders) if (o.sym === 'BTCUSDT') out.push({ p: o.price, color: '#6366f1', label: `${o.side === 'buy' ? t('t.buy') : t('t.sell')} ${o.qty}` });
    return out;
  }, [paper, t]);

  const onPick = useCallback(
    (price: number, time: number) => {
      if (!tool) return;
      const a = atr(c, 14);
      const dist = a[a.length - 1] ?? price * 0.01;
      const long = tool === 'long';
      setDraft({
        id: uid(),
        side: tool,
        entry: Math.round(price),
        sl: Math.round(long ? price - dist * 1.5 : price + dist * 1.5),
        tp: Math.round(long ? price + dist * 3 : price - dist * 3),
        risk: 100,
        createdAt: Math.max(time, Date.now()),
        strategy: '',
        note: '',
        status: 'pending',
      });
      setTool(null);
    },
    [tool, c],
  );

  const items: { k: IndKey; label: string }[] = [
    ...ind.ema.map((e, i) => ({ k: `ema${i}` as IndKey, label: `EMA ${e.n}` })),
    { k: 'bb', label: 'Bollinger Bands' },
    { k: 'kc', label: 'Keltner Channel' },
    { k: 'vwap', label: 'VWAP' },
    { k: 'vp', label: t('x.ind.vp') },
    { k: 'rsi', label: 'RSI' },
    { k: 'stoch', label: 'Stoch RSI' },
    { k: 'macd', label: 'MACD' },
    { k: 'liq', label: t('x.ind.liq') },
  ];
  const isOn = (k: IndKey) => (k.startsWith('ema') ? ind.ema[+k.slice(3)].on : (ind[k as Exclude<IndKey, `ema${number}`>] as { on: boolean }).on);
  const toggle = (k: IndKey) =>
    setInd(() => {
      if (k.startsWith('ema')) return { ...ind, ema: ind.ema.map((e, i) => (i === +k.slice(3) ? { ...e, on: !e.on } : e)) };
      const key = k as Exclude<IndKey, `ema${number}`>;
      return { ...ind, [key]: { ...ind[key], on: !ind[key].on } };
    });
  const [q, setQ] = useState('');

  const chartH = 360 + panes.length * 84;

  return (
    <div className="grid gap-3">
      <Card>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <Seg value={iv} onChange={setIv} options={INTERVALS.map((v) => ({ v, label: v }))} />
          <div className="flex flex-wrap gap-1">
            <Btn kind="ghost" className="!px-2.5 !py-1.5 text-xs" onClick={() => setPicker(!picker)}>
              ƒx {t('x.indicators')} ({items.filter((i) => isOn(i.k)).length})
            </Btn>
            <Btn kind={tool === 'long' ? 'primary' : 'ghost'} className="!px-2.5 !py-1.5 text-xs" onClick={() => setTool(tool === 'long' ? null : 'long')}>
              ↗ Long
            </Btn>
            <Btn kind={tool === 'short' ? 'primary' : 'ghost'} className="!px-2.5 !py-1.5 text-xs" onClick={() => setTool(tool === 'short' ? null : 'short')}>
              ↘ Short
            </Btn>
          </div>
        </div>

        {picker && (
          <div className="anim-slide-down mb-3 rounded-xl border border-line bg-card2 p-3">
            <input placeholder={t('x.search')} value={q} onChange={(e) => setQ(e.target.value)} className="mb-2 !py-1.5 text-sm" />
            <div className="grid gap-1 sm:grid-cols-2">
              {items
                .filter((i) => i.label.toLowerCase().includes(q.toLowerCase()))
                .map((i) => (
                  <div key={i.k} className="flex items-center justify-between gap-2 rounded-lg bg-card px-2 py-1.5 text-sm">
                    <label className="flex cursor-pointer items-center gap-2">
                      <input type="checkbox" className="!w-4" checked={isOn(i.k)} onChange={() => toggle(i.k)} />
                      {i.label}
                    </label>
                    <IndParams k={i.k} ind={ind} set={setInd} />
                  </div>
                ))}
            </div>
          </div>
        )}

        {tool && <p className="anim-slide-down mb-2 rounded-lg bg-accent/10 px-2 py-1.5 text-xs text-accent">{t('x.pickHint', { side: tool === 'long' ? 'Long' : 'Short' })}</p>}

        <div style={{ height: `min(${chartH}px, 78vh)` }}>
          {d.error ? (
            <ErrorBox msg={t('t.error')} />
          ) : !c.length ? (
            <Loading rows={5} />
          ) : (
            <Suspense fallback={<Loading rows={5} />}>
              <CandleChart candles={c} intervalMs={INTERVAL_MS[iv]} fmt={fmt} lang={lang} lines={lines} bands={bands} panes={panes} markers={markers} zones={zones} hlines={hlines} profile={ind.vp.on} onPick={tool ? onPick : undefined} />
            </Suspense>
          )}
        </div>
        <p className="mt-2 text-xs text-muted">{t('x.chartHint')}</p>
      </Card>

      {draft && <PositionForm draft={draft} setDraft={setDraft} onSave={(p) => (setJournal([...journal, p]), setDraft(null))} />}
    </div>
  );
}

function IndParams({ k, ind, set }: { k: IndKey; ind: IndSettings; set: (v: IndSettings) => void }) {
  const box = (v: number, on: (n: number) => void, w = 'w-14') => (
    <input
      type="number"
      inputMode="numeric"
      value={v}
      min={1}
      max={500}
      onChange={(e) => {
        const n = Math.round(+e.target.value);
        if (n >= 1 && n <= 500) on(n);
      }}
      className={`${w} !px-1.5 !py-0.5 text-right !text-sm`}
    />
  );
  if (k.startsWith('ema')) {
    const i = +k.slice(3);
    return box(ind.ema[i].n, (n) => set({ ...ind, ema: ind.ema.map((e, j) => (j === i ? { ...e, n } : e)) }));
  }
  if (k === 'bb' || k === 'kc')
    return (
      <span className="flex gap-1">
        {box(ind[k].n, (n) => set({ ...ind, [k]: { ...ind[k], n } }))}
        {box(ind[k].mult, (mult) => set({ ...ind, [k]: { ...ind[k], mult } }), 'w-10')}
      </span>
    );
  if (k === 'rsi' || k === 'stoch') return box(ind[k].n, (n) => set({ ...ind, [k]: { ...ind[k], n } }));
  if (k === 'macd')
    return (
      <span className="flex gap-1">
        {(['fast', 'slow', 'signal'] as const).map((f) => (
          <span key={f}>{box(ind.macd[f], (n) => set({ ...ind, macd: { ...ind.macd, [f]: n } }), 'w-11')}</span>
        ))}
      </span>
    );
  return null;
}

function PositionForm({ draft, setDraft, onSave }: { draft: Position; setDraft: (p: Position | null) => void; onSave: (p: Position) => void }) {
  const { t, lang } = useApp();
  const ok = validPosition(draft) && draft.risk > 0;
  const field = (k: 'entry' | 'sl' | 'tp' | 'risk', label: Key) => (
    <Field label={t(label)}>
      <input type="number" inputMode="decimal" value={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: +e.target.value })} />
    </Field>
  );
  return (
    <Card title={`${t('x.newPosition')} · ${draft.side === 'long' ? 'Long' : 'Short'}`} className="anim-slide-up">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {field('entry', 'x.entry')}
        {field('sl', 'x.sl')}
        {field('tp', 'x.tp')}
        {field('risk', 'x.risk')}
        <Field label={t('x.strategy')}>
          <input value={draft.strategy} maxLength={40} onChange={(e) => setDraft({ ...draft, strategy: e.target.value })} placeholder="breakout, VWAP…" />
        </Field>
        <div className="col-span-1 sm:col-span-3">
          <Field label={t('x.note')}>
            <input value={draft.note} maxLength={200} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
          </Field>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <span className={`text-sm ${ok ? 'text-muted' : 'text-down'}`}>
          {ok ? t('x.rr', { r: num(plannedR(draft), lang, 2), win: num(plannedR(draft) * draft.risk, lang, 0), loss: num(draft.risk, lang, 0) }) : t('x.invalidPos')}
        </span>
        <span className="flex gap-2">
          <Btn kind="ghost" onClick={() => setDraft(null)}>
            {t('x.cancel')}
          </Btn>
          <Btn disabled={!ok} onClick={() => onSave({ ...draft, createdAt: Date.now() })}>
            {t('x.saveJournal')}
          </Btn>
        </span>
      </div>
    </Card>
  );
}
