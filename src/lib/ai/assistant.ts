import "server-only";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { withTenant, type TenantCtx } from "@/lib/db/tenant";
import { leads, projects, users } from "@/lib/db/schema";
import { can, type Permission } from "@/lib/auth/permissions";
import { UserError } from "@/lib/errors";
import { executivePerformance, funnel, kpis, projectPerformance } from "@/lib/services/analytics";
import { campaignMetrics, sourceMetrics } from "@/lib/services/marketing";
import { revenueBreakdown, revenueForecast, revenueLeakage, revenueSummary } from "@/lib/services/revenue";
import { leadScope } from "@/lib/services/leads";
import { generateInsights } from "@/lib/services/insights";
import { FALLBACK_BETA, getClaude, MODEL, Anthropic } from "./claude";

const DAY = 86400_000;
const window = (days: number) => {
  const d = Math.min(Math.max(Math.round(days || 30), 1), 730);
  const to = new Date(Date.now() + DAY);
  return { from: new Date(to.getTime() - (d + 1) * DAY), to, days: d };
};
const round = (v: unknown): unknown =>
  typeof v === "number" ? Math.round(v * 100) / 100 : Array.isArray(v) ? v.map(round) : v && typeof v === "object" && !(v instanceof Date) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, round(x)])) : v;

type ToolDef = {
  tool: Anthropic.Beta.BetaTool;
  permission?: Permission;
  run: (ctx: TenantCtx, input: Record<string, unknown>) => Promise<unknown>;
};

const daysProp = { type: "integer", description: "Look-back window in days (1–730). Default 30." } as const;

const TOOLS: ToolDef[] = [
  {
    tool: {
      name: "get_kpis",
      description: "Headline sales KPIs for a recent window and the previous window of equal length: total/new/qualified leads, completed site visits, bookings, lead→booking conversion, booked revenue (agreement value), collections, marketing spend, cost per lead and per booking.",
      input_schema: { type: "object", properties: { days: daysProp }, additionalProperties: false },
    },
    run: (ctx, i) => {
      const w = window(Number(i.days));
      return withTenant(ctx, async (tx) => ({
        window: `last ${w.days} days`,
        current: await kpis(tx, ctx, w.from, w.to),
        previous: await kpis(tx, ctx, new Date(w.from.getTime() - (w.to.getTime() - w.from.getTime())), w.from),
      }));
    },
  },
  {
    tool: {
      name: "campaign_performance",
      description: "Per-campaign marketing attribution (first-touch): spend, leads, qualified leads, completed visits, bookings, booked revenue, cost per lead, cost per booking, ROI. Also returns lead→booking performance by lead source.",
      input_schema: { type: "object", properties: { days: daysProp }, additionalProperties: false },
    },
    permission: "marketing:read",
    run: (ctx, i) => {
      const w = window(Number(i.days));
      return withTenant(ctx, async (tx) => ({ campaigns: await campaignMetrics(tx, w.from, w.to), sources: await sourceMetrics(tx, w.from, w.to) }));
    },
  },
  {
    tool: {
      name: "executive_performance",
      description: "Sales team leaderboard: leads assigned, contacted, calls, follow-ups done and overdue, completed visits, bookings, revenue, lead→booking conversion, average first-response time (hours), and target attainment.",
      input_schema: { type: "object", properties: { days: daysProp }, additionalProperties: false },
    },
    run: (ctx, i) => {
      const w = window(Number(i.days));
      return withTenant(ctx, (tx) => executivePerformance(tx, ctx, w.from, w.to));
    },
  },
  {
    tool: {
      name: "project_performance",
      description: "Per-project leads, completed visits, bookings, booked revenue, conversion, total/available/sold units and absorption.",
      input_schema: { type: "object", properties: { days: daysProp }, additionalProperties: false },
    },
    run: (ctx, i) => {
      const w = window(Number(i.days));
      return withTenant(ctx, (tx) => projectPerformance(tx, w.from, w.to));
    },
  },
  {
    tool: {
      name: "funnel",
      description: "Cohort funnel for leads created in the window: leads → contacted → qualified → site visit done → negotiation → booked, with step conversion rates.",
      input_schema: { type: "object", properties: { days: daysProp }, additionalProperties: false },
    },
    run: (ctx, i) => {
      const w = window(Number(i.days ?? 90));
      return withTenant(ctx, (tx) => funnel(tx, ctx, w.from, w.to));
    },
  },
  {
    tool: {
      name: "revenue",
      description: "Actual revenue figures for the window (booked value, bookings, average deal, collections, cancellations, outstanding and overdue receivables) plus a breakdown by project, campaign, executive or source.",
      input_schema: {
        type: "object",
        properties: { days: daysProp, breakdown_by: { type: "string", enum: ["project", "campaign", "executive", "source"] } },
        additionalProperties: false,
      },
    },
    permission: "revenue:read",
    run: (ctx, i) => {
      const w = window(Number(i.days));
      const by = (["project", "campaign", "executive", "source"] as const).find((b) => b === i.breakdown_by) ?? "project";
      return withTenant(ctx, async (tx) => ({ summary: await revenueSummary(tx, ctx, w.from, w.to), breakdownBy: by, breakdown: await revenueBreakdown(tx, ctx, by, w.from, w.to) }));
    },
  },
  {
    tool: {
      name: "revenue_forecast",
      description: "Projected (not actual) bookings revenue for this month and the next two, with expected number of bookings, open pipeline value, probability-weighted pipeline value and the forecasting method.",
      input_schema: { type: "object", properties: {}, additionalProperties: false },
    },
    permission: "revenue:read",
    run: (ctx) => withTenant(ctx, (tx) => revenueForecast(tx, ctx)),
  },
  {
    tool: {
      name: "revenue_leakage",
      description: "Where revenue is being lost or delayed: overdue collections, cancellations, discounts below list price, leads lost after a site visit, hot leads waiting 48h+, stalled negotiations.",
      input_schema: { type: "object", properties: { days: daysProp }, additionalProperties: false },
    },
    permission: "revenue:read",
    run: (ctx, i) => {
      const w = window(Number(i.days ?? 90));
      return withTenant(ctx, (tx) => revenueLeakage(tx, ctx, w.from, w.to));
    },
  },
  {
    tool: {
      name: "find_leads",
      description: "Search leads. Use to list leads that need attention (e.g. hot leads not contacted recently), or to look up a lead by name/phone/email. Returns score, intent, conversion probability, stage, owner, last contact and suggested next action.",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Name, email or phone fragment" },
          stage: { type: "string", enum: ["new", "contacted", "qualified", "follow_up", "site_visit_scheduled", "negotiation", "booked", "lost"] },
          intent: { type: "string", enum: ["hot", "warm", "cold"] },
          needs_attention: { type: "boolean", description: "Only open leads with no contact for 48h+ or overdue follow-ups" },
          limit: { type: "integer", description: "Max rows (1–25)" },
        },
        additionalProperties: false,
      },
    },
    run: (ctx, i) =>
      withTenant(ctx, (tx) =>
        tx
          .select({
            id: leads.id, name: leads.name, stage: leads.stage, intent: leads.intent, score: leads.score, conversionProbability: leads.conversionProbability,
            owner: users.name, project: projects.name, lastContactedAt: leads.lastContactedAt, nextAction: leads.nextAction, createdAt: leads.createdAt,
          })
          .from(leads)
          .leftJoin(users, eq(users.id, leads.ownerId))
          .leftJoin(projects, eq(projects.id, leads.projectId))
          .where(
            and(
              leadScope(ctx),
              typeof i.query === "string" && i.query ? or(ilike(leads.name, `%${i.query}%`), ilike(leads.email, `%${i.query}%`), ilike(leads.phoneNormalized, `%${String(i.query).replace(/\D/g, "") || "~"}%`)) : undefined,
              typeof i.stage === "string" ? sql`${leads.stage} = ${i.stage}` : undefined,
              typeof i.intent === "string" ? sql`${leads.intent} = ${i.intent}` : undefined,
              i.needs_attention
                ? sql`${leads.stage} not in ('booked','lost') and (coalesce(${leads.lastContactedAt}, ${leads.createdAt}) < now() - interval '48 hours'
                      or exists (select 1 from follow_ups f where f.lead_id = ${leads.id} and f.status = 'pending' and f.due_at < now()))`
                : undefined,
            ),
          )
          .orderBy(sql`${leads.score} desc nulls last`, desc(leads.createdAt))
          .limit(Math.min(Math.max(Number(i.limit) || 10, 1), 25)),
      ),
  },
  {
    tool: {
      name: "current_insights",
      description: "The platform's current rule-based recommendations (uncontacted leads, overdue follow-ups, bottlenecks, campaign issues, inventory gaps, overdue payments).",
      input_schema: { type: "object", properties: {}, additionalProperties: false },
    },
    run: (ctx) => withTenant(ctx, (tx) => generateInsights(tx, ctx)),
  },
];

export type ChatTurn = { role: "user" | "assistant"; content: string };

function systemPrompt(orgName: string, currency: string, role: string) {
  return `You are Oikos AI, the revenue analyst inside a real estate sales platform, working for ${orgName}. The person asking is a ${role.replace(/_/g, " ")}.

Answer questions about the organization's leads, sales team, projects, marketing and revenue using only the data tools provided. Call tools before answering any question about numbers; never estimate or invent figures. If a tool returns no data or the data is insufficient, say so plainly and suggest what to record.

Money is in ${currency}; write Indian amounts in lakh/crore (e.g. ₹1.25 Cr) when the currency is INR. Always distinguish actual figures (bookings, collections) from projections (forecast, pipeline). Mention the time window you used. Keep answers short: a direct answer first, then the supporting numbers, then one or two concrete next actions where useful. Use plain Markdown (short lists or a small table), no headings. If a tool says the user lacks permission, tell them which data they can't see.

Today is ${new Date().toISOString().slice(0, 10)}.`;
}

/** Runs the assistant's tool loop. Each tool call executes in its own tenant-isolated transaction. */
export async function askAssistant(ctx: TenantCtx & { orgName: string; currency: string }, history: ChatTurn[]) {
  const client = getClaude();
  const tools = TOOLS.filter((t) => !t.permission || can(ctx.role, t.permission));
  const messages: Anthropic.Beta.BetaMessageParam[] = history.slice(-12).map((t) => ({ role: t.role, content: t.content.slice(0, 4000) }));
  if (!messages.length || messages[messages.length - 1].role !== "user") throw new UserError("Ask a question.");
  const used: string[] = [];

  for (let step = 0; step < 8; step++) {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 8000,
      betas: [FALLBACK_BETA],
      fallbacks: "default",
      output_config: { effort: "medium" },
      system: systemPrompt(ctx.orgName, ctx.currency, ctx.role),
      tools: tools.map((t) => t.tool),
      messages,
    });

    if (response.stop_reason === "refusal") {
      return { answer: "I can't help with that request. Try asking about your leads, team, projects, marketing or revenue.", tools: used };
    }
    if (response.stop_reason !== "tool_use") {
      const text = response.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
      return { answer: text || "I couldn't produce an answer. Please rephrase the question.", tools: used };
    }

    // Keep the full assistant content (including thinking blocks) in the history.
    messages.push({ role: "assistant", content: response.content });
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      const def = tools.find((t) => t.tool.name === block.name);
      used.push(block.name);
      if (!def) {
        results.push({ type: "tool_result", tool_use_id: block.id, content: "Unknown tool", is_error: true });
        continue;
      }
      try {
        const input = block.input && typeof block.input === "object" ? (block.input as Record<string, unknown>) : {};
        const data = await def.run(ctx, input);
        results.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(round(data)).slice(0, 60_000) });
      } catch (e) {
        console.error("[assistant] tool failed", block.name, e);
        results.push({ type: "tool_result", tool_use_id: block.id, content: "The data query failed.", is_error: true });
      }
    }
    messages.push({ role: "user", content: results });
  }
  return { answer: "That question needed too many steps. Try asking something more specific.", tools: used };
}

/** A short executive briefing written from the computed insights and KPIs (not from free recall). */
export async function aiBriefing(ctx: TenantCtx & { orgName: string; currency: string }) {
  return askAssistant(ctx, [
    {
      role: "user",
      content:
        "Write a short weekly briefing for leadership: how the last 30 days went versus the previous 30 (leads, bookings, revenue, collections), the three most important problems or opportunities right now, and what the team should do this week. Use the tools.",
    },
  ]);
}
