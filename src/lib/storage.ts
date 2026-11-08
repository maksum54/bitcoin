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

export function importBackup(text: string): void {
  const data = JSON.parse(text);
  if (data?.app !== 'btc-nyicil') throw new Error('bad file');
  for (const k of USER_KEYS) if (data[k] != null) save(k, data[k]);
}
