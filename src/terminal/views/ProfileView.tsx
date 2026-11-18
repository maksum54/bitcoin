import { useEffect, useMemo, useRef, useState } from 'react';
import { Card, ErrorBox, Loading, Seg, useAsync } from '../../components/ui';
import { num } from '../../lib/format';
import { useApp } from '../../lib/i18n';
import { useStored } from '../../lib/storage';
import { fetchHistory } from '../../lib/useTerminal';
import { useTerm } from '../data';
import { autoStep, footprintBars, tpoProfiles, type FootBar, type Session, type TpoProfile } from '../profile';

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';
const useTheme = () => {
  const [th, setTh] = useState(document.documentElement.dataset.theme);
  useEffect(() => {
    const mo = new MutationObserver(() => setTh(document.documentElement.dataset.theme));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => mo.disconnect();
  }, []);
  return th;
};

export default function ProfileView() {
  const { t } = useApp();
  const [mode, setMode] = useStored<'tpo' | 'footprint'>('term.profileMode', 'tpo');
  return (
    <div className="grid gap-3">
      <Seg
        value={mode}
        onChange={setMode}
        options={[
          { v: 'tpo', label: t('x.tpo') },
          { v: 'footprint', label: 'Footprint' },
        ]}
      />
      {mode === 'tpo' ? <Tpo /> : <Footprint />}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Tpo() {
  const { t, lang } = useApp();
  const [days, setDays] = useStored<number>('term.tpoDays', 7);
  const [session, setSession] = useStored<Session>('term.tpoSession', 'day');
  const [stepSel, setStepSel] = useStored<number>('term.tpoStep', 0);
  const span = session === 'week' ? days * 7 : days;
  const q = useAsync(() => fetchHistory('30m', Math.min(5000, span * 48)), [span], 5 * 60_000);
  const candles = useMemo(() => q.data ?? [], [q.data]);
  const lo = Math.min(...candles.map((c) => c.l));
  const hi = Math.max(...candles.map((c) => c.h));
  const step = stepSel || autoStep(lo, hi, session === 'week' ? 90 : 70);
  const profiles = useMemo(() => (candles.length ? tpoProfiles(candles, step, session) : []), [candles, step, session]);

  return (
    <Card
      title={t('x.tpo')}
      right={
        <div className="flex flex-wrap justify-end gap-1">
          <Seg value={session} onChange={setSession} options={[{ v: 'day', label: t('x.day') }, { v: 'week', label: t('x.week') }]} />
          <Seg value={days} onChange={setDays} options={[3, 7, 14].map((v) => ({ v, label: String(v) }))} />
        </div>
      }
    >
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted">
        {t('x.rowSize')}
        <Seg value={stepSel} onChange={setStepSel} options={[0, 25, 50, 100, 250, 500].map((v) => ({ v, label: v ? `$${v}` : 'Auto' }))} />
      </div>
      {q.error && !candles.length ? <ErrorBox onRetry={q.reload} /> : !profiles.length ? <Loading rows={6} /> : <TpoChart profiles={profiles} step={step} />}
      {profiles.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted">
              <tr className="text-left">
                <th className="py-1 pr-2 font-normal">{t('x.session')}</th>
                <th className="pr-2 text-right font-normal">POC</th>
                <th className="pr-2 text-right font-normal">VAH</th>
                <th className="pr-2 text-right font-normal">VAL</th>
                <th className="pr-2 text-right font-normal">{t('x.range')}</th>
                <th className="font-normal">{t('x.notes')}</th>
              </tr>
            </thead>
            <tbody>
              {[...profiles].reverse().map((p) => (
                <tr key={p.start} className="border-t border-line">
                  <td className="py-1 pr-2">{new Date(p.start).toLocaleDateString(lang, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })}</td>
                  <td className="num pr-2 text-right font-semibold text-accent">{num(p.poc, lang, 0)}</td>
                  <td className="num pr-2 text-right">{num(p.vaHi + step, lang, 0)}</td>
                  <td className="num pr-2 text-right">{num(p.vaLo, lang, 0)}</td>
                  <td className="num pr-2 text-right">{num(p.high - p.low, lang, 0)}</td>
                  <td className="text-muted">
                    {[p.poorHigh && t('x.poorHigh'), p.poorLow && t('x.poorLow'), p.singles.length > 0 && t('x.singles', { n: p.singles.length })].filter(Boolean).join(' · ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-[11px] text-muted">{t('x.tpoNote')}</p>
    </Card>
  );
}

const LETTER_W = 7;
const ROW_H = 11;
const GAP = 14;
const AXIS = 58;

function TpoChart({ profiles, step }: { profiles: TpoProfile[]; step: number }) {
  const { lang } = useApp();
  const theme = useTheme();
  const ref = useRef<HTMLCanvasElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const lo = Math.min(...profiles.map((p) => p.rows[0].p));
  const hi = Math.max(...profiles.map((p) => p.rows[p.rows.length - 1].p));
  const rows = Math.round((hi - lo) / step) + 1;
  const widths = profiles.map((p) => Math.max(60, Math.max(...p.rows.map((r) => r.letters.length)) * LETTER_W + 8));
  const W = widths.reduce((a, b) => a + b + GAP, 0) + AXIS;
  const H = rows * ROW_H + 24;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const dpr = window.devicePixelRatio || 1;
    el.width = W * dpr;
    el.height = H * dpr;
    const ctx = el.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const col = { fg: css('--fg'), muted: css('--muted'), line: css('--line'), accent: css('--accent'), up: css('--up'), down: css('--down'), card2: css('--card2') };
    const y = (p: number) => 18 + (rows - 1 - Math.round((p - lo) / step)) * ROW_H;
    ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textBaseline = 'top';
    let x = 4;
    profiles.forEach((p, k) => {
      const w = widths[k];
      ctx.fillStyle = col.muted;
      ctx.fillText(new Date(p.start).toLocaleDateString(lang, { day: 'numeric', month: 'short', timeZone: 'UTC' }), x, 2);
      // Value area
      ctx.fillStyle = col.card2;
      ctx.fillRect(x - 2, y(p.vaHi) - 1, w, y(p.vaLo) - y(p.vaHi) + ROW_H);
      for (const r of p.rows) {
        const yy = y(r.p);
        const isPoc = r.p === p.poc;
        const single = p.singles.includes(r.p);
        if (single) {
          ctx.fillStyle = col.accent;
          ctx.globalAlpha = 0.25;
          ctx.fillRect(x - 2, yy, w, ROW_H - 1);
          ctx.globalAlpha = 1;
        }
        ctx.fillStyle = isPoc ? col.accent : r.p >= p.vaLo && r.p <= p.vaHi ? col.fg : col.muted;
        ctx.fillText(r.letters, x, yy);
      }
      // POC line
      ctx.strokeStyle = col.accent;
      ctx.beginPath();
      ctx.moveTo(x - 2, y(p.poc) + ROW_H / 2);
      ctx.lineTo(x + w - 2, y(p.poc) + ROW_H / 2);
      ctx.stroke();
      // Open / close ticks
      ctx.fillStyle = col.up;
      ctx.fillRect(x - 4, y(Math.floor(p.open / step) * step) + 2, 2, ROW_H - 4);
      ctx.fillStyle = col.down;
      ctx.fillRect(x + w - 3, y(Math.floor(p.close / step) * step) + 2, 2, ROW_H - 4);
      // Poor extremes
      ctx.fillStyle = col.down;
      if (p.poorHigh) ctx.fillText('▔ poor', x + w - 44, y(p.rows[p.rows.length - 1].p) - ROW_H);
      if (p.poorLow) ctx.fillText('▁ poor', x + w - 44, y(p.rows[0].p) + ROW_H);
      x += w + GAP;
    });
    // Price axis
    ctx.fillStyle = col.muted;
    const every = Math.max(1, Math.ceil(28 / ROW_H));
    for (let i = 0; i < rows; i += every) {
      const p = hi - i * step;
      ctx.fillText(num(p, lang, 0), W - AXIS + 4, 18 + i * ROW_H);
    }
  }, [profiles, step, theme, W, H, rows, lo, hi, widths, lang]);

  useEffect(() => {
    const s = scroller.current;
    if (s) s.scrollLeft = s.scrollWidth;
  }, [W]);

  return (
    <div ref={scroller} className="max-h-[70vh] overflow-auto rounded-lg border border-line">
      <canvas ref={ref} style={{ width: W, height: H }} />
    </div>
  );
}

/* ------------------------------------------------------------------ */

type FpMode = 'delta' | 'bidask' | 'volume';
const COL_W = { delta: 64, bidask: 104, volume: 60 } as const;
const CELL_H = 15;
const TABLE = ['Vol', 'Δ', 'CumΔ', 'MaxΔ', 'MinΔ'];

function Footprint() {
  const { t } = useApp();
  const { footprint, footVersion } = useTerm();
  const [iv, setIv] = useStored<number>('term.fpIv', 5);
  const [step, setStep] = useStored<number>('term.fpStep', 10);
  const [mode, setMode] = useStored<FpMode>('term.fpMode', 'bidask');
  // Rebuild at most twice a second.
  const slot = Math.floor(footVersion / 2);
  const bars = useMemo(() => footprintBars(footprint, iv * 60_000, step, 40), [footprint, iv, step, slot]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Card title="Footprint">
      <div className="mb-2 flex flex-wrap gap-1">
        <Seg value={iv} onChange={setIv} options={[1, 5, 15].map((v) => ({ v, label: `${v}m` }))} />
        <Seg value={step} onChange={setStep} options={[5, 10, 25, 50].map((v) => ({ v, label: `$${v}` }))} />
        <Seg value={mode} onChange={setMode} options={[{ v: 'delta', label: 'Delta' }, { v: 'bidask', label: 'Bid × Ask' }, { v: 'volume', label: 'Volume' }]} />
      </div>
      {!bars.length ? <Loading rows={6} /> : <FootprintChart bars={bars} step={step} mode={mode} />}
      <p className="mt-2 text-[11px] text-muted">{t('x.fpNote')}</p>
    </Card>
  );
}

function FootprintChart({ bars, step, mode }: { bars: FootBar[]; step: number; mode: FpMode }) {
  const { lang } = useApp();
  const theme = useTheme();
  const ref = useRef<HTMLCanvasElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const hi = Math.max(...bars.map((b) => b.cells[0]?.p ?? b.h));
  const lo = Math.min(...bars.map((b) => b.cells[b.cells.length - 1]?.p ?? b.l));
  const rows = Math.min(400, Math.round((hi - lo) / step) + 1);
  const colW = COL_W[mode];
  const AX = 58;
  const W = bars.length * colW + AX;
  const gridH = rows * CELL_H;
  const H = gridH + 18 + TABLE.length * CELL_H + 6;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const dpr = window.devicePixelRatio || 1;
    el.width = W * dpr;
    el.height = H * dpr;
    const ctx = el.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const col = { fg: css('--fg'), muted: css('--muted'), line: css('--line'), accent: css('--accent'), up: css('--up'), down: css('--down') };
    const y = (p: number) => 16 + Math.round((hi - p) / step) * CELL_H;
    ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textBaseline = 'middle';
    let maxAbs = 1e-9;
    let maxVol = 1e-9;
    for (const b of bars)
      for (const c of b.cells) {
        maxAbs = Math.max(maxAbs, Math.abs(c.ask - c.bid));
        maxVol = Math.max(maxVol, c.ask + c.bid);
      }
    const f = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2));
    let cum = 0;
    bars.forEach((b, i) => {
      const x = i * colW;
      ctx.fillStyle = col.muted;
      ctx.textAlign = 'center';
      ctx.fillText(new Date(b.t).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' }), x + colW / 2, 7);
      // Candle strip on the left of the column
      const up = b.c >= b.o;
      ctx.fillStyle = up ? col.up : col.down;
      ctx.fillRect(x + 2, y(Math.floor(b.h / step) * step), 1, y(Math.floor(b.l / step) * step) - y(Math.floor(b.h / step) * step) + CELL_H);
      const bt = y(Math.floor(Math.max(b.o, b.c) / step) * step);
      const bb = y(Math.floor(Math.min(b.o, b.c) / step) * step) + CELL_H;
      ctx.fillRect(x + 1, bt, 3, bb - bt);
      for (const c of b.cells) {
        const yy = y(c.p);
        const delta = c.ask - c.bid;
        const vol = c.ask + c.bid;
        const cx = x + 6;
        const cw = colW - 8;
        if (mode === 'delta') {
          ctx.fillStyle = delta >= 0 ? col.up : col.down;
          ctx.globalAlpha = 0.12 + 0.6 * (Math.abs(delta) / maxAbs);
          ctx.fillRect(cx, yy, cw, CELL_H - 1);
        } else if (mode === 'volume') {
          ctx.fillStyle = col.accent;
          ctx.globalAlpha = 0.1 + 0.6 * (vol / maxVol);
          ctx.fillRect(cx, yy, cw * (vol / maxVol), CELL_H - 1);
        } else {
          ctx.fillStyle = col.line;
          ctx.globalAlpha = 0.5;
          ctx.fillRect(cx, yy, cw, CELL_H - 1);
        }
        ctx.globalAlpha = 1;
        if (c.p === b.poc) {
          ctx.strokeStyle = col.accent;
          ctx.strokeRect(cx + 0.5, yy + 0.5, cw - 1, CELL_H - 2);
        }
        ctx.fillStyle = col.fg;
        if (mode === 'bidask') {
          // Highlight a side that is 3× the other.
          ctx.textAlign = 'right';
          ctx.fillStyle = c.bid > 3 * c.ask && c.bid > 0.05 ? col.down : col.fg;
          ctx.fillText(f(c.bid), cx + cw / 2 - 6, yy + CELL_H / 2);
          ctx.fillStyle = col.muted;
          ctx.textAlign = 'center';
          ctx.fillText('×', cx + cw / 2, yy + CELL_H / 2);
          ctx.textAlign = 'left';
          ctx.fillStyle = c.ask > 3 * c.bid && c.ask > 0.05 ? col.up : col.fg;
          ctx.fillText(f(c.ask), cx + cw / 2 + 6, yy + CELL_H / 2);
        } else {
          ctx.textAlign = 'center';
          ctx.fillText(mode === 'delta' ? f(delta) : f(vol), cx + cw / 2, yy + CELL_H / 2);
        }
      }
      // Per-bar table
      cum += b.delta;
      const vals = [b.vol, b.delta, cum, b.maxDelta, b.minDelta];
      vals.forEach((v, k) => {
        const yy = 18 + gridH + k * CELL_H + CELL_H / 2;
        ctx.textAlign = 'center';
        ctx.fillStyle = k === 0 ? col.fg : v >= 0 ? col.up : col.down;
        ctx.fillText(f(v), x + colW / 2, yy);
      });
      ctx.strokeStyle = col.line;
      ctx.beginPath();
      ctx.moveTo(x + colW - 0.5, 14);
      ctx.lineTo(x + colW - 0.5, H);
      ctx.stroke();
    });
    // Axis + table labels
    ctx.fillStyle = col.muted;
    ctx.textAlign = 'left';
    const every = Math.max(1, Math.ceil(30 / CELL_H));
    for (let i = 0; i < rows; i += every) ctx.fillText(num(hi - i * step, lang, 0), W - AX + 4, 16 + i * CELL_H + CELL_H / 2);
    ctx.strokeStyle = col.line;
    ctx.beginPath();
    ctx.moveTo(0, 16 + gridH + 1.5);
    ctx.lineTo(W, 16 + gridH + 1.5);
    ctx.stroke();
    TABLE.forEach((l, k) => ctx.fillText(l, W - AX + 4, 18 + gridH + k * CELL_H + CELL_H / 2));
  }, [bars, step, mode, theme, W, H, hi, rows, colW, gridH, lang]);

  useEffect(() => {
    const s = scroller.current;
    if (s && stick.current) s.scrollLeft = s.scrollWidth;
  }, [W, bars]);

  return (
    <div
      ref={scroller}
      onScroll={(e) => {
        const s = e.currentTarget;
        stick.current = s.scrollLeft + s.clientWidth >= s.scrollWidth - 8;
      }}
      className="max-h-[75vh] overflow-auto rounded-lg border border-line"
    >
      <canvas ref={ref} style={{ width: W, height: H }} />
    </div>
  );
}
