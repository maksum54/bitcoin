import { useState } from 'react';
import { Btn, Card, ErrorBox, Loading, Stat, Updated, useAsync } from '../components/ui';
import {
  balanceSats,
  classifyQuery,
  getAddress,
  getAddressTxs,
  getBlock,
  getBlockHash,
  getNetwork,
  getRecentBlocks,
  getTx,
  txDelta,
  type AddressInfo,
  type Block,
  type MTx,
} from '../lib/api';
import { halving } from '../lib/calc';
import { ago, btc, dateOnly, dateTime, idr, num, pct, short } from '../lib/format';
import { useApp } from '../lib/i18n';
import { usePrice } from '../lib/price';
import { useStored } from '../lib/storage';

interface Watch {
  addr: string;
  label?: string;
}

type Result =
  | { kind: 'address'; info: AddressInfo; txs: MTx[] }
  | { kind: 'tx'; tx: MTx }
  | { kind: 'block'; block: Block };

const sats = (v: number) => v / 1e8;
const MS = 'https://mempool.space';

export default function Explorer() {
  const { t } = useApp();
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState<Result | null>(null);

  const search = async (input = q) => {
    const parsed = classifyQuery(input);
    setErr('');
    setResult(null);
    if (!parsed) return setErr(t('e.invalid'));
    setBusy(true);
    try {
      if (parsed.kind === 'address') {
        const [info, txs] = await Promise.all([getAddress(parsed.value), getAddressTxs(parsed.value)]);
        setResult({ kind: 'address', info, txs });
      } else if (parsed.kind === 'tx') {
        setResult({ kind: 'tx', tx: await getTx(parsed.value) });
      } else {
        const hash = parsed.kind === 'height' ? await getBlockHash(Number(parsed.value)) : parsed.value;
        setResult({ kind: 'block', block: await getBlock(hash) });
      }
    } catch (e) {
      setErr(String(e).includes('notfound') ? t('e.notFound') : t('error'));
    } finally {
      setBusy(false);
    }
  };
  const open = (v: string) => {
    setQ(v);
    search(v);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="grid min-w-0 content-start gap-4 lg:col-span-2">
        <Card>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              search();
            }}
          >
            <input className="min-w-0 flex-1" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('e.searchPh')} spellCheck={false} autoCapitalize="off" />
            <Btn type="submit" disabled={busy} className="shrink-0">
              {t('e.search')}
            </Btn>
          </form>
          {busy && <Loading />}
          {err && <p className="mt-3 text-sm text-down">{err}</p>}
          {result?.kind === 'address' && <AddressView info={result.info} txs={result.txs} onOpen={open} />}
          {result?.kind === 'tx' && <TxView tx={result.tx} onOpen={open} />}
          {result?.kind === 'block' && <BlockView block={result.block} />}
        </Card>
        <Network onOpen={open} />
      </div>
      <WatchList onOpen={open} />
    </div>
  );
}

function Network({ onOpen }: { onOpen: (v: string) => void }) {
  const { t, lang } = useApp();
  const net = useAsync(getNetwork, [], 60_000);
  const blocks = useAsync(getRecentBlocks, [], 60_000);
  if (net.error && !net.data) return <ErrorBox onRetry={net.reload} />;
  if (!net.data) return <Loading />;
  const n = net.data;
  const h = halving(n.height);
  return (
    <Card title={t('e.network')} right={<Updated at={n.at} stale={n.stale} />}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label={t('e.height')} value={num(n.height, lang)} />
        <Stat label={t('e.mempool')} value={t('e.unconfirmed', { n: num(n.mempool.count, lang) })} sub={`${num(n.mempool.vsize / 1e6, lang, 1)} MvB`} />
        <Stat label={t('e.hashrate')} value={`${num(n.hashrate / 1e18, lang, 0)} EH/s`} />
        <Stat
          label={t('e.diff')}
          value={pct(n.diff.difficultyChange, lang)}
          tone={n.diff.difficultyChange >= 0 ? 'up' : 'down'}
          sub={t('e.diffIn', { pct: `${num(n.diff.progressPercent, lang, 0)}%`, n: num(n.diff.remainingBlocks, lang) })}
        />
        <div className="col-span-2">
          <Stat label={t('e.halving')} value={`#${num(h.next, lang)}`} sub={`${t('e.halvingIn', { n: num(h.blocksLeft, lang), date: dateOnly(h.eta, lang) })} · ${t('e.subsidy', { n: h.nextSubsidy })}`} />
        </div>
      </div>
      <h3 className="mt-4 mb-2 text-xs text-muted">{t('e.fees')}</h3>
      <div className="grid grid-cols-4 gap-2 text-center">
        {[
          [t('e.fast'), n.fees.fastestFee],
          [t('e.halfHour'), n.fees.halfHourFee],
          [t('e.hour'), n.fees.hourFee],
          [t('e.economy'), n.fees.economyFee],
        ].map(([label, v]) => (
          <div key={label} className="rounded-xl bg-card2 p-2">
            <div className="truncate text-xs text-muted">{label}</div>
            <div className="num font-semibold">{v}</div>
          </div>
        ))}
      </div>
      {blocks.data && (
        <>
          <h3 className="mt-4 mb-2 text-xs text-muted">{t('e.recentBlocks')}</h3>
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
            {blocks.data.data.slice(0, 8).map((b) => (
              <button key={b.id} onClick={() => onOpen(String(b.height))} className="min-w-28 shrink-0 rounded-xl border border-line bg-card2 p-2 text-left text-xs hover:border-accent">
                <div className="num font-semibold text-accent">#{num(b.height, lang)}</div>
                <div className="text-muted">{t('e.txs', { n: num(b.tx_count, lang) })}</div>
                <div className="truncate text-muted">{b.extras?.pool?.name ?? ''}</div>
                <div className="text-muted">{ago(b.timestamp * 1000, lang)}</div>
              </button>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

function AddressView({ info, txs, onOpen }: { info: AddressInfo; txs: MTx[]; onOpen: (v: string) => void }) {
  const { t, lang } = useApp();
  const { price } = usePrice();
  const [watch, setWatch] = useStored<Watch[]>('watch', []);
  const watched = watch.some((w) => w.addr === info.address);
  const bal = sats(balanceSats(info));
  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <code className="break-all text-sm">{info.address}</code>
        <Btn
          kind={watched ? 'ghost' : 'primary'}
          onClick={() => setWatch(watched ? watch.filter((w) => w.addr !== info.address) : [...watch, { addr: info.address }])}
        >
          {watched ? t('e.unwatch') : `👁 ${t('e.watch')}`}
        </Btn>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label={t('e.balance')} value={btc(bal, lang)} sub={price ? idr(bal * price.idr, lang) : undefined} />
        <Stat label={t('e.txCount')} value={num(info.chain_stats.tx_count + info.mempool_stats.tx_count, lang)} />
        <Stat label={t('e.received')} value={btc(sats(info.chain_stats.funded_txo_sum + info.mempool_stats.funded_txo_sum), lang)} />
      </div>
      <h3 className="mt-4 mb-1 text-xs text-muted">{t('e.recentTx')}</h3>
      <ul className="divide-y divide-line text-sm">
        {txs.slice(0, 25).map((tx) => {
          const d = sats(txDelta(tx, info.address));
          return (
            <li key={tx.txid} className="flex items-center justify-between gap-2 py-2">
              <button className="min-w-0 text-left hover:text-accent" onClick={() => onOpen(tx.txid)}>
                <code className="block truncate text-xs">{short(tx.txid, 10)}</code>
                <span className="text-xs text-muted">
                  {tx.status.confirmed && tx.status.block_time ? dateTime(tx.status.block_time * 1000, lang) : t('e.unconfirmedOne')}
                </span>
              </button>
              <span className={`num shrink-0 font-medium ${d >= 0 ? 'text-up' : 'text-down'}`}>
                {d >= 0 ? '+' : ''}
                {num(d, lang, 8)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function TxView({ tx, onOpen }: { tx: MTx; onOpen: (v: string) => void }) {
  const { t, lang } = useApp();
  const total = sats(tx.vout.reduce((s, v) => s + v.value, 0));
  const vsize = Math.ceil(tx.weight / 4);
  return (
    <div className="mt-4">
      <code className="break-all text-sm">{tx.txid}</code>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat
          label={tx.status.confirmed ? t('e.confirmed') : t('e.unconfirmedOne')}
          value={tx.status.block_height ? `${t('e.block')} #${num(tx.status.block_height, lang)}` : '–'}
          tone={tx.status.confirmed ? 'up' : null}
        />
        <Stat label={t('e.time')} value={tx.status.block_time ? dateTime(tx.status.block_time * 1000, lang) : '–'} />
        <Stat label="Total" value={btc(total, lang)} />
        <Stat label={t('e.fee')} value={`${num(tx.fee, lang)} sats`} sub={`${num(tx.fee / vsize, lang, 1)} sat/vB`} />
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <IoList
          title={`${t('e.inputs')} (${tx.vin.length})`}
          items={tx.vin.map((v) => (v.is_coinbase ? { label: t('e.coinbase'), value: 0 } : { addr: v.prevout?.scriptpubkey_address, value: v.prevout?.value ?? 0 }))}
          onOpen={onOpen}
        />
        <IoList title={`${t('e.outputs')} (${tx.vout.length})`} items={tx.vout.map((v) => ({ addr: v.scriptpubkey_address, value: v.value }))} onOpen={onOpen} />
      </div>
      <a className="mt-3 inline-block text-sm text-accent" href={`${MS}/tx/${tx.txid}`} target="_blank" rel="noreferrer">
        {t('e.open')} ↗
      </a>
    </div>
  );
}

function IoList({ title, items, onOpen }: { title: string; items: { addr?: string; label?: string; value: number }[]; onOpen: (v: string) => void }) {
  const { lang } = useApp();
  return (
    <div>
      <h3 className="mb-1 text-xs text-muted">{title}</h3>
      <ul className="divide-y divide-line rounded-xl bg-card2 px-3 text-xs">
        {items.slice(0, 20).map((it, i) => (
          <li key={i} className="flex justify-between gap-2 py-1.5">
            {it.addr ? (
              <button className="truncate text-left hover:text-accent" onClick={() => onOpen(it.addr!)}>
                {short(it.addr, 8)}
              </button>
            ) : (
              <span className="text-muted">{it.label ?? 'OP_RETURN / ?'}</span>
            )}
            <span className="num shrink-0">{num(sats(it.value), lang, 8)}</span>
          </li>
        ))}
        {items.length > 20 && <li className="py-1.5 text-muted">+{items.length - 20}</li>}
      </ul>
    </div>
  );
}

function BlockView({ block }: { block: Block }) {
  const { t, lang } = useApp();
  return (
    <div className="mt-4">
      <div className="text-lg font-semibold text-accent">
        {t('e.block')} #{num(block.height, lang)}
      </div>
      <code className="block break-all text-xs text-muted">{block.id}</code>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label={t('e.time')} value={dateTime(block.timestamp * 1000, lang)} />
        <Stat label="Tx" value={num(block.tx_count, lang)} />
        <Stat label="Size" value={`${num(block.size / 1e6, lang, 2)} MB`} />
        <Stat label="Pool" value={block.extras?.pool?.name ?? '–'} sub={block.extras?.totalFees ? `${t('e.fee')}: ${btc(sats(block.extras.totalFees), lang)}` : undefined} />
      </div>
      <a className="mt-3 inline-block text-sm text-accent" href={`${MS}/block/${block.id}`} target="_blank" rel="noreferrer">
        {t('e.open')} ↗
      </a>
    </div>
  );
}

function WatchList({ onOpen }: { onOpen: (v: string) => void }) {
  const { t, lang } = useApp();
  const { price } = usePrice();
  const [watch, setWatch] = useStored<Watch[]>('watch', []);
  const balances = useAsync(
    async () => {
      const res = await Promise.allSettled(watch.map((w) => getAddress(w.addr)));
      return Object.fromEntries(res.map((r, i) => [watch[i].addr, r.status === 'fulfilled' ? sats(balanceSats(r.value)) : null]));
    },
    [watch.map((w) => w.addr).join(',')],
    5 * 60_000,
  );
  const total = Object.values(balances.data ?? {}).reduce<number>((s, v) => s + (v ?? 0), 0);
  return (
    <Card title={t('e.watchlist')}>
      {watch.length === 0 ? (
        <p className="text-sm text-muted">{t('e.watchEmpty')}</p>
      ) : (
        <>
          <ul className="divide-y divide-line text-sm">
            {watch.map((w) => {
              const b = balances.data?.[w.addr];
              return (
                <li key={w.addr} className="py-2">
                  <div className="flex items-center justify-between gap-2">
                    <button className="min-w-0 truncate text-left font-mono text-xs hover:text-accent" onClick={() => onOpen(w.addr)}>
                      {short(w.addr, 8)}
                    </button>
                    <span className="num shrink-0">{b == null ? '…' : num(b, lang, 8)}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <input
                      className="!py-1 text-xs"
                      placeholder={t('e.label')}
                      value={w.label ?? ''}
                      maxLength={40}
                      onChange={(e) => setWatch(watch.map((x) => (x.addr === w.addr ? { ...x, label: e.target.value } : x)))}
                    />
                    <button className="px-2 text-muted hover:text-down" aria-label={t('e.unwatch')} onClick={() => setWatch(watch.filter((x) => x.addr !== w.addr))}>
                      ✕
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="mt-3 rounded-xl bg-card2 p-3">
            <div className="text-xs text-muted">Total</div>
            <div className="num font-semibold">{btc(total, lang)}</div>
            {price && <div className="num text-xs text-muted">{idr(total * price.idr, lang)}</div>}
          </div>
        </>
      )}
      <p className="mt-3 text-xs text-muted">⚠️ {t('e.watchNote')}</p>
    </Card>
  );
}

