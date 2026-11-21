import "server-only";
import { sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import type { TenantCtx } from "@/lib/db/tenant";
import { can } from "@/lib/auth/permissions";
import { formatMoney, formatPercent } from "@/lib/utils";
import { executivePerformance, funnel } from "./analytics";
import { campaignMetrics } from "./marketing";
import { receivables } from "./bookings";
import { revenueForecast } from "./revenue";

export type Insight = {
  id: string;
  severity: "critical" | "warning" | "opportunity" | "info";
  category: "leads" | "sales" | "marketing" | "inventory" | "revenue";
  title: string;
  detail: string;
  action?: { label: string; href: string };
};

const DAY = 86400_000;

/**
 * Generates recommendations from the organization's live data. Every insight cites the
 * numbers it is based on; nothing is invented, and thresholds require minimum sample sizes.
 */
export async function generateInsights(tx: Tx, ctx: TenantCtx, currency = "INR"): Promise<Insight[]> {
  const out: Insight[] = [];
  const now = new Date();
  const d90 = new Date(now.getTime() - 90 * DAY);
  const d30 = new Date(now.getTime() - 30 * DAY);
  const own = can(ctx.role, "leads:read_all") ? sql`` : sql`and l.owner_id = ${ctx.userId}`;
  const money = (v: number) => formatMoney(v, currency, true);

  // 1. Uncontacted leads + speed-to-lead evidence from this org's history
  const [u] = (
    await tx.execute<{ n: string; oldest_h: string | null }>(sql`
      select count(*) as n, max(extract(epoch from now() - l.created_at) / 3600) as oldest_h
      from leads l where l.last_contacted_at is null and l.stage not in ('booked','lost') and l.created_at < now() - interval '1 hour' ${own}`)
  ).rows;
  const uncontacted = Number(u.n);
  if (uncontacted > 0) {
    const [sp] = (
      await tx.execute<{ fast_n: string; fast_b: string; slow_n: string; slow_b: string }>(sql`
        with closed as (
          select l.stage, (select min(a.created_at) from lead_activities a where a.lead_id = l.id and a.direction = 'outbound') - l.created_at as rt
          from leads l where l.stage in ('booked','lost'))
        select count(*) filter (where rt <= interval '1 hour') as fast_n, count(*) filter (where rt <= interval '1 hour' and stage = 'booked') as fast_b,
               count(*) filter (where rt > interval '1 hour') as slow_n, count(*) filter (where rt > interval '1 hour' and stage = 'booked') as slow_b
        from closed where rt is not null`)
    ).rows;
    const fastN = Number(sp.fast_n), slowN = Number(sp.slow_n);
    const evidence =
      fastN >= 10 && slowN >= 10
        ? ` In your history, leads contacted within an hour converted at ${formatPercent(Number(sp.fast_b) / fastN)} vs ${formatPercent(Number(sp.slow_b) / slowN)} when contacted later.`
        : "";
    out.push({
      id: "uncontacted",
      severity: uncontacted >= 5 || Number(u.oldest_h) > 24 ? "critical" : "warning",
      category: "leads",
      title: `${uncontacted} open lead${uncontacted === 1 ? " has" : "s have"} never been contacted`,
      detail: `The oldest has waited ${Math.round(Number(u.oldest_h))} hours.${evidence}`,
      action: { label: "Open uncontacted leads", href: "/leads?stage=new&sort=created&dir=asc" },
    });
  }

  // 2. Overdue follow-ups
  const [fo] = (
    await tx.execute<{ n: string; owners: string }>(sql`
      select count(*) as n, count(distinct f.assigned_to_id) as owners from follow_ups f join leads l on l.id = f.lead_id
      where f.status = 'pending' and f.due_at < now() ${own}`)
  ).rows;
  if (Number(fo.n) > 0) {
    out.push({
      id: "overdue-followups",
      severity: Number(fo.n) >= 10 ? "critical" : "warning",
      category: "sales",
      title: `${fo.n} follow-up${Number(fo.n) === 1 ? " is" : "s are"} overdue`,
      detail: `Spread across ${fo.owners} team member${Number(fo.owners) === 1 ? "" : "s"}. Missed follow-ups lower lead scores and conversion.`,
      action: { label: "Review overdue follow-ups", href: "/follow-ups?view=overdue" },
    });
  }

  // 3. Hot leads requiring attention
  const hot = (
    await tx.execute<{ id: string; name: string; score: number; next_action: string | null }>(sql`
      select l.id, l.name, l.score, l.next_action from leads l
      where l.intent = 'hot' and l.stage not in ('booked','lost') and coalesce(l.last_contacted_at, l.created_at) < now() - interval '48 hours' ${own}
      order by l.score desc nulls last limit 5`)
  ).rows;
  if (hot.length) {
    out.push({
      id: "hot-idle",
      severity: "critical",
      category: "leads",
      title: `${hot.length} high-intent lead${hot.length === 1 ? "" : "s"} waiting more than 48 hours`,
      detail: hot.map((h) => `${h.name} (score ${h.score})`).join(", ") + ".",
      action: { label: "Act on hot leads", href: "/leads?intent=hot&sort=lastContact&dir=asc" },
    });
  }

  // 4. Funnel bottleneck (last 90 days, needs volume)
  const steps = await funnel(tx, ctx, d90, now);
  if (steps[0].value >= 20) {
    const candidates = steps.slice(1).filter((s, i) => steps[i].value >= 10 && s.stepRate != null);
    const worst = candidates.sort((a, b) => (a.stepRate ?? 1) - (b.stepRate ?? 1))[0];
    if (worst) {
      const idx = steps.findIndex((s) => s.key === worst.key);
      out.push({
        id: "bottleneck",
        severity: (worst.stepRate ?? 1) < 0.3 ? "warning" : "info",
        category: "sales",
        title: `Biggest drop-off: ${steps[idx - 1].label} → ${worst.label}`,
        detail: `Only ${formatPercent(worst.stepRate)} of leads that reached "${steps[idx - 1].label}" progressed to "${worst.label}" in the last 90 days (${steps[idx - 1].value} → ${worst.value}).`,
        action: { label: "See the funnel", href: "/revenue" },
      });
    }
  }

  // 5. Stage ageing
  const aging = (
    await tx.execute<{ stage: string; n: string; avg_days: string }>(sql`
      select l.stage, count(*) as n, avg(extract(epoch from now() - l.stage_changed_at) / 86400) as avg_days
      from leads l where l.stage in ('qualified','follow_up','site_visit_scheduled','negotiation') and l.stage_changed_at < now() - interval '14 days' ${own}
      group by l.stage order by count(*) desc limit 1`)
  ).rows[0];
  if (aging && Number(aging.n) >= 3) {
    out.push({
      id: "stage-aging",
      severity: "warning",
      category: "sales",
      title: `${aging.n} leads stuck in "${aging.stage.replace(/_/g, " ")}" for over 2 weeks`,
      detail: `They have spent ${Math.round(Number(aging.avg_days))} days in this stage on average. Re-engage or close them out so the pipeline stays accurate.`,
      action: { label: "Review these leads", href: `/leads?stage=${aging.stage}&sort=lastContact&dir=asc` },
    });
  }

  // 6. Campaign performance (managers / marketing only)
  if (can(ctx.role, "marketing:read")) {
    const camps = (await campaignMetrics(tx, d30, new Date(now.getTime() + DAY))).filter((c) => c.spend > 0);
    if (camps.length >= 2) {
      const cpls = camps.map((c) => c.cpl).filter((x): x is number => x != null).sort((a, b) => a - b);
      const median = cpls.length ? cpls[Math.floor(cpls.length / 2)] : null;
      const poor = camps.filter((c) => (c.leads === 0 && c.spend > 0) || (median && c.cpl && c.cpl > median * 1.5 && c.bookings === 0)).sort((a, b) => b.spend - a.spend);
      if (poor.length) {
        const c = poor[0];
        out.push({
          id: `campaign-poor-${c.id}`,
          severity: "warning",
          category: "marketing",
          title: `"${c.name}" is underperforming`,
          detail: `${money(c.spend)} spent in 30 days for ${c.leads} lead${c.leads === 1 ? "" : "s"}${c.cpl ? ` (CPL ${money(c.cpl)} vs median ${money(median ?? 0)})` : ""} and ${c.bookings} bookings. Consider pausing or reworking targeting.`,
          action: { label: "Open marketing", href: "/marketing" },
        });
      }
      const best = camps.filter((c) => c.bookings > 0).sort((a, b) => (b.roi ?? -Infinity) - (a.roi ?? -Infinity))[0];
      if (best) {
        out.push({
          id: `campaign-best-${best.id}`,
          severity: "opportunity",
          category: "marketing",
          title: `"${best.name}" produced the most return`,
          detail: `${best.bookings} booking${best.bookings === 1 ? "" : "s"} worth ${money(best.revenue)} from ${money(best.spend)} spend in 30 days${best.cpb ? ` (cost per booking ${money(best.cpb)})` : ""}. A good candidate for more budget.`,
          action: { label: "Compare campaigns", href: "/marketing" },
        });
      }
    }
  }

  // 7. Executive conversion vs team (needs volume)
  if (can(ctx.role, "team:read")) {
    const execs = (await executivePerformance(tx, ctx, d90, now)).filter((e) => e.leads >= 10);
    if (execs.length >= 2) {
      const teamLeads = execs.reduce((s, e) => s + e.leads, 0);
      const teamBooked = execs.reduce((s, e) => s + (e.conversion ?? 0) * e.leads, 0);
      const teamRate = teamBooked / teamLeads;
      const low = execs.filter((e) => e.conversion != null && teamRate > 0 && e.conversion < teamRate * 0.5).sort((a, b) => (a.conversion ?? 0) - (b.conversion ?? 0))[0];
      if (low) {
        out.push({
          id: `exec-low-${low.userId}`,
          severity: "info",
          category: "sales",
          title: `${low.name}'s conversion is well below the team`,
          detail: `${formatPercent(low.conversion)} of ${low.leads} leads (90 days) vs ${formatPercent(teamRate)} team average${low.overdueFollowUps ? `, with ${low.overdueFollowUps} overdue follow-ups` : ""}. Pair with a top performer or review call quality.`,
          action: { label: "Open team performance", href: "/team" },
        });
      }
    }
  }

  // 8. Demand vs inventory by configuration
  const demand = (
    await tx.execute<{ configuration: string; demand: string; available: string }>(sql`
      select l.configuration, count(*) as demand,
        (select count(*) from units u where u.status = 'available' and lower(u.configuration) = lower(l.configuration)) as available
      from leads l where l.configuration is not null and l.stage not in ('booked','lost') and l.created_at >= ${d90}
      group by l.configuration having count(*) >= 5 order by count(*) desc limit 5`)
  ).rows;
  const short = demand.find((d) => Number(d.available) < Number(d.demand) / 4);
  if (short) {
    out.push({
      id: `inventory-${short.configuration}`,
      severity: "opportunity",
      category: "inventory",
      title: `High demand for ${short.configuration}, little inventory`,
      detail: `${short.demand} open leads want ${short.configuration} but only ${short.available} unit${Number(short.available) === 1 ? " is" : "s are"} available. Consider pricing these units higher or releasing more inventory.`,
      action: { label: "View inventory", href: "/inventory?status=available" },
    });
  }

  // 9. Overdue collections
  if (can(ctx.role, "payments:write") || can(ctx.role, "revenue:read")) {
    const rec = (await receivables(tx, ctx)).filter((b) => b.overdue > 0);
    if (rec.length) {
      const total = rec.reduce((s, b) => s + b.overdue, 0);
      out.push({
        id: "overdue-payments",
        severity: total > 0 ? "critical" : "warning",
        category: "revenue",
        title: `${money(total)} in overdue payments`,
        detail: `${rec.length} booking${rec.length === 1 ? " has" : "s have"} milestones past their due date. Largest: ${rec.sort((a, b) => b.overdue - a.overdue)[0].customerName}.`,
        action: { label: "Chase collections", href: "/payments?view=overdue" },
      });
    }
  }

  // 10. Site-visit no-shows
  const [ns] = (
    await tx.execute<{ total: string; noshow: string; unconfirmed: string }>(sql`
      select count(*) filter (where v.status in ('completed','no_show')) as total, count(*) filter (where v.status = 'no_show') as noshow,
        (select count(*) from site_visits v2 where v2.status = 'scheduled' and v2.scheduled_at between now() and now() + interval '48 hours') as unconfirmed
      from site_visits v where v.scheduled_at >= ${d90}`)
  ).rows;
  if (Number(ns.total) >= 10 && Number(ns.noshow) / Number(ns.total) > 0.25) {
    out.push({
      id: "no-shows",
      severity: "warning",
      category: "sales",
      title: `${formatPercent(Number(ns.noshow) / Number(ns.total))} of site visits were no-shows`,
      detail: `${ns.noshow} of ${ns.total} visits in 90 days. ${Number(ns.unconfirmed) ? `${ns.unconfirmed} upcoming visits in the next 48 hours are still unconfirmed. ` : ""}Add a WhatsApp reminder automation for visits.`,
      action: { label: "Set up a reminder", href: "/automation" },
    });
  }

  // 11. Forecast outlook
  if (can(ctx.role, "revenue:read")) {
    const fc = await revenueForecast(tx, ctx);
    if (fc.openLeads > 0) {
      const m = fc.months[0];
      out.push({
        id: "forecast",
        severity: "info",
        category: "revenue",
        title: `Projected ${money(m.forecast)} in bookings this month`,
        detail: `About ${m.expectedBookings.toFixed(1)} expected bookings from ${fc.openLeads} open leads (weighted pipeline ${money(fc.weightedValue)}). Projection, not actual revenue.`,
        action: { label: "Open revenue forecast", href: "/revenue" },
      });
    }
  }

  const order = { critical: 0, warning: 1, opportunity: 2, info: 3 };
  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}
