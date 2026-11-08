import { createContext, useContext } from 'react';
import type { Price } from './api';
import type { Ccy } from './money';

export interface PriceState {
  price: Price | null;
  at?: number;
  stale?: boolean;
  error: unknown;
  reload: () => void;
}

export const PriceCtx = createContext<PriceState>({ price: null, error: null, reload: () => {} });
export const usePrice = () => useContext(PriceCtx);

export interface Alert {
  id: string;
  dir: 'above' | 'below';
  price: number; // target, in `ccy`
  ccy: Ccy;
  active: boolean;
  firedAt?: number;
}

/** Upgrades alerts saved before multi-currency support (they were always IDR). */
export function normalizeAlert(a: Alert | (Omit<Alert, 'price' | 'ccy'> & { priceIdr: number })): Alert {
  if ('priceIdr' in a) {
    const { priceIdr, ...rest } = a;
    return { ...rest, price: priceIdr, ccy: 'idr' };
  }
  return a;
}

/** Returns the alerts that should fire for the given price, each compared in its own currency. */
export const dueAlerts = (alerts: Alert[], price: Pick<Price, 'usd' | 'idr'>) =>
  alerts.filter((a) => a.active && (a.dir === 'above' ? price[a.ccy] >= a.price : price[a.ccy] <= a.price));
