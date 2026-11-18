import { useEffect, useRef, useState } from 'react';
import { niceTicks, type Candle } from '../lib/terminal';

const AXIS_W = 64;
const TIME_H = 20;
const MIN_BARS = 20;
const MAX_BARS = 400;

interface View {
  bars: number; // candles visible
  offset: number; // candles scrolled back from the newest
}

const css = (el: Element, name: string) => getComputedStyle(el).getPropertyValue(name).trim() || '#888';

/**
 * Candlestick chart with volume, drawn on a canvas. Wheel or +/− zooms, drag pans,
 * hovering (or touching) shows a crosshair with the candle's OHLC.
 */
export default function CandleChart({ candles, intervalMs, fmt, lang }: { candles: Candle[]; intervalMs: number; fmt: (v: number) => string; lang: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View>({ bars: 90, offset: 0 });
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ x: number; offset: number; moved: boolean } | null>(null);
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
  const hoverIdx = hover ? Math.floor((hover.x - (plotW - vis.length * slot)) / slot) : -1;
  const hovered = hover && hoverIdx >= 0 && hoverIdx < vis.length ? vis[hoverIdx] : null;
  const shown = hovered ?? vis[vis.length - 1];

  // Wheel zoom must be a non-passive listener to stop the page scrolling.
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX)) {
        e.preventDefault();
        setView((v) => ({ ...v, bars: Math.round(Math.min(MAX_BARS, Math.max(MIN_BARS, v.bars * (e.deltaY > 0 ? 1.12 : 1 / 1.12)))) }));
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
    const priceH = (size.h - TIME_H) * 0.8;
    const volTop = priceH;
    const volH = size.h - TIME_H - priceH;
    let lo = Infinity;
    let hi = -Infinity;
    let vmax = 0;
    for (const c of vis) {
      lo = Math.min(lo, c.l);
      hi = Math.max(hi, c.h);
      vmax = Math.max(vmax, c.v);
    }
    const pad = (hi - lo) * 0.08 || hi * 0.001 || 1;
    lo -= pad;
    hi += pad;
    const y = (p: number) => ((hi - p) / (hi - lo)) * priceH;
    const x0 = plotW - vis.length * slot;
    const font = '11px ui-sans-serif, system-ui, sans-serif';
    ctx.font = font;
    ctx.textBaseline = 'middle';

    // Grid + price axis
    ctx.strokeStyle = col.line;
    ctx.lineWidth = 1;
    ctx.fillStyle = col.muted;
    ctx.textAlign = 'left';
    const lastY = candles[total - 1] ? y(candles[total - 1].c) : -99;
    for (const p of niceTicks(lo, hi, 5)) {
      const yy = Math.round(y(p)) + 0.5;
      const hideLabel = Math.abs(yy - lastY) < 14;
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.moveTo(0, yy);
      ctx.lineTo(plotW, yy);
      ctx.stroke();
      ctx.globalAlpha = 1;
      if (!hideLabel) ctx.fillText(fmt(p), plotW + 6, yy);
    }

    // Time axis
    ctx.textAlign = 'center';
    const every = Math.max(1, Math.ceil(80 / slot));
    const daily = intervalMs >= 86_400_000;
    for (let i = vis.length - 1; i >= 0; i -= every) {
      const d = new Date(vis[i].t);
      const label = daily
        ? d.toLocaleDateString(lang, { day: 'numeric', month: 'short' })
        : intervalMs >= 4 * 3_600_000 && d.getHours() === 0
          ? d.toLocaleDateString(lang, { day: 'numeric', month: 'short' })
          : d.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' });
      ctx.fillText(label, x0 + (i + 0.5) * slot, size.h - TIME_H / 2);
    }

    // Candles + volume
    const bodyW = Math.max(1, Math.floor(slot * 0.7));
    vis.forEach((c, i) => {
      const cx = Math.round(x0 + (i + 0.5) * slot);
      const up = c.c >= c.o;
      ctx.fillStyle = ctx.strokeStyle = up ? col.up : col.down;
      ctx.globalAlpha = 0.35;
      const vh = vmax ? (c.v / vmax) * volH * 0.9 : 0;
      ctx.fillRect(cx - bodyW / 2, volTop + volH - vh, bodyW, vh);
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.moveTo(cx + 0.5, y(c.h));
      ctx.lineTo(cx + 0.5, y(c.l));
      ctx.stroke();
      const top = y(Math.max(c.o, c.c));
      ctx.fillRect(cx - bodyW / 2 + 0.5, top, bodyW, Math.max(1, y(Math.min(c.o, c.c)) - top));
    });

    // Last price line
    const last = candles[total - 1];
    if (last && last.c >= lo && last.c <= hi) {
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

    // Crosshair
    if (hover && hover.x < plotW && hover.y < priceH) {
      ctx.strokeStyle = col.muted;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(Math.round(hover.x) + 0.5, 0);
      ctx.lineTo(Math.round(hover.x) + 0.5, size.h - TIME_H);
      ctx.moveTo(0, Math.round(hover.y) + 0.5);
      ctx.lineTo(plotW, Math.round(hover.y) + 0.5);
      ctx.stroke();
      ctx.setLineDash([]);
      const p = hi - (hover.y / priceH) * (hi - lo);
      ctx.fillStyle = col.fg;
      ctx.fillRect(plotW, hover.y - 9, AXIS_W, 18);
      ctx.fillStyle = col.card;
      ctx.textAlign = 'left';
      ctx.fillText(fmt(p), plotW + 6, hover.y);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles, size, bars, offset, hover, theme, fmt, lang, intervalMs]);

  const pos = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const zoom = (k: number) => setView((v) => ({ ...v, bars: Math.round(Math.min(MAX_BARS, Math.max(MIN_BARS, v.bars * k))) }));
  const up = shown ? shown.c >= shown.o : true;

  return (
    <div ref={wrap} className="relative h-full w-full select-none">
      <canvas
        ref={canvas}
        className="absolute inset-0 h-full w-full cursor-crosshair touch-pan-y"
        role="img"
        aria-label="BTC/USDT candlestick chart"
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, offset, moved: false };
          setHover(pos(e));
        }}
        onPointerMove={(e) => {
          setHover(pos(e));
          const d = drag.current;
          if (!d || !slot) return;
          const dx = e.clientX - d.x;
          if (Math.abs(dx) > 4) d.moved = true;
          if (d.moved) setView((v) => ({ ...v, offset: Math.max(0, Math.round(d.offset + dx / slot)) }));
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        onPointerLeave={() => {
          drag.current = null;
          setHover(null);
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
      <div className="absolute bottom-6 left-1 flex gap-1">
        <button className="h-7 w-7 rounded-md border border-line bg-card/80 text-sm" onClick={() => zoom(1 / 1.3)} aria-label="Zoom in">
          +
        </button>
        <button className="h-7 w-7 rounded-md border border-line bg-card/80 text-sm" onClick={() => zoom(1.3)} aria-label="Zoom out">
          −
        </button>
        {offset > 0 && (
          <button className="h-7 rounded-md border border-line bg-card/80 px-2 text-xs" onClick={() => setView((v) => ({ ...v, offset: 0 }))} aria-label="Latest">
            ⇥
          </button>
        )}
      </div>
    </div>
  );
}
