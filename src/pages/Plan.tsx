import { useMemo, useState } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Btn, Card, ErrorBox, Field, Loading, Stat, parseIdr, useAsync } from '../components/ui';
import { getLongHistoryUsd } from '../lib/api';
import { backtestDca, planMonths, projectPlan, type Plan, type Tx } from '../lib/calc';
import { btc, compact, idr, monthLabel, num, pct } from '../lib/format';
import { useApp } from '../lib/i18n';
import { useNav } from '../lib/nav';
import { usePrice } from '../lib/price';
import { useStored } from '../lib/storage';

function nextJanuary(): string {
  return `${new Date().getFullYear() + 1}-01`;
}

export const DEFAULT_PLAN: Plan = { monthlyIdr: 1_000_000, startMonth: nextJanuary(), months: 12, day: 1, feePct: 0.3 };

export default function PlanPage() {
  const { t, lang } = useApp();
  const { price } = usePrice();
  const { go } = useNav();
  const [plan, setPlan] = useStored<Plan>('plan', DEFAULT_PLAN);
  const [txs] = useStored<Tx[]>('txs', []);
  const [monthlyStr, setMonthlyStr] = useState(() => num(plan.monthlyIdr, lang));
  const [scen, setScen] = useStored('ui.scenarios', { bear: -30, bull: 40 });

  const upd = (p: Partial<Plan>) => setPlan({ ...plan, ...p });
  const months = planMonths(plan);
  const boughtMonths = new Set(txs.filter((x) => x.type === 'buy').map((x) => x.date.slice(0, 7)));

  return (
    <div className="stagger grid gap-4 lg:grid-cols-3">
      <Card title={t('p.title')}>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Field label={t('p.monthly')}>
              <input
                inputMode="numeric"
                value={monthlyStr}
                onChange={(e) => {
                  setMonthlyStr(e.target.value);
                  const v = parseIdr(e.target.value);
                  if (Number.isFinite(v) && v > 0) upd({ monthlyIdr: v });
                }}
                onBlur={() => setMonthlyStr(num(plan.monthlyIdr, lang))}
              />
            </Field>
          </div>
          <Field label={t('p.start')}>
            <input type="month" value={plan.startMonth} onChange={(e) => e.target.value && upd({ startMonth: e.target.value })} />
          </Field>
          <Field label={t('p.months')}>
            <input type="number" min={1} max={120} value={plan.months} onChange={(e) => upd({ months: Math.min(120, Math.max(1, Number(e.target.value) || 1)) })} />
          </Field>
          <Field label={t('p.day')}>
            <input type="number" min={1} max={28} value={plan.day} onChange={(e) => upd({ day: Math.min(28, Math.max(1, Number(e.target.value) || 1)) })} />
          </Field>
          <Field label={t('p.fee')}>
            <input type="number" min={0} max={5} step={0.05} value={plan.feePct} onChange={(e) => upd({ feePct: Math.min(5, Math.max(0, Number(e.target.value) || 0)) })} />
          </Field>
        </div>
        <div className="mt-4 space-y-1 rounded-xl bg-card2 p-3 text-sm">
          {price && (
            <p>
              {t('p.satsNow', {
                amount: idr(plan.monthlyIdr, lang),
                sats: num(Math.round(((plan.monthlyIdr * (1 - plan.feePct / 100)) / price.idr) * 1e8), lang),
                btc: btc(+((plan.monthlyIdr * (1 - plan.feePct / 100)) / price.idr).toFixed(8), lang),
              })}
            </p>
          )}
          <p className="text-muted">{t('p.total', { amount: idr(plan.monthlyIdr * plan.months, lang), n: plan.months })}</p>
        </div>
      </Card>

      <Card title={t('p.projection')} className="lg:col-span-2">
        {!price ? (
          <Loading />
        ) : (
          <>
            <div className="stagger grid gap-2 sm:grid-cols-3">
              {[
                { key: 'bear', label: t('p.bear'), pctv: scen.bear, edit: true },
                { key: 'flat', label: t('p.flat'), pctv: 0, edit: false },
                { key: 'bull', label: t('p.bull'), pctv: scen.bull, edit: true },
              ].map((s) => {
                const p = projectPlan(plan, price.idr, s.pctv, s.label);
                return (
                  <div key={s.key} className="lift rounded-xl bg-card2 p-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{s.label}</span>
                      {s.edit ? (
                        <label className="flex items-center gap-1 text-xs text-muted">
                          <input
                            type="number"
                            step={5}
                            className="!w-16 !px-1.5 !py-0.5 text-right"
                            value={s.pctv}
                            onChange={(e) => setScen({ ...scen, [s.key]: Math.max(-95, Number(e.target.value) || 0) })}
                          />
                          {lang === 'id' ? '%/th' : '%/yr'}
                        </label>
                      ) : (
                        <span className="text-xs text-muted">{t('p.perYear', { pct: '0%' })}</span>
                      )}
                    </div>
                    <dl className="num mt-2 grid grid-cols-2 gap-y-1">
                      <dt className="text-muted">{t('p.invested')}</dt>
                      <dd className="text-right">{idr(p.invested, lang)}</dd>
                      <dt className="text-muted">{t('p.btcGot')}</dt>
                      <dd className="text-right">{num(p.btc, lang, 6)}</dd>
                      <dt className="text-muted">{t('p.endPrice')}</dt>
                      <dd className="text-right">Rp {compact(p.endPrice, lang)}</dd>
                      <dt className="text-muted">{t('p.endValue')}</dt>
                      <dd className={`text-right font-semibold ${p.roiPct >= 0 ? 'text-up' : 'text-down'}`}>
                        {idr(p.value, lang)}
                        <div className="text-xs font-normal">{pct(p.roiPct, lang)}</div>
                      </dd>
                    </dl>
                  </div>
                );
              })}
            </div>
            <p className="mt-3 text-xs text-muted">{t('p.projectionNote')}</p>
          </>
        )}
      </Card>

      <Card title={t('p.schedule')}>
        <ul className="stagger divide-y divide-line text-sm">
          {months.map((m) => {
            const done = boughtMonths.has(m);
            const date = `${m}-${String(plan.day).padStart(2, '0')}`;
            return (
              <li key={m} className="flex items-center justify-between gap-2 py-2">
                <span className="flex items-center gap-2">
                  <span className={`grid h-5 w-5 place-items-center rounded-full text-xs ${done ? 'anim-pop bg-up text-white' : 'border border-line'}`}>{done ? '✓' : ''}</span>
                  {monthLabel(`${m}-01T00:00:00`, lang)}
                </span>
                {done ? (
                  <span className="text-xs text-up">{t('p.done')}</span>
                ) : (
                  <Btn kind="ghost" className="!px-2 !py-1 text-xs" onClick={() => go('portfolio', { date, totalIdr: plan.monthlyIdr })}>
                    + {t('p.record')}
                  </Btn>
                )}
              </li>
            );
          })}
        </ul>
        <p className="mt-2 text-xs text-muted">{t('p.scheduleNote')}</p>
      </Card>

      <Backtest monthlyIdr={plan.monthlyIdr} day={plan.day} feePct={plan.feePct} />
    </div>
  );
}

function Backtest({ monthlyIdr, day, feePct }: { monthlyIdr: number; day: number; feePct: number }) {
  const { t, lang } = useApp();
  const { price } = usePrice();
  const hist = useAsync(() => getLongHistoryUsd(), []);
  const now = new Date();
  const [from, setFrom] = useStored('ui.btFrom', `${now.getFullYear() - 4}-01`);
  const [to, setTo] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);

  const rate = price ? price.idr / price.usd : null;
  const result = useMemo(() => {
    if (!hist.data || !rate) return null;
    const start = new Date(`${from}-01T00:00:00`).getTime();
    const [ty, tm] = to.split('-').map(Number);
    const end = Math.min(Date.now(), new Date(ty, tm, 0, 23, 59).getTime());
    const series = hist.data.data;
    // Use today's price as the latest point so the result matches the live price.
    const withLive = price ? [...series, { t: Date.now(), p: price.usd }] : series;
    return backtestDca(withLive, monthlyIdr / rate, start, end, day, feePct);
  }, [hist.data, rate, from, to, monthlyIdr, day, feePct, price]);

  const chartData = result?.points.map((p) => ({ t: p.t, invested: p.invested * rate!, value: p.value * rate! }));

  return (
    <Card title={t('p.backtest')} className="lg:col-span-2">
      <p className="mb-3 text-sm text-muted">{t('p.backtestDesc')}</p>
      <div className="mb-3 grid grid-cols-2 gap-3 sm:max-w-sm">
        <Field label={t('p.from')}>
          <input type="month" min="2011-01" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} />
        </Field>
        <Field label={t('p.to')}>
          <input type="month" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} />
        </Field>
      </div>
      {hist.error && !hist.data ? (
        <ErrorBox onRetry={hist.reload} />
      ) : !result || !rate ? (
        <Loading />
      ) : (
        <>
          <div className="stagger grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label={t('p.invested')} value={idr(result.invested * rate, lang)} sub={t('p.months.n', { n: result.points.length })} />
            <Stat label={t('p.btcGot')} value={num(result.btc, lang, 6)} sub={`${t('p.avgPrice')}: Rp ${compact(result.avgPrice * rate, lang)}`} />
            <Stat
              label={`${t('p.dca')} — ${t('p.endValue')}`}
              value={idr(result.value * rate, lang)}
              sub={pct(result.roiPct, lang)}
              tone={result.roiPct >= 0 ? 'up' : 'down'}
            />
            <Stat
              label={t('p.lump')}
              value={idr(result.lumpSumValue * rate, lang)}
              sub={pct(result.lumpSumRoiPct, lang)}
              tone={result.lumpSumRoiPct >= 0 ? 'up' : 'down'}
            />
          </div>
          <div className="mt-4 h-60">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ left: 0, right: 0, top: 4, bottom: 0 }}>
                <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="t"
                  type="number"
                  domain={['dataMin', 'dataMax']}
                  tickFormatter={(v) => monthLabel(v, lang)}
                  tick={{ fill: 'var(--muted)', fontSize: 11 }}
                  stroke="var(--line)"
                  minTickGap={40}
                />
                <YAxis tickFormatter={(v) => compact(v, lang)} tick={{ fill: 'var(--muted)', fontSize: 11 }} stroke="var(--line)" width={48} orientation="right" />
                <Tooltip
                  contentStyle={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 12, color: 'var(--fg)' }}
                  labelFormatter={(v) => monthLabel(v as number, lang)}
                  formatter={(v, n) => [idr(v as number, lang), n === 'value' ? t('p.endValue') : t('p.invested')]}
                />
                <Legend formatter={(v) => (v === 'value' ? t('p.endValue') : t('p.invested'))} />
                <Line type="monotone" dataKey="invested" stroke="var(--muted)" dot={false} strokeWidth={2} animationDuration={1000} />
                <Line type="monotone" dataKey="value" stroke="var(--accent)" dot={false} strokeWidth={2} animationDuration={1400} animationBegin={200} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-xs text-muted">{t('p.fxNote')}</p>
        </>
      )}
    </Card>
  );
}
