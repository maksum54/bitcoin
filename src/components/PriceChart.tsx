import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { PricePoint } from '../lib/calc';
import { compact, dateOnly, dateTime } from '../lib/format';
import { useApp } from '../lib/i18n';

export default function PriceChart({ pts, days, color, format }: { pts: PricePoint[]; days: number; color: string; format: (v: number) => string }) {
  const { lang } = useApp();
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={pts} margin={{ left: 0, right: 0, top: 4, bottom: 0 }}>
        <defs>
          <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="t"
          type="number"
          domain={['dataMin', 'dataMax']}
          tickFormatter={(v) =>
            days <= 1 ? new Date(v).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' }) : dateOnly(v, lang).replace(/,? \d{4}$/, '')
          }
          tick={{ fill: 'var(--muted)', fontSize: 11 }}
          stroke="var(--line)"
          minTickGap={40}
        />
        <YAxis
          dataKey="p"
          domain={['auto', 'auto']}
          tickFormatter={(v) => compact(v, lang)}
          tick={{ fill: 'var(--muted)', fontSize: 11 }}
          stroke="var(--line)"
          width={52}
          orientation="right"
        />
        <Tooltip
          contentStyle={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 12, color: 'var(--fg)' }}
          labelFormatter={(v) => dateTime(v as number, lang)}
          formatter={(v) => [format(v as number), 'BTC']}
        />
        <Area type="monotone" dataKey="p" stroke={color} strokeWidth={2} fill="url(#g)" animationDuration={900} animationEasing="ease-out" />
      </AreaChart>
    </ResponsiveContainer>
  );
}
