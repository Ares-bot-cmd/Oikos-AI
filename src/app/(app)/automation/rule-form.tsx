"use client";

import { useId, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ActionForm, FormField, SubmitButton } from "@/components/ui/form";
import { Field, Select } from "@/components/ui/field";
import { createRuleAction } from "./actions";

type Opt = { value: string; label: string };

export function NewRuleButton({ triggers, actions, members, projects, sources, stages, templates }: {
  triggers: Opt[]; actions: Opt[]; members: Opt[]; projects: Opt[]; sources: Opt[]; stages: Opt[]; templates: Opt[];
}) {
  const [trigger, setTrigger] = useState("lead_created");
  const [action, setAction] = useState("assign_round_robin");
  const assignment = action === "assign_round_robin" || action === "assign_user";
  const userIdsId = useId();
  return (
    <Dialog wide title="New automation rule" description="When the trigger happens and the conditions match, Oikos runs the action." trigger={(open) => <Button onClick={open}><Plus className="size-4" /> New rule</Button>}>
      <ActionForm action={createRuleAction} className="space-y-4">
        <FormField label="Rule name" name="name" required placeholder="e.g. Assign Meta leads round-robin" />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="When" name="trigger">
            <Select name="trigger" value={trigger} onChange={(e) => { setTrigger(e.target.value); if (e.target.value !== "lead_created" && assignment) setAction("notify_owner"); }}>
              {triggers.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </Select>
          </Field>
          <Field label="Then" name="action">
            <Select name="action" value={action} onChange={(e) => setAction(e.target.value)}>
              {actions.map((a) => <option key={a.value} value={a.value} disabled={trigger !== "lead_created" && (a.value === "assign_round_robin" || a.value === "assign_user")}>{a.label}</option>)}
            </Select>
          </Field>
        </div>
        <fieldset className="rounded-md border border-line p-3">
          <legend className="px-1 text-xs font-medium text-muted">Only if (optional)</legend>
          <div className="grid gap-3 sm:grid-cols-3">
            <FormField label="Lead source is" name="condSource" as="select" options={sources} />
            <FormField label="Project is" name="condProjectId" as="select" options={projects} />
            {trigger === "lead_stage_changed" && <FormField label="New stage is" name="condStage" as="select" options={stages} />}
          </div>
        </fieldset>
        {action === "assign_round_robin" && (
          <Field label="Rotate between" name="userIds" id={userIdsId} hint="Leave empty to rotate across all sales executives who receive leads">
            <select id={userIdsId} name="userIds" multiple className="h-28 w-full rounded-md border border-line-strong bg-surface px-2 py-1 text-sm">
              {members.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </Field>
        )}
        {action === "assign_user" && <FormField label="Assign to" name="userId" as="select" required options={members} />}
        {(action === "notify_owner" || action === "notify_managers") && <FormField label="Notification text" name="message" placeholder="Defaults to the rule name and lead" />}
        {action === "create_follow_up" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Due after (hours)" name="hours" type="number" defaultValue={1} inputProps={{ min: 0, max: 720 }} />
            <FormField label="Type" name="followUpType" as="select" required defaultValue="call" options={[{ value: "call", label: "Call" }, { value: "whatsapp", label: "WhatsApp" }, { value: "email", label: "Email" }, { value: "meeting", label: "Meeting" }]} />
          </div>
        )}
        {action === "send_whatsapp_template" && (
          <div className="grid gap-3 sm:grid-cols-2">
            {templates.length ? (
              <FormField label="Approved template" name="template" as="select" required options={templates} />
            ) : (
              <FormField label="Approved template name" name="template" required hint="Add templates on the WhatsApp page" />
            )}
            <FormField label="Language" name="language" defaultValue="en" />
          </div>
        )}
        <div className="flex justify-end"><SubmitButton>Create rule</SubmitButton></div>
      </ActionForm>
    </Dialog>
  );
}
