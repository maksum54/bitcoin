import { load, save } from './storage';
import type { PricePoint } from './calc';

export interface Cached<T> {
  data: T;
  at: number; // when the data was fetched
  stale: boolean; // true when served from local cache because the network failed
}

/**
 * Network-first fetch. On success the result is kept in localStorage; when offline
 * or rate-limited the last good copy is returned with `stale: true`.
 */
export async function getCached<T>(key: string, url: string, timeoutMs = 12_000): Promise<Cached<T>> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as T;
    const entry = { data, at: Date.now() };
    save(`cache.${key}`, entry);
    return { ...entry, stale: false };
  } catch (e) {
    const prev = load<{ data: T; at: number } | null>(`cache.${key}`, null);
    if (prev) return { ...prev, stale: true };
    throw e;
  }
}

const CG = 'https://api.coingecko.com/api/v3';
const MP = 'https://mempool.space/api';

export interface Price {
  idr: number;
  usd: number;
  idr_24h_change: number;
  usd_24h_change: number;
  idr_market_cap: number;
  usd_market_cap: number;
  idr_24h_vol: number;
  usd_24h_vol: number;
  last_updated_at: number;
}

export async function getPrice() {
  const r = await getCached<{ bitcoin: Price }>(
    'price',
    `${CG}/simple/price?ids=bitcoin&vs_currencies=idr,usd&include_market_cap=true&include_24hr_vol=true&include_24hr_change=true&include_last_updated_at=true`,
  );
  return { ...r, data: r.data.bitcoin };
}

export async function getChart(days: number, vs: 'idr' | 'usd') {
  const r = await getCached<{ prices: [number, number][] }>(
    `chart.${vs}.${days}`,
    `${CG}/coins/bitcoin/market_chart?vs_currency=${vs}&days=${days}`,
  );
  return { ...r, data: r.data.prices.map(([t, p]) => ({ t, p })) as PricePoint[] };
}

/** Long daily USD history (back to 2010) for multi-year DCA backtests. */
export async function getLongHistoryUsd() {
  const r = await getCached<{ values: { x: number; y: number }[] }>(
    'history.usd',
    'https://api.blockchain.info/charts/market-price?timespan=all&sampled=true&format=json&cors=true',
    20_000,
  );
  return { ...r, data: r.data.values.filter((v) => v.y > 0).map((v) => ({ t: v.x * 1000, p: v.y })) as PricePoint[] };
}

// ---------- mempool.space ----------

export interface Fees {
  fastestFee: number;
  halfHourFee: number;
  hourFee: number;
  economyFee: number;
  minimumFee: number;
}
export interface DifficultyAdj {
  progressPercent: number;
  difficultyChange: number;
  estimatedRetargetDate: number;
  remainingBlocks: number;
}
export interface MempoolInfo {
  count: number;
  vsize: number;
  total_fee: number;
}

export async function getNetwork() {
  const [height, fees, diff, mempool, hash] = await Promise.all([
    getCached<number>('net.height', `${MP}/blocks/tip/height`),
    getCached<Fees>('net.fees', `${MP}/v1/fees/recommended`),
    getCached<DifficultyAdj>('net.diff', `${MP}/v1/difficulty-adjustment`),
    getCached<MempoolInfo>('net.mempool', `${MP}/mempool`),
    getCached<{ currentHashrate: number; currentDifficulty: number }>('net.hash', `${MP}/v1/mining/hashrate/3d`),
  ]);
  return {
    height: height.data,
    fees: fees.data,
    diff: diff.data,
    mempool: mempool.data,
    hashrate: hash.data.currentHashrate,
    difficulty: hash.data.currentDifficulty,
    at: Math.min(height.at, fees.at),
    stale: [height, fees, diff, mempool, hash].some((x) => x.stale),
  };
}

export interface AddressInfo {
  address: string;
  chain_stats: { funded_txo_sum: number; spent_txo_sum: number; tx_count: number };
  mempool_stats: { funded_txo_sum: number; spent_txo_sum: number; tx_count: number };
}
export interface MTx {
  txid: string;
  fee: number;
  weight: number;
  size: number;
  status: { confirmed: boolean; block_height?: number; block_time?: number };
  vin: { prevout?: { scriptpubkey_address?: string; value: number }; is_coinbase: boolean }[];
  vout: { scriptpubkey_address?: string; value: number }[];
}
export interface Block {
  id: string;
  height: number;
  timestamp: number;
  tx_count: number;
  size: number;
  weight: number;
  extras?: { reward?: number; totalFees?: number; pool?: { name: string } };
}

async function mp<T>(path: string): Promise<T> {
  const res = await fetch(`${MP}${path}`, { signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(res.status === 400 || res.status === 404 ? 'notfound' : `HTTP ${res.status}`);
  const ct = res.headers.get('content-type') ?? '';
  return (ct.includes('json') ? res.json() : res.text()) as Promise<T>;
}

export const getAddress = (a: string) => mp<AddressInfo>(`/address/${a}`);
export const getAddressTxs = (a: string) => mp<MTx[]>(`/address/${a}/txs`);
export const getTx = (id: string) => mp<MTx>(`/tx/${id}`);
export const getBlockHash = (h: number) => mp<string>(`/block-height/${h}`);
export const getBlock = (hash: string) => mp<Block>(`/v1/block/${hash}`);
export const getRecentBlocks = () => getCached<Block[]>('net.blocks', `${MP}/v1/blocks`);

export const balanceSats = (a: AddressInfo) =>
  a.chain_stats.funded_txo_sum - a.chain_stats.spent_txo_sum + a.mempool_stats.funded_txo_sum - a.mempool_stats.spent_txo_sum;

/** Net effect of a tx on an address, in sats. */
export function txDelta(tx: MTx, addr: string): number {
  const inSum = tx.vin.reduce((s, v) => s + (v.prevout?.scriptpubkey_address === addr ? v.prevout.value : 0), 0);
  const outSum = tx.vout.reduce((s, v) => s + (v.scriptpubkey_address === addr ? v.value : 0), 0);
  return outSum - inSum;
}

export type Query = { kind: 'address' | 'tx' | 'height' | 'blockhash'; value: string } | null;

export function classifyQuery(q: string): Query {
  const s = q.trim();
  if (!s) return null;
  if (/^\d{1,7}$/.test(s)) return { kind: 'height', value: s };
  if (/^0{8}[0-9a-f]{56}$/i.test(s)) return { kind: 'blockhash', value: s.toLowerCase() };
  if (/^[0-9a-f]{64}$/i.test(s)) return { kind: 'tx', value: s.toLowerCase() };
  if (/^(bc1[ac-hj-np-z02-9]{11,87}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/i.test(s)) return { kind: 'address', value: s };
  return null;
}

// ---------- own serverless API ----------

import type { NewsItem } from '../../server/news';
import type { WhaleTx } from '../../server/whales';
export type { NewsItem, WhaleTx };

export const getNews = () =>
  getCached<{ items: NewsItem[]; failed: number; sources: number; updatedAt: string }>('news', '/api/news', 25_000);
export const getWhales = (min: number) =>
  getCached<{ items: WhaleTx[]; failed: number; minBtc: number; updatedAt: string }>(`whales.${min}`, `/api/whales?min=${min}`, 40_000);
