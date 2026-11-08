import { useState } from 'react';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Btn, Card, ErrorBox, Field, Loading, Num, Seg, Stat, Updated, parseBtc, parseMoney, useAsync, useFlash } from '../components/ui';
import { getChart } from '../lib/api';
import { uid } from '../lib/calc';
import { compact, dateOnly, dateTime, num, pct } from '../lib/format';
import { useApp } from '../lib/i18n';
import { CCY_LABEL, compactMoney, money, type Ccy } from '../lib/money';
import { normalizeAlert, usePrice, type Alert } from '../lib/price';
import { useStored } from '../lib/storage';

const RANGES = [1, 7, 30, 90, 365] as const;

export default function Market() {
  const { t, lang, ccy: vs, setCcy: setVs } = useApp();
  const { price, at, stale, error, reload } = usePrice();
  const [days, setDays] = useStored<number>('ui.range', 30);
  const chart = useAsync(() => getChart(days, vs), [days, vs], 5 * 60_000);
  const flash = useFlash(price ? price[vs] : undefined);

  if (!price && error) return <ErrorBox onRetry={reload} />;
  if (!price) return <Loading />;

  const fmt = (v: number) => money(v, vs, lang, 0);
  const other: Ccy = vs === 'usd' ? 'idr' : 'usd';
  const change = vs === 'idr' ? price.idr_24h_change : price.usd_24h_change;
  const pts = chart.data?.data ?? [];
  const first = pts[0]?.p;
  const last = pts[pts.length - 1]?.p;
  const rangeUp = first && last ? last >= first : change >= 0;
  const color = rangeUp ? 'var(--up)' : 'var(--down)';

  return (
    <div className="stagger grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs text-muted">Bitcoin · BTC</div>
            <div className={`num -mx-1 px-1 text-3xl font-bold sm:text-4xl ${flash}`}>
              <Num value={price[vs]} format={fmt} />
            </div>
            <div className="num mt-1 text-sm text-muted">
              {money(price[other], other, lang, 0)}{' '}
              <span className={change >= 0 ? 'text-up' : 'text-down'}>{pct(change, lang)} (24h)</span>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <Seg value={vs} onChange={setVs} options={[{ v: 'usd', label: 'USD' }, { v: 'idr', label: 'IDR' }]} />
            <Seg value={days} onChange={setDays} options={RANGES.map((d) => ({ v: d, label: t(`m.range.${d}` as 'm.range.1') }))} />
          </div>
        </div>
        <div className="mt-4 h-64">
          {chart.error && !pts.length ? (
            <ErrorBox onRetry={chart.reload} />
          ) : !pts.length ? (
            <Loading />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={pts} margin={{ left: 0, right: 0, top: 4, bottom: 0 }}>
                <defs>
                  <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={color} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="t"
                  type="number"
                  domain={['dataMin', 'dataMax']}
                  tickFormatter={(v) =>
                    days <= 1
                      ? new Date(v).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' })
                      : dateOnly(v, lang).replace(/ \d{4}$/, '')
                  }
                  tick={{ fill: 'var(--muted)', fontSize: 11 }}
                  stroke="var(--line)"
                  minTickGap={40}
                />
                <YAxis
                  dataKey="p"
                  domain={['auto', 'auto']}
                  tickFormatter={(v) => compact(v, lang)}
                  tick={{ fill: 'var(--muted)', fontSize: 11 }}
                  stroke="var(--line)"
                  width={52}
                  orientation="right"
                />
                <Tooltip
                  contentStyle={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 12, color: 'var(--fg)' }}
                  labelFormatter={(v) => dateTime(v as number, lang)}
                  formatter={(v) => [fmt(v as number), 'BTC']}
                />
                <Area type="monotone" dataKey="p" stroke={color} strokeWidth={2} fill="url(#g)" animationDuration={900} animationEasing="ease-out" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
        <div className="stagger mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Stat label={t('m.change24')} value={pct(change, lang)} tone={change >= 0 ? 'up' : 'down'} />
          <Stat label={t('m.marketCap')} value={compactMoney(vs === 'idr' ? price.idr_market_cap : price.usd_market_cap, vs, lang)} />
          <Stat label={t('m.volume')} value={compactMoney(vs === 'idr' ? price.idr_24h_vol : price.usd_24h_vol, vs, lang)} />
        </div>
        <div className="mt-2 text-right">
          <Updated at={at} stale={stale} />
        </div>
      </Card>
      <div className="stagger grid min-w-0 content-start gap-4">
        <Converter priceIdr={price.idr} priceUsd={price.usd} />
        <Alerts price={price[vs]} />
      </div>
    </div>
  );
}

function Converter({ priceIdr, priceUsd }: { priceIdr: number; priceUsd: number }) {
  const { t, lang, ccy } = useApp();
  const fmtUsd = (v: number) => num(v, lang, 2);
  const fmtIdr = (v: number) => num(v, lang, 0);
  const [btcStr, setBtcStr] = useState('0.001');
  const [usdStr, setUsdStr] = useState(() => fmtUsd(0.001 * priceUsd));
  const [idrStr, setIdrStr] = useState(() => fmtIdr(0.001 * priceIdr));
  const btcVal = parseBtc(btcStr);

  const fromBtc = (v: number, skip?: Ccy) => {
    if (skip) setBtcStr(String(+v.toFixed(8)));
    if (skip !== 'usd') setUsdStr(fmtUsd(v * priceUsd));
    if (skip !== 'idr') setIdrStr(fmtIdr(v * priceIdr));
  };

  const usdField = (
    <Field key="usd" label="USD">
      <input
        inputMode="decimal"
        value={usdStr}
        onChange={(e) => {
          setUsdStr(e.target.value);
          const v = parseMoney(e.target.value);
          if (Number.isFinite(v)) fromBtc(v / priceUsd, 'usd');
        }}
      />
    </Field>
  );
  const idrField = (
    <Field key="idr" label="IDR">
      <input
        inputMode="numeric"
        value={idrStr}
        onChange={(e) => {
          setIdrStr(e.target.value);
          const v = parseMoney(e.target.value);
          if (Number.isFinite(v)) fromBtc(v / priceIdr, 'idr');
        }}
      />
    </Field>
  );

  return (
    <Card title={t('m.converter')}>
      <div className="grid gap-3">
        <Field label="BTC">
          <input
            inputMode="decimal"
            value={btcStr}
            onChange={(e) => {
              setBtcStr(e.target.value);
              const v = parseBtc(e.target.value);
              if (Number.isFinite(v)) fromBtc(v);
            }}
          />
        </Field>
        {/* The currency the person buys with comes first. */}
        {ccy === 'usd' ? [usdField, idrField] : [idrField, usdField]}
        <div className="num text-xs text-muted">= {Number.isFinite(btcVal) ? num(Math.round(btcVal * 1e8), lang) : '–'} sats</div>
      </div>
    </Card>
  );
}

function Alerts({ price }: { price: number }) {
  const { t, lang, ccy } = useApp();
  const [stored, setAlerts] = useStored<Alert[]>('alerts', []);
  const alerts = stored.map(normalizeAlert);
  const [dir, setDir] = useState<Alert['dir']>('below');
  const [val, setVal] = useState('');
  const [perm, setPerm] = useState<string>(() => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission));
  const add = () => {
    const v = parseMoney(val);
    if (!Number.isFinite(v) || v <= 0) return;
    setAlerts((a) => [...a.map(normalizeAlert), { id: uid(), dir, price: v, ccy, active: true }]);
    setVal('');
  };
  const step = ccy === 'usd' ? 1000 : 1e6;
  return (
    <Card title={t('m.alerts')}>
      <div className="grid gap-2">
        <div className="grid grid-cols-[auto_1fr] gap-2">
          <select value={dir} onChange={(e) => setDir(e.target.value as Alert['dir'])} className="w-auto">
            <option value="below">{t('m.below')}</option>
            <option value="above">{t('m.above')}</option>
          </select>
          <input
            inputMode="decimal"
            aria-label={t('m.alertIn', { ccy: CCY_LABEL[ccy] })}
            placeholder={`${ccy === 'usd' ? '$' : 'Rp'} ${num(Math.round(price / step) * step, lang)}`}
            value={val}
            onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
          />
        </div>
        <Btn onClick={add}>{t('m.addAlert')}</Btn>
        {perm === 'default' && (
          <Btn kind="ghost" onClick={() => Notification.requestPermission().then(setPerm)}>
            🔔 {t('m.enableNotif')}
          </Btn>
        )}
        <ul className="mt-1 divide-y divide-line text-sm">
          {alerts.length === 0 && <li className="py-2 text-muted">{t('m.noAlerts')}</li>}
          {alerts.map((a) => (
            <li key={a.id} className="anim-slide-down flex items-center justify-between gap-2 py-2">
              <span className={a.active ? '' : 'text-muted'}>
                <span className={a.active ? 'inline-block animate-bounce [animation-duration:2s]' : ''}>{a.dir === 'above' ? '▲' : '▼'}</span>{' '}
                <span className="num">{money(a.price, a.ccy, lang, 0)}</span>
                {!a.active && <span className="ml-1 text-xs">({t('m.fired')})</span>}
              </span>
              <button
                className="px-2 text-muted hover:text-down"
                aria-label={t('f.delete')}
                onClick={() => setAlerts((x) => x.map(normalizeAlert).filter((y) => y.id !== a.id))}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted">{t('m.alertNote')}</p>
      </div>
    </Card>
  );
}
