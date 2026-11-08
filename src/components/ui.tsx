import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useApp } from '../lib/i18n';
import { ago } from '../lib/format';

/** Smoothly animates a number from its previous value to the new one. */
export function useTween(target: number, ms = 700): number {
  const [v, setV] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const start = from.current;
    if (start === target || !Number.isFinite(start) || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      from.current = target;
      setV(target);
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / ms);
      const e = 1 - Math.pow(1 - k, 3); // ease-out cubic
      const cur = start + (target - start) * e;
      from.current = cur;
      setV(cur);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

export function Num({ value, format }: { value: number; format: (v: number) => string }) {
  return <>{format(useTween(value))}</>;
}

/** Returns 'flash-up' / 'flash-down' for ~1s after the value rises or falls. */
export function useFlash(value: number | undefined): string {
  const prev = useRef(value);
  const [cls, setCls] = useState('');
  useEffect(() => {
    const p = prev.current;
    prev.current = value;
    if (p == null || value == null || p === value) return;
    setCls(value > p ? 'flash-up' : 'flash-down');
    const id = setTimeout(() => setCls(''), 1200);
    return () => clearTimeout(id);
  }, [value]);
  return cls;
}

export function Card({ title, right, children, className = '' }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 rounded-2xl border border-line bg-card p-4 ${className}`}>
      {(title || right) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{title}</h2>}
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, sub, tone }: { label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: 'up' | 'down' | null }) {
  return (
    <div className="lift min-w-0 rounded-xl bg-card2 p-3">
      <div className="text-xs leading-tight text-muted">{label}</div>
      <div className={`num mt-1 break-words text-base font-semibold ${tone === 'up' ? 'text-up' : tone === 'down' ? 'text-down' : ''}`}>{value}</div>
      {sub && <div className="num mt-0.5 break-words text-xs text-muted">{sub}</div>}
    </div>
  );
}

export function Btn({
  children,
  onClick,
  kind = 'primary',
  type = 'button',
  disabled,
  className = '',
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  kind?: 'primary' | 'ghost' | 'danger';
  type?: 'button' | 'submit';
  disabled?: boolean;
  className?: string;
  title?: string;
}) {
  const k =
    kind === 'primary'
      ? 'bg-accent text-accent-fg hover:opacity-90'
      : kind === 'danger'
        ? 'border border-line text-down hover:bg-card2'
        : 'border border-line hover:bg-card2';
  return (
    <button type={type} title={title} onClick={onClick} disabled={disabled} className={`rounded-xl px-3 py-2 text-sm font-medium transition disabled:opacity-50 ${k} ${className}`}>
      {children}
    </button>
  );
}

export function Field({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-xs text-muted">{label}</span>
      {children}
    </label>
  );
}

export function Seg<V extends string | number>({ value, options, onChange }: { value: V; options: { v: V; label: ReactNode }[]; onChange: (v: V) => void }) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-xl bg-card2 p-1">
      {options.map((o) => (
        <button
          key={String(o.v)}
          onClick={() => onChange(o.v)}
          className={`rounded-lg px-2.5 py-1 text-xs font-medium duration-300 ${o.v === value ? 'bg-accent text-accent-fg shadow-sm scale-105' : 'text-muted hover:text-fg'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Shimmering placeholder rows while data loads. */
export function Loading({ rows = 3 }: { rows?: number }) {
  const { t } = useApp();
  return (
    <div className="grid gap-2 py-2" role="status" aria-label={t('loading')}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton h-10" style={{ width: `${100 - i * 12}%` }} />
      ))}
    </div>
  );
}

export function ErrorBox({ onRetry, msg }: { onRetry?: () => void; msg?: string }) {
  const { t } = useApp();
  return (
    <div className="anim-slide-down flex flex-wrap items-center justify-between gap-2 rounded-xl border border-down/40 p-3 text-sm text-down">
      <span>{msg ?? t('error')}</span>
      {onRetry && (
        <Btn kind="ghost" onClick={onRetry}>
          {t('retry')}
        </Btn>
      )}
    </div>
  );
}

export function Updated({ at, stale }: { at?: number | string; stale?: boolean }) {
  const { t, lang } = useApp();
  if (!at) return null;
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs ${stale ? 'text-accent' : 'text-muted'}`}>
      <span className={`live-dot shrink-0 ${stale ? 'stale' : ''}`} aria-hidden />
      {stale ? t('stale', { time: ago(at, lang) }) : t('updated', { time: ago(at, lang) })}
    </span>
  );
}

/** Runs an async loader on mount / when deps change, optionally on an interval. Keeps last data during reloads. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[], intervalMs?: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const seq = useRef(0);
  const reload = useCallback(async () => {
    const n = ++seq.current;
    setLoading(true);
    try {
      const d = await fnRef.current();
      if (n === seq.current) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      if (n === seq.current) setError(e);
    } finally {
      if (n === seq.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    setData(null);
    reload();
    if (!intervalMs) return;
    const id = setInterval(() => document.visibilityState === 'visible' && reload(), intervalMs);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, error, loading, reload };
}

/** Rupiah input: "1.000.000", "1,000,000" and "1000000" all mean one million. */
export function parseIdr(s: string): number {
  const n = s.replace(/\s/g, '').replace(/[.,](?=\d{3}(\D|$))/g, '').replace(',', '.');
  const v = Number(n);
  return n !== '' && Number.isFinite(v) ? v : NaN;
}

/** BTC input: "0,005" and "0.005" are both decimals. */
export function parseBtc(s: string): number {
  const n = s.replace(/\s/g, '').replace(',', '.');
  const v = Number(n);
  return n !== '' && Number.isFinite(v) ? v : NaN;
}
