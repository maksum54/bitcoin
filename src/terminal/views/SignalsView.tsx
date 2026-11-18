import { useCallback, useEffect, useRef, useState } from 'react';
import { Btn, Card, ErrorBox, Seg } from '../../components/ui';
import { ago, num, pct } from '../../lib/format';
import { useApp, type Key } from '../../lib/i18n';
import { load, save, useStored } from '../../lib/storage';
import { REST } from '../../lib/terminal';
import { fetchCandles } from '../../lib/useTerminal';
import { scanCandles, topSymbols, type Signal, type SignalKind } from '../signals';

interface Row {
  sym: string;
  last: number;
  change: number;
  signals: Signal[];
}

const KINDS: SignalKind[] = ['threeDriveBull', 'threeDriveBear', 'rsiOversold', 'rsiOverbought', 'goldenCross', 'deathCross'];
const BULL = new Set<SignalKind>(['threeDriveBull', 'rsiOversold', 'goldenCross']);
const CONCURRENCY = 8;

export default function SignalsView() {
  const { t, lang } = useApp();
  const [tf, setTf] = useStored<string>('term.sigTf', '1h');
  const [count, setCount] = useStored<number>('term.sigCount', 100);
  const [auto, setAuto] = useStored<boolean>('term.sigAuto', false);
  const [filter, setFilter] = useState<SignalKind | 'any'>('any');
  const [rows, setRows] = useState<Row[]>(() => load<Row[]>('sig.rows', []));
  const [at, setAt] = useState<number>(() => load<number>('sig.at', 0));
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const [error, setError] = useState(false);
  const running = useRef(false);

  const scan = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setError(false);
    try {
      const r = await fetch(`${REST}/ticker/24hr?type=MINI`);
      if (!r.ok) throw new Error('ticker');
      const tickers = (await r.json()) as { symbol: string; quoteVolume: string; lastPrice: string; openPrice: string }[];
      const syms = topSymbols(tickers, count);
      const bySym = new Map(tickers.map((x) => [x.symbol, x]));
      const out: Row[] = [];
      let done = 0;
      setProgress([0, syms.length]);
      const queue = [...syms];
      await Promise.all(
        Array.from({ length: CONCURRENCY }, async () => {
          while (queue.length) {
            const sym = queue.shift()!;
            try {
              const c = await fetchCandles(tf, 300, sym);
              const tk = bySym.get(sym)!;
              const last = parseFloat(tk.lastPrice);
              const open = parseFloat(tk.openPrice);
              out.push({ sym, last, change: open ? ((last - open) / open) * 100 : 0, signals: scanCandles(c) });
            } catch {
              /* skip this market */
            }
            setProgress([++done, syms.length]);
          }
        }),
      );
      out.sort((a, b) => b.signals.length - a.signals.length || syms.indexOf(a.sym) - syms.indexOf(b.sym));
      // Notify about new three-drive patterns.
      const prev = new Set(load<Row[]>('sig.rows', []).flatMap((r) => r.signals.filter((s) => s.kind.startsWith('three')).map((s) => `${r.sym}:${s.kind}`)));
      const fresh = out.flatMap((r) => r.signals.filter((s) => s.kind.startsWith('three') && !prev.has(`${r.sym}:${s.kind}`)).map((s) => `${r.sym} ${t(`x.sig.${s.kind}` as Key)}`));
      if (fresh.length && auto && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        navigator.serviceWorker
          ?.getRegistration()
          .then((reg) => reg?.showNotification(t('x.sigNotify'), { body: fresh.slice(0, 5).join('\n'), icon: '/pwa-192.png', tag: 'btc-signals' }))
          .catch(() => {});
      }
      setRows(out);
      const now = Date.now();
      setAt(now);
      save('sig.rows', out);
      save('sig.at', now);
    } catch {
      setError(true);
    } finally {
      running.current = false;
      setProgress(null);
    }
  }, [tf, count, auto, t]);

  useEffect(() => {
    if (!auto) return;
    const id = setInterval(() => document.visibilityState === 'visible' && scan(), 15 * 60_000);
    return () => clearInterval(id);
  }, [auto, scan]);

  const shown = rows.filter((r) => (filter === 'any' ? r.signals.length : r.signals.some((s) => s.kind === filter)));

  return (
    <Card title={t('x.screener')}>
      <div className="flex flex-wrap items-center gap-2">
        <Seg value={tf} onChange={setTf} options={['15m', '1h', '4h', '1d'].map((v) => ({ v, label: v }))} />
        <Seg value={count} onChange={setCount} options={[50, 100, 200].map((v) => ({ v, label: `${v} coin` }))} />
        <Btn onClick={scan} disabled={!!progress}>
          {progress ? `${progress[0]}/${progress[1]}` : t('x.scan')}
        </Btn>
        <label className="flex items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            className="!w-4"
            checked={auto}
            onChange={async (e) => {
              const on = e.target.checked;
              if (on && typeof Notification !== 'undefined' && Notification.permission === 'default') await Notification.requestPermission();
              setAuto(on);
            }}
          />
          {t('x.autoScan')}
        </label>
      </div>
      {progress && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-card2">
          <div className="h-full bg-accent transition-[width]" style={{ width: `${(progress[0] / progress[1]) * 100}%` }} />
        </div>
      )}
      {error && (
        <div className="mt-2">
          <ErrorBox onRetry={scan} />
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-1">
        {(['any', ...KINDS] as const).map((k) => (
          <button key={k} onClick={() => setFilter(k)} aria-pressed={filter === k} className={`rounded-full border px-2 py-0.5 text-[11px] ${filter === k ? 'border-accent bg-accent/15 text-accent' : 'border-line text-muted'}`}>
            {k === 'any' ? t('x.all') : t(`x.sig.${k}` as Key)} ({k === 'any' ? rows.filter((r) => r.signals.length).length : rows.filter((r) => r.signals.some((s) => s.kind === k)).length})
          </button>
        ))}
      </div>
      {at > 0 && <p className="mt-2 text-[11px] text-muted">{t('x.scanned', { n: rows.length, tf, time: ago(at, lang) })}</p>}
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-muted">
            <tr>
              <th className="py-1 text-left font-normal">{t('x.market')}</th>
              <th className="text-right font-normal">{t('t.price')}</th>
              <th className="text-right font-normal">24h</th>
              <th className="pl-3 text-left font-normal">{t('x.signals')}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.sym} className="border-t border-line">
                <td className="py-1.5 font-semibold">{r.sym.replace(/USDT$/, '')}</td>
                <td className="num text-right">{num(r.last, lang, r.last < 1 ? 5 : r.last < 100 ? 3 : 2)}</td>
                <td className={`num text-right ${r.change >= 0 ? 'text-up' : 'text-down'}`}>{pct(r.change, lang)}</td>
                <td className="pl-3">
                  <span className="flex flex-wrap gap-1">
                    {r.signals.map((s, i) => (
                      <span key={i} className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${BULL.has(s.kind) ? 'bg-up/15 text-up' : 'bg-down/15 text-down'}`}>
                        {t(`x.sig.${s.kind}` as Key)}
                        {s.detail ? ` · ${s.detail}` : ''}
                      </span>
                    ))}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!shown.length && !progress && <p className="py-6 text-center text-xs text-muted">{rows.length ? t('x.noSignals') : t('x.scanFirst')}</p>}
      </div>
      <p className="mt-2 text-[11px] text-muted">{t('x.sigNote')}</p>
    </Card>
  );
}
