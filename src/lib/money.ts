import { compact, idr, usd, type Lang } from './format';

export type Ccy = 'usd' | 'idr';
export const CCYS: Ccy[] = ['usd', 'idr'];
export const CCY_LABEL: Record<Ccy, string> = { usd: 'USD', idr: 'IDR' };

/** Full money format. USD keeps cents for small amounts, IDR never shows decimals. */
export function money(v: number, ccy: Ccy, lang: Lang, digits?: number): string {
  if (ccy === 'usd') return usd(v, lang, digits ?? (Math.abs(v) < 10_000 ? 2 : 0));
  return idr(v, lang, digits ?? 0);
}

export const compactMoney = (v: number, ccy: Ccy, lang: Lang) => `${ccy === 'usd' ? '$' : 'Rp '}${compact(v, lang)}`;

/** Converts between currencies with `fx` = IDR per 1 USD. */
export function convert(v: number, from: Ccy, to: Ccy, fx: number): number {
  if (from === to) return v;
  return from === 'usd' ? v * fx : v / fx;
}

/** Rounds a converted amount to something a person would type. */
export function roundNice(v: number, ccy: Ccy): number {
  if (ccy === 'usd') return v >= 100 ? Math.round(v) : Math.round(v * 100) / 100;
  return Math.round(v / 1000) * 1000;
}
