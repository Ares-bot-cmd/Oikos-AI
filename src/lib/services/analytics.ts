import "server-only";
import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import type { TenantCtx } from "@/lib/db/tenant";
import { followUps, leadActivities, leads, users } from "@/lib/db/schema";
import { can } from "@/lib/auth/permissions";
import { isoDate, safeDivide } from "@/lib/utils";

const ADV = sql.raw(`('qualified','follow_up','site_visit_scheduled','negotiation','booked')`);

function ownerCond(ctx: TenantCtx, column = "l.owner_id") {
  return can(ctx.role, "leads:read_all") ? sql`` : sql`and ${sql.raw(column)} = ${ctx.userId}`;
}
const projCond = (projectId: string | undefined, column = "l.project_id") => (projectId ? sql`and ${sql.raw(column)} = ${projectId}` : sql``);

export type Kpis = {
  totalLeads: number; newLeads: number; qualifiedLeads: number; siteVisits: number; bookings: number;
  conversionRate: number | null; revenue: number; collections: number; spend: number; cpl: number | null; cpb: number | null;
};

export async function kpis(tx: Tx, ctx: TenantCtx, from: Date, to: Date, projectId?: string): Promise<Kpis> {
  const f = isoDate(from), t = isoDate(to);
  const salesCond = can(ctx.role, "leads:read_all") ? sql`` : sql`and b.sales_user_id = ${ctx.userId}`;
  const res = await tx.execute<Record<string, string>>(sql`
    select
      (select count(*) from leads l where true ${ownerCond(ctx)} ${projCond(projectId)}) as total_leads,
      (select count(*) from leads l where l.created_at >= ${from} and l.created_at < ${to} ${ownerCond(ctx)} ${projCond(projectId)}) as new_leads,
      (select count(*) from leads l where l.created_at >= ${from} and l.created_at < ${to} ${ownerCond(ctx)} ${projCond(projectId)}
         and (l.stage in ${ADV} or exists (select 1 from lead_activities a where a.lead_id = l.id and a.type = 'stage_change' and a.meta->>'to' in ${ADV}))) as qualified,
      (select count(*) from leads l where l.created_at >= ${from} and l.created_at < ${to} and l.stage = 'booked' ${ownerCond(ctx)} ${projCond(projectId)}) as cohort_booked,
      (select count(*) from site_visits v join leads l on l.id = v.lead_id where v.status = 'completed' and v.scheduled_at >= ${from} and v.scheduled_at < ${to} ${ownerCond(ctx)} ${projCond(projectId, "v.project_id")}) as visits,
      (select count(*) from bookings b where b.status <> 'cancelled' and b.booking_date >= ${f} and b.booking_date < ${t} ${salesCond} ${projCond(projectId, "b.project_id")}) as bookings,
      (select coalesce(sum(b.agreement_value),0) from bookings b where b.status <> 'cancelled' and b.booking_date >= ${f} and b.booking_date < ${t} ${salesCond} ${projCond(projectId, "b.project_id")}) as revenue,
      (select coalesce(sum(p.amount),0) from payments p join bookings b on b.id = p.booking_id where p.paid_on >= ${f} and p.paid_on < ${t} ${salesCond} ${projCond(projectId, "b.project_id")}) as collections,
      (select coalesce(sum(s.amount),0) from campaign_spend s join campaigns c on c.id = s.campaign_id where s.spend_date >= ${f} and s.spend_date < ${t} ${projCond(projectId, "c.project_id")}) as spend,
      (select count(*) from leads l where l.campaign_id is not null and l.created_at >= ${from} and l.created_at < ${to} ${projCond(projectId)}) as campaign_leads,
      (select count(*) from bookings b where b.campaign_id is not null and b.status <> 'cancelled' and b.booking_date >= ${f} and b.booking_date < ${t} ${projCond(projectId, "b.project_id")}) as campaign_bookings
  `);
  const r = res.rows[0];
  const n = (k: string) => Number(r[k] ?? 0);
  const spend = can(ctx.role, "marketing:read") ? n("spend") : 0;
  return {
    totalLeads: n("total_leads"),
    newLeads: n("new_leads"),
    qualifiedLeads: n("qualified"),
    siteVisits: n("visits"),
    bookings: n("bookings"),
    conversionRate: safeDivide(n("cohort_booked"), n("new_leads")),
    revenue: n("revenue"),
    collections: n("collections"),
    spend,
    cpl: spend ? safeDivide(spend, n("campaign_leads")) : null,
    cpb: spend ? safeDivide(spend, n("campaign_bookings")) : null,
  };
}

export async function monthlyRevenue(tx: Tx, ctx: TenantCtx, months = 12, projectId?: string) {
  const salesCond = can(ctx.role, "leads:read_all") ? sql`` : sql`and b.sales_user_id = ${ctx.userId}`;
  const res = await tx.execute<{ m: string; booked: string; collected: string; bookings: string }>(sql`
    with ms as (select generate_series(date_trunc('month', now()) - (${months - 1} * interval '1 month'), date_trunc('month', now()), interval '1 month')::date as m)
    select to_char(ms.m, 'YYYY-MM') as m,
      coalesce((select sum(b.agreement_value) from bookings b where b.status <> 'cancelled' and date_trunc('month', b.booking_date) = ms.m ${salesCond} ${projCond(projectId, "b.project_id")}), 0) as booked,
      coalesce((select sum(p.amount) from payments p join bookings b on b.id = p.booking_id where date_trunc('month', p.paid_on) = ms.m ${salesCond} ${projCond(projectId, "b.project_id")}), 0) as collected,
      (select count(*) from bookings b where b.status <> 'cancelled' and date_trunc('month', b.booking_date) = ms.m ${salesCond} ${projCond(projectId, "b.project_id")}) as bookings
    from ms order by ms.m`);
  return res.rows.map((r) => ({ month: r.m, booked: Number(r.booked), collected: Number(r.collected), bookings: Number(r.bookings) }));
}

/** Leads created per day (≤ 45 days) or per week, split into qualified vs other. */
export async function leadTrend(tx: Tx, ctx: TenantCtx, from: Date, to: Date, projectId?: string) {
  const days = (to.getTime() - from.getTime()) / 86400_000;
  const unit = days <= 45 ? "day" : days <= 200 ? "week" : "month";
  const res = await tx.execute<{ b: string; leads: string; qualified: string }>(sql`
    with buckets as (select generate_series(date_trunc(${unit}, ${from}::timestamptz), date_trunc(${unit}, ${to}::timestamptz - interval '1 second'), ${"1 " + unit}::interval) as b)
    select to_char(buckets.b, 'YYYY-MM-DD') as b,
      (select count(*) from leads l where date_trunc(${unit}, l.created_at) = buckets.b and l.created_at >= ${from} and l.created_at < ${to} ${ownerCond(ctx)} ${projCond(projectId)}) as leads,
      (select count(*) from leads l where date_trunc(${unit}, l.created_at) = buckets.b and l.created_at >= ${from} and l.created_at < ${to} and l.stage in ${ADV} ${ownerCond(ctx)} ${projCond(projectId)}) as qualified
    from buckets order by buckets.b`);
  return { unit, points: res.rows.map((r) => ({ date: r.b, leads: Number(r.leads), qualified: Number(r.qualified) })) };
}

/** Cohort funnel for leads created in the window: how far each lead has progressed. */
export async function funnel(tx: Tx, ctx: TenantCtx, from: Date, to: Date, projectId?: string) {
  const res = await tx.execute<Record<string, string>>(sql`
    with cohort as (
      select l.id, l.stage,
        array(select a.meta->>'to' from lead_activities a where a.lead_id = l.id and a.type = 'stage_change') as path
      from leads l where l.created_at >= ${from} and l.created_at < ${to} ${ownerCond(ctx)} ${projCond(projectId)}
    )
    select count(*) as leads,
      count(*) filter (where stage <> 'new' or cardinality(path) > 0) as contacted,
      count(*) filter (where stage in ${ADV} or path && array['qualified','follow_up','site_visit_scheduled','negotiation','booked']) as qualified,
      count(*) filter (where exists (select 1 from site_visits v where v.lead_id = cohort.id and v.status = 'completed')) as visited,
      count(*) filter (where stage in ('negotiation','booked') or path && array['negotiation','booked']) as negotiation,
      count(*) filter (where stage = 'booked') as booked
    from cohort`);
  const r = res.rows[0];
  const steps = [
    { key: "leads", label: "Leads" }, { key: "contacted", label: "Contacted" }, { key: "qualified", label: "Qualified" },
    { key: "visited", label: "Site visit done" }, { key: "negotiation", label: "Negotiation" }, { key: "booked", label: "Booked" },
  ];
  const top = Number(r.leads) || 0;
  return steps.map((s, i) => {
    const value = Number(r[s.key] ?? 0);
    const prev = i === 0 ? value : Number(r[steps[i - 1].key] ?? 0);
    return { ...s, value, ofTotal: safeDivide(value, top), stepRate: i === 0 ? null : safeDivide(value, prev) };
  });
}

export type ExecRow = {
  userId: string; name: string; role: string; leads: number; contacted: number; followUpsDone: number; overdueFollowUps: number;
  visits: number; bookings: number; revenue: number; conversion: number | null; avgResponseHours: number | null;
  bookingTarget: number | null; revenueTarget: number | null; targetAttainment: number | null; calls: number;
};

export async function executivePerformance(tx: Tx, ctx: TenantCtx, from: Date, to: Date): Promise<ExecRow[]> {
  const f = isoDate(from), t = isoDate(to);
  const months = Math.max(1, (to.getTime() - from.getTime()) / (30.44 * 86400_000));
  const res = await tx.execute<Record<string, string | null>>(sql`
    select u.id as user_id, u.name, m.role, m.monthly_booking_target, m.monthly_revenue_target,
      (select count(*) from leads l where l.owner_id = u.id and l.created_at >= ${from} and l.created_at < ${to}) as leads,
      (select count(*) from leads l where l.owner_id = u.id and l.created_at >= ${from} and l.created_at < ${to} and l.last_contacted_at is not null) as contacted,
      (select count(*) from follow_ups fu where fu.assigned_to_id = u.id and fu.status = 'done' and fu.completed_at >= ${from} and fu.completed_at < ${to}) as follow_ups_done,
      (select count(*) from follow_ups fu where fu.assigned_to_id = u.id and fu.status = 'pending' and fu.due_at < now()) as overdue,
      (select count(*) from lead_activities a where a.user_id = u.id and a.type = 'call' and a.created_at >= ${from} and a.created_at < ${to}) as calls,
      (select count(*) from site_visits v where v.assigned_to_id = u.id and v.status = 'completed' and v.scheduled_at >= ${from} and v.scheduled_at < ${to}) as visits,
      (select count(*) from bookings b where b.sales_user_id = u.id and b.status <> 'cancelled' and b.booking_date >= ${f} and b.booking_date < ${t}) as bookings,
      (select coalesce(sum(b.agreement_value),0) from bookings b where b.sales_user_id = u.id and b.status <> 'cancelled' and b.booking_date >= ${f} and b.booking_date < ${t}) as revenue,
      (select count(*) from leads l where l.owner_id = u.id and l.created_at >= ${from} and l.created_at < ${to} and l.stage = 'booked') as cohort_booked,
      (select avg(extract(epoch from (first_touch - l.created_at)) / 3600) from (
         select l2.created_at, (select min(a.created_at) from lead_activities a where a.lead_id = l2.id and a.direction = 'outbound') as first_touch
         from leads l2 where l2.owner_id = u.id and l2.created_at >= ${from} and l2.created_at < ${to}) l where first_touch is not null) as avg_response_hours
    from memberships m join users u on u.id = m.user_id
    where m.is_active and m.role in ('sales_executive','sales_manager','org_admin')
    ${can(ctx.role, "team:read") ? sql`` : sql`and u.id = ${ctx.userId}`}
    order by u.name`);
  return res.rows
    .map((r) => {
      const bookingsN = Number(r.bookings), revenue = Number(r.revenue), leadsN = Number(r.leads);
      const bt = r.monthly_booking_target == null ? null : Number(r.monthly_booking_target);
      const rt = r.monthly_revenue_target == null ? null : Number(r.monthly_revenue_target);
      const attainment = rt ? revenue / (rt * months) : bt ? bookingsN / (bt * months) : null;
      return {
        userId: r.user_id!, name: r.name!, role: r.role!, leads: leadsN, contacted: Number(r.contacted), followUpsDone: Number(r.follow_ups_done),
        overdueFollowUps: Number(r.overdue), calls: Number(r.calls), visits: Number(r.visits), bookings: bookingsN, revenue,
        conversion: safeDivide(Number(r.cohort_booked), leadsN), avgResponseHours: r.avg_response_hours == null ? null : Number(r.avg_response_hours),
        bookingTarget: bt, revenueTarget: rt, targetAttainment: attainment,
      };
    })
    .filter((r) => r.role === "sales_executive" || r.leads > 0 || r.bookings > 0)
    .sort((a, b) => b.revenue - a.revenue || b.bookings - a.bookings || b.visits - a.visits);
}

export async function projectPerformance(tx: Tx, from: Date, to: Date) {
  const f = isoDate(from), t = isoDate(to);
  const res = await tx.execute<Record<string, string>>(sql`
    select p.id, p.name, p.location,
      (select count(*) from leads l where l.project_id = p.id and l.created_at >= ${from} and l.created_at < ${to}) as leads,
      (select count(*) from site_visits v where v.project_id = p.id and v.status = 'completed' and v.scheduled_at >= ${from} and v.scheduled_at < ${to}) as visits,
      (select count(*) from bookings b where b.project_id = p.id and b.status <> 'cancelled' and b.booking_date >= ${f} and b.booking_date < ${t}) as bookings,
      (select coalesce(sum(b.agreement_value),0) from bookings b where b.project_id = p.id and b.status <> 'cancelled' and b.booking_date >= ${f} and b.booking_date < ${t}) as revenue,
      (select count(*) from units u where u.project_id = p.id) as units,
      (select count(*) from units u where u.project_id = p.id and u.status = 'available') as available,
      (select count(*) from units u where u.project_id = p.id and u.status in ('booked','sold')) as sold
    from projects p order by p.name`);
  return res.rows.map((r) => ({
    id: r.id, name: r.name, location: r.location, leads: Number(r.leads), visits: Number(r.visits), bookings: Number(r.bookings),
    revenue: Number(r.revenue), units: Number(r.units), available: Number(r.available), sold: Number(r.sold),
    conversion: safeDivide(Number(r.bookings), Number(r.leads)), visitToBooking: safeDivide(Number(r.bookings), Number(r.visits)),
    absorption: safeDivide(Number(r.sold), Number(r.units)),
  }));
}

export async function recentActivity(tx: Tx, ctx: TenantCtx, limit = 12) {
  return tx
    .select({ id: leadActivities.id, type: leadActivities.type, body: leadActivities.body, createdAt: leadActivities.createdAt, leadId: leads.id, leadName: leads.name, userName: users.name })
    .from(leadActivities)
    .innerJoin(leads, eq(leads.id, leadActivities.leadId))
    .leftJoin(users, eq(users.id, leadActivities.userId))
    .where(can(ctx.role, "leads:read_all") ? undefined : eq(leads.ownerId, ctx.userId!))
    .orderBy(desc(leadActivities.createdAt))
    .limit(limit);
}

export async function upcomingFollowUps(tx: Tx, ctx: TenantCtx, limit = 8) {
  return tx
    .select({ id: followUps.id, dueAt: followUps.dueAt, type: followUps.type, leadId: leads.id, leadName: leads.name, assignee: users.name })
    .from(followUps)
    .innerJoin(leads, eq(leads.id, followUps.leadId))
    .leftJoin(users, eq(users.id, followUps.assignedToId))
    .where(and(eq(followUps.status, "pending"), gte(followUps.dueAt, new Date(Date.now() - 7 * 86400_000)), can(ctx.role, "leads:read_all") ? undefined : eq(followUps.assignedToId, ctx.userId!)))
    .orderBy(asc(followUps.dueAt))
    .limit(limit);
}
