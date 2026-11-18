import { useState } from 'react';
import { Btn, Card, Field, Seg, Stat } from '../../components/ui';
import { dateTime, num } from '../../lib/format';
import { useApp, type Key } from '../../lib/i18n';
import { useStored } from '../../lib/storage';
import { useLive } from '../data';
import { cancelOrder, closePosition, equity, execute, liqPrice, MAKER_FEE, newAccount, PAPER_SYMBOLS, placeLimit, setBrackets, START_BALANCE, TAKER_FEE, unrealised, type PaperState, type PaperSymbol } from '../paper';

const digits = (p: number) => (p >= 1000 ? 1 : p >= 10 ? 2 : 4);

export default function PaperView() {
  const { t, lang } = useApp();
  const { marks } = useLive();
  const [s, setS] = useStored<PaperState>('paper', newAccount());
  const [sym, setSym] = useStored<PaperSymbol>('term.paperSym', 'BTCUSDT');
  const [type, setType] = useState<'market' | 'limit'>('market');
  const [usdt, setUsdt] = useStored<number>('term.paperUsdt', 1000);
  const [lev, setLev] = useStored<number>('term.paperLev', 10);
  const [limit, setLimit] = useState('');
  const [sl, setSl] = useState('');
  const [tp, setTp] = useState('');
  const [msg, setMsg] = useState('');
  const mark = marks[sym];
  const eq = equity(s, marks);
  const upnl = Object.entries(s.positions).reduce((a, [k, p]) => a + (marks[k as PaperSymbol] ? unrealised(p!, marks[k as PaperSymbol]!) : 0), 0);
  const margin = Object.values(s.positions).reduce((a, p) => a + p!.margin, 0);

  const submit = (side: 'buy' | 'sell') => {
    const price = type === 'limit' ? parseFloat(limit) : mark;
    if (!price || !(usdt > 0)) return setMsg(t('x.paper.noPrice'));
    const qty = Math.floor((usdt / price) * 1e6) / 1e6;
    let next = type === 'market' ? execute(s, sym, side, qty, price, lev, TAKER_FEE, 'market') : placeLimit(s, { sym, side, price, qty, lev });
    if (!next) return setMsg(t('x.paper.noMargin'));
    if (type === 'market' && (sl || tp)) next = setBrackets(next, sym, parseFloat(sl) || undefined, parseFloat(tp) || undefined);
    setS(next);
    setMsg(type === 'market' ? t('x.paper.filled') : t('x.paper.placed', { side: side === 'buy' ? t('t.buy') : t('t.sell'), price: num(price, lang, digits(price)) }));
  };

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
      <Card title={t('x.paper.order')}>
        <Seg value={sym} onChange={setSym} options={PAPER_SYMBOLS.map((v) => ({ v, label: v.replace('USDT', '') }))} />
        <div className="num mt-2 text-xl font-bold">{mark ? num(mark, lang, digits(mark)) : '—'}</div>
        <div className="text-[11px] text-muted">{t('x.paper.mark')}</div>
        <div className="mt-3 grid gap-2">
          <Seg value={type} onChange={setType} options={[{ v: 'market', label: 'Market' }, { v: 'limit', label: 'Limit' }]} />
          {type === 'limit' && (
            <Field label={`${t('t.price')} (USDT)`}>
              <input type="number" inputMode="decimal" value={limit} placeholder={mark ? String(mark) : ''} onChange={(e) => setLimit(e.target.value)} />
            </Field>
          )}
          <Field label={`${t('x.paper.size')} (USDT)`}>
            <input type="number" inputMode="decimal" value={usdt} onChange={(e) => setUsdt(+e.target.value)} />
          </Field>
          <Field label={`${t('x.paper.lev')}: ${lev}×`}>
            <input type="range" min={1} max={50} value={lev} onChange={(e) => setLev(+e.target.value)} className="!border-0 !bg-transparent !p-0" />
          </Field>
          {type === 'market' && (
            <div className="grid grid-cols-2 gap-2">
              <Field label="Stop loss">
                <input type="number" inputMode="decimal" value={sl} onChange={(e) => setSl(e.target.value)} />
              </Field>
              <Field label="Take profit">
                <input type="number" inputMode="decimal" value={tp} onChange={(e) => setTp(e.target.value)} />
              </Field>
            </div>
          )}
          <p className="text-[11px] text-muted">
            {t('x.paper.cost', { margin: num(usdt / lev, lang, 2), fee: num(usdt * (type === 'market' ? TAKER_FEE : MAKER_FEE), lang, 2) })}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Btn className="!bg-up !text-white" onClick={() => submit('buy')}>
              {t('x.paper.long')}
            </Btn>
            <Btn className="!bg-down !text-white" onClick={() => submit('sell')}>
              {t('x.paper.short')}
            </Btn>
          </div>
          {msg && <p className="anim-slide-down text-xs text-accent">{msg}</p>}
        </div>
      </Card>

      <div className="grid min-w-0 content-start gap-3">
        <Card
          title={t('x.paper.account')}
          right={
            <Btn kind="ghost" className="!px-2 !py-1 text-xs" onClick={() => confirm(t('x.paper.resetQ')) && setS(newAccount())}>
              {t('x.paper.reset')}
            </Btn>
          }
        >
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label={t('x.equity')} value={`$${num(eq, lang, 2)}`} sub={`${eq >= START_BALANCE ? '+' : ''}${num(((eq - START_BALANCE) / START_BALANCE) * 100, lang, 2)}%`} tone={eq >= START_BALANCE ? 'up' : 'down'} />
            <Stat label={t('x.paper.free')} value={`$${num(s.balance, lang, 2)}`} />
            <Stat label={t('x.paper.margin')} value={`$${num(margin, lang, 2)}`} />
            <Stat label="uPnL" value={`${upnl >= 0 ? '+' : '−'}$${num(Math.abs(upnl), lang, 2)}`} tone={upnl >= 0 ? 'up' : 'down'} />
          </div>
        </Card>

        <Card title={t('x.paper.positions')}>
          {!Object.keys(s.positions).length ? (
            <p className="py-3 text-center text-xs text-muted">{t('x.paper.none')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted">
                  <tr>
                    <th className="py-1 text-left font-normal">{t('x.market')}</th>
                    <th className="text-right font-normal">{t('t.size')}</th>
                    <th className="text-right font-normal">{t('x.entry')}</th>
                    <th className="text-right font-normal">Mark</th>
                    <th className="text-right font-normal">Liq.</th>
                    <th className="text-right font-normal">uPnL</th>
                    <th className="pl-2 font-normal">SL / TP</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {(Object.entries(s.positions) as [PaperSymbol, NonNullable<PaperState['positions'][PaperSymbol]>][]).map(([k, p]) => {
                    const m = marks[k];
                    const u = m ? unrealised(p, m) : 0;
                    return (
                      <tr key={k} className="border-t border-line">
                        <td className="py-1.5">
                          <span className={p.qty > 0 ? 'text-up' : 'text-down'}>{p.qty > 0 ? 'Long' : 'Short'}</span> {k.replace('USDT', '')} <span className="text-muted">{p.lev}×</span>
                        </td>
                        <td className="num text-right">{Math.abs(p.qty)}</td>
                        <td className="num text-right">{num(p.entry, lang, digits(p.entry))}</td>
                        <td className="num text-right">{m ? num(m, lang, digits(m)) : '—'}</td>
                        <td className="num text-right text-accent">{num(liqPrice(p), lang, digits(p.entry))}</td>
                        <td className={`num text-right ${u >= 0 ? 'text-up' : 'text-down'}`}>
                          {u >= 0 ? '+' : ''}
                          {num(u, lang, 2)}
                          <div className="text-[10px]">{num((u / p.margin) * 100, lang, 1)}%</div>
                        </td>
                        <td className="pl-2">
                          <Brackets key={`${p.sl}-${p.tp}`} sl={p.sl} tp={p.tp} onSave={(a, b) => setS(setBrackets(s, k, a, b))} />
                        </td>
                        <td className="text-right">
                          <Btn kind="ghost" className="!px-2 !py-1 text-xs" disabled={!m} onClick={() => m && setS(closePosition(s, k, m))}>
                            {t('x.close')}
                          </Btn>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {s.orders.length > 0 && (
          <Card title={t('x.paper.orders')}>
            {s.orders.map((o) => (
              <div key={o.id} className="flex items-center justify-between border-t border-line py-1.5 text-xs first:border-0">
                <span>
                  <span className={o.side === 'buy' ? 'text-up' : 'text-down'}>{o.side === 'buy' ? t('t.buy') : t('t.sell')}</span> {o.qty} {o.sym.replace('USDT', '')} @ <span className="num">{num(o.price, lang, digits(o.price))}</span> · {o.lev}×
                </span>
                <button className="px-2 text-muted hover:text-down" onClick={() => setS(cancelOrder(s, o.id))} aria-label={t('x.cancel')}>
                  ✕
                </button>
              </div>
            ))}
          </Card>
        )}

        <Card title={t('x.paper.history')}>
          {!s.fills.length ? (
            <p className="py-3 text-center text-xs text-muted">{t('x.paper.noFills')}</p>
          ) : (
            <div className="max-h-72 overflow-y-auto">
              <table className="w-full text-xs">
                <tbody>
                  {s.fills.slice(0, 50).map((f) => (
                    <tr key={f.id} className="border-t border-line first:border-0">
                      <td className="py-1 text-muted">{dateTime(f.t, lang)}</td>
                      <td className={f.side === 'buy' ? 'text-up' : 'text-down'}>{f.side === 'buy' ? t('t.buy') : t('t.sell')}</td>
                      <td>
                        {f.qty} {f.sym.replace('USDT', '')}
                      </td>
                      <td className="num text-right">{num(f.price, lang, digits(f.price))}</td>
                      <td className="pl-2 text-muted">{t(`x.reason.${f.reason}` as Key)}</td>
                      <td className={`num text-right ${f.pnl > 0 ? 'text-up' : f.pnl < 0 ? 'text-down' : 'text-muted'}`}>{f.pnl ? `${f.pnl > 0 ? '+' : ''}${num(f.pnl, lang, 2)}` : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <p className="text-[11px] text-muted">{t('x.paper.note')}</p>
      </div>
    </div>
  );
}

function Brackets({ sl, tp, onSave }: { sl?: number; tp?: number; onSave: (sl?: number, tp?: number) => void }) {
  const { t } = useApp();
  const [a, setA] = useState(sl ? String(sl) : '');
  const [b, setB] = useState(tp ? String(tp) : '');
  const dirty = a !== (sl ? String(sl) : '') || b !== (tp ? String(tp) : '');
  return (
    <span className="flex items-center gap-1">
      <input type="number" inputMode="decimal" value={a} placeholder="SL" onChange={(e) => setA(e.target.value)} className="!w-20 !px-1 !py-0.5 !text-xs" />
      <input type="number" inputMode="decimal" value={b} placeholder="TP" onChange={(e) => setB(e.target.value)} className="!w-20 !px-1 !py-0.5 !text-xs" />
      {dirty && (
        <button className="rounded bg-accent px-1.5 py-0.5 text-[10px] text-accent-fg" onClick={() => onSave(parseFloat(a) || undefined, parseFloat(b) || undefined)}>
          {t('x.save')}
        </button>
      )}
    </span>
  );
}
