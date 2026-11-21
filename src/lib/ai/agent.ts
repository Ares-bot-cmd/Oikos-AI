import "server-only";
import { desc, eq, sql } from "drizzle-orm";
import { withTenant, type TenantCtx } from "@/lib/db/tenant";
import { leadActivities, leads, organizations, projects, whatsappMessages } from "@/lib/db/schema";
import { notify } from "@/lib/services/notifications";
import { sendText, withinSessionWindow } from "@/lib/services/whatsapp";
import { TIMELINES } from "@/lib/services/leads";
import { aiAvailable, FALLBACK_BETA, getClaude, MODEL } from "./claude";

const SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string", description: "Message to send to the customer (empty if handing off without replying)" },
    handoff: { type: "boolean", description: "True when a human salesperson should take over" },
    handoff_reason: { type: "string" },
    budget_max: { type: ["number", "null"], description: "Customer's stated maximum budget in rupees, if stated" },
    timeline: { type: ["string", "null"], enum: [...TIMELINES, null] },
    configuration: { type: ["string", "null"], description: "e.g. 2BHK, 3BHK, if stated" },
    wants_site_visit: { type: "boolean" },
  },
  required: ["reply", "handoff", "handoff_reason", "budget_max", "timeline", "configuration", "wants_site_visit"],
  additionalProperties: false,
} as const;

type AgentOutput = {
  reply: string; handoff: boolean; handoff_reason: string; budget_max: number | null;
  timeline: (typeof TIMELINES)[number] | null; configuration: string | null; wants_site_visit: boolean;
};

/**
 * Replies to an inbound WhatsApp message on behalf of the organization when the AI agent
 * is enabled and no human has taken over. Answers only from the organization's project data;
 * anything else (prices it doesn't have, negotiation, complaints, explicit requests) is handed off.
 */
export async function runWhatsAppAgent(orgId: string, leadId: string) {
  if (!aiAvailable()) return { skipped: "no_api_key" };
  const ctx: TenantCtx = { orgId, userId: null, role: "system" };

  const prepared = await withTenant(ctx, async (tx) => {
    const [org] = await tx.select({ name: organizations.name, enabled: organizations.aiAgentEnabled }).from(organizations).where(eq(organizations.id, orgId));
    const [lead] = await tx.select().from(leads).where(eq(leads.id, leadId));
    if (!org?.enabled || !lead || lead.whatsappHandoff || !withinSessionWindow(lead.lastInboundAt)) return null;
    const history = await tx
      .select({ direction: whatsappMessages.direction, body: whatsappMessages.body })
      .from(whatsappMessages)
      .where(eq(whatsappMessages.leadId, leadId))
      .orderBy(desc(whatsappMessages.createdAt))
      .limit(20);
    const catalog = await tx.execute<{ name: string; location: string; status: string; property_type: string; price_from: string | null; price_to: string | null; configs: string | null; available: string; possession_date: string | null; amenities: string | null }>(sql`
      select p.name, p.location, p.status, p.property_type, p.price_from, p.price_to, p.possession_date, p.amenities,
        (select string_agg(distinct u.configuration, ', ') from units u where u.project_id = p.id and u.status = 'available') as configs,
        (select count(*) from units u where u.project_id = p.id and u.status = 'available') as available
      from ${projects} p order by p.name`);
    return { org, lead, history: history.reverse(), catalog: catalog.rows };
  });
  if (!prepared) return { skipped: "not_applicable" };
  const { org, lead, history, catalog } = prepared;

  const system = `You are the WhatsApp sales assistant for ${org.name}, a real estate developer. You reply to prospective buyers on WhatsApp.

Rules:
- Answer only using the project information below. Never invent prices, availability, offers, dates or amenities. If you don't have the information, say a sales executive will share it and set handoff=true.
- Hand off (handoff=true) when the customer asks for a human, wants to negotiate price or discounts, raises a complaint, asks about legal/loan specifics, or is ready to book or visit at a specific time.
- Qualify gently: learn budget, preferred configuration and buying timeline, one question at a time.
- Keep replies under 80 words, warm and professional, in the customer's language. No markdown.
- Extract budget_max (rupees), timeline and configuration only when the customer actually stated them; otherwise null.

Projects:
${catalog.map((p) => `- ${p.name} (${p.location}); ${p.property_type}; status ${p.status}; price range ${p.price_from ?? "not published"}–${p.price_to ?? "not published"}; available configurations: ${p.configs ?? "none listed"} (${p.available} units available); possession ${p.possession_date ?? "not published"}; amenities: ${p.amenities ?? "not listed"}`).join("\n") || "- No projects published yet. Hand off any project question."}`;

  const messages = history
    .filter((m) => m.body)
    .map((m) => ({ role: m.direction === "inbound" ? ("user" as const) : ("assistant" as const), content: m.body! }));
  // The conversation must start with and end on the customer's message.
  while (messages.length && messages[0].role !== "user") messages.shift();
  if (!messages.length || messages[messages.length - 1].role !== "user") return { skipped: "no_pending_message" };

  let out: AgentOutput;
  try {
    const response = await getClaude().beta.messages.create({
      model: MODEL,
      max_tokens: 4000,
      betas: [FALLBACK_BETA],
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA as unknown as Record<string, unknown> } },
      system,
      messages: [...messages, { role: "user", content: `(Customer name on file: ${lead.name})` }],
    });
    if (response.stop_reason === "refusal") throw new Error("refusal");
    const text = response.content.find((b) => b.type === "text");
    out = JSON.parse(text && text.type === "text" ? text.text : "{}") as AgentOutput;
  } catch (e) {
    console.error("[agent] Claude call failed", e);
    out = { reply: "", handoff: true, handoff_reason: "The AI agent could not respond", budget_max: null, timeline: null, configuration: null, wants_site_visit: false };
  }

  return withTenant(ctx, async (tx) => {
    const patch: Partial<typeof leads.$inferInsert> = {};
    if (out.budget_max && out.budget_max > 0 && !lead.budgetMax) patch.budgetMax = out.budget_max;
    if (out.timeline && lead.timeline === "unknown") patch.timeline = out.timeline;
    if (out.configuration && !lead.configuration) patch.configuration = out.configuration.slice(0, 40);
    if (out.handoff) patch.whatsappHandoff = true;
    if (Object.keys(patch).length) await tx.update(leads).set(patch).where(eq(leads.id, leadId));

    if (out.reply?.trim()) {
      try {
        await sendText(tx, ctx, leadId, out.reply.trim().slice(0, 1000), { byAgent: true });
      } catch (e) {
        console.error("[agent] send failed", e);
      }
    }
    if (out.handoff) {
      await tx.insert(leadActivities).values({ organizationId: orgId, leadId, type: "system", body: `AI agent handed the conversation to the team: ${out.handoff_reason || "needs a human"}` });
      if (lead.ownerId) {
        await notify(tx, orgId, lead.ownerId, { type: "whatsapp_handoff", title: `WhatsApp handoff: ${lead.name}`, body: out.handoff_reason, link: `/whatsapp?lead=${leadId}` });
      }
    }
    return { replied: !!out.reply?.trim(), handoff: out.handoff };
  });
}

