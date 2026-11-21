"use client";

import {
  Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis
} from "recharts";
import { cn, formatMoney, formatNumber } from "@/lib/utils";

/**
 * Categorical series colours, validated (light surface) for lightness band, chroma,
 * colour-vision-deficiency separation and 3:1 contrast. Assigned in this fixed order, never cycled.
 */
export const SERIES = ["#1E7D57", "#2F6DB5", "#B27716", "#8A5CB8", "#D0582E"] as const;
const GRID = "#E6E8E1";
const AXIS = "#6F7A72";

type Fmt = "money" | "number" | "percent";
function fmt(v: number, kind: Fmt, currency: string) {
  if (kind === "money") return formatMoney(v, currency, true);
  if (kind === "percent") return `${(v * 100).toFixed(1)}%`;
  return formatNumber(v, v % 1 ? 1 : 0);
}

function shortLabel(v: string) {
  if (/^\d{4}-\d{2}$/.test(v)) return new Date(v + "-01T00:00:00").toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(v + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  return v;
}

type TipProps = { active?: boolean; payload?: ReadonlyArray<{ dataKey?: unknown; name?: unknown; value?: unknown; color?: string }>; label?: unknown; kind: Fmt; currency: string };

function ChartTooltip({ active, payload, label, kind, currency }: TipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-line bg-surface px-3 py-2 text-xs shadow-pop">
      <div className="mb-1 font-medium text-ink">{shortLabel(String(label))}</div>
      {payload.map((p) => (
        <div key={String(p.dataKey)} className="flex items-center gap-2 text-ink-2">
          <span className="size-2 rounded-full" style={{ background: p.color }} />
          <span>{String(p.name)}</span>
          <span className="tnum ml-auto pl-3 font-medium text-ink">{fmt(Number(p.value), kind, currency)}</span>
        </div>
      ))}
    </div>
  );
}

export type Series = { key: string; label: string };

export function Legend({ series }: { series: Series[] }) {
  if (series.length < 2) return null;
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
      {series.map((s, i) => (
        <li key={s.key} className="flex items-center gap-1.5">
          <span className="h-0.5 w-3 rounded" style={{ background: SERIES[i % SERIES.length] }} />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

function isEmpty(data: Record<string, string | number | null>[], series: Series[]) {
  return !data.some((d) => series.some((s) => Number(d[s.key] ?? 0) !== 0));
}

function EmptyChart({ height, text }: { height: number; text: string }) {
  return (
    <div style={{ height }} className="flex items-center justify-center rounded-md border border-dashed border-line text-[13px] text-muted">
      {text}
    </div>
  );
}

export function LineTrend({
  data, x, series, kind = "number", currency = "INR", height = 240, dashedKeys = [], emptyText = "No data for this period yet.",
}: {
  data: Record<string, string | number | null>[]; x: string; series: Series[]; kind?: Fmt; currency?: string; height?: number; dashedKeys?: string[]; emptyText?: string;
}) {
  if (isEmpty(data, series)) return <EmptyChart height={height} text={emptyText} />;
  return (
    <div>
      <div className="mb-2"><Legend series={series} /></div>
      <div style={{ height }} role="img" aria-label={`Line chart of ${series.map((s) => s.label).join(", ")}`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey={x} tickFormatter={shortLabel} stroke={AXIS} fontSize={11} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={16} />
            <YAxis tickFormatter={(v) => fmt(v, kind, currency)} stroke={AXIS} fontSize={11} tickLine={false} axisLine={false} width={kind === "money" ? 68 : 40} />
            <Tooltip content={(p) => <ChartTooltip {...p} kind={kind} currency={currency} />} cursor={{ stroke: AXIS, strokeDasharray: "3 3" }} />
            {series.map((s, i) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stroke={SERIES[i % SERIES.length]}
                strokeWidth={2}
                strokeDasharray={dashedKeys.includes(s.key) ? "5 4" : undefined}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: "#fff" }}
                isAnimationActive={false}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function Bars({
  data, x, series, kind = "number", currency = "INR", height = 240, stacked = false, emptyText = "No data for this period yet.",
}: {
  data: Record<string, string | number | null>[]; x: string; series: Series[]; kind?: Fmt; currency?: string; height?: number; stacked?: boolean; emptyText?: string;
}) {
  if (isEmpty(data, series)) return <EmptyChart height={height} text={emptyText} />;
  return (
    <div>
      <div className="mb-2"><Legend series={series} /></div>
      <div style={{ height }} role="img" aria-label={`Bar chart of ${series.map((s) => s.label).join(", ")}`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }} barGap={2} barCategoryGap="22%">
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey={x} tickFormatter={shortLabel} stroke={AXIS} fontSize={11} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={8} />
            <YAxis tickFormatter={(v) => fmt(v, kind, currency)} stroke={AXIS} fontSize={11} tickLine={false} axisLine={false} width={kind === "money" ? 68 : 36} allowDecimals={false} />
            <Tooltip content={(p) => <ChartTooltip {...p} kind={kind} currency={currency} />} cursor={{ fill: "rgba(23,59,47,0.05)" }} />
            {series.map((s, i) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.label}
                fill={SERIES[i % SERIES.length]}
                stackId={stacked ? "a" : undefined}
                radius={stacked ? (i === series.length - 1 ? [4, 4, 0, 0] : 0) : [4, 4, 0, 0]}
                stroke={stacked ? "#fff" : undefined}
                strokeWidth={stacked ? 2 : 0}
                maxBarSize={36}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Horizontal comparison bars rendered in HTML (labels never collide, readable on mobile). */
export function RankBars({
  rows, kind = "number", currency = "INR", emptyText = "No data for this period.",
}: {
  rows: { label: string; value: number; sub?: string; href?: string }[]; kind?: Fmt; currency?: string; emptyText?: string;
}) {
  const max = Math.max(...rows.map((r) => r.value), 0);
  if (!rows.length || max === 0) return <p className="py-6 text-center text-[13px] text-muted">{emptyText}</p>;
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.label} title={`${r.label}: ${fmt(r.value, kind, currency)}`}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-[13px]">
            {r.href ? <a href={r.href} className="truncate text-ink hover:underline">{r.label}</a> : <span className="truncate text-ink">{r.label}</span>}
            <span className="tnum shrink-0 font-medium text-ink">
              {fmt(r.value, kind, currency)}
              {r.sub && <span className="ml-1.5 font-normal text-muted">{r.sub}</span>}
            </span>
          </div>
          <div className="h-2 rounded-full bg-ink/[0.05]">
            <div className="h-2 rounded-full bg-emerald" style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function Funnel({ steps }: { steps: { label: string; value: number; ofTotal: number | null; stepRate: number | null }[] }) {
  const top = steps[0]?.value ?? 0;
  if (!top) return <p className="py-6 text-center text-[13px] text-muted">No leads in this period yet.</p>;
  return (
    <ol className="space-y-2">
      {steps.map((s, i) => (
        <li key={s.label} className="grid grid-cols-[120px_1fr] items-center gap-3 sm:grid-cols-[150px_1fr]" title={`${s.label}: ${s.value}`}>
          <div className="text-[13px] leading-tight text-ink-2">
            {s.label}
            {i > 0 && s.stepRate != null && <div className="tnum text-[11.5px] text-muted">{(s.stepRate * 100).toFixed(0)}% of previous</div>}
          </div>
          <div className="flex items-center gap-2">
            <div className={cn("h-7 rounded", i === steps.length - 1 ? "bg-forest" : "bg-emerald")} style={{ width: `${Math.max(1.5, (s.value / top) * 100)}%`, opacity: 1 - i * 0.09 }} />
            <span className="tnum shrink-0 text-[13px] font-medium">{formatNumber(s.value)}</span>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Thin progress meter, e.g. target attainment or absorption. */
export function Meter({ value, className }: { value: number | null; className?: string }) {
  const pct = Math.max(0, Math.min(1, value ?? 0));
  return (
    <div className={cn("h-1.5 w-full rounded-full bg-ink/[0.06]", className)} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct * 100)}>
      <div className={cn("h-1.5 rounded-full", pct >= 1 ? "bg-positive" : "bg-emerald")} style={{ width: `${pct * 100}%` }} />
    </div>
  );
}
