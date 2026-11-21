import "server-only";
import { and, asc, count, desc, eq, gte, lt, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/lib/db";
import type { TenantCtx } from "@/lib/db/tenant";
import { followUps, leadActivities, leads, memberships, projects, siteVisits, users } from "@/lib/db/schema";
import { assertCan, can } from "@/lib/auth/permissions";
import { NotFoundError, UserError } from "@/lib/errors";
import { zDateTime, zText } from "@/lib/validation";
import { getLead, rescoreLead, setStage } from "./leads";
import { notify } from "./notifications";

export const VISIT_STATUS_LABELS = {
  scheduled: "Scheduled", confirmed: "Confirmed", completed: "Completed", no_show: "No-show", cancelled: "Cancelled",
} as const;

export const visitSchema = z.object({
  leadId: z.uuid({ error: "Choose a lead" }),
  projectId: z.uuid({ error: "Choose a project" }),
  scheduledAt: zDateTime,
  assignedToId: z.uuid().optional(),
  note: zText(500).optional(),
});

function visitScope(ctx: TenantCtx): SQL | undefined {
  return can(ctx.role, "leads:read_all") ? undefined : eq(siteVisits.assignedToId, ctx.userId!);
}

export async function scheduleVisit(tx: Tx, ctx: TenantCtx, input: z.input<typeof visitSchema>) {
  assertCan(ctx.role, "leads:write");
  const d = visitSchema.parse(input);
  const lead = await getLead(tx, ctx, d.leadId);
  const [project] = await tx.select({ id: projects.id, name: projects.name }).from(projects).where(eq(projects.id, d.projectId));
  if (!project) throw new UserError("Selected project not found.");
  const when = new Date(d.scheduledAt);
  if (when.getTime() < Date.now() - 3600_000) throw new UserError("Choose a time in the future.");
  if (lead.stage === "booked" || lead.stage === "lost") throw new UserError("This lead is closed.");
  const assignee = d.assignedToId ?? lead.ownerId ?? ctx.userId;
  if (assignee !== ctx.userId) assertCan(ctx.role, "leads:assign");
  if (assignee) {
    const [m] = await tx.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.userId, assignee), eq(memberships.isActive, true)));
    if (!m) throw new UserError("The assignee isn't an active member.");
  }
  const [v] = await tx
    .insert(siteVisits)
    .values({ organizationId: ctx.orgId, leadId: lead.id, projectId: project.id, assignedToId: assignee, scheduledAt: when, createdById: ctx.userId, feedback: d.note })
    .returning({ id: siteVisits.id });
  await tx.insert(leadActivities).values({
    organizationId: ctx.orgId, leadId: lead.id, userId: ctx.userId, type: "site_visit",
    body: `Site visit scheduled at ${project.name} for ${when.toISOString()}`, meta: { visitId: v.id, at: when.toISOString() },
  });
  if (!["site_visit_scheduled", "negotiation"].includes(lead.stage)) await setStage(tx, ctx, lead.id, lead.stage, "site_visit_scheduled");
  else await rescoreLead(tx, ctx, lead.id);
  if (assignee && assignee !== ctx.userId) {
    await notify(tx, ctx.orgId, assignee, { type: "visit_assigned", title: `Site visit assigned: ${lead.name} at ${project.name}`, link: `/site-visits` });
  }
  return v.id;
}

async function getVisit(tx: Tx, ctx: TenantCtx, id: string) {
  if (!z.uuid().safeParse(id).success) throw new NotFoundError("Site visit");
  const [v] = await tx.select().from(siteVisits).where(and(eq(siteVisits.id, id), visitScope(ctx))).limit(1);
  if (!v) throw new NotFoundError("Site visit");
  return v;
}

export async function confirmVisit(tx: Tx, ctx: TenantCtx, id: string) {
  assertCan(ctx.role, "leads:write");
  const v = await getVisit(tx, ctx, id);
  if (v.status !== "scheduled") throw new UserError("Only scheduled visits can be confirmed.");
  await tx.update(siteVisits).set({ status: "confirmed", customerConfirmed: true }).where(eq(siteVisits.id, v.id));
  await tx.insert(leadActivities).values({ organizationId: ctx.orgId, leadId: v.leadId, userId: ctx.userId, type: "site_visit", body: "Customer confirmed the site visit" });
}

export async function rescheduleVisit(tx: Tx, ctx: TenantCtx, id: string, at: string) {
  assertCan(ctx.role, "leads:write");
  const v = await getVisit(tx, ctx, id);
  if (!["scheduled", "confirmed"].includes(v.status)) throw new UserError("Only upcoming visits can be rescheduled.");
  const when = new Date(zDateTime.parse(at));
  if (when.getTime() < Date.now()) throw new UserError("Choose a time in the future.");
  await tx
    .update(siteVisits)
    .set({ scheduledAt: when, status: "scheduled", customerConfirmed: false, rescheduleCount: sql`${siteVisits.rescheduleCount} + 1` })
    .where(eq(siteVisits.id, v.id));
  await tx.insert(leadActivities).values({ organizationId: ctx.orgId, leadId: v.leadId, userId: ctx.userId, type: "site_visit", body: `Site visit rescheduled to ${when.toISOString()}` });
  await rescoreLead(tx, ctx, v.leadId);
}

export const visitOutcomeSchema = z.object({
  status: z.enum(["completed", "no_show", "cancelled"]),
  interestLevel: z.enum(["high", "medium", "low"]).optional(),
  feedback: zText(2000).optional(),
  followUpInDays: z.coerce.number().int().min(0).max(60).optional(),
});

export async function recordVisitOutcome(tx: Tx, ctx: TenantCtx, id: string, input: z.input<typeof visitOutcomeSchema>) {
  assertCan(ctx.role, "leads:write");
  const v = await getVisit(tx, ctx, id);
  if (!["scheduled", "confirmed"].includes(v.status)) throw new UserError("This visit is already closed.");
  const d = visitOutcomeSchema.parse(input);
  if (d.status === "completed" && !d.interestLevel) throw new UserError("Record the customer's interest level.");
  await tx
    .update(siteVisits)
    .set({ status: d.status, interestLevel: d.interestLevel, feedback: d.feedback ?? v.feedback, completedAt: new Date() })
    .where(eq(siteVisits.id, v.id));
  const label = { completed: "Site visit completed", no_show: "Customer did not show up for the site visit", cancelled: "Site visit cancelled" }[d.status];
  await tx.insert(leadActivities).values({
    organizationId: ctx.orgId, leadId: v.leadId, userId: ctx.userId, type: "site_visit",
    direction: d.status === "completed" ? "inbound" : null,
    outcome: d.interestLevel ? `Interest: ${d.interestLevel}` : null, body: d.feedback ? `${label}. ${d.feedback}` : label,
  });
  if (d.status === "completed") {
    await tx.update(leads).set({ lastContactedAt: new Date(), lastInboundAt: new Date() }).where(eq(leads.id, v.leadId));
  }
  if (d.followUpInDays != null) {
    await tx.insert(followUps).values({
      organizationId: ctx.orgId, leadId: v.leadId, assignedToId: v.assignedToId, type: "call", createdById: ctx.userId,
      // 0 days = later today (in 3 hours); otherwise N days from now.
      dueAt: new Date(Date.now() + (d.followUpInDays === 0 ? 3 * 3600_000 : d.followUpInDays * 86400_000)),
      note: d.status === "completed" ? "Post-visit follow-up" : "Reschedule the missed visit",
    });
  }
  await rescoreLead(tx, ctx, v.leadId);
}

export type VisitView = "upcoming" | "today" | "past";

export async function listVisits(tx: Tx, ctx: TenantCtx, view: VisitView, opts: { project?: string; limit?: number; offset?: number } = {}) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start.getTime() + 86400_000);
  const viewCond = {
    today: and(gte(siteVisits.scheduledAt, start), lt(siteVisits.scheduledAt, end)),
    upcoming: and(gte(siteVisits.scheduledAt, now), sql`${siteVisits.status} in ('scheduled','confirmed')`),
    past: sql`(${siteVisits.status} in ('completed','no_show','cancelled') or ${siteVisits.scheduledAt} < ${now})`,
  }[view];
  const where = and(viewCond, visitScope(ctx), opts.project && z.uuid().safeParse(opts.project).success ? eq(siteVisits.projectId, opts.project) : undefined);
  const [rows, [{ total }]] = await Promise.all([
    tx
      .select({
        id: siteVisits.id, scheduledAt: siteVisits.scheduledAt, status: siteVisits.status, customerConfirmed: siteVisits.customerConfirmed,
        interestLevel: siteVisits.interestLevel, feedback: siteVisits.feedback, rescheduleCount: siteVisits.rescheduleCount,
        leadId: leads.id, leadName: leads.name, leadPhone: leads.phone, projectName: projects.name, assigneeName: users.name,
      })
      .from(siteVisits)
      .innerJoin(leads, eq(leads.id, siteVisits.leadId))
      .innerJoin(projects, eq(projects.id, siteVisits.projectId))
      .leftJoin(users, eq(users.id, siteVisits.assignedToId))
      .where(where)
      .orderBy(view === "past" ? desc(siteVisits.scheduledAt) : asc(siteVisits.scheduledAt))
      .limit(opts.limit ?? 25)
      .offset(opts.offset ?? 0),
    tx.select({ total: count() }).from(siteVisits).where(where),
  ]);
  return { rows, total: Number(total) };
}

export async function leadVisits(tx: Tx, leadId: string) {
  return tx
    .select({
      id: siteVisits.id, scheduledAt: siteVisits.scheduledAt, status: siteVisits.status, interestLevel: siteVisits.interestLevel,
      feedback: siteVisits.feedback, projectName: projects.name, assigneeName: users.name, customerConfirmed: siteVisits.customerConfirmed,
    })
    .from(siteVisits)
    .innerJoin(projects, eq(projects.id, siteVisits.projectId))
    .leftJoin(users, eq(users.id, siteVisits.assignedToId))
    .where(eq(siteVisits.leadId, leadId))
    .orderBy(desc(siteVisits.scheduledAt));
}
