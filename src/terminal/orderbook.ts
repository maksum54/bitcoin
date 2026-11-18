import type { Book, Level } from '../lib/terminal';

/** A depthUpdate event: first and last update ids, and changed levels (size 0 = removed). */
export interface Diff {
  U: number;
  u: number;
  b: [string, string][];
  a: [string, string][];
}

export interface Snapshot {
  lastUpdateId: number;
  bids: [string, string][];
  asks: [string, string][];
}

export function parseDiff(d: unknown): Diff | null {
  if (!d || typeof d !== 'object') return null;
  const o = d as Record<string, unknown>;
  if (typeof o.U !== 'number' || typeof o.u !== 'number' || !Array.isArray(o.b) || !Array.isArray(o.a)) return null;
  return { U: o.U, u: o.u, b: o.b as [string, string][], a: o.a as [string, string][] };
}

/**
 * A local copy of the full order book, kept in sync from a REST snapshot plus the
 * diff stream, following Binance's rules: buffer diffs until the snapshot arrives,
 * drop those it already contains, and resync when a diff is missing.
 */
export class LocalBook {
  bids = new Map<number, number>();
  asks = new Map<number, number>();
  lastId = 0;
  ready = false;
  private buffer: Diff[] = [];

  /** Returns 'gap' when an update was missed and a new snapshot is needed. */
  push(d: Diff): 'ok' | 'gap' | 'buffered' {
    if (!this.ready) {
      this.buffer.push(d);
      if (this.buffer.length > 2000) this.buffer.shift();
      return 'buffered';
    }
    if (d.u <= this.lastId) return 'ok';
    if (d.U > this.lastId + 1) {
      this.reset();
      return 'gap';
    }
    this.apply(d);
    return 'ok';
  }

  snapshot(s: Snapshot): 'ok' | 'gap' {
    this.bids.clear();
    this.asks.clear();
    for (const [p, q] of s.bids) this.set(this.bids, p, q);
    for (const [p, q] of s.asks) this.set(this.asks, p, q);
    this.lastId = s.lastUpdateId;
    this.ready = true;
    const pending = this.buffer.filter((d) => d.u > s.lastUpdateId);
    this.buffer = [];
    if (pending.length && pending[0].U > s.lastUpdateId + 1) {
      this.reset();
      return 'gap';
    }
    for (const d of pending) {
      if (d.U > this.lastId + 1) {
        this.reset();
        return 'gap';
      }
      this.apply(d);
    }
    return 'ok';
  }

  reset() {
    this.ready = false;
    this.buffer = [];
  }

  /** Best `n` levels on each side. */
  top(n = 400): Book {
    const side = (m: Map<number, number>, desc: boolean): Level[] => {
      const ps = [...m.keys()].sort((a, b) => (desc ? b - a : a - b));
      return ps.slice(0, n).map((p) => ({ p, q: m.get(p)! }));
    };
    return { bids: side(this.bids, true), asks: side(this.asks, false) };
  }

  /** Drops levels far from the touch so memory stays bounded. */
  trim(keep = 3000) {
    for (const [m, desc] of [
      [this.bids, true],
      [this.asks, false],
    ] as const) {
      if (m.size <= keep) continue;
      const ps = [...m.keys()].sort((a, b) => (desc ? b - a : a - b));
      for (const p of ps.slice(keep)) m.delete(p);
    }
  }

  private apply(d: Diff) {
    for (const [p, q] of d.b) this.set(this.bids, p, q);
    for (const [p, q] of d.a) this.set(this.asks, p, q);
    this.lastId = d.u;
  }

  private set(m: Map<number, number>, p: string, q: string) {
    const price = parseFloat(p);
    const size = parseFloat(q);
    if (!Number.isFinite(price) || !Number.isFinite(size)) return;
    if (size === 0) m.delete(price);
    else m.set(price, size);
  }
}
