import { Lock } from "lucide-react";
import { Badge, type Tone } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/states";
import { LinkButton } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { STAGE_LABELS, type LeadStage } from "@/lib/services/leads";

const STAGE_TONES: Record<LeadStage, Tone> = {
  new: "info", contacted: "neutral", qualified: "brand", follow_up: "neutral", site_visit_scheduled: "gold",
  negotiation: "warning", booked: "positive", lost: "danger",
};

export function StageBadge({ stage }: { stage: LeadStage }) {
  return <Badge tone={STAGE_TONES[stage]}>{STAGE_LABELS[stage]}</Badge>;
}

export function IntentBadge({ intent, score }: { intent: "hot" | "warm" | "cold" | null; score?: number | null }) {
  if (!intent) return <span className="text-muted">—</span>;
  const tone: Tone = intent === "hot" ? "danger" : intent === "warm" ? "warning" : "info";
  return (
    <Badge tone={tone}>
      {intent[0].toUpperCase() + intent.slice(1)}
      {score != null && <span className="tnum opacity-80">· {score}</span>}
    </Badge>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, Tone> = {
    available: "positive", reserved: "gold", booked: "info", sold: "neutral", active: "brand", completed: "positive", cancelled: "danger",
    scheduled: "info", confirmed: "brand", no_show: "danger", pending: "warning", done: "positive", paid: "positive", partial: "warning",
    overdue: "danger", due: "gold", upcoming: "neutral", sent: "info", delivered: "brand", read: "positive", failed: "danger", received: "neutral",
  };
  return <Badge tone={map[status] ?? "neutral"}>{status.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())}</Badge>;
}

export function NoAccess({ what = "this page" }: { what?: string }) {
  return (
    <Panel>
      <EmptyState
        icon={Lock}
        title="You don't have access"
        description={`Your role doesn't include access to ${what}. Ask an organization admin if you need it.`}
        action={<LinkButton href="/dashboard">Back to dashboard</LinkButton>}
      />
    </Panel>
  );
}
