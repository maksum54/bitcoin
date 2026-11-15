import { uid, type Tx } from './calc';

const COLS = ['date', 'type', 'btc', 'price', 'fee', 'currency', 'note'] as const;

const cell = (v: string | number) => {
  // Leading = + - @ would run as a formula when the file is opened in a spreadsheet.
  const s = typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? `'${v}` : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function txsToCsv(txs: Tx[]): string {
  const rows = [...txs]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((x) => [x.date, x.type, x.btc, x.price, x.fee, x.ccy.toUpperCase(), x.note ?? ''].map(cell).join(','));
  return [COLS.join(','), ...rows].join('\n') + '\n';
}

/** Splits CSV text into rows of cells; handles quotes, escaped quotes and "," or ";" delimiters. */
function parseRows(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const first = src.split(/\r?\n/, 1)[0] ?? '';
  const delim = first.split(';').length > first.split(',').length ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) {
      row.push(cur);
      cur = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cur);
      rows.push(row);
      row = [];
      cur = '';
    } else cur += c;
  }
  if (cur !== '' || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

const HEAD: Record<string, (typeof COLS)[number]> = {
  date: 'date', tanggal: 'date',
  type: 'type', side: 'type', tipe: 'type', jenis: 'type',
  btc: 'btc', amount: 'btc', jumlah: 'btc', quantity: 'btc',
  price: 'price', harga: 'price',
  fee: 'fee', biaya: 'fee',
  currency: 'currency', ccy: 'currency', 'mata uang': 'currency',
  note: 'note', notes: 'note', catatan: 'note',
};

export interface CsvResult {
  txs: Tx[];
  /** 1-based line numbers (header = 1) that could not be read. */
  skipped: number[];
}

/**
 * Reads transactions from CSV with a header row: date (YYYY-MM-DD), type (buy/sell), btc, price, and
 * optionally fee, currency (USD/IDR, default USD) and note. Numbers use "." as the decimal mark.
 */
export function csvToTxs(text: string): CsvResult {
  const rows = parseRows(text);
  if (rows.length < 2) throw new Error('empty');
  const idx: Partial<Record<(typeof COLS)[number], number>> = {};
  rows[0].forEach((h, i) => {
    const k = HEAD[h.trim().toLowerCase()];
    if (k && idx[k] == null) idx[k] = i;
  });
  if (idx.date == null || idx.type == null || idx.btc == null || idx.price == null) throw new Error('header');
  const get = (r: string[], k: (typeof COLS)[number]) => (idx[k] == null ? '' : (r[idx[k]!] ?? '').trim());
  const txs: Tx[] = [];
  const skipped: number[] = [];
  rows.slice(1).forEach((r, i) => {
    const date = get(r, 'date').slice(0, 10);
    const type = { buy: 'buy', beli: 'buy', sell: 'sell', jual: 'sell' }[get(r, 'type').toLowerCase()] as Tx['type'] | undefined;
    const btc = Number(get(r, 'btc'));
    const price = Number(get(r, 'price'));
    const fee = Number(get(r, 'fee') || 0);
    const ccy = (get(r, 'currency') || 'usd').toLowerCase();
    const okDate = /^\d{4}-\d{2}-\d{2}$/.test(date) && !isNaN(new Date(`${date}T00:00:00`).getTime());
    if (!okDate || !type || !(btc > 0) || !(price > 0) || !(fee >= 0) || (ccy !== 'usd' && ccy !== 'idr')) return void skipped.push(i + 2);
    const note = get(r, 'note').replace(/^'(?=[=+\-@])/, '').slice(0, 80);
    txs.push({ id: uid(), date, type, btc, price, fee, ccy, note: note || undefined });
  });
  return { txs, skipped };
}

/** Same trade already recorded? Used to make re-importing a file harmless. */
export const sameTx = (a: Tx, b: Tx) => a.date === b.date && a.type === b.type && a.ccy === b.ccy && Math.abs(a.btc - b.btc) < 1e-9 && Math.abs(a.price - b.price) < 1e-6;
