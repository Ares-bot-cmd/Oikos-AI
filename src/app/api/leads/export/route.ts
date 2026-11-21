import { NextResponse, type NextRequest } from "next/server";
import { getSession, ctxOf } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { withTenant } from "@/lib/db/tenant";
import { listLeads, SOURCE_LABELS, STAGE_LABELS, TIMELINE_LABELS } from "@/lib/services/leads";
import { leads } from "@/lib/db/schema";
import { inArray } from "drizzle-orm";
import { audit } from "@/lib/services/audit";
import { toCsv } from "@/lib/utils";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(session.role, "leads:export")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const p = req.nextUrl.searchParams;
  const get = (k: string) => p.get(k)?.slice(0, 200) || undefined;
  const ctx = ctxOf(session);
  const csv = await withTenant(ctx, async (tx) => {
    const { rows } = await listLeads(tx, ctx, {
      q: get("q"), stage: get("stage"), owner: get("owner"), source: get("source"), project: get("project"), campaign: get("campaign"),
      intent: get("intent"), priority: get("priority"), tag: get("tag"), duplicates: get("duplicates") === "1", limit: 20000, offset: 0,
    });
    const extra = rows.length
      ? await tx.select({ id: leads.id, timeline: leads.timeline, location: leads.preferredLocation, configuration: leads.configuration, notes: leads.notes }).from(leads).where(inArray(leads.id, rows.map((r) => r.id)))
      : [];
    const byId = new Map(extra.map((e) => [e.id, e]));
    await audit(tx, ctx, "leads.exported", { type: "lead" }, { count: rows.length });
    return toCsv(
      ["Name", "Phone", "Email", "Stage", "Source", "Score", "Intent", "Conversion probability", "Budget min", "Budget max", "Timeline", "Location", "Configuration", "Project", "Owner", "Tags", "Created", "Last contacted", "Notes"],
      rows.map((r) => {
        const e = byId.get(r.id);
        return [r.name, r.phone, r.email, STAGE_LABELS[r.stage], SOURCE_LABELS[r.source], r.score, r.intent, r.conversionProbability, r.budgetMin, r.budgetMax,
          e ? TIMELINE_LABELS[e.timeline] : "", e?.location, e?.configuration, r.projectName, r.ownerName, r.tags.join(", "), r.createdAt, r.lastContactedAt, e?.notes];
      }),
    );
  });
  return new NextResponse("﻿" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="leads-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
