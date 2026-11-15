import { useEffect, useMemo, useRef, useState } from 'react';
import { Area, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Btn, Card, Field, Num, Seg, Stat, parseBtc, parseMoney, useAsync } from '../components/ui';
import { getLongHistoryUsd } from '../lib/api';
import { computePortfolio, normalizeTx, portfolioSeries, uid, type Tx } from '../lib/calc';
import { csvToTxs, sameTx, txsToCsv } from '../lib/csv';
import { btc, compact, dateOnly, num, pct } from '../lib/format';
import { useApp } from '../lib/i18n';
import { CCY_LABEL, money, type Ccy } from '../lib/money';
import { useNav } from '../lib/nav';
import { usePrice } from '../lib/price';
import { exportBackup, importBackup, parseBackup, useStored } from '../lib/storage';

/** Local calendar date (toISOString would give yesterday's date in WIB before 07:00). */
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Number shown in an input: USD keeps cents, IDR is whole rupiah. */
const inputNum = (v: number, ccy: Ccy, lang: 'id' | 'en') => num(ccy === 'usd' ? Math.round(v * 100) / 100 : Math.round(v), lang, ccy === 'usd' ? 2 : 0);

export default function Portfolio() {
  const { t, lang, ccy, fx } = useApp();
  const { price } = usePrice();
  const { draft, clearDraft } = useNav();
  const [stored, setTxs] = useStored<Tx[]>('txs', []);
  const txs = stored.map(normalizeTx);
  const [editing, setEditing] = useState<Partial<Tx> | null>(null);
  const [msg, setMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const csvRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (draft && price) {
      const p = price[draft.ccy];
      setEditing({ type: 'buy', date: draft.date < today() ? draft.date : today(), price: p, btc: draft.total / p, fee: 0, ccy: draft.ccy });
      clearDraft();
    }
  }, [draft, price, clearDraft]);

  const s = computePortfolio(txs, price?.[ccy] ?? 0, ccy, fx || 1);
  const m = (v: number) => money(v, ccy, lang);
  const sorted = [...txs].sort((a, b) => b.date.localeCompare(a.date));

  const saveFile = (text: string, name: string, type: string) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const download = () => saveFile(exportBackup(), `btc-nyicil-backup-${today()}.json`, 'application/json');
  const downloadCsv = () => saveFile(txsToCsv(txs), `btc-nyicil-transaksi-${today()}.csv`, 'text/csv');
  const restore = async (f: File) => {
    try {
      const text = await f.text();
      parseBackup(text); // reject a bad file before asking
      if (!confirm(t('f.confirmRestore'))) return;
      importBackup(text);
      setMsg(t('f.restored'));
    } catch {
      setMsg(t('f.restoreFail'));
    }
  };
  const importCsv = async (f: File) => {
    try {
      const r = csvToTxs(await f.text());
      const fresh = r.txs.filter((x) => !txs.some((y) => sameTx(x, y)));
      if (fresh.length) setTxs((all) => [...all.map(normalizeTx), ...fresh]);
      setMsg(t('f.csvDone', { n: fresh.length, dup: r.txs.length - fresh.length, bad: r.skipped.length }));
    } catch {
      setMsg(t('f.csvFail'));
    }
  };

  return (
    <div className="stagger grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <div className="stagger grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Stat label={t('f.btc')} value={<Num value={s.btc} format={(v) => num(v, lang, 8)} />} sub={`${num(Math.round(s.btc * 1e8), lang)} sats`} />
          <Stat label={t('f.value')} value={price ? <Num value={s.value} format={m} /> : '–'} />
          <Stat label={t('f.cost')} value={<Num value={s.costBasis} format={m} />} />
          <Stat label={t('f.avg')} value={s.avgPrice ? m(s.avgPrice) : '–'} sub={price ? `${t('f.useNow')}: ${m(price[ccy])}` : undefined} />
          <Stat
            label={t('f.unrealized')}
            value={price && s.btc > 0 ? <Num value={s.unrealized} format={m} /> : '–'}
            sub={price && s.btc > 0 ? pct(s.unrealizedPct, lang) : undefined}
            tone={s.btc > 0 && price ? (s.unrealized >= 0 ? 'up' : 'down') : null}
          />
          <Stat label={t('f.realized')} value={m(s.realized)} sub={`${t('f.fees')}: ${m(s.fees)}`} tone={s.realized ? (s.realized > 0 ? 'up' : 'down') : null} />
        </div>
        {s.oversold && <p className="mt-3 rounded-lg border border-down/40 p-2 text-xs text-down">⚠️ {t('f.oversoldWarn')}</p>}
        {s.converted && <p className="mt-3 text-xs text-muted">ⓘ {t('f.converted')}</p>}
        <ValueChart txs={txs} />
      </Card>

      <Card title={t('f.add')}>
        {editing ? (
          <TxForm
            initial={editing}
            onCancel={() => setEditing(null)}
            onSave={(tx) => {
              const next = txs.some((x) => x.id === tx.id) ? txs.map((x) => (x.id === tx.id ? tx : x)) : [...txs, tx];
              // Refuse a change that would sell BTC that was not held yet (unless the data was already like that).
              if (!s.oversold && computePortfolio(next, 0, ccy, fx || 1).oversold) return t('f.oversold');
              setTxs(next);
              setEditing(null);
            }}
          />
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <Btn onClick={() => setEditing({ type: 'buy', date: today(), price: price?.[ccy], fee: 0, ccy })}>+ {t('f.buy')}</Btn>
            <Btn kind="ghost" onClick={() => setEditing({ type: 'sell', date: today(), price: price?.[ccy], fee: 0, ccy })}>
              − {t('f.sell')}
            </Btn>
          </div>
        )}
        <div className="mt-4 grid grid-cols-2 gap-2 border-t border-line pt-4">
          <Btn kind="ghost" onClick={download}>
            ⬇ {t('f.backup')}
          </Btn>
          <Btn kind="ghost" onClick={() => fileRef.current?.click()}>
            ⬆ {t('f.restore')}
          </Btn>
          <Btn kind="ghost" onClick={downloadCsv} disabled={!txs.length}>
            ⬇ {t('f.csvExport')}
          </Btn>
          <Btn kind="ghost" onClick={() => csvRef.current?.click()}>
            ⬆ {t('f.csvImport')}
          </Btn>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = ''; // so the same file can be picked again
              if (f) restore(f);
            }}
          />
          <input
            ref={csvRef}
            type="file"
            accept="text/csv,.csv"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) importCsv(f);
            }}
          />
        </div>
        {msg && (
          <p key={msg} className="anim-pop mt-2 text-sm text-accent">
            {msg}
          </p>
        )}
        <p className="mt-2 text-xs text-muted">{t('f.localNote')}</p>
      </Card>

      <Card title={t('f.history')} className="lg:col-span-3">
        {sorted.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted">{t('f.empty')}</p>
        ) : (
          <div className="-mx-4 overflow-x-auto px-4">
            <table className="num w-full min-w-[640px] text-sm [&_td]:pr-4 [&_th]:pr-4 [&_td:last-child]:pr-0">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="py-2 font-normal">{t('f.date')}</th>
                  <th className="font-normal">{t('f.amount')}</th>
                  <th className="font-normal">{t('f.price', { ccy: '' }).replace(' ()', '')}</th>
                  <th className="font-normal">{t('f.total', { ccy: '' }).replace(' ()', '')}</th>
                  <th className="font-normal">{t('f.note')}</th>
                  <th />
                </tr>
              </thead>
              <tbody className="stagger divide-y divide-line">
                {sorted.map((x) => (
                  <tr key={x.id} className="hover:bg-card2">
                    <td className="py-2 whitespace-nowrap">
                      <span className={`mr-2 rounded px-1.5 py-0.5 text-xs ${x.type === 'buy' ? 'bg-up/15 text-up' : 'bg-down/15 text-down'}`}>
                        {x.type === 'buy' ? t('f.buy') : t('f.sell')}
                      </span>
                      {dateOnly(`${x.date}T00:00:00`, lang)}
                    </td>
                    <td>{btc(x.btc, lang)}</td>
                    <td>{money(x.price, x.ccy, lang)}</td>
                    <td>{money(x.btc * x.price + (x.type === 'buy' ? x.fee : -x.fee), x.ccy, lang)}</td>
                    <td className="max-w-40 truncate text-muted">{x.note}</td>
                    <td className="whitespace-nowrap text-right">
                      <button className="px-2 text-muted hover:text-fg" onClick={() => setEditing(x)} aria-label={t('f.edit')}>
                        ✎
                      </button>
                      <button
                        className="px-2 text-muted hover:text-down"
                        aria-label={t('f.delete')}
                        onClick={() => confirm(t('f.confirmDelete')) && setTxs((all) => all.map(normalizeTx).filter((y) => y.id !== x.id))}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function ValueChart({ txs }: { txs: Tx[] }) {
  const { t, lang, ccy, fx } = useApp();
  const { price } = usePrice();
  const hist = useAsync(() => getLongHistoryUsd(), []);
  const priceUsd = price?.usd;
  const data = useMemo(() => {
    if (!hist.data || !priceUsd || !txs.length || (ccy === 'idr' && !fx)) return [];
    return portfolioSeries(txs, [...hist.data.data, { t: Date.now(), p: priceUsd }], ccy, fx);
  }, [hist.data, priceUsd, txs, ccy, fx]);
  if (data.length < 2) return null;
  const m = (v: number) => money(v, ccy, lang);
  return (
    <div className="mt-4">
      <h3 className="mb-1 text-xs text-muted">{t('f.chart')}</h3>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ left: 0, right: 0, top: 4, bottom: 0 }}>
            <XAxis
              dataKey="t"
              type="number"
              domain={['dataMin', 'dataMax']}
              tickFormatter={(v) => dateOnly(v, lang).replace(/,? \d{4}$/, '')}
              tick={{ fill: 'var(--muted)', fontSize: 11 }}
              stroke="var(--line)"
              minTickGap={40}
            />
            <YAxis tickFormatter={(v) => compact(v, lang)} tick={{ fill: 'var(--muted)', fontSize: 11 }} stroke="var(--line)" width={48} orientation="right" />
            <Tooltip
              contentStyle={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 12, color: 'var(--fg)' }}
              labelFormatter={(v) => dateOnly(v as number, lang)}
              formatter={(v, n) => [m(v as number), n === 'value' ? t('f.value') : t('f.cost')]}
            />
            <Area type="monotone" dataKey="value" stroke="var(--accent)" strokeWidth={2} fill="var(--accent)" fillOpacity={0.12} animationDuration={900} />
            <Line type="stepAfter" dataKey="cost" stroke="var(--muted)" strokeWidth={2} strokeDasharray="4 3" dot={false} animationDuration={900} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1 text-xs text-muted">
        <span className="text-accent">━</span> {t('f.value')} · <span>┅</span> {t('f.cost')} · {t('f.chartNote')}
      </p>
    </div>
  );
}

function TxForm({ initial, onSave, onCancel }: { initial: Partial<Tx>; onSave: (t: Tx) => string | void; onCancel: () => void }) {
  const { t, lang, ccy: appCcy } = useApp();
  const { price } = usePrice();
  const [ccy, setCcy] = useState<Ccy>(initial.ccy ?? appCcy);
  const [type, setType] = useState<Tx['type']>(initial.type ?? 'buy');
  const [date, setDate] = useState(initial.date ?? today());
  const [priceStr, setPriceStr] = useState(initial.price ? inputNum(initial.price, ccy, lang) : '');
  const [btcStr, setBtcStr] = useState(initial.btc ? String(+initial.btc.toFixed(8)) : '');
  const [totalStr, setTotalStr] = useState(initial.btc && initial.price ? inputNum(initial.btc * initial.price, ccy, lang) : '');
  const [feeStr, setFeeStr] = useState(initial.fee ? inputNum(initial.fee, ccy, lang) : '0');
  const [note, setNote] = useState(initial.note ?? '');
  const [err, setErr] = useState('');
  const L = { ccy: CCY_LABEL[ccy] };

  // Amount and total stay linked through the price; whichever the user edits last wins.
  const fromTotal = (total: string, p = parseMoney(priceStr, lang)) => {
    const v = parseMoney(total, lang);
    if (Number.isFinite(v) && p > 0) setBtcStr(String(+(v / p).toFixed(8)));
  };
  const fromBtc = (b: string, p = parseMoney(priceStr, lang)) => {
    const v = parseBtc(b);
    if (Number.isFinite(v) && p > 0) setTotalStr(inputNum(v * p, ccy, lang));
  };

  // Switching currency on a new entry restarts the money fields at today's price.
  const switchCcy = (c: Ccy) => {
    setCcy(c);
    if (price) {
      setPriceStr(inputNum(price[c], c, lang));
      const b = parseBtc(btcStr);
      setTotalStr(Number.isFinite(b) ? inputNum(b * price[c], c, lang) : '');
    }
    setFeeStr('0');
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const p = parseMoney(priceStr, lang);
    const b = parseBtc(btcStr);
    const f = parseMoney(feeStr || '0', lang);
    if (!(p > 0) || !(b > 0) || !Number.isFinite(f) || f < 0) return setErr(t('f.invalid'));
    const problem = onSave({ id: initial.id ?? uid(), type, date, price: p, btc: b, fee: f, ccy, note: note.trim() || undefined });
    if (problem) setErr(problem);
  };

  return (
    <form onSubmit={submit} className="anim-slide-down grid grid-cols-2 gap-3">
      <div className="col-span-2 grid grid-cols-2 gap-1 rounded-xl bg-card2 p-1">
        {(['buy', 'sell'] as const).map((k) => (
          <button
            type="button"
            key={k}
            onClick={() => setType(k)}
            className={`rounded-lg py-1.5 text-sm font-medium duration-300 ${type === k ? (k === 'buy' ? 'bg-up text-white shadow-sm' : 'bg-down text-white shadow-sm') : 'text-muted hover:text-fg'}`}
          >
            {k === 'buy' ? t('f.buy') : t('f.sell')}
          </button>
        ))}
      </div>
      <div className="col-span-2 flex items-center justify-between gap-2 text-xs text-muted">
        {t('f.ccy')}
        <Seg value={ccy} onChange={switchCcy} options={[{ v: 'usd', label: 'USD' }, { v: 'idr', label: 'IDR' }]} />
      </div>
      <Field label={t('f.date')}>
        <input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} required />
      </Field>
      <Field
        label={
          <span className="flex justify-between gap-1">
            {t('f.price', L)}
            {price && (
              <button
                type="button"
                className="shrink-0 text-accent"
                onClick={() => {
                  setPriceStr(inputNum(price[ccy], ccy, lang));
                  fromTotal(totalStr, price[ccy]);
                }}
              >
                {t('f.useNow')}
              </button>
            )}
          </span>
        }
      >
        <input
          inputMode="decimal"
          value={priceStr}
          onChange={(e) => {
            setPriceStr(e.target.value);
            fromTotal(totalStr, parseMoney(e.target.value, lang));
          }}
          required
        />
      </Field>
      <Field label={t('f.total', L)}>
        <input
          inputMode="decimal"
          value={totalStr}
          onChange={(e) => {
            setTotalStr(e.target.value);
            fromTotal(e.target.value);
          }}
        />
      </Field>
      <Field label={t('f.amount')}>
        <input
          inputMode="decimal"
          value={btcStr}
          onChange={(e) => {
            setBtcStr(e.target.value);
            fromBtc(e.target.value);
          }}
          required
        />
      </Field>
      <Field label={t('f.fee', L)}>
        <input inputMode="decimal" value={feeStr} onChange={(e) => setFeeStr(e.target.value)} />
      </Field>
      <Field label={t('f.note')}>
        <input value={note} placeholder={t('f.notePh')} onChange={(e) => setNote(e.target.value)} maxLength={80} />
      </Field>
      {err && <p className="col-span-2 text-sm text-down">{err}</p>}
      <Btn kind="ghost" onClick={onCancel}>
        {t('f.cancel')}
      </Btn>
      <Btn type="submit">{t('f.save')}</Btn>
    </form>
  );
}
