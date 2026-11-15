import type { Lang } from './format';

/**
 * Money input in either currency. "1.000.000", "1,000,000" and "1000000" all mean one million,
 * and "100,50" / "100.50" are both 100.5.
 *
 * A single separator followed by exactly three digits is ambiguous ("12.345"): it is read as a
 * thousands separator only when it is the grouping character of the UI language (the same one the
 * app prints numbers with), and never after a leading zero — so "0.125" is always a fraction.
 */
export function parseMoney(s: string, lang: Lang = 'id'): number {
  let n = s.replace(/[\s ]/g, '').replace(/^(rp|us\$|\$)/i, '');
  if (!/^-?[\d.,]*\d[\d.,]*$/.test(n)) return NaN;
  const dots = n.split('.').length - 1;
  const commas = n.split(',').length - 1;
  if (dots && commas) {
    // Both present: the last one is the decimal mark, the other groups thousands.
    const dec = n.lastIndexOf('.') > n.lastIndexOf(',') ? '.' : ',';
    n = n.split(dec === '.' ? ',' : '.').join('');
    if (n.split(dec).length > 2) return NaN;
    n = n.replace(dec, '.');
  } else if (dots + commas > 1) {
    n = n.replace(/[.,]/g, '');
  } else if (dots + commas === 1) {
    const sep = dots ? '.' : ',';
    const [int, frac] = n.split(sep);
    const group = lang === 'id' ? '.' : ',';
    const thousands = frac.length === 3 && sep === group && /[1-9]/.test(int);
    n = thousands ? int + frac : `${int}.${frac}`;
  }
  const v = Number(n);
  return Number.isFinite(v) ? v : NaN;
}

/** BTC input: "0,005" and "0.005" are both decimals. */
export function parseBtc(s: string): number {
  const n = s.replace(/\s/g, '').replace(',', '.');
  const v = Number(n);
  return n !== '' && Number.isFinite(v) ? v : NaN;
}
