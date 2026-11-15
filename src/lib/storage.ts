import { useCallback, useEffect, useState } from 'react';

const PREFIX = 'btc.';

export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function save<T>(key: string, value: T): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
    window.dispatchEvent(new CustomEvent('btc-storage', { detail: key }));
  } catch {
    /* storage full or blocked: app keeps working in memory */
  }
}

/** useState persisted in localStorage, kept in sync across components and tabs. */
export function useStored<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => load(key, fallback));
  useEffect(() => {
    const sync = (e: Event) => {
      const k = e instanceof StorageEvent ? e.key?.slice(PREFIX.length) : (e as CustomEvent).detail;
      if (k === key) setValue(load(key, fallback));
    };
    window.addEventListener('btc-storage', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('btc-storage', sync);
      window.removeEventListener('storage', sync);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const set = useCallback(
    (v: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const next = typeof v === 'function' ? (v as (p: T) => T)(prev) : v;
        save(key, next);
        return next;
      });
    },
    [key],
  );
  return [value, set] as const;
}

/** Keys that make up the user's own data (for backup/restore). */
export const USER_KEYS = ['txs', 'plan', 'alerts', 'watch', 'lang', 'theme', 'ccy'];

export function exportBackup(): string {
  const data: Record<string, unknown> = { app: 'btc-nyicil', version: 1, exportedAt: new Date().toISOString() };
  for (const k of USER_KEYS) data[k] = load(k, null);
  return JSON.stringify(data, null, 2);
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const posNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > 0;
const isCcy = (v: unknown) => v === 'usd' || v === 'idr';

/** Shape checks per key, so a damaged or hand-edited file cannot break the app after a restore. */
const VALID: Record<string, (v: unknown) => boolean> = {
  txs: (v) =>
    Array.isArray(v) &&
    v.every(
      (x) =>
        isObj(x) &&
        typeof x.id === 'string' &&
        typeof x.date === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(x.date) &&
        (x.type === 'buy' || x.type === 'sell') &&
        posNum(x.btc) &&
        (posNum(x.price) ? isCcy(x.ccy) : posNum(x.priceIdr)),
    ),
  plan: (v) => isObj(v) && (posNum(v.monthly) || posNum(v.monthlyIdr)) && typeof v.startMonth === 'string' && /^\d{4}-\d{2}$/.test(v.startMonth) && posNum(v.months) && posNum(v.day),
  alerts: (v) => Array.isArray(v) && v.every((x) => isObj(x) && typeof x.id === 'string' && (x.dir === 'above' || x.dir === 'below') && (posNum(x.price) || posNum(x.priceIdr))),
  watch: (v) => Array.isArray(v) && v.every((x) => isObj(x) && typeof x.addr === 'string'),
  lang: (v) => v === 'id' || v === 'en',
  theme: (v) => v === 'dark' || v === 'light',
  ccy: isCcy,
};

/** Parses and checks a backup file. Throws when it is not a valid backup; nothing is written. */
export function parseBackup(text: string): Record<string, unknown> {
  const data = JSON.parse(text);
  if (!isObj(data) || data.app !== 'btc-nyicil') throw new Error('bad file');
  const out: Record<string, unknown> = {};
  for (const k of USER_KEYS) {
    if (data[k] == null) continue;
    if (!VALID[k](data[k])) throw new Error(`bad ${k}`);
    out[k] = data[k];
  }
  return out;
}

export function importBackup(text: string): void {
  const data = parseBackup(text);
  for (const k of Object.keys(data)) save(k, data[k]);
}
