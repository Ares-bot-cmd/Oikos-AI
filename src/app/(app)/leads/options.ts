import "server-only";
import type { Tx } from "@/lib/db";
import type { TenantCtx } from "@/lib/db/tenant";
import { can } from "@/lib/auth/permissions";
import { memberOptions, SOURCE_LABELS, SOURCES, TIMELINE_LABELS, TIMELINES } from "@/lib/services/leads";
import { projectOptions } from "@/lib/services/projects";
import { campaignOptions } from "@/lib/services/marketing";
import { customFields } from "@/lib/services/org";
import type { LeadFormOptions } from "./lead-form";

export async function leadFormOptions(tx: Tx, ctx: TenantCtx): Promise<LeadFormOptions> {
  const [projects, campaigns, members, cfs] = await Promise.all([projectOptions(tx), campaignOptions(tx), memberOptions(tx), customFields(tx)]);
  return {
    projects: projects.map((p) => ({ value: p.id, label: p.name })),
    campaigns: campaigns.map((c) => ({ value: c.id, label: c.name })),
    members: members.map((m) => ({ value: m.id, label: m.name })),
    sources: SOURCES.map((s) => ({ value: s, label: SOURCE_LABELS[s] })),
    timelines: TIMELINES.map((t) => ({ value: t, label: TIMELINE_LABELS[t] })),
    customFields: cfs.map((c) => ({ key: c.key, label: c.label, fieldType: c.fieldType, options: c.options })),
    canAssign: can(ctx.role, "leads:assign"),
  };
}
