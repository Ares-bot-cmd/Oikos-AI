import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * KPI tile. `delta` is the relative change vs the comparison period (0.12 = +12%).
 * `goodWhenUp=false` flips the colour for cost metrics.
 */
export function Stat({
  label,
  value,
  delta,
  goodWhenUp = true,
  hint,
  className,
}: {
  label: string;
  value: React.ReactNode;
  delta?: number | null;
  goodWhenUp?: boolean;
  hint?: React.ReactNode;
  className?: string;
}) {
  const hasDelta = delta != null && Number.isFinite(delta);
  const up = hasDelta && delta! > 0.0005;
  const down = hasDelta && delta! < -0.0005;
  const good = (up && goodWhenUp) || (down && !goodWhenUp);
  const bad = (down && goodWhenUp) || (up && !goodWhenUp);
  return (
    <div className={cn("rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3.5 shadow-card", className)}>
      <div className="text-[12.5px] font-medium text-muted">{label}</div>
      <div className="tnum mt-1 font-display text-[22px] font-bold leading-tight text-ink">{value}</div>
      <div className="mt-1 flex min-h-[18px] items-center gap-1.5 text-xs">
        {hasDelta && (
          <span className={cn("tnum inline-flex items-center gap-0.5 font-medium", good && "text-positive", bad && "text-danger", !good && !bad && "text-muted")}>
            {up ? <ArrowUpRight className="size-3.5" /> : down ? <ArrowDownRight className="size-3.5" /> : <Minus className="size-3.5" />}
            {Math.abs(delta! * 100).toFixed(1)}%
          </span>
        )}
        {hint && <span className="truncate text-muted">{hint}</span>}
      </div>
    </div>
  );
}

export function delta(current: number | null | undefined, previous: number | null | undefined): number | null {
  if (current == null || previous == null) return null;
  if (previous === 0) return null;
  return (current - previous) / Math.abs(previous);
}
