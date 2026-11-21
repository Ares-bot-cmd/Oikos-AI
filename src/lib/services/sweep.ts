import "server-only";
import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { withSystem, withTenant, type TenantCtx } from "@/lib/db/tenant";
import { followUps, leads, organizations, projects, siteVisits } from "@/lib/db/schema";
import type { Tx } from "@/lib/db";
import { managerIds, notify, notifyMany } from "./notifications";
import { runAutomations } from "./automation";
import { receivables } from "./bookings";
import { releaseExpiredReservations } from "./projects";
import { rescoreOpenLeads } from "./leads";
import { flushPending } from "./whatsapp";
import { formatMoney } from "@/lib/utils";

const SWEEP_INTERVAL_MS = 10 * 60_000;

/** Time-based work for one organization: reminders, alerts, automations, rescoring. Idempotent. */
export async function sweepOrganization(orgId: string) {
  const ctx: TenantCtx = { orgId, userId: null, role: "system" };
  const stats = { reservationsReleased: 0, overdue: 0, visits: 0, payments: 0, neglected: 0, rescored: 0, whatsapp: 0 };
  await withTenant(ctx, async (tx) => {
    const [org] = await tx.select({ currency: organizations.currency, neglectDays: organizations.neglectDays }).from(organizations).where(eq(organizations.id, orgId));
    if (!org) return;
    stats.reservationsReleased = await releaseExpiredReservations(tx);

    // Missed follow-ups
    const overdue = await tx
      .select({ id: followUps.id, leadId: followUps.leadId, assignedToId: followUps.assignedToId, leadName: leads.name, ownerId: leads.ownerId })
      .from(followUps)
      .innerJoin(leads, eq(leads.id, followUps.leadId))
      .where(and(eq(followUps.status, "pending"), lt(followUps.dueAt, new Date())))
      .limit(500);
    for (const f of overdue) {
      const to = f.assignedToId ?? f.ownerId;
      if (to) await notify(tx, orgId, to, { type: "follow_up_missed", title: `Missed follow-up: ${f.leadName}`, link: `/leads/${f.leadId}`, dedupeKey: `fu-missed:${f.id}` });
      await runAutomations(tx, ctx, "follow_up_overdue", { leadId: f.leadId, subjectKey: `fu:${f.id}` });
    }
    stats.overdue = overdue.length;

    // Upcoming site visits (next 24 hours)
    const visits = await tx
      .select({ id: siteVisits.id, leadId: siteVisits.leadId, at: siteVisits.scheduledAt, assignedToId: siteVisits.assignedToId, leadName: leads.name, projectName: projects.name })
      .from(siteVisits)
      .innerJoin(leads, eq(leads.id, siteVisits.leadId))
      .innerJoin(projects, eq(projects.id, siteVisits.projectId))
      .where(and(inArray(siteVisits.status, ["scheduled", "confirmed"]), sql`${siteVisits.scheduledAt} between now() and now() + interval '24 hours'`))
      .limit(500);
    for (const v of visits) {
      if (v.assignedToId) {
        await notify(tx, orgId, v.assignedToId, {
          type: "visit_upcoming", title: `Upcoming site visit: ${v.leadName}`, body: `${v.projectName}`, link: `/site-visits`, dedupeKey: `visit:${v.id}:${v.at.toISOString()}`,
        });
      }
      await runAutomations(tx, ctx, "site_visit_upcoming", { leadId: v.leadId, subjectKey: `visit:${v.id}:${v.at.toISOString()}` });
    }
    stats.visits = visits.length;

    // Payment reminders: milestones due within 7 days or overdue
    const managers = await managerIds(tx);
    for (const b of await receivables(tx, ctx)) {
      for (const m of b.milestones) {
        if (m.status !== "due" && m.status !== "overdue") continue;
        await notifyMany(tx, orgId, [b.salesUserId, ...managers], {
          type: m.status === "overdue" ? "payment_overdue" : "payment_due",
          title: `${m.status === "overdue" ? "Overdue" : "Payment due"}: ${b.customerName} — ${m.name}`,
          body: `${formatMoney(m.outstanding, org.currency)} ${m.status === "overdue" ? "was due" : "due"} on ${m.dueDate}`,
          link: `/bookings/${b.id}`,
          dedupeKey: `pay:${m.id}:${m.status}`,
        });
        stats.payments++;
      }
    }

    // Neglected leads
    const cutoff = new Date(Date.now() - org.neglectDays * 86400_000);
    const neglected = await tx
      .select({ id: leads.id, name: leads.name, ownerId: leads.ownerId, last: leads.lastContactedAt })
      .from(leads)
      .where(
        and(
          sql`${leads.stage} not in ('booked','lost')`,
          or(lt(leads.lastContactedAt, cutoff), and(isNull(leads.lastContactedAt), lt(leads.createdAt, cutoff))),
        ),
      )
      .limit(500);
    for (const l of neglected) {
      const key = `neglect:${l.id}:${l.last?.toISOString() ?? "never"}`;
      if (l.ownerId) await notify(tx, orgId, l.ownerId, { type: "lead_neglected", title: `No contact for ${org.neglectDays}+ days: ${l.name}`, link: `/leads/${l.id}`, dedupeKey: key });
      await runAutomations(tx, ctx, "lead_neglected", { leadId: l.id, subjectKey: key });
    }
    stats.neglected = neglected.length;

    stats.rescored = await rescoreOpenLeads(tx, ctx, 300);
    stats.whatsapp = await flushPending(tx, ctx);
    await tx.update(organizations).set({ lastSweepAt: new Date() }).where(eq(organizations.id, orgId));
  });
  return stats;
}

/** Runs the sweep only if this organization hasn't been swept recently (called on page loads). */
export async function maybeSweep(orgId: string) {
  const due = await withSystem(async (tx: Tx) => {
    const r = await tx
      .update(organizations)
      .set({ lastSweepAt: new Date() })
      .where(and(eq(organizations.id, orgId), or(isNull(organizations.lastSweepAt), lt(organizations.lastSweepAt, new Date(Date.now() - SWEEP_INTERVAL_MS)))))
      .returning({ id: organizations.id });
    return r.length > 0;
  });
  if (due) await sweepOrganization(orgId);
}

export async function sweepAll() {
  const orgs = await withSystem((tx) => tx.select({ id: organizations.id }).from(organizations));
  const results: Record<string, unknown> = {};
  for (const o of orgs) {
    try {
      results[o.id] = await sweepOrganization(o.id);
    } catch (e) {
      console.error("[sweep] failed for org", o.id, e);
      results[o.id] = { error: true };
    }
  }
  return results;
}
