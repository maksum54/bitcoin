import { useMemo } from 'react';
import { Card, Seg, Stat } from '../../components/ui';
import { compact, num } from '../../lib/format';
import { useApp } from '../../lib/i18n';
import { useStored } from '../../lib/storage';
import { useLive, useVenueFlow, type VenueFlow } from '../data';

const LIQ_WINDOWS = [5, 60, 0] as const; // minutes, 0 = everything since opened
const FLOW_WINDOWS = [60, 300, 900, 3600] as const; // seconds
const BIG_LIQ = 100_000;

export default function FlowView() {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Liquidations />
      <Flow />
    </div>
  );
}

function Liquidations() {
  const { t, lang } = useApp();
  const { liqs, liqLive } = useLive();
  const [win, setWin] = useStored<number>('term.liqWin', 60);
  const since = win ? Date.now() - win * 60_000 : 0;
  const inWin = liqs.filter((l) => l.t >= since);
  const longs = inWin.filter((l) => l.side === 'long').reduce((s, l) => s + l.usd, 0);
  const shorts = inWin.filter((l) => l.side === 'short').reduce((s, l) => s + l.usd, 0);
  const venues = ['Binance', 'Bybit', 'OKX'];
  const timeFmt = useMemo(() => new Intl.DateTimeFormat(lang === 'id' ? 'id-ID' : 'en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }), [lang]);
  const usd = (v: number) => `$${compact(v, lang)}`;

  return (
    <Card title={t('x.liqs')} right={<Seg value={win} onChange={setWin} options={LIQ_WINDOWS.map((v) => ({ v, label: v === 0 ? t('x.all') : v < 60 ? `${v}m` : `${v / 60}h` }))} />}>
      <div className="grid grid-cols-2 gap-2">
        <Stat label={t('x.longsLiq')} value={<span className="text-down">{usd(longs)}</span>} sub={`${inWin.filter((l) => l.side === 'long').length}×`} />
        <Stat label={t('x.shortsLiq')} value={<span className="text-up">{usd(shorts)}</span>} sub={`${inWin.filter((l) => l.side === 'short').length}×`} />
      </div>
      <div className="mt-2 grid gap-1 text-xs">
        {venues.map((v) => {
          const l = inWin.filter((x) => x.venue === v && x.side === 'long').reduce((s, x) => s + x.usd, 0);
          const sh = inWin.filter((x) => x.venue === v && x.side === 'short').reduce((s, x) => s + x.usd, 0);
          const tot = l + sh || 1;
          return (
            <div key={v} className="grid grid-cols-[5.5rem_1fr_5rem] items-center gap-2">
              <span className="flex items-center gap-1.5">
                <span className={`live-dot ${liqLive[v] ? '' : 'stale'}`} aria-hidden />
                {v}
              </span>
              <span className="flex h-2 overflow-hidden rounded-full bg-card2">
                <span className="bg-down" style={{ width: `${(l / tot) * 100}%` }} />
                <span className="bg-up" style={{ width: `${(sh / tot) * 100}%` }} />
              </span>
              <span className="num text-right text-muted">{usd(l + sh)}</span>
            </div>
          );
        })}
      </div>
      <div className="mt-3 grid grid-cols-[4.2rem_4rem_1fr_1fr] px-1 pb-1 text-[11px] text-muted">
        <span>{t('t.time')}</span>
        <span>{t('x.venue')}</span>
        <span className="text-right">{t('t.price')}</span>
        <span className="text-right">USD</span>
      </div>
      <div className="max-h-[22rem] overflow-y-auto">
        {liqs.length === 0 && <p className="py-4 text-center text-xs text-muted">{t('x.noLiqs')}</p>}
        {liqs.slice(0, 100).map((l, i) => (
          <div key={`${l.t}-${i}`} className={`grid grid-cols-[4.2rem_4rem_1fr_1fr] rounded px-1 py-[3px] text-xs ${l.usd >= BIG_LIQ ? (l.side === 'long' ? 'bg-down/20 font-semibold' : 'bg-up/20 font-semibold') : ''}`}>
            <span className="num text-muted">{timeFmt.format(l.t)}</span>
            <span>{l.venue}</span>
            <span className={`num text-right ${l.side === 'long' ? 'text-down' : 'text-up'}`}>{num(l.p, lang, 1)}</span>
            <span className="num text-right">
              {l.side === 'long' ? 'L ' : 'S '}
              {usd(l.usd)}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-muted">{t('x.liqNote')}</p>
    </Card>
  );
}

function Spark({ values }: { values: number[] }) {
  const max = Math.max(1e-9, ...values.map(Math.abs));
  const w = 90;
  const h = 22;
  const bw = w / values.length;
  return (
    <svg width={w} height={h} className="shrink-0" aria-hidden>
      <line x1={0} x2={w} y1={h / 2} y2={h / 2} stroke="var(--line)" />
      {values.map((v, i) => {
        const bh = (Math.abs(v) / max) * (h / 2 - 1);
        return <rect key={i} x={i * bw} width={Math.max(1, bw - 0.5)} y={v >= 0 ? h / 2 - bh : h / 2} height={bh} fill={v >= 0 ? 'var(--up)' : 'var(--down)'} />;
      })}
    </svg>
  );
}

function Flow() {
  const { t, lang } = useApp();
  const venues = useVenueFlow();
  const [win, setWin] = useStored<number>('term.flowWin', 300);
  const rows = venues.map((v) => ({ v, s: v.w.sum(win) }));
  const total = (m: VenueFlow['market']) => rows.filter((r) => r.v.market === m).reduce((a, r) => a + r.s.net, 0);
  const all = rows.reduce((a, r) => a + r.s.net, 0);
  const tone = (x: number) => (x >= 0 ? 'up' : 'down');
  const f = (x: number) => `${x >= 0 ? '+' : ''}${num(x, lang, 2)}`;

  return (
    <Card title={t('x.flow')} right={<Seg value={win} onChange={setWin} options={FLOW_WINDOWS.map((v) => ({ v, label: v < 3600 ? `${v / 60}m` : '1h' }))} />}>
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Spot" value={f(total('spot'))} tone={tone(total('spot'))} sub="BTC" />
        <Stat label="Perp" value={f(total('perp'))} tone={tone(total('perp'))} sub="BTC" />
        <Stat label={t('x.total')} value={f(all)} tone={tone(all)} sub="BTC" />
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-muted">
            <tr>
              <th className="py-1 text-left font-normal">{t('x.venue')}</th>
              <th className="text-right font-normal">{t('t.buy')}</th>
              <th className="text-right font-normal">{t('t.sell')}</th>
              <th className="text-right font-normal">{t('t.net')}</th>
              <th className="pl-2 text-right font-normal">30m</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ v, s }) => (
              <tr key={v.id} className="border-t border-line">
                <td className="py-1.5">
                  <span className="flex items-center gap-1.5">
                    <span className={`live-dot ${v.live ? '' : 'stale'}`} aria-hidden />
                    {v.name} <span className="rounded bg-card2 px-1 text-[10px] text-muted">{v.market}</span>
                  </span>
                </td>
                <td className="num text-right text-up">{num(s.buy, lang, 2)}</td>
                <td className="num text-right text-down">{num(s.sell, lang, 2)}</td>
                <td className={`num text-right font-semibold ${s.net >= 0 ? 'text-up' : 'text-down'}`}>{f(s.net)}</td>
                <td className="pl-2 text-right">
                  <Spark values={v.w.perMinute(30)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-muted">{t('x.flowVenueNote')}</p>
    </Card>
  );
}
