import type { Metadata } from "next";
import Link from "next/link";
import { PhoneCall } from "lucide-react";
import { loadPage } from "@/lib/server-action";
import { can } from "@/lib/auth/permissions";
import { hrefWith, listParams, param, type SearchParams } from "@/lib/list-params";
import { followUpCounts, listFollowUps, type FollowUpView } from "@/lib/services/followups";
import { leadOptions, memberOptions } from "@/lib/services/leads";
import { PageHeader, Panel } from "@/components/ui/panel";
import { FilterBar, FilterSelect } from "@/components/ui/filters";
import { Pagination, Table, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/states";
import { InlineAction } from "@/components/ui/form";
import { IntentBadge, StageBadge, StatusBadge } from "@/components/app/bits";
import { Tabs } from "@/components/app/tabs";
import { NewFollowUpButton, RescheduleFollowUpButton } from "@/components/app/schedule-controls";
import { CompleteFollowUpButton } from "../leads/[id]/panels";
import { cancelFollowUpAction } from "../leads/actions";
import { cn, formatDateTime, relativeTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Follow-ups" };
const VIEWS: FollowUpView[] = ["overdue", "today", "upcoming", "done"];

export default async function FollowUpsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const raw = param(sp, "view");
  const view: FollowUpView = VIEWS.includes(raw as FollowUpView) ? (raw as FollowUpView) : "today";
  const lp = listParams(sp, ["due"], "due");
  const assignee = param(sp, "assignee");
  const { session, data } = await loadPage(async (tx, ctx) => {
    const [list, counts, leadsOpts, members] = await Promise.all([
      listFollowUps(tx, ctx, view, { assignee, limit: lp.limit, offset: lp.offset }),
      followUpCounts(tx, ctx),
      leadOptions(tx, ctx),
      memberOptions(tx),
    ]);
    return { list, counts, leadsOpts, members };
  });
  const { list, counts } = data;
  const members = data.members.map((m) => ({ value: m.id, label: m.name }));
  const canWrite = can(session.role, "leads:write");

  return (
    <>
      <PageHeader
        title="Follow-ups"
        description="Calls, messages and meetings your team has committed to. Missed follow-ups trigger reminders automatically."
        actions={canWrite && <NewFollowUpButton leads={data.leadsOpts.map((l) => ({ value: l.id, label: `${l.name}${l.phone ? ` · ${l.phone}` : ""}` }))} members={members} canAssign={can(session.role, "leads:assign")} />}
      />
      <Panel>
        <Tabs
          active={view}
          tabs={[
            { key: "overdue", label: "Overdue", count: counts.overdue, tone: "danger", href: hrefWith("/follow-ups", sp, { view: "overdue", page: undefined }) },
            { key: "today", label: "Due today", count: counts.today, href: hrefWith("/follow-ups", sp, { view: "today", page: undefined }) },
            { key: "upcoming", label: "Upcoming", count: counts.upcoming, href: hrefWith("/follow-ups", sp, { view: "upcoming", page: undefined }) },
            { key: "done", label: "Completed", href: hrefWith("/follow-ups", sp, { view: "done", page: undefined }) },
          ]}
        />
        {can(session.role, "leads:read_all") && (
          <FilterBar>
            <FilterSelect name="assignee" label="Everyone" options={[{ value: "me", label: "Assigned to me" }, ...members]} />
          </FilterBar>
        )}
        {list.total === 0 ? (
          <EmptyState icon={PhoneCall} title={view === "overdue" ? "Nothing overdue — nice work" : "No follow-ups here"} description="Schedule follow-ups from a lead's page or with the button above." />
        ) : (
          <>
            <Table>
              <THead><TH>Lead</TH><TH>Type</TH><TH>{view === "done" ? "Completed" : "Due"}</TH><TH>Assignee</TH><TH>Status</TH><TH className="text-right">Actions</TH></THead>
              <tbody>
                {list.rows.map((f) => {
                  const overdue = f.status === "pending" && f.dueAt < new Date();
                  return (
                    <TR key={f.id}>
                      <TD>
                        <Link href={`/leads/${f.leadId}`} className="font-medium hover:underline">{f.leadName}</Link>
                        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted"><StageBadge stage={f.leadStage} /><IntentBadge intent={f.leadIntent} />{f.leadPhone && <a href={`tel:${f.leadPhone}`} className="hover:underline">{f.leadPhone}</a>}</div>
                      </TD>
                      <TD className="capitalize">{f.type}{f.note && <div className="max-w-xs truncate text-xs normal-case text-muted">{f.note}</div>}</TD>
                      <TD className={cn("whitespace-nowrap", overdue && "font-medium text-danger")}>
                        {formatDateTime(view === "done" ? f.completedAt : f.dueAt, session.timezone)}
                        <div className="text-xs font-normal text-muted">{relativeTime(view === "done" ? f.completedAt : f.dueAt)}</div>
                      </TD>
                      <TD>{f.assigneeName ?? <span className="text-warning">Unassigned</span>}</TD>
                      <TD><StatusBadge status={overdue ? "overdue" : f.status} />{f.outcome && <div className="text-xs text-muted">{f.outcome.replace(/_/g, " ")}</div>}</TD>
                      <TD className="text-right">
                        {f.status === "pending" && canWrite && (
                          <div className="flex justify-end gap-1">
                            <CompleteFollowUpButton id={f.id} />
                            <RescheduleFollowUpButton id={f.id} />
                            <InlineAction action={cancelFollowUpAction} fields={{ id: f.id }} variant="ghost" confirm="Cancel this follow-up?">Cancel</InlineAction>
                          </div>
                        )}
                      </TD>
                    </TR>
                  );
                })}
              </tbody>
            </Table>
            <Pagination pathname="/follow-ups" sp={sp} page={lp.page} total={list.total} />
          </>
        )}
      </Panel>
    </>
  );
}
