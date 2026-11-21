import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/lib/db";
import type { TenantCtx } from "@/lib/db/tenant";
import { campaigns, campaignSpend, projects } from "@/lib/db/schema";
import { assertCan } from "@/lib/auth/permissions";
import { NotFoundError, UserError } from "@/lib/errors";
import { isoDate, safeDivide } from "@/lib/utils";
import { zDate, zMoney, zOptMoney, zText } from "@/lib/validation";

export const CHANNELS = ["meta_ads", "google_ads", "website", "portal", "whatsapp", "referral", "offline", "other"] as const;
export const CHANNEL_LABELS: Record<(typeof CHANNELS)[number], string> = {
  meta_ads: "Meta Ads", google_ads: "Google Ads", website: "Website", portal: "Property portal", whatsapp: "WhatsApp",
  referral: "Referral", offline: "Offline / events", other: "Other",
};
/** Stages at or beyond qualification. */
export const QUALIFIED_STAGES = ["qualified", "follow_up", "site_visit_scheduled", "negotiation", "booked"] as const;

export const campaignSchema = z
  .object({
    name: z.string().trim().min(2, "Name the campaign").max(120),
    channel: z.enum(CHANNELS),
    projectId: z.uuid().optional(),
    externalId: zText(120).optional(),
    utmCampaign: zText(120).optional(),
    startDate: zDate.optional(),
    endDate: zDate.optional(),
    budget: zOptMoney,
  })
  .refine((v) => !v.startDate || !v.endDate || v.startDate <= v.endDate, { message: "End date must be after the start date", path: ["endDate"] });

export async function createCampaign(tx: Tx, ctx: TenantCtx, input: z.input<typeof campaignSchema>) {
  assertCan(ctx.role, "marketing:write");
  const d = campaignSchema.parse(input);
  if (d.projectId) {
    const [p] = await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, d.projectId));
    if (!p) throw new UserError("Selected project not found.");
  }
  const [c] = await tx.insert(campaigns).values({ organizationId: ctx.orgId, ...d }).returning({ id: campaigns.id });
  return c.id;
}

export async function updateCampaign(tx: Tx, ctx: TenantCtx, id: string, input: z.input<typeof campaignSchema> & { isActive?: boolean }) {
  assertCan(ctx.role, "marketing:write");
  if (!z.uuid().safeParse(id).success) throw new NotFoundError("Campaign");
  const d = campaignSchema.parse(input);
  const r = await tx
    .update(campaigns)
    .set({ ...d, projectId: d.projectId ?? null, externalId: d.externalId ?? null, utmCampaign: d.utmCampaign ?? null, startDate: d.startDate ?? null, endDate: d.endDate ?? null, budget: d.budget ?? null, isActive: input.isActive ?? true })
    .where(eq(campaigns.id, id))
    .returning({ id: campaigns.id });
  if (!r.length) throw new NotFoundError("Campaign");
}

export async function deleteCampaign(tx: Tx, ctx: TenantCtx, id: string) {
  assertCan(ctx.role, "marketing:write");
  if (!z.uuid().safeParse(id).success) throw new NotFoundError("Campaign");
  const r = await tx.delete(campaigns).where(eq(campaigns.id, id)).returning({ id: campaigns.id });
  if (!r.length) throw new NotFoundError("Campaign");
}

export const spendSchema = z.object({
  campaignId: z.uuid({ error: "Choose a campaign" }),
  spendDate: zDate,
  amount: zMoney,
  impressions: z.coerce.number().int().min(0).max(1e12).optional(),
  clicks: z.coerce.number().int().min(0).max(1e12).optional(),
});

/** Records spend for a campaign on a date (re-entering the same date replaces it). */
export async function recordSpend(tx: Tx, ctx: TenantCtx, input: z.input<typeof spendSchema>) {
  assertCan(ctx.role, "marketing:write");
  const d = spendSchema.parse(input);
  if (d.spendDate > isoDate(new Date())) throw new UserError("Spend date can't be in the future.");
  const [c] = await tx.select({ id: campaigns.id }).from(campaigns).where(eq(campaigns.id, d.campaignId));
  if (!c) throw new UserError("Selected campaign not found.");
  await tx
    .insert(campaignSpend)
    .values({ organizationId: ctx.orgId, ...d })
    .onConflictDoUpdate({ target: [campaignSpend.campaignId, campaignSpend.spendDate], set: { amount: d.amount, impressions: d.impressions ?? null, clicks: d.clicks ?? null } });
}

/** CSV rows: campaign (name or external id), date, amount, impressions?, clicks? */
export async function importSpend(tx: Tx, ctx: TenantCtx, rows: Record<string, string>[]) {
  assertCan(ctx.role, "marketing:write");
  if (rows.length > 5000) throw new UserError("Import at most 5,000 rows at a time.");
  const all = await tx.select({ id: campaigns.id, name: campaigns.name, externalId: campaigns.externalId }).from(campaigns);
  const byKey = new Map<string, string>();
  for (const c of all) {
    byKey.set(c.name.toLowerCase(), c.id);
    if (c.externalId) byKey.set(c.externalId.toLowerCase(), c.id);
  }
  const errors: string[] = [];
  let imported = 0;
  for (const [i, r] of rows.entries()) {
    const key = (r.campaign ?? r.campaign_name ?? r.campaign_id ?? "").trim().toLowerCase();
    const campaignId = byKey.get(key);
    if (!campaignId) { errors.push(`Row ${i + 2}: campaign "${key}" not found`); continue; }
    const parsed = spendSchema.safeParse({ campaignId, spendDate: normalizeDate(r.date ?? r.day ?? ""), amount: (r.amount ?? r.spend ?? r.cost ?? "").replace(/[,₹\s]/g, ""), impressions: r.impressions || undefined, clicks: r.clicks || undefined });
    if (!parsed.success) { errors.push(`Row ${i + 2}: ${parsed.error.issues[0]?.message}`); continue; }
    await recordSpend(tx, ctx, parsed.data);
    imported++;
  }
  return { imported, errors: errors.slice(0, 50), errorCount: errors.length };
}

export function normalizeDate(v: string): string {
  const s = v.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/); // DD/MM/YYYY
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : isoDate(d);
}

export type CampaignMetrics = {
  id: string; name: string; channel: string; projectName: string | null; isActive: boolean; budget: number | null;
  spend: number; impressions: number; clicks: number; leads: number; qualified: number; visits: number; bookings: number; revenue: number;
  cpl: number | null; cpql: number | null; cpb: number | null; roi: number | null; conversion: number | null;
};

/**
 * Campaign attribution for a date window. Leads count by creation date, bookings by booking date,
 * spend by spend date. Attribution is first-touch: the campaign recorded on the lead when captured.
 */
export async function campaignMetrics(tx: Tx, from: Date, to: Date, projectId?: string): Promise<CampaignMetrics[]> {
  const f = isoDate(from);
  const t = isoDate(to);
  const res = await tx.execute<{
    id: string; name: string; channel: string; project_name: string | null; is_active: boolean; budget: string | null;
    spend: string; impressions: string; clicks: string; leads: string; qualified: string; visits: string; bookings: string; revenue: string;
  }>(sql`
    select c.id, c.name, c.channel, p.name as project_name, c.is_active, c.budget,
      coalesce((select sum(s.amount) from campaign_spend s where s.campaign_id = c.id and s.spend_date >= ${f} and s.spend_date < ${t}), 0) as spend,
      coalesce((select sum(s.impressions) from campaign_spend s where s.campaign_id = c.id and s.spend_date >= ${f} and s.spend_date < ${t}), 0) as impressions,
      coalesce((select sum(s.clicks) from campaign_spend s where s.campaign_id = c.id and s.spend_date >= ${f} and s.spend_date < ${t}), 0) as clicks,
      (select count(*) from leads l where l.campaign_id = c.id and l.created_at >= ${from} and l.created_at < ${to}) as leads,
      (select count(*) from leads l where l.campaign_id = c.id and l.created_at >= ${from} and l.created_at < ${to}
         and (l.stage in ('qualified','follow_up','site_visit_scheduled','negotiation','booked')
              or exists (select 1 from lead_activities a where a.lead_id = l.id and a.type = 'stage_change'
                         and a.meta->>'to' in ('qualified','follow_up','site_visit_scheduled','negotiation','booked')))) as qualified,
      (select count(*) from site_visits v join leads l on l.id = v.lead_id where l.campaign_id = c.id and v.status = 'completed'
         and v.scheduled_at >= ${from} and v.scheduled_at < ${to}) as visits,
      (select count(*) from bookings b where b.campaign_id = c.id and b.status <> 'cancelled' and b.booking_date >= ${f} and b.booking_date < ${t}) as bookings,
      coalesce((select sum(b.agreement_value) from bookings b where b.campaign_id = c.id and b.status <> 'cancelled' and b.booking_date >= ${f} and b.booking_date < ${t}), 0) as revenue
    from campaigns c left join projects p on p.id = c.project_id
    ${projectId ? sql`where c.project_id = ${projectId}` : sql``}
    order by c.name`);
  return res.rows.map((r) => {
    const spend = Number(r.spend), leadsN = Number(r.leads), qualified = Number(r.qualified), bookingsN = Number(r.bookings), revenue = Number(r.revenue);
    return {
      id: r.id, name: r.name, channel: r.channel, projectName: r.project_name, isActive: r.is_active, budget: r.budget == null ? null : Number(r.budget),
      spend, impressions: Number(r.impressions), clicks: Number(r.clicks), leads: leadsN, qualified, visits: Number(r.visits), bookings: bookingsN, revenue,
      cpl: spend ? safeDivide(spend, leadsN) : null,
      cpql: spend ? safeDivide(spend, qualified) : null,
      cpb: spend ? safeDivide(spend, bookingsN) : null,
      roi: spend > 0 ? (revenue - spend) / spend : null,
      conversion: safeDivide(bookingsN, leadsN),
    };
  });
}

/** Lead → booking performance by source, including leads that have no campaign. */
export async function sourceMetrics(tx: Tx, from: Date, to: Date, projectId?: string) {
  const res = await tx.execute<{ source: string; leads: string; qualified: string; booked: string }>(sql`
    select l.source, count(*) as leads,
      count(*) filter (where l.stage in ('qualified','follow_up','site_visit_scheduled','negotiation','booked')) as qualified,
      count(*) filter (where l.stage = 'booked') as booked
    from leads l
    where l.created_at >= ${from} and l.created_at < ${to} ${projectId ? sql`and l.project_id = ${projectId}` : sql``}
    group by l.source order by count(*) desc`);
  return res.rows.map((r) => ({ source: r.source, leads: Number(r.leads), qualified: Number(r.qualified), booked: Number(r.booked), conversion: safeDivide(Number(r.booked), Number(r.leads)) }));
}

export async function dailySpend(tx: Tx, from: Date, to: Date, projectId?: string) {
  const res = await tx.execute<{ d: string; spend: string; leads: string }>(sql`
    with days as (select generate_series(${isoDate(from)}::date, (${isoDate(to)}::date - 1), interval '1 day')::date as d)
    select to_char(days.d, 'YYYY-MM-DD') as d,
      coalesce((select sum(s.amount) from campaign_spend s join campaigns c on c.id = s.campaign_id where s.spend_date = days.d ${projectId ? sql`and c.project_id = ${projectId}` : sql``}), 0) as spend,
      (select count(*) from leads l where l.created_at::date = days.d and l.campaign_id is not null ${projectId ? sql`and l.project_id = ${projectId}` : sql``}) as leads
    from days order by days.d`);
  return res.rows.map((r) => ({ date: r.d, spend: Number(r.spend), leads: Number(r.leads) }));
}

export async function campaignOptions(tx: Tx) {
  return tx.select({ id: campaigns.id, name: campaigns.name, channel: campaigns.channel }).from(campaigns).orderBy(asc(campaigns.name));
}

export async function getCampaign(tx: Tx, id: string) {
  if (!z.uuid().safeParse(id).success) throw new NotFoundError("Campaign");
  const [c] = await tx.select().from(campaigns).where(eq(campaigns.id, id));
  if (!c) throw new NotFoundError("Campaign");
  return c;
}

export async function spendEntries(tx: Tx, campaignId: string) {
  return tx.select().from(campaignSpend).where(and(eq(campaignSpend.campaignId, campaignId))).orderBy(sql`${campaignSpend.spendDate} desc`).limit(120);
}
