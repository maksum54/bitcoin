import { useEffect, useRef, useState } from 'react';
import { niceTicks, type Candle } from '../lib/terminal';
import { volumeProfile, type Series } from '../terminal/indicators';

const AXIS_W = 64;
const TIME_H = 20;
const PANE_H = 84;
const MIN_BARS = 20;
const MAX_BARS = 600;

export interface Line {
  values: Series;
  color: string;
  width?: number;
  dash?: number[];
}
export interface Band {
  upper: Series;
  lower: Series;
  color: string;
}
export interface Pane {
  id: string;
  label: string;
  lines: Line[];
  hist?: { values: Series; up: string; down: string };
  range?: [number, number];
  levels?: number[];
}
export interface Marker {
  t: number;
  p: number;
  color: string;
  shape: 'up' | 'down' | 'dot';
  /** Radius in px (dots). */
  r?: number;
}
export interface Zone {
  t0: number;
  t1?: number;
  entry: number;
  sl: number;
  tp: number;
  faded?: boolean;
}
export interface HLine {
  p: number;
  color: string;
  label?: string;
}

interface View {
  bars: number;
  offset: number;
}

const css = (el: Element, name: string) => getComputedStyle(el).getPropertyValue(name).trim() || '#888';
const clampBars = (n: number) => Math.round(Math.min(MAX_BARS, Math.max(MIN_BARS, n)));

export interface ChartProps {
  candles: Candle[];
  intervalMs: number;
  fmt: (v: number) => string;
  lang: string;
  lines?: Line[];
  bands?: Band[];
  panes?: Pane[];
  markers?: Marker[];
  zones?: Zone[];
  hlines?: HLine[];
  profile?: boolean;
  /** When set, a tap / click (without dragging) on the price area reports its price and time. */
  onPick?: (price: number, t: number) => void;
}

/**
 * Candlestick chart on a canvas: volume, indicator lines and bands, lower panes,
 * markers, position zones and a visible-range volume profile. Wheel, pinch or +/− zooms;
 * dragging pans; hovering or touching shows a crosshair.
 */
export default function CandleChart({ candles, intervalMs, fmt, lang, lines = [], bands = [], panes = [], markers = [], zones = [], hlines = [], profile, onPick }: ChartProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View>({ bars: 90, offset: 0 });
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ x: number; offset: number; moved: boolean } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; bars: number } | null>(null);
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.floor(e.contentRect.width), h: Math.floor(e.contentRect.height) }));
    ro.observe(el);
    const mo = new MutationObserver(() => setTheme(document.documentElement.dataset.theme));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, []);

  const total = candles.length;
  const bars = Math.min(view.bars, Math.max(MIN_BARS, total));
  const offset = Math.max(0, Math.min(view.offset, Math.max(0, total - bars)));
  const end = total - offset;
  const start = Math.max(0, end - bars);
  const vis = candles.slice(start, end);
  const plotW = Math.max(0, size.w - AXIS_W);
  const slot = plotW / bars;
  const x0 = plotW - vis.length * slot;
  const panesH = panes.length * PANE_H;
  const priceH = Math.max(60, (size.h - TIME_H - panesH) * 0.82);
  const volH = Math.max(0, size.h - TIME_H - panesH - priceH);
  const hoverIdx = hover ? Math.floor((hover.x - x0) / slot) : -1;
  const hovered = hover && hoverIdx >= 0 && hoverIdx < vis.length ? vis[hoverIdx] : null;
  const shown = hovered ?? vis[vis.length - 1];

  // Price range of the visible part (kept in a ref for picking).
  const range = useRef({ lo: 0, hi: 1 });

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX)) {
        e.preventDefault();
        setView((v) => ({ ...v, bars: clampBars(v.bars * (e.deltaY > 0 ? 1.12 : 1 / 1.12)) }));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => {
    const el = canvas.current;
    if (!el || !size.w || !size.h) return;
    const dpr = window.devicePixelRatio || 1;
    el.width = size.w * dpr;
    el.height = size.h * dpr;
    const ctx = el.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    if (!vis.length) return;

    const col = { up: css(el, '--up'), down: css(el, '--down'), line: css(el, '--line'), muted: css(el, '--muted'), fg: css(el, '--fg'), card: css(el, '--card'), accent: css(el, '--accent') };
    let lo = Infinity;
    let hi = -Infinity;
    let vmax = 0;
    for (const c of vis) {
      lo = Math.min(lo, c.l);
      hi = Math.max(hi, c.h);
      vmax = Math.max(vmax, c.v);
    }
    for (const l of lines)
      for (let i = start; i < end; i++) {
        const v = l.values[i];
        if (v == null) continue;
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
    const pad = (hi - lo) * 0.06 || hi * 0.001 || 1;
    lo -= pad;
    hi += pad;
    range.current = { lo, hi };
    const y = (p: number) => ((hi - p) / (hi - lo)) * priceH;
    const xAt = (i: number) => x0 + (i - start + 0.5) * slot; // i = absolute candle index
    const idxOf = (t: number) => {
      // Last candle with open time ≤ t (binary search).
      let a = 0;
      let b = total - 1;
      if (!total || t < candles[0].t) return -1;
      while (a < b) {
        const m = (a + b + 1) >> 1;
        if (candles[m].t <= t) a = m;
        else b = m - 1;
      }
      return t < candles[a].t + intervalMs * 1.5 || a === total - 1 ? a : -1;
    };
    const font = '11px ui-sans-serif, system-ui, sans-serif';
    ctx.font = font;
    ctx.textBaseline = 'middle';

    // Grid + price axis
    ctx.strokeStyle = col.line;
    ctx.lineWidth = 1;
    ctx.fillStyle = col.muted;
    ctx.textAlign = 'left';
    const lastY = y(candles[total - 1].c);
    for (const p of niceTicks(lo, hi, 5)) {
      const yy = Math.round(y(p)) + 0.5;
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.moveTo(0, yy);
      ctx.lineTo(plotW, yy);
      ctx.stroke();
      ctx.globalAlpha = 1;
      if (Math.abs(yy - lastY) >= 14) ctx.fillText(fmt(p), plotW + 6, yy);
    }

    // Time axis
    ctx.textAlign = 'center';
    const every = Math.max(1, Math.ceil(80 / slot));
    const daily = intervalMs >= 86_400_000;
    for (let i = vis.length - 1; i >= 0; i -= every) {
      const d = new Date(vis[i].t);
      const label =
        daily || (intervalMs >= 4 * 3_600_000 && d.getHours() === 0)
          ? d.toLocaleDateString(lang, { day: 'numeric', month: 'short' })
          : d.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' });
      ctx.fillText(label, x0 + (i + 0.5) * slot, size.h - TIME_H / 2);
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, plotW, priceH + volH);
    ctx.clip();

    // Volume profile (behind candles)
    if (profile) {
      const vp = volumeProfile(vis, 48);
      if (vp) {
        const maxBin = Math.max(...vp.bins);
        const wMax = plotW * 0.22;
        vp.bins.forEach((b, i) => {
          const p0 = vp.lo + i * vp.step;
          const yt = y(p0 + vp.step);
          const h = Math.max(1, y(p0) - yt - 1);
          ctx.fillStyle = i === vp.poc ? col.accent : col.muted;
          ctx.globalAlpha = i >= vp.vaLo && i <= vp.vaHi ? 0.32 : 0.14;
          const w = (b / maxBin) * wMax;
          ctx.fillRect(plotW - w, yt, w, h);
        });
        ctx.globalAlpha = 1;
      }
    }

    // Bands
    for (const b of bands) {
      ctx.fillStyle = b.color;
      ctx.globalAlpha = 0.08;
      ctx.beginPath();
      let started = false;
      for (let i = start; i < end; i++) {
        if (b.upper[i] == null) continue;
        if (started) ctx.lineTo(xAt(i), y(b.upper[i]!));
        else ctx.moveTo(xAt(i), y(b.upper[i]!));
        started = true;
      }
      for (let i = end - 1; i >= start; i--) if (b.lower[i] != null) ctx.lineTo(xAt(i), y(b.lower[i]!));
      ctx.closePath();
      if (started) ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Position zones
    for (const z of zones) {
      const i0 = z.t0 < candles[0].t ? start : idxOf(z.t0);
      if (i0 < 0 && z.t0 > candles[total - 1].t + intervalMs) continue;
      const xa = i0 < 0 ? plotW - slot * 6 : Math.max(0, xAt(Math.max(i0, start)) - slot / 2);
      const i1 = z.t1 != null ? idxOf(z.t1) : -1;
      const xb = z.t1 != null && i1 >= 0 ? Math.min(plotW, xAt(i1) + slot / 2) : plotW;
      if (xb <= 0 || xa >= plotW) continue;
      const alpha = z.faded ? 0.1 : 0.2;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = col.up;
      ctx.fillRect(xa, Math.min(y(z.tp), y(z.entry)), xb - xa, Math.abs(y(z.tp) - y(z.entry)));
      ctx.fillStyle = col.down;
      ctx.fillRect(xa, Math.min(y(z.sl), y(z.entry)), xb - xa, Math.abs(y(z.sl) - y(z.entry)));
      ctx.globalAlpha = z.faded ? 0.5 : 1;
      ctx.strokeStyle = col.fg;
      ctx.beginPath();
      ctx.moveTo(xa, Math.round(y(z.entry)) + 0.5);
      ctx.lineTo(xb, Math.round(y(z.entry)) + 0.5);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Candles + volume
    const bodyW = Math.max(1, Math.floor(slot * 0.7));
    vis.forEach((c, i) => {
      const cx = Math.round(x0 + (i + 0.5) * slot);
      const up = c.c >= c.o;
      ctx.fillStyle = ctx.strokeStyle = up ? col.up : col.down;
      ctx.globalAlpha = 0.35;
      const vh = vmax ? (c.v / vmax) * volH * 0.9 : 0;
      ctx.fillRect(cx - bodyW / 2, priceH + volH - vh, bodyW, vh);
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.moveTo(cx + 0.5, y(c.h));
      ctx.lineTo(cx + 0.5, y(c.l));
      ctx.stroke();
      const top = y(Math.max(c.o, c.c));
      ctx.fillRect(cx - bodyW / 2 + 0.5, top, bodyW, Math.max(1, y(Math.min(c.o, c.c)) - top));
    });

    // Indicator lines
    const drawLine = (l: Line, yf: (v: number) => number) => {
      ctx.strokeStyle = l.color;
      ctx.lineWidth = l.width ?? 1.5;
      ctx.setLineDash(l.dash ?? []);
      ctx.beginPath();
      let pen = false;
      for (let i = start; i < end; i++) {
        const v = l.values[i];
        if (v == null) {
          pen = false;
          continue;
        }
        if (pen) ctx.lineTo(xAt(i), yf(v));
        else ctx.moveTo(xAt(i), yf(v));
        pen = true;
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineWidth = 1;
    };
    for (const l of lines) drawLine(l, y);

    // Horizontal lines (orders, positions)
    for (const h of hlines) {
      if (h.p < lo || h.p > hi) continue;
      const yy = Math.round(y(h.p)) + 0.5;
      ctx.strokeStyle = h.color;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(0, yy);
      ctx.lineTo(plotW, yy);
      ctx.stroke();
      ctx.setLineDash([]);
      if (h.label) {
        ctx.fillStyle = h.color;
        ctx.textAlign = 'left';
        ctx.fillText(h.label, 4, yy - 8);
      }
    }

    // Markers
    for (const m of markers) {
      const i = idxOf(m.t);
      if (i < start || i >= end) continue;
      const cx = xAt(i);
      ctx.fillStyle = m.color;
      if (m.shape === 'dot') {
        ctx.globalAlpha = 0.55;
        ctx.beginPath();
        ctx.arc(cx, y(m.p), m.r ?? 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      } else {
        const yy = y(m.p);
        const s = 5;
        ctx.beginPath();
        const k = m.shape === 'up' ? 1 : -1; // up: below the price, pointing up
        ctx.moveTo(cx, yy + 4 * k);
        ctx.lineTo(cx - s, yy + (4 + s * 1.6) * k);
        ctx.lineTo(cx + s, yy + (4 + s * 1.6) * k);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.restore();

    // Last price
    const last = candles[total - 1];
    if (last.c >= lo && last.c <= hi) {
      const yy = Math.round(y(last.c)) + 0.5;
      const lc = last.c >= last.o ? col.up : col.down;
      ctx.strokeStyle = lc;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(0, yy);
      ctx.lineTo(plotW, yy);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = lc;
      ctx.fillRect(plotW, yy - 9, AXIS_W, 18);
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'left';
      ctx.font = `600 ${font}`;
      ctx.fillText(fmt(last.c), plotW + 6, yy);
      ctx.font = font;
    }

    // Lower panes
    panes.forEach((pn, k) => {
      const top = priceH + volH + k * PANE_H;
      ctx.strokeStyle = col.line;
      ctx.beginPath();
      ctx.moveTo(0, top + 0.5);
      ctx.lineTo(size.w, top + 0.5);
      ctx.stroke();
      let plo = pn.range?.[0] ?? Infinity;
      let phi = pn.range?.[1] ?? -Infinity;
      if (!pn.range) {
        for (const s of [...pn.lines.map((l) => l.values), ...(pn.hist ? [pn.hist.values] : [])])
          for (let i = start; i < end; i++) {
            if (s[i] == null) continue;
            plo = Math.min(plo, s[i]!);
            phi = Math.max(phi, s[i]!);
          }
        if (!Number.isFinite(plo)) return;
        if (pn.hist) {
          plo = Math.min(plo, 0);
          phi = Math.max(phi, 0);
        }
        const pp = (phi - plo) * 0.1 || 1;
        plo -= pp;
        phi += pp;
      }
      const py = (v: number) => top + 4 + ((phi - v) / (phi - plo)) * (PANE_H - 8);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, top, plotW, PANE_H);
      ctx.clip();
      for (const lv of pn.levels ?? []) {
        ctx.strokeStyle = col.muted;
        ctx.globalAlpha = 0.5;
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.moveTo(0, Math.round(py(lv)) + 0.5);
        ctx.lineTo(plotW, Math.round(py(lv)) + 0.5);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }
      if (pn.hist) {
        const z = py(0);
        for (let i = start; i < end; i++) {
          const v = pn.hist.values[i];
          if (v == null) continue;
          ctx.fillStyle = v >= 0 ? pn.hist.up : pn.hist.down;
          ctx.globalAlpha = 0.6;
          ctx.fillRect(xAt(i) - bodyW / 2, Math.min(z, py(v)), bodyW, Math.max(1, Math.abs(py(v) - z)));
          ctx.globalAlpha = 1;
        }
      }
      for (const l of pn.lines) drawLine(l, py);
      ctx.restore();
      ctx.fillStyle = col.muted;
      ctx.textAlign = 'left';
      ctx.fillText(pn.label, 4, top + 10);
      for (const v of pn.range ? (pn.levels ?? []) : [phi - (phi - plo) * 0.1, plo + (phi - plo) * 0.1]) {
        ctx.fillText(Math.abs(v) >= 1000 ? v.toFixed(0) : v.toFixed(Math.abs(v) < 10 ? 2 : 1), plotW + 6, py(v));
      }
    });

    // Crosshair
    if (hover && hover.x < plotW && hover.y < size.h - TIME_H) {
      ctx.strokeStyle = col.muted;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(Math.round(hover.x) + 0.5, 0);
      ctx.lineTo(Math.round(hover.x) + 0.5, size.h - TIME_H);
      if (hover.y < priceH) {
        ctx.moveTo(0, Math.round(hover.y) + 0.5);
        ctx.lineTo(plotW, Math.round(hover.y) + 0.5);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      if (hover.y < priceH) {
        const p = hi - (hover.y / priceH) * (hi - lo);
        ctx.fillStyle = col.fg;
        ctx.fillRect(plotW, hover.y - 9, AXIS_W, 18);
        ctx.fillStyle = col.card;
        ctx.textAlign = 'left';
        ctx.fillText(fmt(p), plotW + 6, hover.y);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles, size, bars, offset, hover, theme, fmt, lang, intervalMs, lines, bands, panes, markers, zones, hlines, profile]);

  const pos = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const zoom = (k: number) => setView((v) => ({ ...v, bars: clampBars(v.bars * k) }));
  const dist = () => {
    const [a, b] = [...pointers.current.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  const endPointer = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    const d = drag.current;
    if (d && !d.moved && onPick && pointers.current.size === 0) {
      const p = pos(e);
      if (p.x < plotW && p.y < priceH) {
        const { lo, hi } = range.current;
        const price = hi - (p.y / priceH) * (hi - lo);
        const i = Math.floor((p.x - x0) / slot);
        const c = vis[Math.max(0, Math.min(vis.length - 1, i))];
        if (c) onPick(price, c.t);
      }
    }
    drag.current = null;
  };
  const up = shown ? shown.c >= shown.o : true;

  return (
    <div ref={wrap} className="relative h-full w-full select-none">
      <canvas
        ref={canvas}
        className={`absolute inset-0 h-full w-full touch-pan-y ${onPick ? 'cursor-copy' : 'cursor-crosshair'}`}
        role="img"
        aria-label="BTC/USDT candlestick chart"
        onPointerDown={(e) => {
          pointers.current.set(e.pointerId, pos(e));
          if (pointers.current.size === 2) {
            pinch.current = { d: dist(), bars: view.bars };
            drag.current = null;
          } else drag.current = { x: e.clientX, offset, moved: false };
          setHover(pos(e));
        }}
        onPointerMove={(e) => {
          if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, pos(e));
          if (pinch.current && pointers.current.size === 2) {
            const k = pinch.current.d / Math.max(10, dist());
            setView((v) => ({ ...v, bars: clampBars(pinch.current!.bars * k) }));
            return;
          }
          setHover(pos(e));
          const d = drag.current;
          if (!d || !slot) return;
          const dx = e.clientX - d.x;
          if (Math.abs(dx) > 6) d.moved = true;
          if (d.moved) setView((v) => ({ ...v, offset: Math.max(0, Math.round(d.offset + dx / slot)) }));
        }}
        onPointerUp={endPointer}
        onPointerCancel={(e) => {
          pointers.current.delete(e.pointerId);
          pinch.current = null;
          drag.current = null;
        }}
        onPointerLeave={(e) => {
          if (e.pointerType === 'mouse') setHover(null);
          if (!pointers.current.size) drag.current = null;
        }}
      />
      {shown && (
        <div className="num pointer-events-none absolute left-1 top-1 flex flex-wrap gap-x-2 rounded-md bg-card/80 px-1.5 py-0.5 text-[11px] text-muted backdrop-blur-sm">
          {(['o', 'h', 'l', 'c'] as const).map((k) => (
            <span key={k}>
              {k.toUpperCase()} <span className={up ? 'text-up' : 'text-down'}>{fmt(shown[k])}</span>
            </span>
          ))}
          <span>V {shown.v.toFixed(2)}</span>
        </div>
      )}
      <div className="absolute left-1 flex gap-1" style={{ top: Math.max(30, priceH - 34) }}>
        <button className="h-8 w-8 rounded-md border border-line bg-card/80 text-sm" onClick={() => zoom(1 / 1.3)} aria-label="Zoom in">
          +
        </button>
        <button className="h-8 w-8 rounded-md border border-line bg-card/80 text-sm" onClick={() => zoom(1.3)} aria-label="Zoom out">
          −
        </button>
        {offset > 0 && (
          <button className="h-8 rounded-md border border-line bg-card/80 px-2 text-xs" onClick={() => setView((v) => ({ ...v, offset: 0 }))} aria-label="Latest">
            ⇥
          </button>
        )}
      </div>
    </div>
  );
}
