import { cn } from "@/lib/utils";

export type Tone = "neutral" | "positive" | "warning" | "danger" | "info" | "brand" | "gold";

const tones: Record<Tone, string> = {
  neutral: "bg-ink/[0.06] text-ink-2",
  positive: "bg-positive-soft text-positive",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
  brand: "bg-emerald-soft text-forest",
  gold: "bg-champagne-soft text-[#7d6236]",
};

export function Badge({ tone = "neutral", className, children }: { tone?: Tone; className?: string; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-[11.5px] font-medium", tones[tone], className)}>
      {children}
    </span>
  );
}
