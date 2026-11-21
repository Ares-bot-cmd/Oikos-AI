import type { Metadata } from "next";
import Link from "next/link";
import { MapPin } from "lucide-react";
import { loadPage } from "@/lib/server-action";
import { can } from "@/lib/auth/permissions";
import { hrefWith, listParams, param, type SearchParams } from "@/lib/list-params";
import { listVisits, type VisitView } from "@/lib/services/visits";
import { leadOptions, memberOptions } from "@/lib/services/leads";
import { projectOptions } from "@/lib/services/projects";
import { PageHeader, Panel } from "@/components/ui/panel";
import { FilterBar, FilterSelect } from "@/components/ui/filters";
import { Pagination, Table, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/states";
import { InlineAction } from "@/components/ui/form";
import { StatusBadge } from "@/components/app/bits";
import { Tabs } from "@/components/app/tabs";
import { NewVisitButton, RescheduleVisitButton } from "@/components/app/schedule-controls";
import { VisitOutcomeButton } from "../leads/[id]/panels";
import { confirmVisitAction } from "../leads/actions";
import { formatDateTime, relativeTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Site Visits" };
const VIEWS: VisitView[] = ["upcoming", "today", "past"];

export default async function SiteVisitsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const raw = param(sp, "view");
  const view: VisitView = VIEWS.includes(raw as VisitView) ? (raw as VisitView) : "upcoming";
  const lp = listParams(sp, ["at"], "at");
  const project = param(sp, "project");
  const { session, data } = await loadPage(async (tx, ctx) => {
    const [list, leadsOpts, projects, members] = await Promise.all([
      listVisits(tx, ctx, view, { project, limit: lp.limit, offset: lp.offset }),
      leadOptions(tx, ctx),
      projectOptions(tx),
      memberOptions(tx),
    ]);
    return { list, leadsOpts, projects, members };
  });
  const { list } = data;
  const projects = data.projects.map((p) => ({ value: p.id, label: p.name }));
  const canWrite = can(session.role, "leads:write");

  return (
    <>
      <PageHeader
        title="Site Visits"
        description="Schedule visits, confirm with customers, and capture feedback. Reminders go out 24 hours before."
        actions={canWrite && (
          <NewVisitButton
            leads={data.leadsOpts.map((l) => ({ value: l.id, label: `${l.name}${l.phone ? ` · ${l.phone}` : ""}` }))}
            projects={projects}
            members={data.members.map((m) => ({ value: m.id, label: m.name }))}
            canAssign={can(session.role, "leads:assign")}
          />
        )}
      />
      <Panel>
        <Tabs
          active={view}
          tabs={[
            { key: "upcoming", label: "Upcoming", href: hrefWith("/site-visits", sp, { view: "upcoming", page: undefined }) },
            { key: "today", label: "Today", href: hrefWith("/site-visits", sp, { view: "today", page: undefined }) },
            { key: "past", label: "Completed & past", href: hrefWith("/site-visits", sp, { view: "past", page: undefined }) },
          ]}
        />
        {projects.length > 0 && <FilterBar><FilterSelect name="project" label="All projects" options={projects} /></FilterBar>}
        {list.total === 0 ? (
          <EmptyState icon={MapPin} title="No site visits here" description="Schedule a visit from a lead's page or with the button above." />
        ) : (
          <>
            <Table>
              <THead><TH>Customer</TH><TH>Project</TH><TH>When</TH><TH>Executive</TH><TH>Status</TH><TH>Feedback</TH><TH className="text-right">Actions</TH></THead>
              <tbody>
                {list.rows.map((v) => (
                  <TR key={v.id}>
                    <TD>
                      <Link href={`/leads/${v.leadId}`} className="font-medium hover:underline">{v.leadName}</Link>
                      {v.leadPhone && <div className="text-xs text-muted"><a href={`tel:${v.leadPhone}`} className="hover:underline">{v.leadPhone}</a></div>}
                    </TD>
                    <TD>{v.projectName}</TD>
                    <TD className="whitespace-nowrap">{formatDateTime(v.scheduledAt, session.timezone)}<div className="text-xs text-muted">{relativeTime(v.scheduledAt)}{v.rescheduleCount ? ` · rescheduled ${v.rescheduleCount}×` : ""}</div></TD>
                    <TD>{v.assigneeName ?? <span className="text-warning">Unassigned</span>}</TD>
                    <TD><StatusBadge status={v.status} />{v.interestLevel && <div className="text-xs text-muted">interest: {v.interestLevel}</div>}</TD>
                    <TD className="max-w-xs truncate text-ink-2">{v.feedback ?? "—"}</TD>
                    <TD className="text-right">
                      {canWrite && (v.status === "scheduled" || v.status === "confirmed") && (
                        <div className="flex justify-end gap-1">
                          {v.status === "scheduled" && <InlineAction action={confirmVisitAction} fields={{ id: v.id }}>Confirm</InlineAction>}
                          <VisitOutcomeButton id={v.id} />
                          <RescheduleVisitButton id={v.id} />
                        </div>
                      )}
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
            <Pagination pathname="/site-visits" sp={sp} page={lp.page} total={list.total} />
          </>
        )}
      </Panel>
    </>
  );
}
