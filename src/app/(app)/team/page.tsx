import type { Metadata } from "next";
import { Trophy, UserPlus } from "lucide-react";
import { loadPage } from "@/lib/server-action";
import { can, ROLE_LABELS, type Role } from "@/lib/auth/permissions";
import { dateRange, type SearchParams } from "@/lib/list-params";
import { executivePerformance } from "@/lib/services/analytics";
import { members } from "@/lib/services/org";
import { PageHeader, Panel, PanelHeader } from "@/components/ui/panel";
import { DateRangeFilter } from "@/components/ui/filters";
import { Stat } from "@/components/ui/stat";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/states";
import { LinkButton } from "@/components/ui/button";
import { Meter, RankBars } from "@/components/charts";
import { cn, formatMoney, formatNumber, formatPercent } from "@/lib/utils";
import { TargetsButton } from "./targets-button";

export const metadata: Metadata = { title: "Sales Team" };

export default async function TeamPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const { current } = dateRange(sp, "mtd");
  const { session, data } = await loadPage(async (tx, ctx) => ({
    perf: await executivePerformance(tx, ctx, current.from, current.to),
    team: can(ctx.role, "team:read") ? await members(tx) : [],
  }));
  const { perf, team } = data;
  const m = (v: number | null) => formatMoney(v, session.currency, true);
  const totals = perf.reduce(
    (a, e) => ({ leads: a.leads + e.leads, visits: a.visits + e.visits, bookings: a.bookings + e.bookings, revenue: a.revenue + e.revenue, overdue: a.overdue + e.overdueFollowUps, calls: a.calls + e.calls }),
    { leads: 0, visits: 0, bookings: 0, revenue: 0, overdue: 0, calls: 0 },
  );
  const byUser = new Map(team.map((t) => [t.userId, t]));
  const canManage = can(session.role, "team:manage");

  return (
    <>
      <PageHeader
        title="Sales Team"
        description={`Performance for ${current.label.toLowerCase()}. Revenue counts bookings credited to each executive.`}
        actions={
          <>
            <DateRangeFilter fallback="mtd" />
            {can(session.role, "users:manage") && <LinkButton href="/settings/users"><UserPlus className="size-4" /> Invite</LinkButton>}
          </>
        }
      />
      {perf.length === 0 ? (
        <Panel><EmptyState icon={Trophy} title="No sales activity yet" description="Invite sales executives and assign leads to see the leaderboard." /></Panel>
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Stat label="Leads handled" value={formatNumber(totals.leads)} />
            <Stat label="Calls logged" value={formatNumber(totals.calls)} />
            <Stat label="Site visits" value={formatNumber(totals.visits)} />
            <Stat label="Bookings" value={formatNumber(totals.bookings)} hint={m(totals.revenue)} />
            <Stat label="Overdue follow-ups" value={formatNumber(totals.overdue)} hint="right now" />
          </section>
          <div className="mt-4 grid gap-4 xl:grid-cols-3">
            <Panel className="xl:col-span-2">
              <PanelHeader title="Leaderboard" description="Ranked by revenue, then bookings and visits" />
              <Table>
                <THead>
                  <TH>#</TH><TH>Executive</TH><TH className="text-right">Leads</TH><TH className="text-right">Calls</TH><TH className="text-right">Follow-ups</TH>
                  <TH className="text-right">Visits</TH><TH className="text-right">Bookings</TH><TH className="text-right">Revenue</TH><TH className="text-right">Conversion</TH>
                  <TH className="text-right">1st response</TH><TH>Target</TH>{canManage && <TH />}
                </THead>
                <tbody>
                  {perf.map((e, i) => {
                    const member = byUser.get(e.userId);
                    return (
                      <TR key={e.userId}>
                        <TD className={cn("tnum font-semibold", i === 0 && "text-champagne")}>{i + 1}</TD>
                        <TD><div className="font-medium">{e.name}</div><div className="text-xs text-muted">{ROLE_LABELS[e.role as Role] ?? e.role}</div></TD>
                        <TD className="tnum text-right">{e.leads}</TD>
                        <TD className="tnum text-right">{e.calls}</TD>
                        <TD className="tnum text-right">{e.followUpsDone}{e.overdueFollowUps > 0 && <div className="text-xs text-danger">{e.overdueFollowUps} overdue</div>}</TD>
                        <TD className="tnum text-right">{e.visits}</TD>
                        <TD className="tnum text-right">{e.bookings}</TD>
                        <TD className="tnum text-right font-medium">{m(e.revenue)}</TD>
                        <TD className="tnum text-right">{formatPercent(e.conversion)}</TD>
                        <TD className="tnum text-right">{e.avgResponseHours == null ? "—" : e.avgResponseHours < 1 ? `${Math.round(e.avgResponseHours * 60)}m` : `${e.avgResponseHours.toFixed(1)}h`}</TD>
                        <TD className="min-w-28">
                          {e.targetAttainment == null ? <span className="text-xs text-muted">No target</span> : (
                            <><div className="tnum mb-1 text-xs">{formatPercent(e.targetAttainment, 0)}</div><Meter value={e.targetAttainment} /></>
                          )}
                        </TD>
                        {canManage && <TD>{member && <TargetsButton m={member} />}</TD>}
                      </TR>
                    );
                  })}
                </tbody>
              </Table>
            </Panel>
            <Panel>
              <PanelHeader title="Revenue by executive" />
              <div className="p-4">
                <RankBars kind="money" currency={session.currency} rows={perf.filter((e) => e.revenue > 0).map((e) => ({ label: e.name, value: e.revenue, sub: `${e.bookings} booking${e.bookings === 1 ? "" : "s"}` }))} emptyText="No bookings in this period yet." />
              </div>
            </Panel>
          </div>
        </>
      )}
    </>
  );
}
