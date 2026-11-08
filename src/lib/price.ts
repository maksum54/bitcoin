import { createContext, useContext } from 'react';
import type { Price } from './api';

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
  priceIdr: number;
  active: boolean;
  firedAt?: number;
}

/** Returns the alerts that should fire for the given price. */
export const dueAlerts = (alerts: Alert[], priceIdr: number) =>
  alerts.filter((a) => a.active && (a.dir === 'above' ? priceIdr >= a.priceIdr : priceIdr <= a.priceIdr));
