export interface Tx {
  id: string;
  date: string; // YYYY-MM-DD
  type: 'buy' | 'sell';
  btc: number;
  priceIdr: number; // price per 1 BTC
  feeIdr: number;
  note?: string;
}

export interface PortfolioSummary {
  btc: number;
  costBasis: number; // IDR still "in" the position (average-cost method)
  avgPrice: number;
  value: number;
  unrealized: number;
  unrealizedPct: number;
  realized: number;
  totalIn: number; // all money spent on buys incl. fees
  totalOut: number; // all money received from sells net of fees
  fees: number;
}

/** Average-cost method: a sale removes cost in proportion to the BTC sold. */
export function computePortfolio(txs: Tx[], priceIdr: number): PortfolioSummary {
  const sorted = [...txs].sort((a, b) => a.date.localeCompare(b.date));
  let held = 0;
  let cost = 0;
  let realized = 0;
  let totalIn = 0;
  let totalOut = 0;
  let fees = 0;
  for (const t of sorted) {
    fees += t.feeIdr;
    if (t.type === 'buy') {
      const spent = t.btc * t.priceIdr + t.feeIdr;
      held += t.btc;
      cost += spent;
      totalIn += spent;
    } else {
      const qty = Math.min(t.btc, held);
      if (qty <= 0) continue;
      const avg = cost / held;
      const proceeds = qty * t.priceIdr - t.feeIdr;
      realized += proceeds - avg * qty;
      cost -= avg * qty;
      held -= qty;
      totalOut += proceeds;
    }
  }
  if (held < 1e-12) {
    held = 0;
    cost = 0;
  }
  const value = held * priceIdr;
  const unrealized = value - cost;
  return {
    btc: held,
    costBasis: cost,
    avgPrice: held > 0 ? cost / held : 0,
    value,
    unrealized,
    unrealizedPct: cost > 0 ? (unrealized / cost) * 100 : 0,
    realized,
    totalIn,
    totalOut,
    fees,
  };
}

export interface PricePoint {
  t: number; // ms
  p: number;
}

/** Last known price at or before t (history must be sorted ascending). */
export function priceAt(history: PricePoint[], t: number): number | null {
  let lo = 0;
  let hi = history.length - 1;
  let ans: number | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (history[mid].t <= t) {
      ans = history[mid].p;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

export interface DcaPoint {
  t: number;
  invested: number;
  btc: number;
  value: number;
}

export interface DcaResult {
  points: DcaPoint[];
  invested: number;
  btc: number;
  value: number;
  avgPrice: number;
  roiPct: number;
  lumpSumValue: number;
  lumpSumRoiPct: number;
}

/** Monthly DCA backtest: buy `amount` on day `day` of each month from start to end. */
export function backtestDca(history: PricePoint[], amount: number, startMs: number, endMs: number, day = 1, feePct = 0): DcaResult | null {
  if (!history.length || amount <= 0) return null;
  const s = new Date(startMs);
  let y = s.getFullYear();
  let m = s.getMonth();
  if (s.getDate() > day) m += 1;
  let invested = 0;
  let held = 0;
  const points: DcaPoint[] = [];
  for (;;) {
    const d = new Date(y, m, Math.min(day, 28));
    const t = d.getTime();
    if (t > endMs) break;
    const p = priceAt(history, t);
    if (p) {
      invested += amount;
      held += (amount * (1 - feePct / 100)) / p;
      points.push({ t, invested, btc: held, value: held * p });
    }
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }
  if (!points.length) return null;
  const last = priceAt(history, endMs) ?? history[history.length - 1].p;
  const value = held * last;
  const firstP = priceAt(history, points[0].t)!;
  const lumpSumValue = ((invested * (1 - feePct / 100)) / firstP) * last;
  return {
    points,
    invested,
    btc: held,
    value,
    avgPrice: invested / held,
    roiPct: ((value - invested) / invested) * 100,
    lumpSumValue,
    lumpSumRoiPct: ((lumpSumValue - invested) / invested) * 100,
  };
}

export interface Plan {
  monthlyIdr: number;
  startMonth: string; // YYYY-MM
  months: number;
  day: number;
  feePct: number;
}

export interface Projection {
  label: string;
  annualPct: number;
  invested: number;
  btc: number;
  endPrice: number;
  value: number;
  roiPct: number;
}

/** Projects a plan if the price moves by a constant annual rate from today's price. Not a forecast. */
export function projectPlan(plan: Plan, priceNow: number, annualPct: number, label: string): Projection {
  const monthly = Math.pow(1 + annualPct / 100, 1 / 12);
  const [sy, sm] = plan.startMonth.split('-').map(Number);
  const now = new Date();
  const monthsUntilStart = Math.max(0, (sy - now.getFullYear()) * 12 + (sm - 1 - now.getMonth()));
  let btcHeld = 0;
  let price = priceNow * Math.pow(monthly, monthsUntilStart);
  for (let i = 0; i < plan.months; i++) {
    btcHeld += (plan.monthlyIdr * (1 - plan.feePct / 100)) / price;
    if (i < plan.months - 1) price *= monthly;
  }
  const invested = plan.monthlyIdr * plan.months;
  const value = btcHeld * price;
  return { label, annualPct, invested, btc: btcHeld, endPrice: price, value, roiPct: ((value - invested) / invested) * 100 };
}

/** The months of a plan as YYYY-MM strings. */
export function planMonths(plan: Plan): string[] {
  const [y, m] = plan.startMonth.split('-').map(Number);
  return Array.from({ length: plan.months }, (_, i) => {
    const d = new Date(y, m - 1 + i, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
}

export const HALVING_INTERVAL = 210_000;

export function halving(height: number) {
  const next = Math.ceil((height + 1) / HALVING_INTERVAL) * HALVING_INTERVAL;
  const blocksLeft = next - height;
  const subsidy = 50 / Math.pow(2, next / HALVING_INTERVAL);
  return { next, blocksLeft, eta: new Date(Date.now() + blocksLeft * 10 * 60_000), nextSubsidy: subsidy };
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
