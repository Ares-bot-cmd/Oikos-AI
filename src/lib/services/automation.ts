import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/lib/db";
import type { TenantCtx } from "@/lib/db/tenant";
import { automationRules, automationRuns, followUps, leadActivities, leads, memberships, users } from "@/lib/db/schema";
import { assertCan } from "@/lib/auth/permissions";
import { NotFoundError, UserError } from "@/lib/errors";
import { notify, notifyMany, managerIds } from "./notifications";
import { queueWhatsAppTemplate } from "./whatsapp";

export const TRIGGERS = ["lead_created", "lead_stage_changed", "lead_neglected", "follow_up_overdue", "site_visit_upcoming"] as const;
export const ACTIONS = ["assign_round_robin", "assign_user", "notify_owner", "notify_managers", "create_follow_up", "send_whatsapp_template"] as const;
export type Trigger = (typeof TRIGGERS)[number];

export const TRIGGER_LABELS: Record<Trigger, string> = {
  lead_created: "A new lead is created",
  lead_stage_changed: "A lead changes stage",
  lead_neglected: "A lead is neglected (no contact)",
  follow_up_overdue: "A follow-up becomes overdue",
  site_visit_upcoming: "A site visit is within 24 hours",
};
export const ACTION_LABELS: Record<(typeof ACTIONS)[number], string> = {
  assign_round_robin: "Assign round-robin across the team",
  assign_user: "Assign to a specific person",
  notify_owner: "Notify the lead owner",
  notify_managers: "Alert sales managers",
  create_follow_up: "Create a follow-up task",
  send_whatsapp_template: "Send a WhatsApp template",
};

export const ruleSchema = z
  .object({
    name: z.string().trim().min(2, "Name the rule").max(100),
    trigger: z.enum(TRIGGERS),
    action: z.enum(ACTIONS),
    condSource: z.string().max(40).optional(),
    condProjectId: z.uuid().optional(),
    condStage: z.string().max(40).optional(),
    userIds: z.string().max(2000).optional(),
    userId: z.uuid().optional(),
    hours: z.coerce.number().int().min(0).max(720).optional(),
    followUpType: z.enum(["call", "whatsapp", "email", "meeting", "other"]).optional(),
    template: z.string().trim().max(120).optional(),
    language: z.string().trim().max(12).optional(),
    message: z.string().trim().max(200).optional(),
  })
  .refine((v) => v.action !== "assign_user" || v.userId, { message: "Choose who to assign to", path: ["userId"] })
  .refine((v) => v.action !== "send_whatsapp_template" || v.template, { message: "Enter the approved template name", path: ["template"] })
  .refine((v) => !["assign_round_robin", "assign_user"].includes(v.action) || v.trigger === "lead_created", {
    message: "Assignment rules run when a lead is created",
    path: ["action"],
  });

export async function createRule(tx: Tx, ctx: TenantCtx, input: z.input<typeof ruleSchema>) {
  assertCan(ctx.role, "automation:manage");
  const d = ruleSchema.parse(input);
  const conditions: Record<string, string> = {};
  if (d.condSource) conditions.source = d.condSource;
  if (d.condProjectId) conditions.projectId = d.condProjectId;
  if (d.condStage) conditions.stage = d.condStage;
  const actionConfig: Record<string, string> = {};
  if (d.userIds) actionConfig.userIds = d.userIds;
  if (d.userId) actionConfig.userId = d.userId;
  if (d.hours != null) actionConfig.hours = String(d.hours);
  if (d.followUpType) actionConfig.followUpType = d.followUpType;
  if (d.template) actionConfig.template = d.template;
  if (d.language) actionConfig.language = d.language;
  if (d.message) actionConfig.message = d.message;
  if (d.userId) {
    const [m] = await tx.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.userId, d.userId), eq(memberships.isActive, true)));
    if (!m) throw new UserError("That person isn't an active member.");
  }
  const [r] = await tx
    .insert(automationRules)
    .values({ organizationId: ctx.orgId, name: d.name, trigger: d.trigger, action: d.action, conditions, actionConfig })
    .returning({ id: automationRules.id });
  return r.id;
}

export async function toggleRule(tx: Tx, ctx: TenantCtx, id: string, active: boolean) {
  assertCan(ctx.role, "automation:manage");
  const r = await tx.update(automationRules).set({ isActive: active }).where(eq(automationRules.id, id)).returning({ id: automationRules.id });
  if (!r.length) throw new NotFoundError("Rule");
}

export async function deleteRule(tx: Tx, ctx: TenantCtx, id: string) {
  assertCan(ctx.role, "automation:manage");
  const r = await tx.delete(automationRules).where(eq(automationRules.id, id)).returning({ id: automationRules.id });
  if (!r.length) throw new NotFoundError("Rule");
}

type Payload = { leadId: string; stage?: string; subjectKey?: string; visitAt?: Date };

function matches(conditions: Record<string, string>, lead: { source: string; projectId: string | null }, payload: Payload) {
  if (conditions.source && conditions.source !== lead.source) return false;
  if (conditions.projectId && conditions.projectId !== lead.projectId) return false;
  if (conditions.stage && conditions.stage !== payload.stage) return false;
  return true;
}

/**
 * Executes active rules for a trigger. Runs as the system on behalf of the organization:
 * rules are configured by admins, and everything stays inside the tenant transaction.
 */
export async function runAutomations(tx: Tx, ctx: TenantCtx, trigger: Trigger, payload: Payload) {
  const rules = await tx
    .select()
    .from(automationRules)
    .where(and(eq(automationRules.trigger, trigger), eq(automationRules.isActive, true)))
    .orderBy(asc(automationRules.createdAt));
  if (!rules.length) return;
  const [lead] = await tx
    .select({ id: leads.id, name: leads.name, ownerId: leads.ownerId, source: leads.source, projectId: leads.projectId, phone: leads.phoneNormalized })
    .from(leads)
    .where(eq(leads.id, payload.leadId));
  if (!lead) return;

  for (const rule of rules) {
    if (!matches(rule.conditions, lead, payload)) continue;
    if (payload.subjectKey) {
      const ins = await tx
        .insert(automationRuns)
        .values({ organizationId: ctx.orgId, ruleId: rule.id, subjectKey: payload.subjectKey })
        .onConflictDoNothing()
        .returning({ id: automationRuns.id });
      if (!ins.length) continue; // already ran for this subject
    }
    const cfg = rule.actionConfig;
    let ran = true;
    switch (rule.action) {
      case "assign_round_robin": {
        if (lead.ownerId) { ran = false; break; }
        let pool = (cfg.userIds ?? "").split(",").map((s) => s.trim()).filter(Boolean);
        const active = await tx
          .select({ userId: memberships.userId, role: memberships.role })
          .from(memberships)
          .where(and(eq(memberships.isActive, true), eq(memberships.receivesLeads, true)))
          .orderBy(asc(memberships.createdAt));
        const activeIds = new Set(active.map((a) => a.userId));
        pool = pool.length ? pool.filter((id) => activeIds.has(id)) : active.filter((a) => a.role === "sales_executive").map((a) => a.userId);
        if (!pool.length) { ran = false; break; }
        const pick = pool[rule.rrCursor % pool.length];
        await tx.update(leads).set({ ownerId: pick }).where(eq(leads.id, lead.id));
        await tx.update(automationRules).set({ rrCursor: sql`${automationRules.rrCursor} + 1` }).where(eq(automationRules.id, rule.id));
        const [u] = await tx.select({ name: users.name }).from(users).where(eq(users.id, pick));
        await tx.insert(leadActivities).values({ organizationId: ctx.orgId, leadId: lead.id, type: "assignment", body: `Auto-assigned to ${u?.name ?? "team member"} (rule: ${rule.name})` });
        lead.ownerId = pick;
        break;
      }
      case "assign_user": {
        if (lead.ownerId || !cfg.userId) { ran = false; break; }
        const [m] = await tx.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.userId, cfg.userId), eq(memberships.isActive, true)));
        if (!m) { ran = false; break; }
        await tx.update(leads).set({ ownerId: cfg.userId }).where(eq(leads.id, lead.id));
        await tx.insert(leadActivities).values({ organizationId: ctx.orgId, leadId: lead.id, type: "assignment", body: `Auto-assigned (rule: ${rule.name})` });
        lead.ownerId = cfg.userId;
        break;
      }
      case "notify_owner": {
        if (!lead.ownerId) { ran = false; break; }
        await notify(tx, ctx.orgId, lead.ownerId, {
          type: `automation_${trigger}`, title: cfg.message || `${rule.name}: ${lead.name}`, link: `/leads/${lead.id}`,
          dedupeKey: payload.subjectKey ? `rule:${rule.id}:${payload.subjectKey}` : undefined,
        });
        break;
      }
      case "notify_managers": {
        await notifyMany(tx, ctx.orgId, await managerIds(tx), {
          type: `automation_${trigger}`, title: cfg.message || `${rule.name}: ${lead.name}`, link: `/leads/${lead.id}`,
          dedupeKey: payload.subjectKey ? `rule:${rule.id}:${payload.subjectKey}` : undefined,
        });
        break;
      }
      case "create_follow_up": {
        const hours = Number(cfg.hours ?? 1);
        await tx.insert(followUps).values({
          organizationId: ctx.orgId, leadId: lead.id, assignedToId: lead.ownerId, dueAt: new Date(Date.now() + hours * 3600_000),
          type: (cfg.followUpType as "call") ?? "call", note: `Created by automation: ${rule.name}`,
        });
        break;
      }
      case "send_whatsapp_template": {
        if (!lead.phone || !cfg.template) { ran = false; break; }
        await queueWhatsAppTemplate(tx, ctx, lead.id, cfg.template, cfg.language || "en");
        break;
      }
    }
    if (ran) {
      await tx.update(automationRules).set({ runCount: sql`${automationRules.runCount} + 1`, lastRunAt: new Date() }).where(eq(automationRules.id, rule.id));
    }
  }
}

export async function listRules(tx: Tx) {
  return tx.select().from(automationRules).orderBy(asc(automationRules.createdAt));
}

export async function ruleUserNames(tx: Tx, ids: string[]) {
  if (!ids.length) return {};
  const rows = await tx.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids));
  return Object.fromEntries(rows.map((r) => [r.id, r.name]));
}
