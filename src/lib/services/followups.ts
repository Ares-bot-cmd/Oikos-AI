import "server-only";
import { and, asc, count, desc, eq, gte, lt, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/lib/db";
import type { TenantCtx } from "@/lib/db/tenant";
import { followUps, leadActivities, leads, memberships, users } from "@/lib/db/schema";
import { assertCan, can } from "@/lib/auth/permissions";
import { NotFoundError, UserError } from "@/lib/errors";
import { zDateTime, zText } from "@/lib/validation";
import { getLead, rescoreLead, setStage } from "./leads";
import { notify } from "./notifications";

export const FOLLOW_UP_TYPES = ["call", "whatsapp", "email", "meeting", "other"] as const;

export const followUpSchema = z.object({
  leadId: z.uuid({ error: "Choose a lead" }),
  dueAt: zDateTime,
  type: z.enum(FOLLOW_UP_TYPES).default("call"),
  note: zText(500).optional(),
  assignedToId: z.uuid().optional(),
});

function followUpScope(ctx: TenantCtx): SQL | undefined {
  return can(ctx.role, "leads:read_all") ? undefined : eq(followUps.assignedToId, ctx.userId!);
}

export async function scheduleFollowUp(tx: Tx, ctx: TenantCtx, input: z.input<typeof followUpSchema>) {
  assertCan(ctx.role, "leads:write");
  const d = followUpSchema.parse(input);
  const lead = await getLead(tx, ctx, d.leadId);
  const assignee = d.assignedToId ?? lead.ownerId ?? ctx.userId;
  if (assignee !== ctx.userId) assertCan(ctx.role, "leads:assign");
  if (assignee) {
    const [m] = await tx.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.userId, assignee), eq(memberships.isActive, true)));
    if (!m) throw new UserError("The assignee isn't an active member.");
  }
  const due = new Date(d.dueAt);
  const [f] = await tx
    .insert(followUps)
    .values({ organizationId: ctx.orgId, leadId: lead.id, assignedToId: assignee, dueAt: due, type: d.type, note: d.note, createdById: ctx.userId })
    .returning({ id: followUps.id });
  await tx.insert(leadActivities).values({
    organizationId: ctx.orgId, leadId: lead.id, userId: ctx.userId, type: "follow_up",
    body: `Follow-up (${d.type}) scheduled for ${due.toISOString()}${d.note ? ` — ${d.note}` : ""}`, meta: { followUpId: f.id, dueAt: due.toISOString() },
  });
  if (lead.stage === "contacted" || lead.stage === "qualified") await setStage(tx, ctx, lead.id, lead.stage, "follow_up");
  else await rescoreLead(tx, ctx, lead.id);
  if (assignee && assignee !== ctx.userId) {
    await notify(tx, ctx.orgId, assignee, { type: "follow_up_assigned", title: `Follow-up assigned: ${lead.name}`, link: `/leads/${lead.id}` });
  }
  return f.id;
}

async function getFollowUp(tx: Tx, ctx: TenantCtx, id: string) {
  if (!z.uuid().safeParse(id).success) throw new NotFoundError("Follow-up");
  const [f] = await tx.select().from(followUps).where(and(eq(followUps.id, id), followUpScope(ctx))).limit(1);
  if (!f) throw new NotFoundError("Follow-up");
  return f;
}

export const completeSchema = z.object({
  outcome: z.enum(["connected", "no_answer", "busy", "call_back_later", "interested", "not_interested", "wrong_number"]),
  note: zText(1000).optional(),
  nextDueAt: zDateTime.optional(),
});
export const OUTCOME_LABELS: Record<z.infer<typeof completeSchema>["outcome"], string> = {
  connected: "Connected", no_answer: "No answer", busy: "Busy", call_back_later: "Call back later",
  interested: "Interested", not_interested: "Not interested", wrong_number: "Wrong number",
};

export async function completeFollowUp(tx: Tx, ctx: TenantCtx, id: string, input: z.input<typeof completeSchema>) {
  assertCan(ctx.role, "leads:write");
  const f = await getFollowUp(tx, ctx, id);
  if (f.status !== "pending") throw new UserError("This follow-up is already closed.");
  const d = completeSchema.parse(input);
  const lead = await getLead(tx, ctx, f.leadId);
  await tx.update(followUps).set({ status: "done", outcome: d.outcome, completedAt: new Date() }).where(eq(followUps.id, f.id));
  const reached = ["connected", "interested", "not_interested", "call_back_later"].includes(d.outcome);
  await tx.insert(leadActivities).values({
    organizationId: ctx.orgId, leadId: f.leadId, userId: ctx.userId, type: f.type === "whatsapp" ? "whatsapp" : f.type === "email" ? "email" : f.type === "meeting" ? "meeting" : "call",
    direction: "outbound", outcome: OUTCOME_LABELS[d.outcome], body: d.note ?? `Follow-up completed: ${OUTCOME_LABELS[d.outcome]}`,
  });
  // A two-way conversation counts as an inbound response for engagement scoring.
  const now = new Date();
  await tx.update(leads).set({ lastContactedAt: now, ...(reached ? { lastInboundAt: now } : {}), updatedAt: now }).where(eq(leads.id, f.leadId));
  if (reached) {
    await tx.insert(leadActivities).values({ organizationId: ctx.orgId, leadId: f.leadId, userId: ctx.userId, type: "system", direction: "inbound", body: "Customer responded on follow-up" });
  }
  if (d.nextDueAt) {
    await scheduleFollowUp(tx, ctx, { leadId: f.leadId, dueAt: d.nextDueAt, type: f.type, assignedToId: f.assignedToId ?? undefined });
  }
  if (lead.stage === "new") await setStage(tx, ctx, lead.id, "new", "contacted");
  else await rescoreLead(tx, ctx, lead.id);
}

export async function cancelFollowUp(tx: Tx, ctx: TenantCtx, id: string) {
  assertCan(ctx.role, "leads:write");
  const f = await getFollowUp(tx, ctx, id);
  if (f.status !== "pending") throw new UserError("This follow-up is already closed.");
  await tx.update(followUps).set({ status: "cancelled", completedAt: new Date() }).where(eq(followUps.id, f.id));
  await rescoreLead(tx, ctx, f.leadId);
}

export async function rescheduleFollowUp(tx: Tx, ctx: TenantCtx, id: string, dueAt: string) {
  assertCan(ctx.role, "leads:write");
  const f = await getFollowUp(tx, ctx, id);
  if (f.status !== "pending") throw new UserError("This follow-up is already closed.");
  const due = new Date(zDateTime.parse(dueAt));
  await tx.update(followUps).set({ dueAt: due }).where(eq(followUps.id, f.id));
  await rescoreLead(tx, ctx, f.leadId);
}

export type FollowUpView = "overdue" | "today" | "upcoming" | "done";

export async function listFollowUps(tx: Tx, ctx: TenantCtx, view: FollowUpView, opts: { assignee?: string; limit?: number; offset?: number } = {}) {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(startOfDay.getTime() + 86400_000);
  const viewCond = {
    overdue: and(eq(followUps.status, "pending"), lt(followUps.dueAt, now)),
    today: and(eq(followUps.status, "pending"), gte(followUps.dueAt, now), lt(followUps.dueAt, endOfDay)),
    upcoming: and(eq(followUps.status, "pending"), gte(followUps.dueAt, endOfDay)),
    done: sql`${followUps.status} <> 'pending'`,
  }[view];
  const assigneeCond = opts.assignee === "me" ? eq(followUps.assignedToId, ctx.userId!) : opts.assignee && z.uuid().safeParse(opts.assignee).success ? eq(followUps.assignedToId, opts.assignee) : undefined;
  const where = and(viewCond, followUpScope(ctx), assigneeCond);
  const [rows, [{ total }]] = await Promise.all([
    tx
      .select({
        id: followUps.id, dueAt: followUps.dueAt, type: followUps.type, note: followUps.note, status: followUps.status,
        outcome: followUps.outcome, completedAt: followUps.completedAt, leadId: leads.id, leadName: leads.name, leadPhone: leads.phone,
        leadStage: leads.stage, leadIntent: leads.intent, assignedToId: followUps.assignedToId, assigneeName: users.name,
      })
      .from(followUps)
      .innerJoin(leads, eq(leads.id, followUps.leadId))
      .leftJoin(users, eq(users.id, followUps.assignedToId))
      .where(where)
      .orderBy(view === "done" ? desc(followUps.completedAt) : asc(followUps.dueAt))
      .limit(opts.limit ?? 25)
      .offset(opts.offset ?? 0),
    tx.select({ total: count() }).from(followUps).where(where),
  ]);
  return { rows, total: Number(total) };
}

export async function followUpCounts(tx: Tx, ctx: TenantCtx) {
  const now = new Date();
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const [r] = await tx
    .select({
      overdue: sql<number>`count(*) filter (where ${followUps.status} = 'pending' and ${followUps.dueAt} < ${now})`.mapWith(Number),
      today: sql<number>`count(*) filter (where ${followUps.status} = 'pending' and ${followUps.dueAt} >= ${now} and ${followUps.dueAt} < ${endOfDay})`.mapWith(Number),
      upcoming: sql<number>`count(*) filter (where ${followUps.status} = 'pending' and ${followUps.dueAt} >= ${endOfDay})`.mapWith(Number),
    })
    .from(followUps)
    .where(followUpScope(ctx));
  return r;
}

export async function leadFollowUps(tx: Tx, leadId: string) {
  return tx
    .select({
      id: followUps.id, dueAt: followUps.dueAt, type: followUps.type, note: followUps.note, status: followUps.status,
      outcome: followUps.outcome, assigneeName: users.name,
    })
    .from(followUps)
    .leftJoin(users, eq(users.id, followUps.assignedToId))
    .where(eq(followUps.leadId, leadId))
    .orderBy(desc(followUps.dueAt))
    .limit(50);
}
