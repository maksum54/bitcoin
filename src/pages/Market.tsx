import { useState } from 'react';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Btn, Card, ErrorBox, Field, Loading, Num, Seg, Stat, Updated, parseBtc, parseIdr, useAsync, useFlash } from '../components/ui';
import { getChart } from '../lib/api';
import { uid } from '../lib/calc';
import { compact, dateOnly, dateTime, idr, num, pct, usd } from '../lib/format';
import { useApp } from '../lib/i18n';
import { usePrice, type Alert } from '../lib/price';
import { useStored } from '../lib/storage';

const RANGES = [1, 7, 30, 90, 365] as const;

export default function Market() {
  const { t, lang } = useApp();
  const { price, at, stale, error, reload } = usePrice();
  const [days, setDays] = useStored<number>('ui.range', 30);
  const [vs, setVs] = useStored<'idr' | 'usd'>('ui.vs', 'idr');
  const chart = useAsync(() => getChart(days, vs), [days, vs], 5 * 60_000);
  const flash = useFlash(price ? (vs === 'idr' ? price.idr : price.usd) : undefined);

  if (!price && error) return <ErrorBox onRetry={reload} />;
  if (!price) return <Loading />;

  const fmt = (v: number) => (vs === 'idr' ? idr(v, lang) : usd(v, lang));
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
              <Num value={vs === 'idr' ? price.idr : price.usd} format={fmt} />
            </div>
            <div className="num mt-1 text-sm text-muted">
              {vs === 'idr' ? usd(price.usd, lang) : idr(price.idr, lang)}{' '}
              <span className={change >= 0 ? 'text-up' : 'text-down'}>{pct(change, lang)} (24h)</span>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <Seg value={vs} onChange={setVs} options={[{ v: 'idr', label: 'IDR' }, { v: 'usd', label: 'USD' }]} />
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
          <Stat
            label={t('m.marketCap')}
            value={vs === 'idr' ? `Rp ${compact(price.idr_market_cap, lang)}` : `$${compact(price.usd_market_cap, lang)}`}
          />
          <Stat label={t('m.volume')} value={vs === 'idr' ? `Rp ${compact(price.idr_24h_vol, lang)}` : `$${compact(price.usd_24h_vol, lang)}`} />
        </div>
        <div className="mt-2 text-right">
          <Updated at={at} stale={stale} />
        </div>
      </Card>
      <div className="stagger grid min-w-0 content-start gap-4">
        <Converter priceIdr={price.idr} priceUsd={price.usd} />
        <Alerts priceIdr={price.idr} />
      </div>
    </div>
  );
}

function Converter({ priceIdr, priceUsd }: { priceIdr: number; priceUsd: number }) {
  const { t, lang } = useApp();
  const [btcStr, setBtcStr] = useState('0.001');
  const [idrStr, setIdrStr] = useState(() => num(0.001 * priceIdr, lang));
  const btcVal = parseBtc(btcStr);
  const onBtc = (s: string) => {
    setBtcStr(s);
    const v = parseBtc(s);
    if (Number.isFinite(v)) setIdrStr(num(v * priceIdr, lang));
  };
  const onIdr = (s: string) => {
    setIdrStr(s);
    const v = parseIdr(s);
    if (Number.isFinite(v)) setBtcStr(String(+(v / priceIdr).toFixed(8)));
  };
  return (
    <Card title={t('m.converter')}>
      <div className="grid gap-3">
        <Field label="BTC">
          <input inputMode="decimal" value={btcStr} onChange={(e) => onBtc(e.target.value)} />
        </Field>
        <Field label="IDR">
          <input inputMode="numeric" value={idrStr} onChange={(e) => onIdr(e.target.value)} />
        </Field>
        <div className="num text-xs text-muted">
          = {Number.isFinite(btcVal) ? num(Math.round(btcVal * 1e8), lang) : '–'} sats ·{' '}
          {Number.isFinite(btcVal) ? usd(btcVal * priceUsd, lang, 2) : '–'}
        </div>
      </div>
    </Card>
  );
}

function Alerts({ priceIdr }: { priceIdr: number }) {
  const { t, lang } = useApp();
  const [alerts, setAlerts] = useStored<Alert[]>('alerts', []);
  const [dir, setDir] = useState<Alert['dir']>('below');
  const [val, setVal] = useState('');
  const [perm, setPerm] = useState<string>(() => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission));
  const add = () => {
    const v = parseIdr(val);
    if (!Number.isFinite(v) || v <= 0) return;
    setAlerts((a) => [...a, { id: uid(), dir, priceIdr: v, active: true }]);
    setVal('');
  };
  return (
    <Card title={t('m.alerts')}>
      <div className="grid gap-2">
        <div className="grid grid-cols-[auto_1fr] gap-2">
          <select value={dir} onChange={(e) => setDir(e.target.value as Alert['dir'])} className="w-auto">
            <option value="below">{t('m.below')}</option>
            <option value="above">{t('m.above')}</option>
          </select>
          <input
            inputMode="numeric"
            placeholder={num(Math.round(priceIdr / 1e6) * 1e6, lang)}
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
                <span className={a.active ? 'inline-block animate-bounce [animation-duration:2s]' : ''}>{a.dir === 'above' ? '▲' : '▼'}</span> <span className="num">{idr(a.priceIdr, lang)}</span>
                {!a.active && <span className="ml-1 text-xs">({t('m.fired')})</span>}
              </span>
              <button className="px-2 text-muted hover:text-down" aria-label={t('f.delete')} onClick={() => setAlerts((x) => x.filter((y) => y.id !== a.id))}>
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
