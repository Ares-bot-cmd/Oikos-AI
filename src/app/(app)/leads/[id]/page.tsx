import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, FileSignature, Lightbulb, MessageCircle } from "lucide-react";
import { loadPage } from "@/lib/server-action";
import { can } from "@/lib/auth/permissions";
import { getLead, leadTimeline, orgScoringStats, SOURCE_LABELS, STAGE_LABELS, STAGES, TIMELINE_LABELS } from "@/lib/services/leads";
import { leadFollowUps } from "@/lib/services/followups";
import { leadVisits } from "@/lib/services/visits";
import { availableUnitsFor } from "@/lib/services/projects";
import { customFields } from "@/lib/services/org";
import { CALIBRATION_MIN } from "@/lib/services/scoring";
import { leadFormOptions } from "../options";
import { DefinitionList, PageHeader, Panel, PanelHeader } from "@/components/ui/panel";
import { IntentBadge, StageBadge, StatusBadge } from "@/components/app/bits";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { InlineAction } from "@/components/ui/form";
import { cn, formatDateTime, formatMoney, formatPercent, relativeTime } from "@/lib/utils";
import { cancelFollowUpAction, confirmVisitAction } from "../actions";
import {
  CompleteFollowUpButton, DeleteLeadButton, EditLeadButton, LogActivityForm, ReserveUnitButton, ScheduleFollowUpButton, ScheduleVisitButton,
  StageControl, VisitOutcomeButton,
} from "./panels";

export const metadata: Metadata = { title: "Lead" };

const ACTIVITY_ICON: Record<string, string> = {
  call: "Call", whatsapp: "WhatsApp", email: "Email", meeting: "Meeting", note: "Note", stage_change: "Stage", assignment: "Assignment",
  follow_up: "Follow-up", site_visit: "Site visit", booking: "Booking", payment: "Payment", system: "System",
};

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { session, data } = await loadPage(async (tx, ctx) => {
    const lead = await getLead(tx, ctx, id);
    const [timeline, followUps, visits, options, units, cfs, stats] = await Promise.all([
      leadTimeline(tx, lead.id), leadFollowUps(tx, lead.id), leadVisits(tx, lead.id), leadFormOptions(tx, ctx),
      availableUnitsFor(tx, lead.projectId ?? undefined, lead.id), customFields(tx), orgScoringStats(tx),
    ]);
    return { lead, timeline, followUps, visits, options, units, cfs, stats };
  });
  const { lead, timeline, followUps, visits, options, units, cfs, stats } = data;
  const cur = session.currency;
  const tz = session.timezone;
  const closed = lead.stage === "booked" || lead.stage === "lost";
  const canWrite = can(session.role, "leads:write");

  return (
    <>
      <Link href="/leads" className="mb-3 inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink"><ArrowLeft className="size-3.5" /> Leads</Link>
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-2">{lead.name} <StageBadge stage={lead.stage} /> <IntentBadge intent={lead.intent} score={lead.score} /></span>}
        description={`${SOURCE_LABELS[lead.source]}${lead.campaignName ? ` · ${lead.campaignName}` : ""} · created ${relativeTime(lead.createdAt)} · owner: ${lead.ownerName ?? "unassigned"}`}
        actions={
          canWrite && (
            <>
              <EditLeadButton options={options} leadId={lead.id} defaults={{ ...lead, tags: lead.tags.join(", "), customFields: lead.customFields } as never} />
              {can(session.role, "bookings:write") && !closed && (
                <LinkButton href={`/bookings/new?lead=${lead.id}`} variant="primary"><FileSignature className="size-4" /> Record booking</LinkButton>
              )}
              {can(session.role, "leads:delete") && <DeleteLeadButton leadId={lead.id} name={lead.name} />}
            </>
          )
        }
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="space-y-4">
          <Panel>
            <PanelHeader title="AI lead intelligence" description={lead.scoredAt ? `Updated ${relativeTime(lead.scoredAt)}` : "Not scored yet"} />
            <div className="p-4">
              <div className="grid grid-cols-3 gap-3 text-center">
                <Metric label="Lead score" value={lead.score ?? "—"} />
                <Metric label="Conversion probability" value={formatPercent(lead.conversionProbability)} />
                <Metric label="Buying intent" value={lead.intent ? lead.intent[0].toUpperCase() + lead.intent.slice(1) : "—"} />
              </div>
              {lead.nextAction && (
                <div className="mt-4 flex gap-2 rounded-md border border-champagne/40 bg-champagne-soft px-3 py-2.5 text-[13.5px]">
                  <Lightbulb className="mt-0.5 size-4 shrink-0 text-[#7d6236]" />
                  <div><div className="text-xs font-medium uppercase tracking-wider text-[#7d6236]">Suggested next action</div>{lead.nextAction}</div>
                </div>
              )}
              <h3 className="mb-2 mt-4 text-[13px] font-semibold">Why this score</h3>
              <ul className="space-y-1.5">
                {(lead.scoreReasons ?? []).map((r) => (
                  <li key={r.label} className="flex items-start justify-between gap-3 text-[13px]">
                    <span className="text-ink-2">{r.label}</span>
                    <span className={cn("tnum shrink-0 font-medium", r.points > 0 ? "text-positive" : r.points < 0 ? "text-danger" : "text-muted")}>
                      {r.points > 0 ? `+${r.points}` : r.points === 0 ? "·" : r.points}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-muted">
                Score starts at 30 and adds or subtracts points for each fact above.{" "}
                {stats.closedCount >= CALIBRATION_MIN
                  ? `Probability is calibrated on your ${stats.closedCount} closed leads with similar scores.`
                  : `Probability uses a default curve until you have ${CALIBRATION_MIN} closed (booked or lost) leads — you have ${stats.closedCount}.`}
              </p>
            </div>
          </Panel>

          <Panel>
            <PanelHeader title="Details" />
            <div className="p-4">
              <DefinitionList
                items={[
                  { label: "Phone", value: lead.phone ? <a href={`tel:${lead.phone}`} className="text-emerald hover:underline">{lead.phone}</a> : null },
                  { label: "Email", value: lead.email ? <a href={`mailto:${lead.email}`} className="text-emerald hover:underline">{lead.email}</a> : null },
                  { label: "Budget", value: lead.budgetMin != null || lead.budgetMax != null ? `${formatMoney(lead.budgetMin, cur, true)} – ${formatMoney(lead.budgetMax, cur, true)}` : null },
                  { label: "Timeline", value: TIMELINE_LABELS[lead.timeline] },
                  { label: "Preferred project", value: lead.projectName },
                  { label: "Location", value: lead.preferredLocation },
                  { label: "Property type", value: lead.propertyType },
                  { label: "Configuration", value: lead.configuration },
                  { label: "Priority", value: lead.priority[0].toUpperCase() + lead.priority.slice(1) },
                  { label: "Last contacted", value: lead.lastContactedAt ? formatDateTime(lead.lastContactedAt, tz) : "Never" },
                  ...cfs.map((c) => ({ label: c.label, value: lead.customFields[c.key] ?? null })),
                  ...(lead.lostReason ? [{ label: "Lost reason", value: lead.lostReason }] : []),
                ]}
              />
              {lead.tags.length > 0 && <div className="mt-4 flex flex-wrap gap-1.5">{lead.tags.map((t) => <Link key={t} href={`/leads?tag=${encodeURIComponent(t)}`}><Badge tone="brand">#{t}</Badge></Link>)}</div>}
              {lead.notes && <p className="mt-4 whitespace-pre-wrap rounded-md bg-ivory px-3 py-2 text-[13px] text-ink-2">{lead.notes}</p>}
              {lead.duplicateOfId && <p className="mt-3 text-[13px] text-warning">Possible duplicate of <Link className="underline" href={`/leads/${lead.duplicateOfId}`}>another lead</Link>.</p>}
            </div>
          </Panel>
        </div>

        <div className="space-y-4">
          {canWrite && (
            <Panel>
              <PanelHeader
                title="Actions"
                actions={
                  <>
                    {!closed && <ScheduleFollowUpButton leadId={lead.id} members={options.members} canAssign={options.canAssign} />}
                    {!closed && <ScheduleVisitButton leadId={lead.id} projects={options.projects} members={options.members} canAssign={options.canAssign} defaultProject={lead.projectId} />}
                    {!closed && can(session.role, "bookings:write") && <ReserveUnitButton leadId={lead.id} units={units.filter((u) => u.status === "available").map((u) => ({ value: u.id, label: `${u.label} · ${formatMoney(u.price, cur, true)}` }))} />}
                    {can(session.role, "whatsapp:send") && <LinkButton size="sm" href={`/whatsapp?lead=${lead.id}`}><MessageCircle className="size-3.5" /> WhatsApp</LinkButton>}
                  </>
                }
              />
              <div className="space-y-4 p-4">
                <StageControl leadId={lead.id} stage={lead.stage} stages={STAGES.map((s) => ({ value: s, label: STAGE_LABELS[s] }))} />
                <LogActivityForm leadId={lead.id} />
              </div>
            </Panel>
          )}

          <Panel>
            <PanelHeader title="Follow-ups" />
            <ul className="divide-y divide-line">
              {followUps.map((f) => {
                const overdue = f.status === "pending" && f.dueAt < new Date();
                return (
                  <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-[13.5px]">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium capitalize">{f.type}</span>
                        <StatusBadge status={overdue ? "overdue" : f.status} />
                        {f.outcome && <span className="text-xs text-muted">{f.outcome.replace(/_/g, " ")}</span>}
                      </div>
                      <div className={cn("text-xs", overdue ? "text-danger" : "text-muted")}>{formatDateTime(f.dueAt, tz)} · {f.assigneeName ?? "Unassigned"}{f.note ? ` · ${f.note}` : ""}</div>
                    </div>
                    {f.status === "pending" && canWrite && (
                      <div className="flex gap-1.5">
                        <CompleteFollowUpButton id={f.id} />
                        <InlineAction action={cancelFollowUpAction} fields={{ id: f.id }} variant="ghost" confirm="Cancel this follow-up?">Cancel</InlineAction>
                      </div>
                    )}
                  </li>
                );
              })}
              {!followUps.length && <li className="px-4 py-6 text-center text-[13px] text-muted">No follow-ups scheduled.</li>}
            </ul>
          </Panel>

          <Panel>
            <PanelHeader title="Site visits" />
            <ul className="divide-y divide-line">
              {visits.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-[13.5px]">
                  <div>
                    <div className="flex items-center gap-2"><span className="font-medium">{v.projectName}</span><StatusBadge status={v.status} />{v.interestLevel && <span className="text-xs text-muted">interest: {v.interestLevel}</span>}</div>
                    <div className="text-xs text-muted">{formatDateTime(v.scheduledAt, tz)} · {v.assigneeName ?? "Unassigned"}{v.feedback ? ` · ${v.feedback}` : ""}</div>
                  </div>
                  {canWrite && (v.status === "scheduled" || v.status === "confirmed") && (
                    <div className="flex gap-1.5">
                      {v.status === "scheduled" && <InlineAction action={confirmVisitAction} fields={{ id: v.id }}>Confirm</InlineAction>}
                      <VisitOutcomeButton id={v.id} />
                    </div>
                  )}
                </li>
              ))}
              {!visits.length && <li className="px-4 py-6 text-center text-[13px] text-muted">No site visits yet.</li>}
            </ul>
          </Panel>

          <Panel>
            <PanelHeader title="Activity timeline" description="Complete interaction history" />
            <ol className="relative px-4 py-3">
              {timeline.map((a) => (
                <li key={a.id} className="relative border-l border-line pb-4 pl-4 last:pb-0">
                  <span className={cn("absolute -left-[5px] top-1.5 size-2.5 rounded-full border-2 border-surface", a.direction === "inbound" ? "bg-champagne" : a.type === "stage_change" ? "bg-forest" : "bg-emerald")} />
                  <div className="flex flex-wrap items-baseline gap-x-2 text-[12px] text-muted">
                    <span className="font-medium text-ink-2">{ACTIVITY_ICON[a.type] ?? a.type}{a.direction === "inbound" ? " · inbound" : ""}</span>
                    {a.outcome && <span>· {a.outcome}</span>}
                    <span>· {a.userName ?? "System"}</span>
                    <time dateTime={a.createdAt.toISOString()}>· {formatDateTime(a.createdAt, tz)}</time>
                  </div>
                  {a.body && <p className="mt-0.5 whitespace-pre-wrap text-[13.5px] text-ink">{a.body}</p>}
                </li>
              ))}
            </ol>
          </Panel>
        </div>
      </div>
    </>
  );
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md bg-ivory px-2 py-3">
      <div className="tnum font-display text-xl font-bold">{value}</div>
      <div className="mt-0.5 text-[11.5px] text-muted">{label}</div>
    </div>
  );
}
