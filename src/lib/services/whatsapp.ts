import "server-only";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import type { TenantCtx } from "@/lib/db/tenant";
import { integrations, leadActivities, leads, messageTemplates, whatsappMessages } from "@/lib/db/schema";
import { assertCan } from "@/lib/auth/permissions";
import { NotFoundError, UserError } from "@/lib/errors";
import { decryptJson } from "@/lib/security/crypto";
import { leadScope } from "./leads";

const GRAPH = () => `https://graph.facebook.com/${process.env.WHATSAPP_GRAPH_VERSION || "v23.0"}`;
const WINDOW_MS = 24 * 3600_000;

export type WhatsAppSecrets = { accessToken: string; appSecret: string; verifyToken: string };
export type WhatsAppConfig = { phoneNumberId: string; wabaId?: string; displayPhone?: string };

export async function getWhatsApp(tx: Tx) {
  const [row] = await tx.select().from(integrations).where(eq(integrations.provider, "whatsapp")).limit(1);
  if (!row || !row.isActive) return null;
  const secrets = decryptJson<WhatsAppSecrets>(row.secretsEnc);
  const config = row.config as WhatsAppConfig;
  if (!secrets?.accessToken || !config.phoneNumberId) return null;
  return { id: row.id, config, secrets };
}

type GraphResult = { ok: true; id: string } | { ok: false; error: string };

/** Calls the WhatsApp Cloud API. Returns Meta's message id or the error Meta reported. */
export async function graphSend(phoneNumberId: string, accessToken: string, payload: Record<string, unknown>): Promise<GraphResult> {
  try {
    const res = await fetch(`${GRAPH()}/${encodeURIComponent(phoneNumberId)}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", ...payload }),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string; code?: number } };
    if (!res.ok || !json.messages?.[0]?.id) {
      return { ok: false, error: json.error?.message ? `${json.error.message}${json.error.code ? ` (code ${json.error.code})` : ""}` : `HTTP ${res.status}` };
    }
    return { ok: true, id: json.messages[0].id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Network error" };
  }
}

async function leadForMessaging(tx: Tx, ctx: TenantCtx, leadId: string) {
  const [lead] = await tx
    .select({ id: leads.id, name: leads.name, phone: leads.phoneNormalized, lastInboundAt: leads.lastInboundAt, stage: leads.stage })
    .from(leads)
    .where(and(eq(leads.id, leadId), leadScope(ctx)))
    .limit(1);
  if (!lead) throw new NotFoundError("Lead");
  if (!lead.phone) throw new UserError("This lead has no valid phone number.");
  return lead;
}

export function withinSessionWindow(lastInboundAt: Date | null) {
  return !!lastInboundAt && Date.now() - lastInboundAt.getTime() < WINDOW_MS;
}

/** Free-form text is only allowed within 24 hours of the customer's last message (WhatsApp policy). */
export async function sendText(tx: Tx, ctx: TenantCtx, leadId: string, body: string, opts: { byAgent?: boolean } = {}) {
  if (!opts.byAgent) assertCan(ctx.role, "whatsapp:send");
  const text = body.trim();
  if (!text) throw new UserError("Write a message.");
  if (text.length > 4096) throw new UserError("Messages are limited to 4,096 characters.");
  const wa = await getWhatsApp(tx);
  if (!wa) throw new UserError("WhatsApp isn't connected. An admin can connect it under Settings → Integrations.");
  const lead = await leadForMessaging(tx, ctx, leadId);
  if (!withinSessionWindow(lead.lastInboundAt)) {
    throw new UserError("The 24-hour conversation window is closed. Send an approved template to restart the conversation.");
  }
  const result = await graphSend(wa.config.phoneNumberId, wa.secrets.accessToken, { to: lead.phone, type: "text", text: { body: text, preview_url: false } });
  await recordOutbound(tx, ctx, lead.id, { body: text, result, byAgent: !!opts.byAgent });
  if (!result.ok) throw new UserError(`WhatsApp rejected the message: ${result.error}`);
}

export async function sendTemplate(tx: Tx, ctx: TenantCtx, leadId: string, templateId: string, params: string[] = []) {
  assertCan(ctx.role, "whatsapp:send");
  const [tpl] = await tx.select().from(messageTemplates).where(eq(messageTemplates.id, templateId)).limit(1);
  if (!tpl) throw new NotFoundError("Template");
  const wa = await getWhatsApp(tx);
  if (!wa) throw new UserError("WhatsApp isn't connected. An admin can connect it under Settings → Integrations.");
  const lead = await leadForMessaging(tx, ctx, leadId);
  const values = fillParams(tpl.variableCount, params, lead.name);
  const result = await graphSend(wa.config.phoneNumberId, wa.secrets.accessToken, templatePayload(lead.phone!, tpl.name, tpl.language, values));
  await recordOutbound(tx, ctx, lead.id, { body: renderTemplate(tpl.body, values), template: tpl.name, result, byAgent: false });
  if (!result.ok) throw new UserError(`WhatsApp rejected the template: ${result.error}`);
}

function fillParams(count: number, params: string[], leadName: string) {
  const out = params.slice(0, count);
  if (count > 0 && !out[0]) out[0] = leadName.split(" ")[0];
  while (out.length < count) out.push("-");
  return out;
}

export function renderTemplate(body: string, values: string[]) {
  return body.replace(/\{\{(\d+)\}\}/g, (_, i) => values[Number(i) - 1] ?? `{{${i}}}`);
}

function templatePayload(to: string, name: string, language: string, values: string[]) {
  return {
    to,
    type: "template",
    template: {
      name,
      language: { code: language },
      ...(values.length ? { components: [{ type: "body", parameters: values.map((text) => ({ type: "text", text })) }] } : {}),
    },
  };
}

async function recordOutbound(
  tx: Tx,
  ctx: TenantCtx,
  leadId: string,
  m: { body: string; template?: string; result: GraphResult; byAgent: boolean },
) {
  await tx.insert(whatsappMessages).values({
    organizationId: ctx.orgId,
    leadId,
    direction: "outbound",
    body: m.body,
    templateName: m.template,
    waMessageId: m.result.ok ? m.result.id : null,
    status: m.result.ok ? "sent" : "failed",
    error: m.result.ok ? null : m.result.error.slice(0, 500),
    sentById: m.byAgent ? null : ctx.userId,
    sentByAgent: m.byAgent,
    statusUpdatedAt: new Date(),
  });
  if (m.result.ok) {
    await tx.insert(leadActivities).values({
      organizationId: ctx.orgId, leadId, userId: m.byAgent ? null : ctx.userId, type: "whatsapp", direction: "outbound",
      body: m.template ? `Template "${m.template}": ${m.body}` : m.body, meta: m.byAgent ? { agent: true } : undefined,
    });
    await tx.update(leads).set({ lastContactedAt: new Date() }).where(eq(leads.id, leadId));
  }
}

/** Queues a template for sending after the current transaction (automations, reminders). */
export async function queueWhatsAppTemplate(tx: Tx, ctx: TenantCtx, leadId: string, templateName: string, language: string, params: string[] = []) {
  await tx.insert(whatsappMessages).values({
    organizationId: ctx.orgId, leadId, direction: "outbound", templateName, body: JSON.stringify({ language, params }), status: "pending",
  });
}

/** Sends queued templates. Failures are recorded with Meta's error, never reported as delivered. */
export async function flushPending(tx: Tx, ctx: TenantCtx, limit = 25) {
  const pending = await tx
    .select({ id: whatsappMessages.id, leadId: whatsappMessages.leadId, templateName: whatsappMessages.templateName, body: whatsappMessages.body })
    .from(whatsappMessages)
    .where(eq(whatsappMessages.status, "pending"))
    .orderBy(asc(whatsappMessages.createdAt))
    .limit(limit);
  if (!pending.length) return 0;
  const wa = await getWhatsApp(tx);
  for (const p of pending) {
    if (!wa) {
      await tx.update(whatsappMessages).set({ status: "failed", error: "WhatsApp is not connected", statusUpdatedAt: new Date() }).where(eq(whatsappMessages.id, p.id));
      continue;
    }
    const [lead] = await tx.select({ name: leads.name, phone: leads.phoneNormalized }).from(leads).where(eq(leads.id, p.leadId!));
    const [tpl] = await tx.select().from(messageTemplates).where(eq(messageTemplates.name, p.templateName!)).limit(1);
    let meta: { language?: string; params?: string[] } = {};
    try { meta = JSON.parse(p.body ?? "{}"); } catch { /* ignore */ }
    if (!lead?.phone) {
      await tx.update(whatsappMessages).set({ status: "failed", error: "Lead has no phone number", statusUpdatedAt: new Date() }).where(eq(whatsappMessages.id, p.id));
      continue;
    }
    const values = fillParams(tpl?.variableCount ?? (meta.params?.length ?? 0), meta.params ?? [], lead.name);
    const result = await graphSend(wa.config.phoneNumberId, wa.secrets.accessToken, templatePayload(lead.phone, p.templateName!, meta.language || tpl?.language || "en", values));
    await tx
      .update(whatsappMessages)
      .set({
        status: result.ok ? "sent" : "failed",
        waMessageId: result.ok ? result.id : null,
        error: result.ok ? null : result.error.slice(0, 500),
        body: tpl ? renderTemplate(tpl.body, values) : `Template ${p.templateName}`,
        statusUpdatedAt: new Date(),
      })
      .where(eq(whatsappMessages.id, p.id));
    if (result.ok) {
      await tx.insert(leadActivities).values({ organizationId: ctx.orgId, leadId: p.leadId!, type: "whatsapp", direction: "outbound", body: `Automated template "${p.templateName}" sent` });
    }
  }
  return pending.length;
}

export async function conversation(tx: Tx, leadId: string) {
  return tx.select().from(whatsappMessages).where(eq(whatsappMessages.leadId, leadId)).orderBy(asc(whatsappMessages.createdAt)).limit(500);
}

/** Inbox: latest message per lead. */
export async function inbox(tx: Tx, ctx: TenantCtx, filter: "all" | "handoff" | "unanswered" = "all") {
  const rows = await tx.execute<{
    lead_id: string; name: string; phone: string | null; body: string | null; direction: string; status: string;
    created_at: string; whatsapp_handoff: boolean; last_inbound_at: string | null; owner_id: string | null;
  }>(sql`
    select distinct on (m.lead_id) m.lead_id, l.name, l.phone, m.body, m.direction, m.status, m.created_at,
      l.whatsapp_handoff, l.last_inbound_at, l.owner_id
    from whatsapp_messages m join leads l on l.id = m.lead_id
    where m.lead_id is not null
    ${ctx.role === "sales_executive" ? sql`and l.owner_id = ${ctx.userId}` : sql``}
    order by m.lead_id, m.created_at desc`);
  let list = rows.rows.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
  if (filter === "handoff") list = list.filter((r) => r.whatsapp_handoff);
  if (filter === "unanswered") list = list.filter((r) => r.direction === "inbound");
  return list.slice(0, 200);
}

export async function templates(tx: Tx) {
  return tx.select().from(messageTemplates).orderBy(desc(messageTemplates.createdAt));
}

/** Applies a delivery status reported by Meta's webhook. Status only moves forward. */
export async function applyStatus(tx: Tx, waMessageId: string, status: string, error?: string) {
  const order = ["pending", "sent", "delivered", "read"];
  const valid = ["sent", "delivered", "read", "failed"];
  if (!valid.includes(status)) return;
  const [msg] = await tx.select({ id: whatsappMessages.id, status: whatsappMessages.status }).from(whatsappMessages).where(eq(whatsappMessages.waMessageId, waMessageId)).limit(1);
  if (!msg) return;
  if (status !== "failed" && order.indexOf(status) <= order.indexOf(msg.status)) return;
  await tx
    .update(whatsappMessages)
    .set({ status: status as "sent", error: error?.slice(0, 500) ?? null, statusUpdatedAt: new Date() })
    .where(eq(whatsappMessages.id, msg.id));
}
