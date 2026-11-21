import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Info } from "lucide-react";
import { loadPage } from "@/lib/server-action";
import { can } from "@/lib/auth/permissions";
import { dateRange, param, type SearchParams } from "@/lib/list-params";
import { funnel, monthlyRevenue } from "@/lib/services/analytics";
import { revenueBreakdown, revenueForecast, revenueLeakage, revenueSummary } from "@/lib/services/revenue";
import { projectOptions } from "@/lib/services/projects";
import { SOURCE_LABELS } from "@/lib/services/leads";
import { PageHeader, Panel, PanelHeader } from "@/components/ui/panel";
import { DateRangeFilter, FilterSelect } from "@/components/ui/filters";
import { Stat, delta } from "@/components/ui/stat";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { NoAccess } from "@/components/app/bits";
import { Bars, Funnel, RankBars } from "@/components/charts";
import { formatMoney, formatNumber } from "@/lib/utils";

export const metadata: Metadata = { title: "Revenue Intelligence" };

export default async function RevenuePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const { current, previous } = dateRange(sp, "90d");
  const projectId = param(sp, "project");
  const { session, data } = await loadPage(async (tx, ctx) => {
    if (!can(ctx.role, "revenue:read")) return null;
    const [sum, prev, fc, months, byProject, byCampaign, byExec, bySource, leakage, steps, projects] = await Promise.all([
      revenueSummary(tx, ctx, current.from, current.to, projectId),
      revenueSummary(tx, ctx, previous.from, previous.to, projectId),
      revenueForecast(tx, ctx, projectId),
      monthlyRevenue(tx, ctx, 12, projectId),
      revenueBreakdown(tx, ctx, "project", current.from, current.to),
      revenueBreakdown(tx, ctx, "campaign", current.from, current.to),
      revenueBreakdown(tx, ctx, "executive", current.from, current.to),
      revenueBreakdown(tx, ctx, "source", current.from, current.to),
      revenueLeakage(tx, ctx, current.from, current.to),
      funnel(tx, ctx, current.from, current.to, projectId),
      projectOptions(tx),
    ]);
    return { sum, prev, fc, months, byProject, byCampaign, byExec, bySource, leakage, steps, projects };
  });
  if (!data) return <NoAccess what="revenue intelligence" />;
  const cur = session.currency;
  const m = (v: number | null) => formatMoney(v, cur, true);
  const { sum, prev, fc } = data;
  const monthLabel = (k: string) => new Date(k + "-01T00:00:00").toLocaleDateString("en-IN", { month: "long", year: "numeric" });

  return (
    <>
      <PageHeader
        title="Revenue Intelligence"
        description={`Actual revenue for ${current.label.toLowerCase()} vs the previous period, plus a 3-month projection. Actual and projected figures are always labelled.`}
        actions={<><DateRangeFilter fallback="90d" />{data.projects.length > 0 && <FilterSelect name="project" label="All projects" options={data.projects.map((p) => ({ value: p.id, label: p.name }))} />}</>}
      />

      <h2 className="mb-2 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wider text-muted"><Badge tone="positive">Actual</Badge> Recorded results</h2>
      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Booked revenue" value={m(sum.booked)} delta={delta(sum.booked, prev.booked)} hint="agreement value" />
        <Stat label="Bookings" value={formatNumber(sum.bookings)} delta={delta(sum.bookings, prev.bookings)} />
        <Stat label="Average deal" value={m(sum.avgDeal)} delta={delta(sum.avgDeal, prev.avgDeal)} />
        <Stat label="Collections" value={m(sum.collected)} delta={delta(sum.collected, prev.collected)} />
        <Stat label="Outstanding receivables" value={m(sum.outstanding)} hint={`${m(sum.overdue)} overdue`} />
        <Stat label="Cancelled" value={m(sum.cancelledValue)} hint={`${sum.cancelled} booking${sum.cancelled === 1 ? "" : "s"}`} goodWhenUp={false} delta={delta(sum.cancelledValue, prev.cancelledValue)} />
      </section>

      <h2 className="mb-2 mt-6 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wider text-muted"><Badge tone="gold">Projected</Badge> Forecast</h2>
      <div className="grid gap-4 xl:grid-cols-3">
        <Panel className="xl:col-span-2">
          <PanelHeader title="Revenue forecast" description="Projected bookings value for this month and the next two" />
          <Table>
            <THead><TH>Month</TH><TH className="text-right">Pipeline-weighted</TH><TH className="text-right">Trend</TH><TH className="text-right">Forecast</TH><TH className="text-right">Expected bookings</TH></THead>
            <tbody>
              {fc.months.map((x) => (
                <TR key={x.month}>
                  <TD className="font-medium">{monthLabel(x.month)}</TD>
                  <TD className="tnum text-right">{m(x.pipeline)}</TD>
                  <TD className="tnum text-right">{x.trend == null ? <span className="text-muted">n/a</span> : m(x.trend)}</TD>
                  <TD className="tnum text-right font-semibold">{m(x.forecast)}</TD>
                  <TD className="tnum text-right">{x.expectedBookings.toFixed(1)}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
          <p className="flex gap-2 border-t border-line px-4 py-3 text-xs text-muted"><Info className="mt-0.5 size-3.5 shrink-0" />{fc.method} {fc.valuedLeads < fc.openLeads && `${fc.openLeads - fc.valuedLeads} open leads have no budget or project price to value them and are excluded from value (but counted in expected bookings).`}</p>
        </Panel>
        <Panel>
          <PanelHeader title="Sales pipeline" description="Open leads (not booked or lost)" />
          <dl className="space-y-3 p-4 text-[13.5px]">
            <div className="flex justify-between"><dt className="text-muted">Open leads</dt><dd className="tnum font-medium">{formatNumber(fc.openLeads)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Pipeline value (estimated)</dt><dd className="tnum font-medium">{m(fc.pipelineValue)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Probability-weighted value</dt><dd className="tnum font-medium">{m(fc.weightedValue)}</dd></div>
            <p className="border-t border-line pt-3 text-xs text-muted">Each lead is valued at its budget midpoint, else its preferred project&apos;s median list price, else your median booking value — then weighted by its AI conversion probability.</p>
          </dl>
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Panel className="xl:col-span-2">
          <PanelHeader title="Booked vs collected" description="Last 12 months · actual" />
          <div className="p-4"><Bars data={data.months} x="month" kind="money" currency={cur} series={[{ key: "booked", label: "Booked" }, { key: "collected", label: "Collected" }]} emptyText="No bookings or collections recorded yet." /></div>
        </Panel>
        <Panel>
          <PanelHeader title="Conversion funnel" description={`Leads created · ${current.label.toLowerCase()}`} />
          <div className="p-4"><Funnel steps={data.steps} /></div>
        </Panel>
      </div>

      <Panel className="mt-4">
        <PanelHeader title="Revenue leakage" description="Where revenue is being lost or delayed — each figure comes from your records" />
        <ul className="grid divide-y divide-line md:grid-cols-2 md:divide-y-0 xl:grid-cols-3">
          {data.leakage.map((l) => (
            <li key={l.key} className="border-line p-4 md:border-b xl:border-r">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-[13.5px] font-semibold">{l.label}</h3>
                <span className="tnum text-xs text-muted">{l.count}</span>
              </div>
              <div className="tnum mt-1 font-display text-xl font-bold">{l.value != null ? m(l.value) : formatNumber(l.count)}</div>
              <p className="mt-0.5 text-xs text-muted">{l.detail}</p>
              {l.link && l.count > 0 && <Link href={l.link} className="mt-1.5 inline-flex items-center gap-1 text-[12.5px] font-medium text-emerald hover:underline">Review <ArrowRight className="size-3" /></Link>}
            </li>
          ))}
        </ul>
      </Panel>

      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {([
          ["By project", data.byProject, (k: string) => k],
          ["By campaign", data.byCampaign, (k: string) => k],
          ["By sales executive", data.byExec, (k: string) => k],
          ["By lead source", data.bySource, (k: string) => SOURCE_LABELS[k as keyof typeof SOURCE_LABELS] ?? k],
        ] as const).map(([title, rows, label]) => (
          <Panel key={title}>
            <PanelHeader title={`Revenue ${title.toLowerCase()}`} />
            <div className="p-4"><RankBars kind="money" currency={cur} rows={rows.slice(0, 8).map((r) => ({ label: label(r.key), value: r.revenue, sub: `${r.bookings}` }))} emptyText="No bookings in this period." /></div>
          </Panel>
        ))}
      </div>
    </>
  );
}
