import type { Metadata } from "next";
import { loadPage } from "@/lib/server-action";
import { can } from "@/lib/auth/permissions";
import { getOrganization, PLANS, usage } from "@/lib/services/org";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Badge } from "@/components/ui/badge";
import { Notice } from "@/components/ui/states";
import { NoAccess } from "@/components/app/bits";
import { Meter } from "@/components/charts";
import { formatDate, formatNumber } from "@/lib/utils";

export const metadata: Metadata = { title: "Billing" };

export default async function BillingSettings() {
  const { session, data } = await loadPage(async (tx, ctx) => ({ org: await getOrganization(tx, ctx.orgId), u: await usage(tx) }));
  if (!can(session.role, "billing:manage")) return <NoAccess what="billing" />;
  const plan = PLANS[(data.org.plan as keyof typeof PLANS) ?? "trial"] ?? PLANS.trial;
  const rows = [
    { label: "Active seats", used: data.u.seats, limit: plan.seats },
    { label: "Leads this month", used: data.u.leadsMonth, limit: plan.leadsPerMonth },
  ];
  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader title="Current plan" actions={<Badge tone="brand">{plan.label}</Badge>} />
        <div className="space-y-4 p-4">
          {data.org.plan === "trial" && data.org.trialEndsAt && <p className="text-[13.5px] text-ink-2">Your trial {data.org.trialEndsAt > new Date() ? "ends" : "ended"} on <strong>{formatDate(data.org.trialEndsAt)}</strong>.</p>}
          <div className="grid gap-4 sm:grid-cols-2">
            {rows.map((r) => (
              <div key={r.label}>
                <div className="mb-1 flex justify-between text-[13px]"><span className="text-ink-2">{r.label}</span><span className="tnum">{formatNumber(r.used)} / {formatNumber(r.limit)}</span></div>
                <Meter value={r.used / r.limit} />
              </div>
            ))}
          </div>
          <dl className="grid grid-cols-2 gap-3 border-t border-line pt-4 text-[13px] sm:grid-cols-4">
            <div><dt className="text-muted">Total leads</dt><dd className="tnum font-medium">{formatNumber(data.u.leadsTotal)}</dd></div>
            <div><dt className="text-muted">Projects</dt><dd className="tnum font-medium">{formatNumber(data.u.projects)}</dd></div>
            <div><dt className="text-muted">Units</dt><dd className="tnum font-medium">{formatNumber(data.u.units)}</dd></div>
            <div><dt className="text-muted">Workspace created</dt><dd className="font-medium">{formatDate(data.org.createdAt)}</dd></div>
          </dl>
        </div>
      </Panel>
      <Notice tone="info">Online payment for subscriptions isn&apos;t enabled on this deployment. To change plans or seat limits, contact Oikos AI support — your usage above is calculated live from your workspace.</Notice>
    </div>
  );
}
