"use server";

import { eq } from "drizzle-orm";
import { z } from "zod";
import { formObject, type ActionState } from "@/lib/actions";
import { tenantAction } from "@/lib/server-action";
import { assertCan } from "@/lib/auth/permissions";
import { leads, messageTemplates, organizations } from "@/lib/db/schema";
import { NotFoundError } from "@/lib/errors";
import { getLead } from "@/lib/services/leads";
import { sendTemplate, sendText } from "@/lib/services/whatsapp";
import { audit } from "@/lib/services/audit";

export async function sendTextAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const d = formObject(fd);
  return tenantAction(async (tx, ctx) => {
    await sendText(tx, ctx, z.uuid().parse(d.leadId), d.body ?? "");
    return { ok: true, message: "Message sent to WhatsApp." };
  });
}

export async function sendTemplateAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const d = formObject(fd);
  const params = fd.getAll("param").map(String).filter((p) => p.trim()).map((p) => p.slice(0, 200));
  return tenantAction(async (tx, ctx) => {
    await sendTemplate(tx, ctx, z.uuid().parse(d.leadId), z.uuid({ error: "Choose a template" }).parse(d.templateId), params);
    return { ok: true, message: "Template sent to WhatsApp." };
  });
}

export async function setHandoffAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const d = formObject(fd);
  return tenantAction(async (tx, ctx) => {
    assertCan(ctx.role, "whatsapp:send");
    const lead = await getLead(tx, ctx, z.uuid().parse(d.leadId));
    const handoff = d.handoff === "true";
    await tx.update(leads).set({ whatsappHandoff: handoff }).where(eq(leads.id, lead.id));
    return { ok: true, message: handoff ? "A human has taken over this conversation." : "Conversation handed back to the AI agent." };
  });
}

const templateSchema = z.object({
  name: z.string().trim().regex(/^[a-z0-9_]{1,120}$/, "Use the exact template name from Meta (lowercase, numbers, underscores)"),
  language: z.string().trim().regex(/^[a-z]{2}(_[A-Z]{2})?$/, "Language code like en or en_US"),
  purpose: z.enum(["general", "follow_up", "visit_reminder", "visit_confirmation", "payment_reminder", "welcome"]),
  body: z.string().trim().min(1, "Paste the template body").max(1024),
});

export async function createTemplateAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const d = formObject(fd);
  return tenantAction(async (tx, ctx) => {
    assertCan(ctx.role, "integrations:manage");
    const t = templateSchema.parse(d);
    const vars = new Set([...t.body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1])));
    await tx.insert(messageTemplates).values({ organizationId: ctx.orgId, ...t, variableCount: vars.size ? Math.max(...vars) : 0 });
    return { ok: true, message: "Template added." };
  });
}

export async function deleteTemplateAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return tenantAction(async (tx, ctx) => {
    assertCan(ctx.role, "integrations:manage");
    const r = await tx.delete(messageTemplates).where(eq(messageTemplates.id, z.uuid().parse(fd.get("id")))).returning({ id: messageTemplates.id });
    if (!r.length) throw new NotFoundError("Template");
    return { ok: true, message: "Template removed." };
  });
}

export async function toggleAgentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return tenantAction(async (tx, ctx) => {
    assertCan(ctx.role, "org:manage");
    const enabled = fd.get("enabled") === "true";
    await tx.update(organizations).set({ aiAgentEnabled: enabled }).where(eq(organizations.id, ctx.orgId));
    await audit(tx, ctx, enabled ? "ai_agent.enabled" : "ai_agent.disabled", { type: "organization", id: ctx.orgId });
    return { ok: true, message: enabled ? "AI agent enabled." : "AI agent disabled." };
  });
}
