import { useMemo, useState } from 'react';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Btn, Card, Seg, Stat } from '../../components/ui';
import { dateTime, num, pct } from '../../lib/format';
import { useApp, type Key } from '../../lib/i18n';
import { useStored } from '../../lib/storage';
import { byDay, groupStats, plannedR, resultMoney, resultR, stats, type Position } from '../journal';

export default function JournalView() {
  const { t, lang } = useApp();
  const [ps, setPs] = useStored<Position[]>('journal', []);
  const [unit, setUnit] = useStored<'money' | 'r'>('term.jUnit', 'money');
  const s = useMemo(() => stats(ps), [ps]);
  const fm = (v: number) => (unit === 'r' ? `${v >= 0 ? '+' : ''}${num(v, lang, 2)}R` : `${v >= 0 ? '+' : '−'}$${num(Math.abs(v), lang, 0)}`);
  const active = ps.filter((p) => p.status === 'pending' || p.status === 'open');

  if (!ps.length)
    return (
      <Card title={t('x.view.journal')}>
        <p className="py-6 text-center text-sm text-muted">{t('x.jEmpty')}</p>
      </Card>
    );

  return (
    <div className="grid gap-3">
      <Card title={t('x.view.journal')} right={<Seg value={unit} onChange={setUnit} options={[{ v: 'money', label: '$' }, { v: 'r', label: 'R' }]} />}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <Stat label={t('x.pnl')} value={fm(unit === 'r' ? s.totalR : s.totalMoney)} tone={s.totalMoney >= 0 ? 'up' : 'down'} />
          <Stat label={t('x.winRate')} value={pct(s.winRate * 100, lang).replace('+', '')} sub={`${s.wins}W · ${s.losses}L`} />
          <Stat label={t('x.avgR')} value={`${num(s.avgR, lang, 2)}R`} tone={s.avgR >= 0 ? 'up' : 'down'} />
          <Stat label="Profit factor" value={Number.isFinite(s.profitFactor) ? num(s.profitFactor, lang, 2) : '∞'} />
          <Stat label={t('x.openPending')} value={active.length} />
        </div>
        {s.equity.length > 1 && (
          <div className="mt-3 h-48">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={[{ t: s.equity[0].t - 1, money: 0, r: 0 }, ...s.equity]} margin={{ left: 0, right: 0, top: 4, bottom: 0 }}>
                <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} tickFormatter={(v) => new Date(v).toLocaleDateString(lang, { day: 'numeric', month: 'short' })} tick={{ fill: 'var(--muted)', fontSize: 11 }} stroke="var(--line)" minTickGap={40} />
                <YAxis dataKey={unit} tick={{ fill: 'var(--muted)', fontSize: 11 }} stroke="var(--line)" width={48} orientation="right" />
                <Tooltip contentStyle={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 12, color: 'var(--fg)' }} labelFormatter={(v) => dateTime(v as number, lang)} formatter={(v) => [fm(v as number), t('x.equity')]} />
                <Area type="stepAfter" dataKey={unit} stroke="var(--accent)" fill="var(--accent)" fillOpacity={0.15} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      <div className="grid gap-3 lg:grid-cols-2">
        <Calendar ps={ps} unit={unit} fm={fm} />
        <Card title={t('x.breakdown')}>
          {(['side', 'strategy'] as const).map((k) => (
            <div key={k} className="mb-3">
              <div className="mb-1 text-xs text-muted">{t(`x.by.${k}` as Key)}</div>
              <table className="w-full text-xs">
                <tbody>
                  {groupStats(ps, (p) => (k === 'side' ? p.side : p.strategy)).map(({ key, s: g }) => (
                    <tr key={key} className="border-t border-line">
                      <td className="py-1 capitalize">{key}</td>
                      <td className="num text-right">{g.trades}×</td>
                      <td className="num text-right">{pct(g.winRate * 100, lang).replace('+', '')}</td>
                      <td className={`num text-right font-semibold ${g.totalMoney >= 0 ? 'text-up' : 'text-down'}`}>{fm(unit === 'r' ? g.totalR : g.totalMoney)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </Card>
      </div>

      <Card title={t('x.trades')}>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted">
              <tr className="text-left">
                <th className="py-1 font-normal">{t('x.date')}</th>
                <th className="font-normal">{t('x.side')}</th>
                <th className="text-right font-normal">{t('x.entry')}</th>
                <th className="text-right font-normal">SL / TP</th>
                <th className="text-right font-normal">R</th>
                <th className="pl-2 font-normal">{t('x.status')}</th>
                <th className="text-right font-normal">{t('x.result')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {[...ps].reverse().map((p) => (
                <tr key={p.id} className="border-t border-line">
                  <td className="py-1.5">
                    {dateTime(p.createdAt, lang)}
                    {(p.strategy || p.note) && <div className="text-[10px] text-muted">{[p.strategy, p.note].filter(Boolean).join(' · ')}</div>}
                  </td>
                  <td className={p.side === 'long' ? 'text-up' : 'text-down'}>{p.side === 'long' ? 'Long' : 'Short'}</td>
                  <td className="num text-right">{num(p.entry, lang, 0)}</td>
                  <td className="num text-right text-muted">
                    {num(p.sl, lang, 0)} / {num(p.tp, lang, 0)}
                  </td>
                  <td className="num text-right">{num(plannedR(p), lang, 2)}</td>
                  <td className="pl-2">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] ${p.status === 'win' ? 'bg-up/15 text-up' : p.status === 'loss' ? 'bg-down/15 text-down' : 'bg-card2 text-muted'}`}>{t(`x.st.${p.status}` as Key)}</span>
                  </td>
                  <td className={`num text-right ${resultMoney(p) > 0 ? 'text-up' : resultMoney(p) < 0 ? 'text-down' : 'text-muted'}`}>{p.status === 'win' || p.status === 'loss' ? fm(unit === 'r' ? resultR(p) : resultMoney(p)) : '—'}</td>
                  <td className="text-right">
                    {p.status === 'pending' || p.status === 'open' ? (
                      <button className="px-1 text-muted hover:text-fg" title={t('x.cancel')} onClick={() => setPs(ps.map((x) => (x.id === p.id ? { ...x, status: 'cancelled' } : x)))}>
                        ⊘
                      </button>
                    ) : (
                      <button className="px-1 text-muted hover:text-down" title={t('x.delete')} onClick={() => setPs(ps.filter((x) => x.id !== p.id))}>
                        ✕
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-muted">{t('x.jNote')}</p>
      </Card>
    </div>
  );
}

function Calendar({ ps, unit, fm }: { ps: Position[]; unit: 'money' | 'r'; fm: (v: number) => string }) {
  const { t, lang } = useApp();
  const days = useMemo(() => byDay(ps), [ps]);
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const first = (month.getDay() + 6) % 7;
  const n = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = [...Array(first).fill(null), ...Array.from({ length: n }, (_, i) => i + 1)];
  const key = (d: number) => `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const vals = [...days.values()].map((v) => Math.abs(unit === 'r' ? v.r : v.money));
  const max = Math.max(1e-9, ...vals);
  const wk = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(lang, { weekday: 'narrow' }));

  return (
    <Card
      title={t('x.calendar')}
      right={
        <span className="flex items-center gap-1 text-xs">
          <Btn kind="ghost" className="!px-2 !py-1" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>
            ‹
          </Btn>
          <span className="w-24 text-center">{month.toLocaleDateString(lang, { month: 'short', year: 'numeric' })}</span>
          <Btn kind="ghost" className="!px-2 !py-1" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>
            ›
          </Btn>
        </span>
      }
    >
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-muted">
        {wk.map((w, i) => (
          <span key={i}>{w}</span>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((d, i) => {
          if (d == null) return <span key={i} />;
          const v = days.get(key(d));
          const val = v ? (unit === 'r' ? v.r : v.money) : 0;
          return (
            <div
              key={i}
              className="flex aspect-square flex-col items-center justify-center rounded-md border border-line text-[10px]"
              style={v ? { background: `color-mix(in srgb, var(${val >= 0 ? '--up' : '--down'}) ${15 + (Math.abs(val) / max) * 45}%, transparent)` } : undefined}
              title={v ? `${v.n}× ${fm(val)}` : undefined}
            >
              <span className="text-muted">{d}</span>
              {v && <span className="num hidden font-semibold sm:block">{fm(val)}</span>}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
