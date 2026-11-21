import type { Metadata } from "next";
import { CheckCircle2 } from "lucide-react";
import { loadPage } from "@/lib/server-action";
import { aiAvailable } from "@/lib/ai/claude";
import { generateInsights } from "@/lib/services/insights";
import { PageHeader, Panel, PanelHeader } from "@/components/ui/panel";
import { EmptyState } from "@/components/ui/states";
import { InsightRow } from "@/components/app/insight-row";
import { Assistant, BriefingButton, RefreshInsightsButton } from "./assistant";

export const metadata: Metadata = { title: "AI Insights" };

export default async function InsightsPage() {
  const { session, data } = await loadPage((tx, ctx, s) => generateInsights(tx, ctx, s.currency));
  const ai = aiAvailable();
  const generatedAt = new Date().toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: session.timezone });
  return (
    <>
      <PageHeader
        title="AI Insights"
        description="Recommendations generated from your live data — every one cites the numbers behind it — and an assistant that answers questions about your business."
        actions={<><RefreshInsightsButton /><BriefingButton available={ai} /></>}
      />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,6fr)_minmax(0,5fr)]">
        <Panel className="self-start">
          <PanelHeader title="Recommendations" description={`${data.length} insight${data.length === 1 ? "" : "s"} · generated ${generatedAt}`} />
          {data.length === 0 ? (
            <EmptyState icon={CheckCircle2} title="Nothing needs attention" description="Insights appear as leads, follow-ups, campaigns and bookings are recorded. Some checks need a minimum amount of history before they report." />
          ) : (
            <div className="divide-y divide-line">{data.map((i) => <InsightRow key={i.id} insight={i} />)}</div>
          )}
        </Panel>
        <Panel className="self-start">
          <PanelHeader title="Ask Oikos AI" description="Answers use only your organization's data, with your access level" />
          <Assistant available={ai} />
        </Panel>
      </div>
    </>
  );
}
