/**
 * Paper trading on USDT-margined perpetuals with isolated margin. One position per
 * symbol (one-way mode). Market orders pay the taker fee, resting limits the maker fee.
 * A position is liquidated when the mark price reaches its liquidation price.
 */

export const PAPER_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'] as const;
export type PaperSymbol = (typeof PAPER_SYMBOLS)[number];

export const TAKER_FEE = 0.0005;
export const MAKER_FEE = 0.0002;
/** Maintenance margin rate used for the liquidation price. */
export const MMR = 0.004;
export const START_BALANCE = 100_000;

export interface PaperPos {
  qty: number; // signed: + long, − short (coins)
  entry: number;
  lev: number;
  margin: number;
  sl?: number;
  tp?: number;
}

export interface PaperOrder {
  id: string;
  sym: PaperSymbol;
  side: 'buy' | 'sell';
  price: number;
  qty: number; // coins, > 0
  lev: number;
  createdAt: number;
}

export interface Fill {
  id: string;
  sym: PaperSymbol;
  side: 'buy' | 'sell';
  price: number;
  qty: number;
  fee: number;
  pnl: number; // realised on the closed part
  reason: 'market' | 'limit' | 'sl' | 'tp' | 'liquidation' | 'close';
  t: number;
}

export interface PaperState {
  balance: number; // free USDT (margin in positions is held apart)
  positions: Partial<Record<PaperSymbol, PaperPos>>;
  orders: PaperOrder[];
  fills: Fill[];
}

export const newAccount = (): PaperState => ({ balance: START_BALANCE, positions: {}, orders: [], fills: [] });

let seq = 0;
const uid = () => `${Date.now().toString(36)}${(seq++).toString(36)}`;

export function liqPrice(p: PaperPos): number {
  if (!p.qty) return 0;
  return p.qty > 0 ? p.entry * (1 - 1 / p.lev + MMR) : p.entry * (1 + 1 / p.lev - MMR);
}

export const unrealised = (p: PaperPos, mark: number) => (mark - p.entry) * p.qty;

export function equity(s: PaperState, marks: Partial<Record<PaperSymbol, number>>): number {
  let e = s.balance;
  for (const [sym, p] of Object.entries(s.positions) as [PaperSymbol, PaperPos][]) e += p.margin + (marks[sym] != null ? unrealised(p, marks[sym]!) : 0);
  return e;
}

/**
 * Executes a fill of `qty` coins (buy > 0) at `price`. Reduces, closes or flips the
 * position, realising P&L on the closed part. Returns null if margin is not enough.
 */
export function execute(s: PaperState, sym: PaperSymbol, side: 'buy' | 'sell', qty: number, price: number, lev: number, fee: number, reason: Fill['reason'], t = Date.now()): PaperState | null {
  if (!(qty > 0) || !(price > 0)) return null;
  const signed = side === 'buy' ? qty : -qty;
  const pos = s.positions[sym];
  const positions = { ...s.positions };
  let balance = s.balance;
  let pnl = 0;
  const feeAmt = qty * price * fee;
  let openQty = signed;

  if (pos && Math.sign(pos.qty) !== Math.sign(signed)) {
    const closeQty = Math.min(Math.abs(pos.qty), qty);
    const frac = closeQty / Math.abs(pos.qty);
    pnl = (price - pos.entry) * closeQty * Math.sign(pos.qty);
    const freed = pos.margin * frac;
    balance += freed + pnl;
    const rest = pos.qty + Math.sign(signed) * closeQty;
    if (Math.abs(rest) < 1e-12) delete positions[sym];
    else positions[sym] = { ...pos, qty: rest, margin: pos.margin - freed };
    openQty = signed - Math.sign(signed) * closeQty;
  }

  if (Math.abs(openQty) > 1e-12) {
    const cur = positions[sym];
    const useLev = cur ? cur.lev : lev;
    const margin = (Math.abs(openQty) * price) / useLev;
    if (margin + feeAmt > balance + 1e-9) return null;
    balance -= margin;
    if (cur) {
      const q = cur.qty + openQty;
      positions[sym] = { ...cur, qty: q, entry: (cur.entry * Math.abs(cur.qty) + price * Math.abs(openQty)) / Math.abs(q), margin: cur.margin + margin };
    } else positions[sym] = { qty: openQty, entry: price, lev: useLev, margin };
  }

  balance -= feeAmt;
  const fill: Fill = { id: uid(), sym, side, price, qty, fee: feeAmt, pnl, reason, t };
  return { ...s, balance, positions, fills: [fill, ...s.fills].slice(0, 500) };
}

export function placeLimit(s: PaperState, o: Omit<PaperOrder, 'id' | 'createdAt'>, t = Date.now()): PaperState {
  return { ...s, orders: [...s.orders, { ...o, id: uid(), createdAt: t }] };
}

export const cancelOrder = (s: PaperState, id: string): PaperState => ({ ...s, orders: s.orders.filter((o) => o.id !== id) });

export function setBrackets(s: PaperState, sym: PaperSymbol, sl?: number, tp?: number): PaperState {
  const p = s.positions[sym];
  if (!p) return s;
  return { ...s, positions: { ...s.positions, [sym]: { ...p, sl: sl || undefined, tp: tp || undefined } } };
}

export function closePosition(s: PaperState, sym: PaperSymbol, price: number, reason: Fill['reason'] = 'close', t = Date.now()): PaperState {
  const p = s.positions[sym];
  if (!p) return s;
  return execute(s, sym, p.qty > 0 ? 'sell' : 'buy', Math.abs(p.qty), price, p.lev, TAKER_FEE, reason, t) ?? s;
}

/**
 * Applies a new mark price: liquidations first, then stop / target, then resting
 * limit orders that the price crossed (filled at their limit).
 */
export function onPrice(s: PaperState, sym: PaperSymbol, mark: number, t = Date.now()): PaperState {
  let st = s;
  const p = st.positions[sym];
  if (p) {
    const liq = liqPrice(p);
    const long = p.qty > 0;
    if (long ? mark <= liq : mark >= liq) {
      // The whole margin is lost; no P&L beyond it.
      const positions = { ...st.positions };
      delete positions[sym];
      const fill: Fill = { id: uid(), sym, side: long ? 'sell' : 'buy', price: liq, qty: Math.abs(p.qty), fee: 0, pnl: -p.margin, reason: 'liquidation', t };
      st = { ...st, positions, fills: [fill, ...st.fills].slice(0, 500) };
    } else if (p.sl && (long ? mark <= p.sl : mark >= p.sl)) st = closePosition(st, sym, mark, 'sl', t);
    else if (p.tp && (long ? mark >= p.tp : mark <= p.tp)) st = closePosition(st, sym, mark, 'tp', t);
  }
  for (const o of st.orders) {
    if (o.sym !== sym) continue;
    const hit = o.side === 'buy' ? mark <= o.price : mark >= o.price;
    if (!hit) continue;
    const next = execute(cancelOrder(st, o.id), sym, o.side, o.qty, o.price, o.lev, MAKER_FEE, 'limit', t);
    st = next ?? cancelOrder(st, o.id);
  }
  return st;
}
