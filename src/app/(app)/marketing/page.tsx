import type { Metadata } from "next";
import Link from "next/link";
import { Megaphone } from "lucide-react";
import { loadPage } from "@/lib/server-action";
import { can } from "@/lib/auth/permissions";
import { dateRange, param, type SearchParams } from "@/lib/list-params";
import { campaignMetrics, CHANNEL_LABELS, dailySpend, sourceMetrics } from "@/lib/services/marketing";
import { projectOptions } from "@/lib/services/projects";
import { SOURCE_LABELS } from "@/lib/services/leads";
import { getCampaign } from "@/lib/services/marketing";
import { PageHeader, Panel, PanelHeader } from "@/components/ui/panel";
import { DateRangeFilter, FilterSelect } from "@/components/ui/filters";
import { Stat } from "@/components/ui/stat";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/states";
import { Badge } from "@/components/ui/badge";
import { InlineAction } from "@/components/ui/form";
import { Bars, LineTrend, RankBars } from "@/components/charts";
import { NoAccess } from "@/components/app/bits";
import { cn, formatMoney, formatNumber, formatPercent, safeDivide } from "@/lib/utils";
import { deleteCampaignAction } from "./actions";
import { EditCampaignButton, ImportSpendButton, NewCampaignButton, RecordSpendButton } from "./forms";

export const metadata: Metadata = { title: "Marketing Intelligence" };

export default async function MarketingPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const { current } = dateRange(sp);
  const projectId = param(sp, "project");
  const { session, data } = await loadPage(async (tx, ctx) => {
    if (!can(ctx.role, "marketing:read")) return null;
    const [camps, sources, daily, projects] = await Promise.all([
      campaignMetrics(tx, current.from, current.to, projectId),
      sourceMetrics(tx, current.from, current.to, projectId),
      dailySpend(tx, current.from, current.to, projectId),
      projectOptions(tx),
    ]);
    const full = await Promise.all(camps.map((c) => getCampaign(tx, c.id)));
    return { camps, sources, daily, projects, full };
  });
  if (!data) return <NoAccess what="marketing intelligence" />;
  const cur = session.currency;
  const m = (v: number | null) => formatMoney(v, cur, true);
  const t = data.camps.reduce((a, c) => ({ spend: a.spend + c.spend, leads: a.leads + c.leads, qualified: a.qualified + c.qualified, visits: a.visits + c.visits, bookings: a.bookings + c.bookings, revenue: a.revenue + c.revenue }), { spend: 0, leads: 0, qualified: 0, visits: 0, bookings: 0, revenue: 0 });
  const projects = data.projects.map((p) => ({ value: p.id, label: p.name }));
  const canWrite = can(session.role, "marketing:write");
  const byChannel = Object.entries(
    data.camps.reduce<Record<string, { spend: number; leads: number; bookings: number }>>((acc, c) => {
      const k = c.channel;
      acc[k] ??= { spend: 0, leads: 0, bookings: 0 };
      acc[k].spend += c.spend; acc[k].leads += c.leads; acc[k].bookings += c.bookings;
      return acc;
    }, {}),
  );
  const fullById = new Map(data.full.map((c) => [c.id, c]));

  return (
    <>
      <PageHeader
        title="Marketing Intelligence"
        description={`${current.label}. Attribution is first-touch: the campaign recorded on a lead when it was captured. Leads count by creation date, bookings by booking date, spend by spend date.`}
        actions={
          <>
            <DateRangeFilter />
            {projects.length > 0 && <FilterSelect name="project" label="All projects" options={projects} />}
            {canWrite && <><ImportSpendButton /><RecordSpendButton campaigns={data.camps.map((c) => ({ value: c.id, label: c.name }))} /><NewCampaignButton projects={projects} /></>}
          </>
        }
      />
      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Spend" value={m(t.spend)} />
        <Stat label="Campaign leads" value={formatNumber(t.leads)} hint={`${formatNumber(t.qualified)} qualified`} />
        <Stat label="Cost per lead" value={m(t.spend ? safeDivide(t.spend, t.leads) : null)} />
        <Stat label="Bookings" value={formatNumber(t.bookings)} hint={`${formatNumber(t.visits)} site visits`} />
        <Stat label="Cost per booking" value={m(t.spend ? safeDivide(t.spend, t.bookings) : null)} />
        <Stat label="Marketing ROI" value={t.spend ? formatPercent((t.revenue - t.spend) / t.spend, 0) : "—"} hint={`${m(t.revenue)} booked`} />
      </section>

      <Panel className="mt-4">
        <PanelHeader title="Campaigns" description="Click column values to compare. ROI = (booked revenue − spend) ÷ spend." />
        {data.camps.length === 0 ? (
          <EmptyState icon={Megaphone} title="No campaigns yet" description="Create campaigns for each ad set or channel, record spend, and tag leads with their campaign (lead forms and ad webhooks do this automatically)." action={canWrite && <NewCampaignButton projects={projects} />} />
        ) : (
          <Table>
            <THead>
              <TH>Campaign</TH><TH className="text-right">Spend</TH><TH className="text-right">Leads</TH><TH className="text-right">Qualified</TH><TH className="text-right">CPL</TH>
              <TH className="text-right">Visits</TH><TH className="text-right">Bookings</TH><TH className="text-right">Cost / booking</TH><TH className="text-right">Revenue</TH><TH className="text-right">ROI</TH>{canWrite && <TH />}
            </THead>
            <tbody>
              {data.camps.sort((a, b) => b.spend - a.spend || b.leads - a.leads).map((c) => {
                const full = fullById.get(c.id);
                return (
                  <TR key={c.id} className={cn(!c.isActive && "opacity-60")}>
                    <TD>
                      <Link href={`/leads?campaign=${c.id}`} className="font-medium hover:underline">{c.name}</Link>
                      <div className="flex items-center gap-1.5 text-xs text-muted"><Badge>{CHANNEL_LABELS[c.channel as keyof typeof CHANNEL_LABELS]}</Badge>{c.projectName}{!c.isActive && " · paused"}</div>
                    </TD>
                    <TD className="tnum text-right">{m(c.spend)}{c.budget ? <div className="text-xs text-muted">of {m(c.budget)}</div> : null}</TD>
                    <TD className="tnum text-right">{c.leads}</TD>
                    <TD className="tnum text-right">{c.qualified}</TD>
                    <TD className="tnum text-right">{m(c.cpl)}</TD>
                    <TD className="tnum text-right">{c.visits}</TD>
                    <TD className="tnum text-right">{c.bookings}</TD>
                    <TD className="tnum text-right">{m(c.cpb)}</TD>
                    <TD className="tnum text-right">{m(c.revenue)}</TD>
                    <TD className={cn("tnum text-right font-medium", c.roi != null && (c.roi >= 0 ? "text-positive" : "text-danger"))}>{c.roi == null ? "—" : formatPercent(c.roi, 0)}</TD>
                    {canWrite && full && (
                      <TD className="text-right">
                        <div className="flex justify-end">
                          <EditCampaignButton projects={projects} campaign={{ ...full, createdAt: null } as never} />
                          <InlineAction action={deleteCampaignAction} fields={{ id: c.id }} variant="ghost" confirm={`Delete campaign "${c.name}"? Spend records are deleted; leads keep their history.`}>Delete</InlineAction>
                        </div>
                      </TD>
                    )}
                  </TR>
                );
              })}
            </tbody>
          </Table>
        )}
      </Panel>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Panel>
          <PanelHeader title="Daily spend" description="Spend per day across campaigns" />
          <div className="p-4"><Bars data={data.daily} x="date" kind="money" currency={cur} series={[{ key: "spend", label: "Spend" }]} emptyText="No spend recorded in this period." /></div>
        </Panel>
        <Panel>
          <PanelHeader title="Campaign leads per day" />
          <div className="p-4"><LineTrend data={data.daily} x="date" series={[{ key: "leads", label: "Leads" }]} emptyText="No campaign leads in this period." /></div>
        </Panel>
        <Panel>
          <PanelHeader title="Channels" description="Spend and bookings by channel" />
          <div className="p-4">
            <RankBars kind="money" currency={cur} rows={byChannel.map(([k, v]) => ({ label: CHANNEL_LABELS[k as keyof typeof CHANNEL_LABELS] ?? k, value: v.spend, sub: `${v.leads} leads · ${v.bookings} booked` }))} emptyText="No spend recorded." />
          </div>
        </Panel>
        <Panel>
          <PanelHeader title="Lead sources" description="All leads (with or without a campaign) — lead → booking conversion" />
          <Table>
            <THead><TH>Source</TH><TH className="text-right">Leads</TH><TH className="text-right">Qualified</TH><TH className="text-right">Booked</TH><TH className="text-right">Conversion</TH></THead>
            <tbody>
              {data.sources.map((s) => (
                <TR key={s.source}>
                  <TD>{SOURCE_LABELS[s.source as keyof typeof SOURCE_LABELS] ?? s.source}</TD>
                  <TD className="tnum text-right">{s.leads}</TD><TD className="tnum text-right">{s.qualified}</TD><TD className="tnum text-right">{s.booked}</TD>
                  <TD className="tnum text-right">{formatPercent(s.conversion)}</TD>
                </TR>
              ))}
              {!data.sources.length && <TR><TD colSpan={5} className="py-6 text-center text-muted">No leads in this period.</TD></TR>}
            </tbody>
          </Table>
        </Panel>
      </div>
    </>
  );
}
