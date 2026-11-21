import "server-only";
import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, lt, ne, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/lib/db";
import type { TenantCtx } from "@/lib/db/tenant";
import {
  campaigns, customFieldDefs, followUps, leadActivities, leads, memberships, projects, siteVisits, units, users,
} from "@/lib/db/schema";
import { assertCan, can, ForbiddenError } from "@/lib/auth/permissions";
import { NotFoundError, UserError } from "@/lib/errors";
import { normalizeEmail, normalizePhone } from "@/lib/utils";
import { zOptMoney, zOptUuid, zText } from "@/lib/validation";
import { buildCalibration, scoreLead, type LeadFeatures, type OrgScoringStats } from "./scoring";
import { audit } from "./audit";
import { managerIds, notify, notifyMany } from "./notifications";
import { runAutomations } from "./automation";

export const STAGES = ["new", "contacted", "qualified", "follow_up", "site_visit_scheduled", "negotiation", "booked", "lost"] as const;
export type LeadStage = (typeof STAGES)[number];
export const STAGE_LABELS: Record<LeadStage, string> = {
  new: "New", contacted: "Contacted", qualified: "Qualified", follow_up: "Follow-up",
  site_visit_scheduled: "Site Visit Scheduled", negotiation: "Negotiation", booked: "Booked", lost: "Lost",
};
export const SOURCES = ["manual", "import", "website", "api", "meta_ads", "google_ads", "whatsapp", "portal", "referral", "walk_in", "other"] as const;
export const SOURCE_LABELS: Record<(typeof SOURCES)[number], string> = {
  manual: "Manual", import: "Import", website: "Website form", api: "API", meta_ads: "Meta Ads", google_ads: "Google Ads",
  whatsapp: "WhatsApp", portal: "Property portal", referral: "Referral", walk_in: "Walk-in", other: "Other",
};
export const TIMELINES = ["immediate", "within_3_months", "within_6_months", "later", "unknown"] as const;
export const TIMELINE_LABELS: Record<(typeof TIMELINES)[number], string> = {
  immediate: "Immediately", within_3_months: "Within 3 months", within_6_months: "Within 6 months", later: "6+ months", unknown: "Not known",
};
export const PRIORITIES = ["low", "medium", "high", "urgent"] as const;

/** Sales executives only see and act on leads they own. Enforced on every lead query. */
export function leadScope(ctx: TenantCtx): SQL | undefined {
  return can(ctx.role, "leads:read_all") ? undefined : eq(leads.ownerId, ctx.userId ?? "00000000-0000-0000-0000-000000000000");
}

export const leadInputSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(120),
    phone: zText(30).optional(),
    email: z.email("Enter a valid email").trim().max(200).optional(),
    budgetMin: zOptMoney,
    budgetMax: zOptMoney,
    preferredLocation: zText(120).optional(),
    propertyType: zText(60).optional(),
    configuration: zText(60).optional(),
    timeline: z.enum(TIMELINES).default("unknown"),
    projectId: zOptUuid,
    source: z.enum(SOURCES).default("manual"),
    campaignId: zOptUuid,
    ownerId: zOptUuid,
    priority: z.enum(PRIORITIES).default("medium"),
    tags: z.string().max(400).optional(),
    notes: zText(4000).optional(),
    externalRef: zText(200).optional(),
  })
  .refine((v) => v.phone || v.email, { message: "Add a phone number or an email", path: ["phone"] })
  .refine((v) => !v.phone || normalizePhone(v.phone), { message: "Enter a valid phone number", path: ["phone"] })
  .refine((v) => v.budgetMin == null || v.budgetMax == null || v.budgetMin <= v.budgetMax, {
    message: "Minimum budget can't exceed maximum",
    path: ["budgetMin"],
  });
export type LeadInput = z.input<typeof leadInputSchema>;

export function parseTags(raw: string | undefined | null): string[] {
  if (!raw) return [];
  return [...new Set(raw.split(",").map((t) => t.trim().toLowerCase().replace(/[^a-z0-9 _-]/g, "").slice(0, 30)).filter(Boolean))].slice(0, 15);
}

export class DuplicateLeadError extends UserError {
  constructor(public duplicates: { id: string; name: string }[]) {
    super(`Possible duplicate of ${duplicates.map((d) => d.name).join(", ")}.`);
    this.name = "DuplicateLeadError";
  }
}

export async function findDuplicates(tx: Tx, phone: string | null | undefined, email: string | null | undefined, excludeId?: string) {
  const p = normalizePhone(phone);
  const e = normalizeEmail(email);
  if (!p && !e) return [];
  const conds = [p ? eq(leads.phoneNormalized, p) : undefined, e ? eq(leads.emailNormalized, e) : undefined].filter(Boolean) as SQL[];
  return tx
    .select({ id: leads.id, name: leads.name, stage: leads.stage, ownerId: leads.ownerId, createdAt: leads.createdAt })
    .from(leads)
    .where(and(or(...conds), excludeId ? ne(leads.id, excludeId) : undefined))
    .orderBy(asc(leads.createdAt))
    .limit(5);
}

async function assertOwnerIsMember(tx: Tx, ownerId: string | undefined | null) {
  if (!ownerId) return;
  const [m] = await tx.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.userId, ownerId), eq(memberships.isActive, true))).limit(1);
  if (!m) throw new UserError("The selected owner isn't an active member of this organization.");
}

async function assertRefs(tx: Tx, projectId?: string | null, campaignId?: string | null) {
  if (projectId) {
    const [p] = await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!p) throw new UserError("Selected project not found.");
  }
  if (campaignId) {
    const [c] = await tx.select({ id: campaigns.id }).from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
    if (!c) throw new UserError("Selected campaign not found.");
  }
}

export type CreateLeadOptions = {
  /** For inbound capture: when a duplicate exists, log a re-enquiry on it instead of creating a new lead. */
  mergeDuplicates?: boolean;
  /** For manual entry: create even if a possible duplicate exists. */
  allowDuplicate?: boolean;
  activityNote?: string;
  /** Precomputed org scoring stats (bulk imports compute them once). */
  stats?: OrgScoringStats;
};

export async function createLead(tx: Tx, ctx: TenantCtx, input: LeadInput, opts: CreateLeadOptions = {}) {
  assertCan(ctx.role, "leads:write");
  const data = leadInputSchema.parse(input);
  if (data.ownerId && data.ownerId !== ctx.userId) assertCan(ctx.role, "leads:assign");
  await assertOwnerIsMember(tx, data.ownerId);
  await assertRefs(tx, data.projectId, data.campaignId);

  const dups = await findDuplicates(tx, data.phone, data.email);
  if (dups.length) {
    if (opts.mergeDuplicates) {
      const existing = dups[0];
      await tx.insert(leadActivities).values({
        organizationId: ctx.orgId, leadId: existing.id, userId: ctx.userId, type: "system", direction: "inbound",
        body: `Re-enquiry received via ${SOURCE_LABELS[data.source]}${data.notes ? `: ${data.notes}` : ""}`,
        meta: { source: data.source, campaignId: data.campaignId ?? null },
      });
      await tx.update(leads).set({ lastInboundAt: new Date(), updatedAt: new Date() }).where(eq(leads.id, existing.id));
      if (existing.ownerId) {
        await notify(tx, ctx.orgId, existing.ownerId, {
          type: "lead_reenquiry", title: `${existing.name} enquired again`, body: `New enquiry via ${SOURCE_LABELS[data.source]}`, link: `/leads/${existing.id}`,
        });
      }
      await rescoreLead(tx, ctx, existing.id);
      return { id: existing.id, merged: true as const };
    }
    if (!opts.allowDuplicate) throw new DuplicateLeadError(dups.map((d) => ({ id: d.id, name: d.name })));
  }

  // Executives own the leads they create.
  const ownerId = data.ownerId ?? (ctx.role === "sales_executive" ? ctx.userId : null);
  const [lead] = await tx
    .insert(leads)
    .values({
      organizationId: ctx.orgId,
      name: data.name,
      phone: data.phone,
      phoneNormalized: normalizePhone(data.phone),
      email: data.email,
      emailNormalized: normalizeEmail(data.email),
      budgetMin: data.budgetMin,
      budgetMax: data.budgetMax,
      preferredLocation: data.preferredLocation,
      propertyType: data.propertyType,
      configuration: data.configuration,
      timeline: data.timeline,
      projectId: data.projectId,
      source: data.source,
      campaignId: data.campaignId,
      ownerId,
      priority: data.priority,
      tags: parseTags(data.tags),
      notes: data.notes,
      externalRef: data.externalRef,
      duplicateOfId: dups[0]?.id ?? null,
      createdById: ctx.userId,
    })
    .returning({ id: leads.id, name: leads.name });

  await tx.insert(leadActivities).values({
    organizationId: ctx.orgId, leadId: lead.id, userId: ctx.userId, type: "system",
    body: opts.activityNote ?? `Lead created (${SOURCE_LABELS[data.source]})`,
    meta: dups.length ? { possibleDuplicateOf: dups.map((d) => d.id) } : undefined,
  });

  await runAutomations(tx, ctx, "lead_created", { leadId: lead.id });
  const [after] = await tx.select({ ownerId: leads.ownerId }).from(leads).where(eq(leads.id, lead.id));
  if (after?.ownerId && after.ownerId !== ctx.userId) {
    await notify(tx, ctx.orgId, after.ownerId, { type: "lead_assigned", title: `New lead assigned: ${lead.name}`, link: `/leads/${lead.id}` });
  }
  await rescoreLead(tx, ctx, lead.id, opts.stats);
  return { id: lead.id, merged: false as const };
}

export async function getLead(tx: Tx, ctx: TenantCtx, id: string) {
  const parsed = z.uuid().safeParse(id);
  if (!parsed.success) throw new NotFoundError("Lead");
  const [row] = await tx
    .select({
      lead: leads,
      ownerName: users.name,
      projectName: projects.name,
      campaignName: campaigns.name,
    })
    .from(leads)
    .leftJoin(users, eq(users.id, leads.ownerId))
    .leftJoin(projects, eq(projects.id, leads.projectId))
    .leftJoin(campaigns, eq(campaigns.id, leads.campaignId))
    .where(and(eq(leads.id, parsed.data), leadScope(ctx)))
    .limit(1);
  if (!row) throw new NotFoundError("Lead");
  return { ...row.lead, ownerName: row.ownerName, projectName: row.projectName, campaignName: row.campaignName };
}

export async function updateLead(tx: Tx, ctx: TenantCtx, id: string, input: LeadInput) {
  assertCan(ctx.role, "leads:write");
  const current = await getLead(tx, ctx, id);
  const data = leadInputSchema.parse(input);
  await assertRefs(tx, data.projectId, data.campaignId);
  const dups = await findDuplicates(tx, data.phone, data.email, id);
  await tx
    .update(leads)
    .set({
      name: data.name,
      phone: data.phone ?? null,
      phoneNormalized: normalizePhone(data.phone),
      email: data.email ?? null,
      emailNormalized: normalizeEmail(data.email),
      budgetMin: data.budgetMin ?? null,
      budgetMax: data.budgetMax ?? null,
      preferredLocation: data.preferredLocation ?? null,
      propertyType: data.propertyType ?? null,
      configuration: data.configuration ?? null,
      timeline: data.timeline,
      projectId: data.projectId ?? null,
      source: data.source,
      campaignId: data.campaignId ?? null,
      priority: data.priority,
      tags: parseTags(data.tags),
      notes: data.notes ?? null,
      duplicateOfId: dups[0]?.id ?? null,
      updatedAt: new Date(),
    })
    .where(eq(leads.id, current.id));
  if (data.ownerId !== undefined && data.ownerId !== current.ownerId) {
    await assignLeads(tx, ctx, [current.id], data.ownerId ?? null);
  }
  await rescoreLead(tx, ctx, current.id);
  return { duplicates: dups };
}

export async function deleteLead(tx: Tx, ctx: TenantCtx, id: string) {
  assertCan(ctx.role, "leads:delete");
  const lead = await getLead(tx, ctx, id);
  await tx.delete(leads).where(eq(leads.id, lead.id));
  await audit(tx, ctx, "lead.deleted", { type: "lead", id: lead.id }, { name: lead.name });
}

export async function assignLeads(tx: Tx, ctx: TenantCtx, ids: string[], ownerId: string | null) {
  assertCan(ctx.role, "leads:assign");
  if (!ids.length) return 0;
  if (ids.length > 500) throw new UserError("Assign at most 500 leads at a time.");
  await assertOwnerIsMember(tx, ownerId);
  const valid = z.array(z.uuid()).safeParse(ids);
  if (!valid.success) throw new UserError("Invalid lead selection.");
  const owner = ownerId ? (await tx.select({ name: users.name }).from(users).where(eq(users.id, ownerId)))[0] : null;
  const rows = await tx
    .update(leads)
    .set({ ownerId, updatedAt: new Date() })
    .where(and(inArray(leads.id, valid.data), leadScope(ctx)))
    .returning({ id: leads.id, name: leads.name });
  if (rows.length) {
    await tx.insert(leadActivities).values(
      rows.map((r) => ({
        organizationId: ctx.orgId, leadId: r.id, userId: ctx.userId, type: "assignment" as const,
        body: owner ? `Assigned to ${owner.name}` : "Unassigned",
      })),
    );
    if (ownerId && ownerId !== ctx.userId) {
      await notify(tx, ctx.orgId, ownerId, {
        type: "lead_assigned",
        title: rows.length === 1 ? `Lead assigned to you: ${rows[0].name}` : `${rows.length} leads assigned to you`,
        link: rows.length === 1 ? `/leads/${rows[0].id}` : `/leads?owner=me`,
      });
    }
    await audit(tx, ctx, "lead.assigned", { type: "lead", id: rows.length === 1 ? rows[0].id : null }, { count: rows.length, ownerId });
  }
  return rows.length;
}

export async function changeStage(tx: Tx, ctx: TenantCtx, id: string, stage: LeadStage, lostReason?: string) {
  assertCan(ctx.role, "leads:write");
  const lead = await getLead(tx, ctx, id);
  if (!STAGES.includes(stage)) throw new UserError("Unknown stage.");
  if (lead.stage === stage) return;
  if (stage === "booked") throw new UserError("Record a booking to move a lead to Booked — it links the unit, value and payments.");
  if (lead.stage === "booked") throw new UserError("This lead has a booking. Cancel the booking to reopen the lead.");
  if (stage === "lost" && !lostReason?.trim()) throw new UserError("Give a reason when marking a lead as lost.");
  await setStage(tx, ctx, lead.id, lead.stage, stage, lostReason);
}

/** Internal: stage transition with history, close bookkeeping and automations (no permission checks). */
export async function setStage(tx: Tx, ctx: TenantCtx, leadId: string, from: LeadStage, to: LeadStage, lostReason?: string | null) {
  const closing = to === "booked" || to === "lost";
  const [cur] = await tx.select({ score: leads.score }).from(leads).where(eq(leads.id, leadId));
  await tx
    .update(leads)
    .set({
      stage: to,
      stageChangedAt: new Date(),
      lostReason: to === "lost" ? lostReason?.trim().slice(0, 300) : null,
      closedAt: closing ? new Date() : null,
      scoreBeforeClose: closing ? cur?.score ?? null : null,
      updatedAt: new Date(),
    })
    .where(eq(leads.id, leadId));
  await tx.insert(leadActivities).values({
    organizationId: ctx.orgId, leadId, userId: ctx.userId, type: "stage_change",
    body: `${STAGE_LABELS[from]} → ${STAGE_LABELS[to]}${to === "lost" && lostReason ? ` (${lostReason.trim()})` : ""}`,
    meta: { from, to },
  });
  if (to === "qualified") {
    const [l] = await tx.select({ name: leads.name, ownerId: leads.ownerId }).from(leads).where(eq(leads.id, leadId));
    await notifyMany(tx, ctx.orgId, [...(await managerIds(tx)), l?.ownerId].filter((id) => id && id !== ctx.userId), {
      type: "lead_qualified", title: `New qualified lead: ${l?.name ?? "Lead"}`, link: `/leads/${leadId}`, dedupeKey: `qualified:${leadId}`,
    });
  }
  await runAutomations(tx, ctx, "lead_stage_changed", { leadId, stage: to });
  await rescoreLead(tx, ctx, leadId);
}

export const activitySchema = z.object({
  type: z.enum(["note", "call", "email", "whatsapp", "meeting"]),
  direction: z.enum(["inbound", "outbound"]).optional(),
  outcome: zText(80).optional(),
  body: z.string().trim().min(1, "Add a note").max(4000),
});

export async function logActivity(tx: Tx, ctx: TenantCtx, leadId: string, input: z.input<typeof activitySchema>) {
  assertCan(ctx.role, "leads:write");
  const lead = await getLead(tx, ctx, leadId);
  const data = activitySchema.parse(input);
  const direction = data.type === "note" ? null : data.direction ?? "outbound";
  await tx.insert(leadActivities).values({
    organizationId: ctx.orgId, leadId: lead.id, userId: ctx.userId, type: data.type, direction,
    outcome: data.outcome, body: data.body,
  });
  const now = new Date();
  const patch: Partial<typeof leads.$inferInsert> = { updatedAt: now };
  if (direction === "outbound") patch.lastContactedAt = now;
  if (direction === "inbound") {
    patch.lastInboundAt = now;
    patch.lastContactedAt = now;
  }
  await tx.update(leads).set(patch).where(eq(leads.id, lead.id));
  // First outbound contact moves a new lead to Contacted.
  if (lead.stage === "new" && direction) await setStage(tx, ctx, lead.id, "new", "contacted");
  else await rescoreLead(tx, ctx, lead.id);
}

export async function leadTimeline(tx: Tx, leadId: string) {
  return tx
    .select({
      id: leadActivities.id, type: leadActivities.type, direction: leadActivities.direction, outcome: leadActivities.outcome,
      body: leadActivities.body, createdAt: leadActivities.createdAt, userName: users.name,
    })
    .from(leadActivities)
    .leftJoin(users, eq(users.id, leadActivities.userId))
    .where(eq(leadActivities.leadId, leadId))
    .orderBy(desc(leadActivities.createdAt))
    .limit(200);
}

// ─── Listing ────────────────────────────────────────────────────────────────

export const LEAD_SORTS = ["created", "name", "score", "stage", "lastContact", "budget"] as const;
export type LeadFilters = {
  q?: string; stage?: string; owner?: string; source?: string; project?: string; campaign?: string;
  intent?: string; priority?: string; tag?: string; from?: Date; to?: Date; duplicates?: boolean;
  sort?: (typeof LEAD_SORTS)[number]; dir?: "asc" | "desc"; limit?: number; offset?: number;
};

export function leadWhere(ctx: TenantCtx, f: LeadFilters): SQL | undefined {
  const conds: (SQL | undefined)[] = [leadScope(ctx)];
  if (f.q) {
    const like = `%${f.q.replace(/[%_\\]/g, (m) => "\\" + m)}%`;
    const digits = f.q.replace(/\D/g, "");
    conds.push(or(ilike(leads.name, like), ilike(leads.email, like), digits.length >= 4 ? ilike(leads.phoneNormalized, `%${digits}%`) : undefined));
  }
  if (f.stage && (STAGES as readonly string[]).includes(f.stage)) conds.push(eq(leads.stage, f.stage as LeadStage));
  if (f.stage === "open") conds.push(sql`${leads.stage} not in ('booked','lost')`);
  if (f.owner === "me") conds.push(eq(leads.ownerId, ctx.userId!));
  else if (f.owner === "unassigned") conds.push(isNull(leads.ownerId));
  else if (f.owner && z.uuid().safeParse(f.owner).success) conds.push(eq(leads.ownerId, f.owner));
  if (f.source && (SOURCES as readonly string[]).includes(f.source)) conds.push(eq(leads.source, f.source as (typeof SOURCES)[number]));
  if (f.project && z.uuid().safeParse(f.project).success) conds.push(eq(leads.projectId, f.project));
  if (f.campaign && z.uuid().safeParse(f.campaign).success) conds.push(eq(leads.campaignId, f.campaign));
  if (f.intent && ["hot", "warm", "cold"].includes(f.intent)) conds.push(eq(leads.intent, f.intent as "hot"));
  if (f.priority && (PRIORITIES as readonly string[]).includes(f.priority)) conds.push(eq(leads.priority, f.priority as "low"));
  if (f.tag) conds.push(sql`${f.tag.toLowerCase()} = any(${leads.tags})`);
  if (f.from) conds.push(gte(leads.createdAt, f.from));
  if (f.to) conds.push(lt(leads.createdAt, f.to));
  if (f.duplicates) conds.push(sql`${leads.duplicateOfId} is not null`);
  return and(...conds);
}

export async function listLeads(tx: Tx, ctx: TenantCtx, f: LeadFilters) {
  const where = leadWhere(ctx, f);
  const dir = f.dir === "asc" ? asc : desc;
  const order = {
    created: [dir(leads.createdAt)],
    name: [dir(leads.name)],
    score: [sql`${leads.score} ${sql.raw(f.dir === "asc" ? "asc" : "desc")} nulls last`],
    stage: [dir(leads.stage), desc(leads.createdAt)],
    lastContact: [sql`${leads.lastContactedAt} ${sql.raw(f.dir === "asc" ? "asc" : "desc")} nulls last`],
    budget: [sql`${leads.budgetMax} ${sql.raw(f.dir === "asc" ? "asc" : "desc")} nulls last`],
  }[f.sort ?? "created"];
  const [rows, [{ total }]] = await Promise.all([
    tx
      .select({
        id: leads.id, name: leads.name, phone: leads.phone, email: leads.email, stage: leads.stage, source: leads.source,
        priority: leads.priority, score: leads.score, intent: leads.intent, conversionProbability: leads.conversionProbability,
        budgetMin: leads.budgetMin, budgetMax: leads.budgetMax, createdAt: leads.createdAt, lastContactedAt: leads.lastContactedAt,
        ownerId: leads.ownerId, ownerName: users.name, projectName: projects.name, tags: leads.tags, duplicateOfId: leads.duplicateOfId,
        nextAction: leads.nextAction, preferredLocation: leads.preferredLocation,
      })
      .from(leads)
      .leftJoin(users, eq(users.id, leads.ownerId))
      .leftJoin(projects, eq(projects.id, leads.projectId))
      .where(where)
      .orderBy(...order, desc(leads.id))
      .limit(f.limit ?? 25)
      .offset(f.offset ?? 0),
    tx.select({ total: count() }).from(leads).where(where),
  ]);
  return { rows, total: Number(total) };
}

// ─── Scoring (database side) ────────────────────────────────────────────────

export async function orgScoringStats(tx: Tx): Promise<OrgScoringStats> {
  const bySource = await tx
    .select({
      source: leads.source,
      n: count(),
      booked: sql<number>`count(*) filter (where ${leads.stage} = 'booked')`.mapWith(Number),
    })
    .from(leads)
    .where(inArray(leads.stage, ["booked", "lost"]))
    .groupBy(leads.source);
  const closed = await tx
    .select({ score: leads.scoreBeforeClose, stage: leads.stage })
    .from(leads)
    .where(and(inArray(leads.stage, ["booked", "lost"]), sql`${leads.scoreBeforeClose} is not null`))
    .limit(5000);
  const totalN = bySource.reduce((s, r) => s + Number(r.n), 0);
  const totalBooked = bySource.reduce((s, r) => s + r.booked, 0);
  const sourceRates: OrgScoringStats["sourceRates"] = {};
  for (const r of bySource) sourceRates[r.source] = { rate: Number(r.n) ? r.booked / Number(r.n) : 0, n: Number(r.n) };
  return {
    overallRate: totalN ? totalBooked / totalN : null,
    sourceRates,
    calibration: closed.length ? buildCalibration(closed.map((c) => ({ score: c.score ?? 0, booked: c.stage === "booked" }))) : null,
    closedCount: closed.length,
  };
}

export async function leadFeatures(tx: Tx, leadId: string): Promise<LeadFeatures | null> {
  const [lead] = await tx.select().from(leads).where(eq(leads.id, leadId)).limit(1);
  if (!lead) return null;
  const now = Date.now();
  const since30 = new Date(now - 30 * 86400_000);

  const unitScope = lead.projectId ? eq(units.projectId, lead.projectId) : undefined;
  const [inv] = await tx
    .select({
      considered: count(),
      inBudget: lead.budgetMax != null ? sql<number>`count(*) filter (where ${units.price} <= ${lead.budgetMax})`.mapWith(Number) : sql<number>`0`.mapWith(Number),
      cheapest: sql<number | null>`min(${units.price})`.mapWith((v) => (v == null ? null : Number(v))),
    })
    .from(units)
    .where(and(eq(units.status, "available"), unitScope));

  const [act] = await tx
    .select({ inbound: sql<number>`count(*) filter (where ${leadActivities.direction} = 'inbound' and ${leadActivities.createdAt} >= ${since30})`.mapWith(Number) })
    .from(leadActivities)
    .where(eq(leadActivities.leadId, leadId));

  const [fu] = await tx
    .select({
      done: sql<number>`count(*) filter (where ${followUps.status} = 'done')`.mapWith(Number),
      overdue: sql<number>`count(*) filter (where ${followUps.status} = 'pending' and ${followUps.dueAt} < now())`.mapWith(Number),
    })
    .from(followUps)
    .where(eq(followUps.leadId, leadId));

  const visits = await tx
    .select({ status: siteVisits.status, scheduledAt: siteVisits.scheduledAt, interest: siteVisits.interestLevel })
    .from(siteVisits)
    .where(eq(siteVisits.leadId, leadId));
  const upcoming = visits
    .filter((v) => (v.status === "scheduled" || v.status === "confirmed") && v.scheduledAt.getTime() > now)
    .map((v) => (v.scheduledAt.getTime() - now) / 3600_000)
    .sort((a, b) => a - b)[0];
  const interests = visits.filter((v) => v.status === "completed").map((v) => v.interest);
  const bestInterest = interests.includes("high") ? "high" : interests.includes("medium") ? "medium" : interests.includes("low") ? "low" : null;

  const days = (d: Date | null) => (d ? Math.floor((now - d.getTime()) / 86400_000) : null);
  return {
    stage: lead.stage,
    timeline: lead.timeline,
    source: lead.source,
    budgetMax: lead.budgetMax,
    hasPhone: !!lead.phoneNormalized,
    hasEmail: !!lead.emailNormalized,
    hasProject: !!lead.projectId,
    unitsInBudget: lead.budgetMax != null ? inv.inBudget : null,
    unitsConsidered: Number(inv.considered),
    cheapestAvailable: inv.cheapest,
    inboundLast30: act.inbound,
    daysSinceLastContact: days(lead.lastContactedAt),
    daysSinceCreated: days(lead.createdAt) ?? 0,
    daysInStage: days(lead.stageChangedAt) ?? 0,
    completedFollowUps: fu.done,
    overdueFollowUps: fu.overdue,
    visitsCompleted: visits.filter((v) => v.status === "completed").length,
    upcomingVisitWithinHours: upcoming ?? null,
    visitNoShows: visits.filter((v) => v.status === "no_show").length,
    bestVisitInterest: bestInterest,
  };
}

export async function rescoreLead(tx: Tx, _ctx: TenantCtx, leadId: string, stats?: OrgScoringStats) {
  const features = await leadFeatures(tx, leadId);
  if (!features) return null;
  const result = scoreLead(features, stats ?? (await orgScoringStats(tx)));
  await tx
    .update(leads)
    .set({
      score: result.score,
      conversionProbability: result.probability,
      intent: result.intent,
      scoreReasons: result.reasons,
      nextAction: result.nextAction,
      scoredAt: new Date(),
    })
    .where(eq(leads.id, leadId));
  return result;
}

/** Rescores open leads (used by the scheduled sweep so time-based factors stay current). */
export async function rescoreOpenLeads(tx: Tx, ctx: TenantCtx, limit = 500) {
  const stats = await orgScoringStats(tx);
  const open = await tx
    .select({ id: leads.id })
    .from(leads)
    .where(sql`${leads.stage} not in ('booked','lost')`)
    .orderBy(sql`${leads.scoredAt} asc nulls first`)
    .limit(limit);
  for (const l of open) await rescoreLead(tx, ctx, l.id, stats);
  return open.length;
}

export async function leadOptions(tx: Tx, ctx: TenantCtx, q?: string) {
  return tx
    .select({ id: leads.id, name: leads.name, phone: leads.phone })
    .from(leads)
    .where(and(leadScope(ctx), q ? ilike(leads.name, `%${q}%`) : undefined, sql`${leads.stage} <> 'lost'`))
    .orderBy(desc(leads.updatedAt))
    .limit(200);
}

export async function memberOptions(tx: Tx) {
  return tx
    .select({ id: users.id, name: users.name, role: memberships.role })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.isActive, true))
    .orderBy(users.name);
}

export function assertLeadAccess(ctx: TenantCtx, lead: { ownerId: string | null }) {
  if (!can(ctx.role, "leads:read_all") && lead.ownerId !== ctx.userId) throw new ForbiddenError();
}


/** Validates custom field values against the organization's definitions and stores them. */
export async function setCustomFields(tx: Tx, ctx: TenantCtx, leadId: string, values: Record<string, string | undefined>) {
  assertCan(ctx.role, "leads:write");
  const lead = await getLead(tx, ctx, leadId);
  const defs = await tx.select().from(customFieldDefs);
  const out: Record<string, string> = {};
  for (const d of defs) {
    const v = values[d.key]?.trim();
    if (!v) continue;
    if (v.length > 300) throw new UserError(`${d.label} is too long.`);
    if (d.fieldType === "number" && !Number.isFinite(Number(v))) throw new UserError(`${d.label} must be a number.`);
    if (d.fieldType === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new UserError(`${d.label} must be a date.`);
    if (d.fieldType === "select" && !d.options?.includes(v)) throw new UserError(`Choose a valid ${d.label}.`);
    out[d.key] = v;
  }
  await tx.update(leads).set({ customFields: out }).where(eq(leads.id, lead.id));
}
