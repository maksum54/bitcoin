import { fetchJson } from './http.js';

/**
 * Small list of publicly attributed addresses. Attribution comes from public
 * explorers/research and can be wrong or outdated — shown as a hint only.
 */
export const KNOWN: Record<string, { name: string; exchange: boolean }> = {
  '34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo': { name: 'Binance (cold)', exchange: true },
  bc1qm34lsc65zpw79lxes69zkqmk6ee3ewf0j77s3h: { name: 'Binance (cold)', exchange: true },
  bc1qgdjqv0av3q56jvd82tkdjpy7gdp9ut8tlqmgrpmv24sq90ecnvqqjwvw97: { name: 'Bitfinex (cold)', exchange: true },
  bc1ql49ydapnjafl5t2cp9zqpjwe6pdgmxy98859v2: { name: 'Robinhood', exchange: true },
  '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa': { name: 'Genesis (Satoshi)', exchange: false },
};

interface BciOut { addr?: string; value: number }
interface BciTx {
  hash: string;
  time: number;
  inputs: { prev_out?: BciOut }[];
  out: BciOut[];
}

export type WhaleFlow = 'exchange_in' | 'exchange_out' | 'exchange_internal' | 'unknown';

export interface WhaleTx {
  txid: string;
  time: string;
  btc: number;
  confirmed: boolean;
  height: number | null;
  from: { addr: string; label?: string }[];
  to: { addr: string; btc: number; label?: string }[];
  flow: WhaleFlow;
}

const SATS = 1e8;

export function toWhale(tx: BciTx, minBtc: number, confirmed: boolean, height: number | null): WhaleTx | null {
  if (!tx.inputs?.length || !tx.inputs[0].prev_out) return null; // coinbase
  const total = tx.out.reduce((s, o) => s + (o.value || 0), 0) / SATS;
  if (total < minBtc) return null;
  const inAddrs = [...new Set(tx.inputs.map((i) => i.prev_out?.addr).filter(Boolean) as string[])];
  const outs = [...tx.out].sort((a, b) => b.value - a.value);
  const inEx = inAddrs.some((a) => KNOWN[a]?.exchange);
  const outEx = outs.some((o) => o.addr && KNOWN[o.addr]?.exchange);
  const flow: WhaleFlow = inEx && outEx ? 'exchange_internal' : outEx ? 'exchange_in' : inEx ? 'exchange_out' : 'unknown';
  return {
    txid: tx.hash,
    time: new Date(tx.time * 1000).toISOString(),
    btc: Math.round(total * 1e4) / 1e4,
    confirmed,
    height,
    from: inAddrs.slice(0, 3).map((a) => ({ addr: a, label: KNOWN[a]?.name })),
    to: outs.slice(0, 3).map((o) => ({
      addr: o.addr ?? '(non-standard)',
      btc: Math.round((o.value / SATS) * 1e4) / 1e4,
      label: o.addr ? KNOWN[o.addr]?.name : undefined,
    })),
    flow,
  };
}

export async function getWhales(minBtc = 100) {
  const [latest, mempool] = await Promise.allSettled([
    (async () => {
      const tip = await fetchJson<{ hash: string; height: number }>('https://blockchain.info/latestblock');
      const block = await fetchJson<{ tx: BciTx[]; height: number }>(`https://blockchain.info/rawblock/${tip.hash}`, 25_000);
      return block.tx.map((t) => toWhale(t, minBtc, true, block.height ?? tip.height));
    })(),
    (async () => {
      const u = await fetchJson<{ txs: BciTx[] }>('https://blockchain.info/unconfirmed-transactions?format=json');
      return u.txs.map((t) => toWhale(t, minBtc, false, null));
    })(),
  ]);
  const items = [latest, mempool]
    .flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
    .filter((x): x is WhaleTx => x !== null)
    .sort((a, b) => b.btc - a.btc)
    .slice(0, 50);
  return {
    items,
    minBtc,
    failed: [latest, mempool].filter((r) => r.status === 'rejected').length,
    updatedAt: new Date().toISOString(),
  };
}
