import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Circle, Sparkles } from "lucide-react";
import { loadPage } from "@/lib/server-action";
import { can } from "@/lib/auth/permissions";
import { dateRange, param, type SearchParams } from "@/lib/list-params";
import { executivePerformance, funnel, kpis, leadTrend, monthlyRevenue, projectPerformance, recentActivity, upcomingFollowUps } from "@/lib/services/analytics";
import { campaignMetrics } from "@/lib/services/marketing";
import { generateInsights } from "@/lib/services/insights";
import { projectOptions } from "@/lib/services/projects";
import { usage } from "@/lib/services/org";
import { PageHeader, Panel, PanelHeader } from "@/components/ui/panel";
import { Stat, delta } from "@/components/ui/stat";
import { DateRangeFilter, FilterSelect } from "@/components/ui/filters";
import { Bars, Funnel, LineTrend, RankBars } from "@/components/charts";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { LinkButton } from "@/components/ui/button";
import { InsightRow } from "@/components/app/insight-row";
import { formatDateTime, formatMoney, formatNumber, formatPercent, relativeTime } from "@/lib/utils";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const { current, previous } = dateRange(sp);
  const projectId = param(sp, "project");
  const { session, data } = await loadPage(async (tx, ctx, s) => {
    const [k, kPrev, months, trend, steps, activity, followUps, insights, projects, execs, projectsPerf, camps, u] = await Promise.all([
      kpis(tx, ctx, current.from, current.to, projectId),
      kpis(tx, ctx, previous.from, previous.to, projectId),
      monthlyRevenue(tx, ctx, 12, projectId),
      leadTrend(tx, ctx, current.from, current.to, projectId),
      funnel(tx, ctx, current.from, current.to, projectId),
      recentActivity(tx, ctx, 10),
      upcomingFollowUps(tx, ctx, 8),
      generateInsights(tx, ctx, s.currency),
      projectOptions(tx),
      can(ctx.role, "team:read") ? executivePerformance(tx, ctx, current.from, current.to) : Promise.resolve([]),
      projectPerformance(tx, current.from, current.to),
      can(ctx.role, "marketing:read") ? campaignMetrics(tx, current.from, current.to, projectId) : Promise.resolve([]),
      usage(tx),
    ]);
    return { k, kPrev, months, trend, steps, activity, followUps, insights, projects, execs, projectsPerf, camps, u };
  });
  const { k, kPrev, months, trend, steps, activity, followUps, insights, projects, execs, projectsPerf, camps, u } = data;
  const cur = session.currency;
  const m = (v: number | null) => formatMoney(v, cur, true);
  const isNew = u.projects === 0 || u.leadsTotal === 0;

  return (
    <>
      <PageHeader
        eyebrow={session.orgName}
        title={`Good ${greeting()}, ${session.name.split(" ")[0]}`}
        description={`${current.label} compared with the previous period of the same length.`}
        actions={
          <>
            <DateRangeFilter />
            {projects.length > 0 && <FilterSelect name="project" label="All projects" options={projects.map((p) => ({ value: p.id, label: p.name }))} />}
          </>
        }
      />

      {isNew && <Onboarding hasProjects={u.projects > 0} hasLeads={u.leadsTotal > 0} hasTeam={u.seats > 1} canInvite={can(session.role, "users:manage")} />}

      <section aria-label="Key metrics" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Stat label="Total leads" value={formatNumber(k.totalLeads)} hint="all time" />
        <Stat label="New leads" value={formatNumber(k.newLeads)} delta={delta(k.newLeads, kPrev.newLeads)} />
        <Stat label="Qualified leads" value={formatNumber(k.qualifiedLeads)} delta={delta(k.qualifiedLeads, kPrev.qualifiedLeads)} />
        <Stat label="Site visits" value={formatNumber(k.siteVisits)} delta={delta(k.siteVisits, kPrev.siteVisits)} hint="completed" />
        <Stat label="Bookings" value={formatNumber(k.bookings)} delta={delta(k.bookings, kPrev.bookings)} />
        <Stat label="Conversion rate" value={formatPercent(k.conversionRate)} delta={delta(k.conversionRate, kPrev.conversionRate)} hint="lead → booking" />
        <Stat label="Booked revenue" value={m(k.revenue)} delta={delta(k.revenue, kPrev.revenue)} hint={`${m(k.collections)} collected`} />
        {can(session.role, "marketing:read") && (
          <>
            <Stat label="Marketing spend" value={m(k.spend)} delta={delta(k.spend, kPrev.spend)} goodWhenUp={false} />
            <Stat label="Cost per lead" value={m(k.cpl)} delta={delta(k.cpl, kPrev.cpl)} goodWhenUp={false} />
            <Stat label="Cost per booking" value={m(k.cpb)} delta={delta(k.cpb, kPrev.cpb)} goodWhenUp={false} />
          </>
        )}
      </section>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Panel className="xl:col-span-2">
          <PanelHeader title="Revenue trend" description="Booked (agreement value) vs collected, last 12 months · actual figures" actions={<LinkButton href="/revenue" size="sm" variant="ghost">Details <ArrowRight className="size-3.5" /></LinkButton>} />
          <div className="p-4">
            <LineTrend data={months} x="month" kind="money" currency={cur} series={[{ key: "booked", label: "Booked" }, { key: "collected", label: "Collected" }]} />
          </div>
        </Panel>
        <Panel>
          <PanelHeader title="AI recommendations" description="From your live data" actions={<LinkButton href="/insights" size="sm" variant="ghost">All <ArrowRight className="size-3.5" /></LinkButton>} />
          <div className="divide-y divide-line">
            {insights.length === 0 && <p className="px-4 py-8 text-center text-[13px] text-muted">Nothing needs attention right now.</p>}
            {insights.slice(0, 4).map((i) => <InsightRow key={i.id} insight={i} />)}
          </div>
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Panel className="xl:col-span-2">
          <PanelHeader title="Lead acquisition" description={`New vs qualified leads per ${trend.unit} · ${current.label.toLowerCase()}`} />
          <div className="p-4">
            <Bars data={trend.points} x="date" series={[{ key: "leads", label: "New leads" }, { key: "qualified", label: "Qualified" }]} />
          </div>
        </Panel>
        <Panel>
          <PanelHeader title="Conversion funnel" description="Leads created in this period, by furthest stage reached" />
          <div className="p-4"><Funnel steps={steps} /></div>
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        {can(session.role, "marketing:read") && (
          <Panel>
            <PanelHeader title="Campaign performance" description="Leads by campaign (first-touch), with bookings" actions={<LinkButton href="/marketing" size="sm" variant="ghost">Marketing <ArrowRight className="size-3.5" /></LinkButton>} />
            <div className="p-4">
              <RankBars
                rows={camps.filter((c) => c.leads > 0).sort((a, b) => b.leads - a.leads).slice(0, 6).map((c) => ({ label: c.name, value: c.leads, sub: `${c.bookings} booked${c.cpl ? ` · CPL ${m(c.cpl)}` : ""}` }))}
                emptyText="No campaign leads in this period. Create campaigns and tag leads to see attribution."
              />
            </div>
          </Panel>
        )}
        {can(session.role, "team:read") && (
          <Panel>
            <PanelHeader title="Sales executive performance" actions={<LinkButton href="/team" size="sm" variant="ghost">Leaderboard <ArrowRight className="size-3.5" /></LinkButton>} />
            <Table>
              <THead><TH>Executive</TH><TH className="text-right">Leads</TH><TH className="text-right">Visits</TH><TH className="text-right">Bookings</TH><TH className="text-right">Revenue</TH></THead>
              <tbody>
                {execs.slice(0, 6).map((e) => (
                  <TR key={e.userId}>
                    <TD className="font-medium">{e.name}</TD>
                    <TD className="tnum text-right">{e.leads}</TD>
                    <TD className="tnum text-right">{e.visits}</TD>
                    <TD className="tnum text-right">{e.bookings}</TD>
                    <TD className="tnum text-right">{m(e.revenue)}</TD>
                  </TR>
                ))}
                {!execs.length && <TR><TD colSpan={5} className="py-8 text-center text-muted">Invite sales executives to track their performance.</TD></TR>}
              </tbody>
            </Table>
          </Panel>
        )}
      </div>

      <Panel className="mt-4">
        <PanelHeader title="Project performance" description={current.label} actions={<LinkButton href="/projects" size="sm" variant="ghost">Projects <ArrowRight className="size-3.5" /></LinkButton>} />
        <Table>
          <THead><TH>Project</TH><TH className="text-right">Leads</TH><TH className="text-right">Visits</TH><TH className="text-right">Bookings</TH><TH className="text-right">Revenue</TH><TH className="text-right">Lead→booking</TH><TH className="text-right">Available units</TH></THead>
          <tbody>
            {projectsPerf.map((p) => (
              <TR key={p.id}>
                <TD><Link href={`/projects/${p.id}`} className="font-medium hover:underline">{p.name}</Link><div className="text-xs text-muted">{p.location}</div></TD>
                <TD className="tnum text-right">{p.leads}</TD>
                <TD className="tnum text-right">{p.visits}</TD>
                <TD className="tnum text-right">{p.bookings}</TD>
                <TD className="tnum text-right">{m(p.revenue)}</TD>
                <TD className="tnum text-right">{formatPercent(p.conversion)}</TD>
                <TD className="tnum text-right">{p.available} / {p.units}</TD>
              </TR>
            ))}
            {!projectsPerf.length && <TR><TD colSpan={7} className="py-8 text-center text-muted">No projects yet. <Link href="/projects" className="text-emerald hover:underline">Add your first project</Link>.</TD></TR>}
          </tbody>
        </Table>
      </Panel>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Panel>
          <PanelHeader title="Upcoming follow-ups" actions={<LinkButton href="/follow-ups" size="sm" variant="ghost">All <ArrowRight className="size-3.5" /></LinkButton>} />
          <ul className="divide-y divide-line">
            {followUps.map((f) => (
              <li key={f.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13.5px]">
                <div className="min-w-0">
                  <Link href={`/leads/${f.leadId}`} className="font-medium hover:underline">{f.leadName}</Link>
                  <div className="text-xs text-muted">{f.type} · {f.assignee ?? "Unassigned"}</div>
                </div>
                <span className={cn("tnum shrink-0 text-xs", f.dueAt < new Date() ? "font-medium text-danger" : "text-ink-2")}>{formatDateTime(f.dueAt, session.timezone)}</span>
              </li>
            ))}
            {!followUps.length && <li className="px-4 py-8 text-center text-[13px] text-muted">No pending follow-ups.</li>}
          </ul>
        </Panel>
        <Panel>
          <PanelHeader title="Recent activity" />
          <ul className="divide-y divide-line">
            {activity.map((a) => (
              <li key={a.id} className="px-4 py-2.5 text-[13.5px]">
                <div className="flex items-baseline justify-between gap-3">
                  <Link href={`/leads/${a.leadId}`} className="truncate font-medium hover:underline">{a.leadName}</Link>
                  <span className="shrink-0 text-xs text-muted">{relativeTime(a.createdAt)}</span>
                </div>
                <div className="truncate text-xs text-ink-2">{a.userName ? `${a.userName}: ` : ""}{a.body}</div>
              </li>
            ))}
            {!activity.length && <li className="px-4 py-8 text-center text-[13px] text-muted">Activity on your leads will appear here.</li>}
          </ul>
        </Panel>
      </div>
    </>
  );
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
}

function Onboarding({ hasProjects, hasLeads, hasTeam, canInvite }: { hasProjects: boolean; hasLeads: boolean; hasTeam: boolean; canInvite: boolean }) {
  const steps = [
    { done: hasProjects, label: "Add a project and its inventory", href: "/projects" },
    { done: hasLeads, label: "Add or import your leads", href: "/leads" },
    ...(canInvite ? [{ done: hasTeam, label: "Invite your sales team", href: "/settings/users" }] : []),
    { done: false, label: "Connect WhatsApp, Meta and Google lead forms", href: "/settings/integrations" },
  ];
  return (
    <Panel className="mb-4 border-emerald/25 bg-emerald-soft/40">
      <div className="flex flex-wrap items-start gap-4 p-4">
        <div className="flex size-9 items-center justify-center rounded-full bg-forest text-champagne"><Sparkles className="size-4" /></div>
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold">Set up your workspace</h2>
          <p className="text-[13px] text-ink-2">Metrics on this page are calculated only from records you add — there is no sample data.</p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {steps.map((s) => (
              <li key={s.label}>
                <Link href={s.href} className="flex items-center gap-2 text-[13.5px] hover:underline">
                  {s.done ? <CheckCircle2 className="size-4 text-positive" /> : <Circle className="size-4 text-muted" />}
                  <span className={s.done ? "text-muted line-through" : "text-ink"}>{s.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Panel>
  );
}
