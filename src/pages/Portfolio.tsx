import { useEffect, useRef, useState } from 'react';
import { Btn, Card, Field, Stat, parseBtc, parseIdr } from '../components/ui';
import { computePortfolio, uid, type Tx } from '../lib/calc';
import { btc, dateOnly, idr, num, pct } from '../lib/format';
import { useApp } from '../lib/i18n';
import { useNav } from '../lib/nav';
import { usePrice } from '../lib/price';
import { exportBackup, importBackup, useStored } from '../lib/storage';

/** Local calendar date (toISOString would give yesterday's date in WIB before 07:00). */
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export default function Portfolio() {
  const { t, lang } = useApp();
  const { price } = usePrice();
  const { draft, clearDraft } = useNav();
  const [txs, setTxs] = useStored<Tx[]>('txs', []);
  const [editing, setEditing] = useState<Partial<Tx> | null>(null);
  const [msg, setMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (draft && price) {
      setEditing({ type: 'buy', date: draft.date < today() ? draft.date : today(), priceIdr: price.idr, btc: draft.totalIdr / price.idr, feeIdr: 0 });
      clearDraft();
    }
  }, [draft, price, clearDraft]);

  const s = computePortfolio(txs, price?.idr ?? 0);
  const sorted = [...txs].sort((a, b) => b.date.localeCompare(a.date));

  const download = () => {
    const blob = new Blob([exportBackup()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `btc-nyicil-backup-${today()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const restore = async (f: File) => {
    try {
      importBackup(await f.text());
      setMsg(t('f.restored'));
    } catch {
      setMsg(t('f.restoreFail'));
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Stat label={t('f.btc')} value={num(s.btc, lang, 8)} sub={`${num(Math.round(s.btc * 1e8), lang)} sats`} />
          <Stat label={t('f.value')} value={price ? idr(s.value, lang) : '–'} />
          <Stat label={t('f.cost')} value={idr(s.costBasis, lang)} />
          <Stat label={t('f.avg')} value={s.avgPrice ? idr(s.avgPrice, lang) : '–'} sub={price ? `${t('f.useNow')}: ${idr(price.idr, lang)}` : undefined} />
          <Stat
            label={t('f.unrealized')}
            value={price && s.btc > 0 ? idr(s.unrealized, lang) : '–'}
            sub={price && s.btc > 0 ? pct(s.unrealizedPct, lang) : undefined}
            tone={s.btc > 0 && price ? (s.unrealized >= 0 ? 'up' : 'down') : null}
          />
          <Stat label={t('f.realized')} value={idr(s.realized, lang)} sub={`${t('f.fees')}: ${idr(s.fees, lang)}`} tone={s.realized ? (s.realized > 0 ? 'up' : 'down') : null} />
        </div>
      </Card>

      <Card title={t('f.add')}>
        {editing ? (
          <TxForm
            initial={editing}
            onCancel={() => setEditing(null)}
            onSave={(tx) => {
              setTxs((all) => (all.some((x) => x.id === tx.id) ? all.map((x) => (x.id === tx.id ? tx : x)) : [...all, tx]));
              setEditing(null);
            }}
          />
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <Btn onClick={() => setEditing({ type: 'buy', date: today(), priceIdr: price?.idr, feeIdr: 0 })}>+ {t('f.buy')}</Btn>
            <Btn kind="ghost" onClick={() => setEditing({ type: 'sell', date: today(), priceIdr: price?.idr, feeIdr: 0 })}>
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
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && restore(e.target.files[0])} />
        </div>
        {msg && <p className="mt-2 text-sm text-accent">{msg}</p>}
        <p className="mt-2 text-xs text-muted">{t('f.localNote')}</p>
      </Card>

      <Card title={t('f.history')} className="lg:col-span-3">
        {sorted.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted">{t('f.empty')}</p>
        ) : (
          <div className="-mx-4 overflow-x-auto px-4">
            <table className="num w-full min-w-[560px] text-sm">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="py-2 font-normal">{t('f.date')}</th>
                  <th className="font-normal">{t('f.amount')}</th>
                  <th className="font-normal">{t('f.price')}</th>
                  <th className="font-normal">{t('f.total')}</th>
                  <th className="font-normal">{t('f.note')}</th>
                  <th />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {sorted.map((x) => (
                  <tr key={x.id}>
                    <td className="py-2 whitespace-nowrap">
                      <span className={`mr-2 rounded px-1.5 py-0.5 text-xs ${x.type === 'buy' ? 'bg-up/15 text-up' : 'bg-down/15 text-down'}`}>
                        {x.type === 'buy' ? t('f.buy') : t('f.sell')}
                      </span>
                      {dateOnly(`${x.date}T00:00:00`, lang)}
                    </td>
                    <td>{btc(x.btc, lang)}</td>
                    <td>{idr(x.priceIdr, lang)}</td>
                    <td>{idr(x.btc * x.priceIdr + (x.type === 'buy' ? x.feeIdr : -x.feeIdr), lang)}</td>
                    <td className="max-w-40 truncate text-muted">{x.note}</td>
                    <td className="whitespace-nowrap text-right">
                      <button className="px-2 text-muted hover:text-fg" onClick={() => setEditing(x)} aria-label="edit">
                        ✎
                      </button>
                      <button
                        className="px-2 text-muted hover:text-down"
                        aria-label={t('f.delete')}
                        onClick={() => confirm(t('f.confirmDelete')) && setTxs((all) => all.filter((y) => y.id !== x.id))}
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

function TxForm({ initial, onSave, onCancel }: { initial: Partial<Tx>; onSave: (t: Tx) => void; onCancel: () => void }) {
  const { t, lang } = useApp();
  const { price } = usePrice();
  const [type, setType] = useState<Tx['type']>(initial.type ?? 'buy');
  const [date, setDate] = useState(initial.date ?? today());
  const [priceStr, setPriceStr] = useState(initial.priceIdr ? num(Math.round(initial.priceIdr), lang) : '');
  const [btcStr, setBtcStr] = useState(initial.btc ? String(+initial.btc.toFixed(8)) : '');
  const [totalStr, setTotalStr] = useState(initial.btc && initial.priceIdr ? num(Math.round(initial.btc * initial.priceIdr), lang) : '');
  const [feeStr, setFeeStr] = useState(initial.feeIdr ? num(initial.feeIdr, lang) : '0');
  const [note, setNote] = useState(initial.note ?? '');
  const [err, setErr] = useState('');

  // Amount and total stay linked through the price; whichever the user edits last wins.
  const fromTotal = (total: string, p = parseIdr(priceStr)) => {
    const v = parseIdr(total);
    if (Number.isFinite(v) && p > 0) setBtcStr(String(+(v / p).toFixed(8)));
  };
  const fromBtc = (b: string, p = parseIdr(priceStr)) => {
    const v = parseBtc(b);
    if (Number.isFinite(v) && p > 0) setTotalStr(num(Math.round(v * p), lang));
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const p = parseIdr(priceStr);
    const b = parseBtc(btcStr);
    const f = parseIdr(feeStr || '0');
    if (!(p > 0) || !(b > 0) || !Number.isFinite(f) || f < 0) return setErr(t('f.invalid'));
    onSave({ id: initial.id ?? uid(), type, date, priceIdr: p, btc: b, feeIdr: f, note: note.trim() || undefined });
  };

  return (
    <form onSubmit={submit} className="grid grid-cols-2 gap-3">
      <div className="col-span-2 grid grid-cols-2 gap-1 rounded-xl bg-card2 p-1">
        {(['buy', 'sell'] as const).map((k) => (
          <button
            type="button"
            key={k}
            onClick={() => setType(k)}
            className={`rounded-lg py-1.5 text-sm font-medium ${type === k ? (k === 'buy' ? 'bg-up text-white' : 'bg-down text-white') : 'text-muted'}`}
          >
            {k === 'buy' ? t('f.buy') : t('f.sell')}
          </button>
        ))}
      </div>
      <Field label={t('f.date')}>
        <input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} required />
      </Field>
      <Field
        label={
          <span className="flex justify-between">
            {t('f.price')}
            {price && (
              <button
                type="button"
                className="text-accent"
                onClick={() => {
                  setPriceStr(num(Math.round(price.idr), lang));
                  fromTotal(totalStr, price.idr);
                }}
              >
                {t('f.useNow')}
              </button>
            )}
          </span>
        }
      >
        <input
          inputMode="numeric"
          value={priceStr}
          onChange={(e) => {
            setPriceStr(e.target.value);
            fromTotal(totalStr, parseIdr(e.target.value));
          }}
          required
        />
      </Field>
      <Field label={t('f.total')}>
        <input
          inputMode="numeric"
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
      <Field label={t('f.fee')}>
        <input inputMode="numeric" value={feeStr} onChange={(e) => setFeeStr(e.target.value)} />
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
