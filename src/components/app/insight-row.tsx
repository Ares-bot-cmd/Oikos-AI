import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { Insight } from "@/lib/services/insights";

const SEVERITY_TONE = { critical: "danger", warning: "warning", opportunity: "positive", info: "info" } as const;

export function InsightRow({ insight }: { insight: Insight }) {
  return (
    <div className="px-4 py-3">
      <div className="mb-1 flex items-center gap-2">
        <Badge tone={SEVERITY_TONE[insight.severity]}>{insight.severity}</Badge>
        <span className="text-[11.5px] uppercase tracking-wider text-muted">{insight.category}</span>
      </div>
      <div className="text-[13.5px] font-medium text-ink">{insight.title}</div>
      <p className="mt-0.5 text-[12.5px] text-ink-2">{insight.detail}</p>
      {insight.action && (
        <Link href={insight.action.href} className="mt-1 inline-flex items-center gap-1 text-[12.5px] font-medium text-emerald hover:underline">
          {insight.action.label} <ArrowRight className="size-3" />
        </Link>
      )}
    </div>
  );
}

