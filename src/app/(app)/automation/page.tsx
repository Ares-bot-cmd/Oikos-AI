import type { Metadata } from "next";
import { Workflow } from "lucide-react";
import { loadPage } from "@/lib/server-action";
import { can } from "@/lib/auth/permissions";
import { ACTION_LABELS, ACTIONS, listRules, ruleUserNames, TRIGGER_LABELS, TRIGGERS } from "@/lib/services/automation";
import { memberOptions, SOURCE_LABELS, SOURCES, STAGE_LABELS, STAGES } from "@/lib/services/leads";
import { projectOptions } from "@/lib/services/projects";
import { templates } from "@/lib/services/whatsapp";
import { PageHeader, Panel, PanelHeader } from "@/components/ui/panel";
import { EmptyState } from "@/components/ui/states";
import { Badge } from "@/components/ui/badge";
import { InlineAction } from "@/components/ui/form";
import { NoAccess } from "@/components/app/bits";
import { relativeTime } from "@/lib/utils";
import { deleteRuleAction, toggleRuleAction } from "./actions";
import { NewRuleButton } from "./rule-form";

export const metadata: Metadata = { title: "Workflow Automation" };

const BUILT_IN = [
  ["Missed follow-ups", "The assignee is notified as soon as a follow-up passes its due time."],
  ["Upcoming site visits", "The assigned executive is reminded 24 hours before each visit."],
  ["Payment reminders", "Sales and managers are alerted 7 days before a milestone is due and when it becomes overdue."],
  ["Neglected leads", "Owners are alerted when an open lead hasn't been contacted for your neglect threshold (Settings → Organization)."],
  ["New qualified leads", "Managers and the owner are notified when a lead is qualified."],
  ["Reservation expiry", "Units on hold are released automatically when the hold expires."],
];

export default async function AutomationPage() {
  const { session, data } = await loadPage(async (tx, ctx) => {
    if (!can(ctx.role, "automation:manage")) return null;
    const [rules, members, projects, tpls] = await Promise.all([listRules(tx), memberOptions(tx), projectOptions(tx), templates(tx)]);
    const ids = rules.flatMap((r) => [r.actionConfig.userId, ...(r.actionConfig.userIds ?? "").split(",")]).filter(Boolean) as string[];
    return { rules, members, projects, tpls, names: await ruleUserNames(tx, ids) };
  });
  if (!data) return <NoAccess what="workflow automation" />;
  const projectName = new Map(data.projects.map((p) => [p.id, p.name]));

  return (
    <>
      <PageHeader
        title="Workflow Automation"
        description="Rules that assign leads, notify your team, create follow-ups and send WhatsApp templates automatically."
        actions={
          <NewRuleButton
            triggers={TRIGGERS.map((t) => ({ value: t, label: TRIGGER_LABELS[t] }))}
            actions={ACTIONS.map((a) => ({ value: a, label: ACTION_LABELS[a] }))}
            members={data.members.map((m) => ({ value: m.id, label: m.name }))}
            projects={data.projects.map((p) => ({ value: p.id, label: p.name }))}
            sources={SOURCES.map((s) => ({ value: s, label: SOURCE_LABELS[s] }))}
            stages={STAGES.map((s) => ({ value: s, label: STAGE_LABELS[s] }))}
            templates={data.tpls.map((t) => ({ value: t.name, label: `${t.name} (${t.language})` }))}
          />
        }
      />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panel className="self-start">
          <PanelHeader title="Your rules" description="Rules run in the order they were created" />
          {data.rules.length === 0 ? (
            <EmptyState icon={Workflow} title="No rules yet" description="Start with round-robin assignment for new leads, or a WhatsApp reminder before site visits." />
          ) : (
            <ul className="divide-y divide-line">
              {data.rules.map((r) => {
                const c = r.conditions;
                const cfg = r.actionConfig;
                const who = cfg.userId ? data.names[cfg.userId] : cfg.userIds ? cfg.userIds.split(",").map((id) => data.names[id]).filter(Boolean).join(", ") : null;
                return (
                  <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2"><span className="text-[14px] font-medium">{r.name}</span>{r.isActive ? <Badge tone="positive">Active</Badge> : <Badge>Paused</Badge>}</div>
                      <p className="mt-0.5 text-[13px] text-ink-2">
                        <span className="text-muted">When</span> {TRIGGER_LABELS[r.trigger].toLowerCase()}
                        {c.source && <> <span className="text-muted">from</span> {SOURCE_LABELS[c.source as keyof typeof SOURCE_LABELS]}</>}
                        {c.projectId && <> <span className="text-muted">for</span> {projectName.get(c.projectId) ?? "a deleted project"}</>}
                        {c.stage && <> <span className="text-muted">to</span> {STAGE_LABELS[c.stage as keyof typeof STAGE_LABELS]}</>}
                        <span className="text-muted"> → </span>{ACTION_LABELS[r.action].toLowerCase()}
                        {who && ` (${who})`}{cfg.template && ` "${cfg.template}"`}{cfg.hours && ` in ${cfg.hours}h`}
                      </p>
                      <p className="mt-0.5 text-xs text-muted">Ran {r.runCount} time{r.runCount === 1 ? "" : "s"}{r.lastRunAt ? ` · last ${relativeTime(r.lastRunAt)}` : ""}</p>
                    </div>
                    <div className="flex gap-1">
                      <InlineAction action={toggleRuleAction} fields={{ id: r.id, active: String(!r.isActive) }} variant="secondary">{r.isActive ? "Pause" : "Enable"}</InlineAction>
                      <InlineAction action={deleteRuleAction} fields={{ id: r.id }} variant="ghost" confirm={`Delete rule "${r.name}"?`}>Delete</InlineAction>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
        <Panel className="self-start">
          <PanelHeader title="Always on" description={`Built-in alerts for ${session.orgName}`} />
          <ul className="divide-y divide-line">
            {BUILT_IN.map(([t, d]) => <li key={t} className="px-4 py-2.5"><div className="text-[13.5px] font-medium">{t}</div><p className="text-[12.5px] text-muted">{d}</p></li>)}
          </ul>
          <p className="border-t border-line px-4 py-3 text-xs text-muted">Time-based checks run when your team uses the app (at most every 10 minutes) and on a daily schedule.</p>
        </Panel>
      </div>
    </>
  );
}
