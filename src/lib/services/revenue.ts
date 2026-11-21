import "server-only";
import { sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import type { TenantCtx } from "@/lib/db/tenant";
import { can } from "@/lib/auth/permissions";
import { isoDate, safeDivide } from "@/lib/utils";
import { monthlyRevenue } from "./analytics";
import { receivables } from "./bookings";

/** Months from now in which an open lead at this stage is most likely to close (weights sum to 1). */
export const STAGE_TIMING: Record<string, number[]> = {
  negotiation: [0.6, 0.3, 0.1],
  site_visit_scheduled: [0.25, 0.5, 0.25],
  qualified: [0.1, 0.4, 0.5],
  follow_up: [0.1, 0.4, 0.5],
  contacted: [0.05, 0.3, 0.65],
  new: [0.05, 0.25, 0.7],
};

export type OpenLead = { stage: string; probability: number | null; budgetMin: number | null; budgetMax: number | null; projectMedian: number | null };

/** Estimated deal value: budget midpoint, else the preferred project's median list price, else the org's median booking. */
export function dealValue(l: OpenLead, orgMedianBooking: number | null): number | null {
  if (l.budgetMin != null && l.budgetMax != null) return (l.budgetMin + l.budgetMax) / 2;
  if (l.budgetMax != null) return l.budgetMax;
  if (l.budgetMin != null) return l.budgetMin;
  return l.projectMedian ?? orgMedianBooking;
}

/** Ordinary least-squares line through (i, y_i); returns projections for the next `ahead` points. */
export function linearProjection(ys: number[], ahead = 3): number[] {
  const n = ys.length;
  if (n < 3) return [];
  const xs = ys.map((_, i) => i);
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  const sxx = xs.reduce((s, x) => s + (x - mx) ** 2, 0);
  const sxy = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0);
  const slope = sxx ? sxy / sxx : 0;
  const intercept = my - slope * mx;
  return Array.from({ length: ahead }, (_, k) => Math.max(0, intercept + slope * (n + k)));
}

export type ForecastMonth = { month: string; pipeline: number; trend: number | null; forecast: number; expectedBookings: number };

export function buildForecast(open: OpenLead[], orgMedianBooking: number | null, history: { month: string; booked: number }[], now = new Date()) {
  const months = Array.from({ length: 3 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const pipeline = [0, 0, 0];
  const expected = [0, 0, 0];
  let pipelineValue = 0;
  let weightedValue = 0;
  let valued = 0;
  for (const l of open) {
    const v = dealValue(l, orgMedianBooking);
    const p = l.probability ?? 0;
    if (v != null) {
      pipelineValue += v;
      weightedValue += v * p;
      valued++;
    }
    const timing = STAGE_TIMING[l.stage] ?? STAGE_TIMING.new;
    timing.forEach((w, i) => {
      expected[i] += p * w;
      if (v != null) pipeline[i] += v * p * w;
    });
  }
  // Use completed months only for the trend (exclude the current partial month).
  const completed = history.slice(0, -1).slice(-6).map((h) => h.booked);
  const hasHistory = completed.filter((x) => x > 0).length >= 3;
  const trend = hasHistory ? linearProjection(completed, 4).slice(1) : [];
  const result: ForecastMonth[] = months.map((m, i) => {
    const t = trend[i] ?? null;
    return { month: m, pipeline: pipeline[i], trend: t, forecast: t != null ? (pipeline[i] + t) / 2 : pipeline[i], expectedBookings: expected[i] };
  });
  return {
    months: result,
    pipelineValue,
    weightedValue,
    valuedLeads: valued,
    openLeads: open.length,
    method: hasHistory
      ? "Average of (a) open pipeline weighted by each lead's conversion probability and expected close month by stage, and (b) a linear trend fitted to the last 6 completed months of bookings."
      : "Open pipeline weighted by each lead's conversion probability and expected close month by stage. A historical trend is blended in once there are 3+ months of bookings.",
  };
}

export async function revenueForecast(tx: Tx, ctx: TenantCtx, projectId?: string) {
  const own = can(ctx.role, "leads:read_all") ? sql`` : sql`and l.owner_id = ${ctx.userId}`;
  const proj = projectId ? sql`and l.project_id = ${projectId}` : sql``;
  const res = await tx.execute<{ stage: string; p: string | null; bmin: string | null; bmax: string | null; pmed: string | null }>(sql`
    select l.stage, l.conversion_probability as p, l.budget_min as bmin, l.budget_max as bmax,
      (select percentile_cont(0.5) within group (order by u.price) from units u where u.project_id = l.project_id and u.status in ('available','reserved')) as pmed
    from leads l where l.stage not in ('booked','lost') ${own} ${proj}`);
  const [{ med }] = (await tx.execute<{ med: string | null }>(sql`select percentile_cont(0.5) within group (order by agreement_value) as med from bookings where status <> 'cancelled'`)).rows;
  const open: OpenLead[] = res.rows.map((r) => ({
    stage: r.stage, probability: r.p == null ? null : Number(r.p), budgetMin: r.bmin == null ? null : Number(r.bmin),
    budgetMax: r.bmax == null ? null : Number(r.bmax), projectMedian: r.pmed == null ? null : Number(r.pmed),
  }));
  const history = await monthlyRevenue(tx, ctx, 7, projectId);
  return buildForecast(open, med == null ? null : Number(med), history);
}

export async function revenueSummary(tx: Tx, ctx: TenantCtx, from: Date, to: Date, projectId?: string) {
  const f = isoDate(from), t = isoDate(to);
  const sales = can(ctx.role, "leads:read_all") ? sql`` : sql`and b.sales_user_id = ${ctx.userId}`;
  const proj = projectId ? sql`and b.project_id = ${projectId}` : sql``;
  const [r] = (
    await tx.execute<Record<string, string>>(sql`
      select
        coalesce(sum(b.agreement_value) filter (where b.status <> 'cancelled' and b.booking_date >= ${f} and b.booking_date < ${t}), 0) as booked,
        count(*) filter (where b.status <> 'cancelled' and b.booking_date >= ${f} and b.booking_date < ${t}) as bookings,
        coalesce(sum(b.agreement_value) filter (where b.status = 'cancelled' and b.cancelled_at >= ${from} and b.cancelled_at < ${to}), 0) as cancelled_value,
        count(*) filter (where b.status = 'cancelled' and b.cancelled_at >= ${from} and b.cancelled_at < ${to}) as cancelled,
        coalesce((select sum(p.amount) from payments p join bookings b2 on b2.id = p.booking_id where p.paid_on >= ${f} and p.paid_on < ${t}
          ${can(ctx.role, "leads:read_all") ? sql`` : sql`and b2.sales_user_id = ${ctx.userId}`} ${projectId ? sql`and b2.project_id = ${projectId}` : sql``}), 0) as collected
      from bookings b where true ${sales} ${proj}`)
  ).rows;
  const rec = await receivables(tx, ctx, projectId);
  return {
    booked: Number(r.booked),
    bookings: Number(r.bookings),
    avgDeal: safeDivide(Number(r.booked), Number(r.bookings)),
    collected: Number(r.collected),
    cancelledValue: Number(r.cancelled_value),
    cancelled: Number(r.cancelled),
    outstanding: rec.reduce((s, b) => s + b.outstanding, 0),
    overdue: rec.reduce((s, b) => s + b.overdue, 0),
  };
}

export async function revenueBreakdown(tx: Tx, ctx: TenantCtx, by: "project" | "campaign" | "executive" | "source", from: Date, to: Date) {
  const f = isoDate(from), t = isoDate(to);
  const sales = can(ctx.role, "leads:read_all") ? sql`` : sql`and b.sales_user_id = ${ctx.userId}`;
  const key = {
    project: sql`coalesce(p.name, 'Unknown')`,
    campaign: sql`coalesce(c.name, 'No campaign')`,
    executive: sql`coalesce(u.name, 'Unassigned')`,
    source: sql`coalesce(b.source::text, 'unknown')`,
  }[by];
  const res = await tx.execute<{ k: string; bookings: string; revenue: string; collected: string }>(sql`
    select ${key} as k, count(*) as bookings, coalesce(sum(b.agreement_value),0) as revenue,
      coalesce(sum((select coalesce(sum(pm.amount),0) from payments pm where pm.booking_id = b.id)),0) as collected
    from bookings b
    left join projects p on p.id = b.project_id
    left join campaigns c on c.id = b.campaign_id
    left join users u on u.id = b.sales_user_id
    where b.status <> 'cancelled' and b.booking_date >= ${f} and b.booking_date < ${t} ${sales}
    group by 1 order by revenue desc`);
  return res.rows.map((r) => ({ key: r.k, bookings: Number(r.bookings), revenue: Number(r.revenue), collected: Number(r.collected) }));
}

export type LeakageItem = { key: string; label: string; detail: string; value: number | null; count: number; link?: string };

/** Places where revenue is being lost or delayed, each backed by a query over real records. */
export async function revenueLeakage(tx: Tx, ctx: TenantCtx, from: Date, to: Date): Promise<LeakageItem[]> {
  const f = isoDate(from), t = isoDate(to);
  const own = can(ctx.role, "leads:read_all") ? sql`` : sql`and l.owner_id = ${ctx.userId}`;
  const sales = can(ctx.role, "leads:read_all") ? sql`` : sql`and b.sales_user_id = ${ctx.userId}`;
  const [r] = (
    await tx.execute<Record<string, string | null>>(sql`
      select
        (select count(*) from bookings b where b.status = 'cancelled' and b.cancelled_at >= ${from} and b.cancelled_at < ${to} ${sales}) as cancel_n,
        (select coalesce(sum(b.agreement_value - coalesce(b.refund_amount,0)),0) from bookings b where b.status = 'cancelled' and b.cancelled_at >= ${from} and b.cancelled_at < ${to} ${sales}) as cancel_v,
        (select count(*) from bookings b join units u on u.id = b.unit_id where b.status <> 'cancelled' and b.agreement_value < u.price and b.booking_date >= ${f} and b.booking_date < ${t} ${sales}) as disc_n,
        (select coalesce(sum(u.price - b.agreement_value),0) from bookings b join units u on u.id = b.unit_id where b.status <> 'cancelled' and b.agreement_value < u.price and b.booking_date >= ${f} and b.booking_date < ${t} ${sales}) as disc_v,
        (select count(*) from leads l where l.stage = 'lost' and l.closed_at >= ${from} and l.closed_at < ${to} ${own}
           and exists (select 1 from site_visits v where v.lead_id = l.id and v.status = 'completed')) as late_lost_n,
        (select coalesce(sum(coalesce((l.budget_min + l.budget_max)/2, l.budget_max, l.budget_min)),0) from leads l where l.stage = 'lost' and l.closed_at >= ${from} and l.closed_at < ${to} ${own}
           and exists (select 1 from site_visits v where v.lead_id = l.id and v.status = 'completed')) as late_lost_v,
        (select count(*) from leads l where l.intent = 'hot' and l.stage not in ('booked','lost') ${own}
           and coalesce(l.last_contacted_at, l.created_at) < now() - interval '48 hours') as hot_idle_n,
        (select coalesce(sum(coalesce((l.budget_min + l.budget_max)/2, l.budget_max, l.budget_min)),0) from leads l where l.intent = 'hot' and l.stage not in ('booked','lost') ${own}
           and coalesce(l.last_contacted_at, l.created_at) < now() - interval '48 hours') as hot_idle_v,
        (select count(*) from leads l where l.stage = 'negotiation' and l.stage_changed_at < now() - interval '14 days' ${own}) as stalled_n
    `)
  ).rows;
  const rec = await receivables(tx, ctx);
  const overdue = rec.filter((b) => b.overdue > 0);
  const n = (k: string) => Number(r[k] ?? 0);
  return [
    { key: "overdue", label: "Overdue collections", detail: `${overdue.length} booking${overdue.length === 1 ? "" : "s"} have milestones past due`, value: overdue.reduce((s, b) => s + b.overdue, 0), count: overdue.length, link: "/payments?view=overdue" },
    { key: "cancellations", label: "Cancelled bookings", detail: "Agreement value lost to cancellations, net of refunds", value: n("cancel_v"), count: n("cancel_n"), link: "/bookings?status=cancelled" },
    { key: "discounts", label: "Discounts below list price", detail: "Gap between unit list price and agreement value", value: n("disc_v"), count: n("disc_n"), link: "/bookings" },
    { key: "late_lost", label: "Lost after a site visit", detail: "Leads who visited the site and were then lost (budget-based estimate)", value: n("late_lost_v") || null, count: n("late_lost_n"), link: "/leads?stage=lost" },
    { key: "hot_idle", label: "Hot leads waiting 48h+", detail: "High-intent leads with no contact in over 48 hours (budget-based estimate)", value: n("hot_idle_v") || null, count: n("hot_idle_n"), link: "/leads?intent=hot&sort=lastContact&dir=asc" },
    { key: "stalled", label: "Stalled negotiations", detail: "Leads in negotiation for more than 14 days", value: null, count: n("stalled_n"), link: "/leads?stage=negotiation" },
  ];
}
