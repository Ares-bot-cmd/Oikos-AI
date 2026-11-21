"use client";

import { useState } from "react";
import { localDateTimeInput, useClientValue } from "@/lib/use-client-value";
import { CalendarPlus, Check, MapPin, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ActionForm, FormField, SubmitButton } from "@/components/ui/form";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import {
  changeStageAction, completeFollowUpAction, deleteLeadAction, logActivityAction, reserveUnitAction, scheduleFollowUpAction,
  scheduleVisitAction, visitOutcomeAction,
} from "../actions";
import { LeadForm, type LeadDefaults, type LeadFormOptions } from "../lead-form";

type Opt = { value: string; label: string };

/** datetime-local has no zone; convert to an ISO instant in the browser before submitting. */
function IsoDateTime({ name, label, defaultHours = 24, required = true }: { name: string; label: string; defaultHours?: number; required?: boolean }) {
  // The default is computed in the browser so it reflects the user's local time zone.
  const initial = useClientValue(() => localDateTimeInput(defaultHours), "");
  const [edited, setLocal] = useState<string | null>(null);
  const local = edited ?? initial;
  return (
    <Field label={label} name={`${name}-local`} required={required}>
      <Input type="datetime-local" value={local} required={required} onChange={(e) => setLocal(e.target.value)} />
      <input type="hidden" name={name} value={local && !Number.isNaN(new Date(local).getTime()) ? new Date(local).toISOString() : ""} />
    </Field>
  );
}
export { IsoDateTime };

export function EditLeadButton({ options, defaults, leadId }: { options: LeadFormOptions; defaults: LeadDefaults; leadId: string }) {
  return (
    <Dialog wide title="Edit lead" trigger={(open) => <Button variant="secondary" onClick={open}><Pencil className="size-4" /> Edit</Button>}>
      <LeadForm options={options} defaults={defaults} leadId={leadId} />
    </Dialog>
  );
}

export function StageControl({ leadId, stage, stages }: { leadId: string; stage: string; stages: Opt[] }) {
  const [next, setNext] = useState(stage);
  return (
    <ActionForm action={changeStageAction} resetOnSuccess={false} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="id" value={leadId} />
      <Field label="Stage" name="stage">
        <Select name="stage" value={next} onChange={(e) => setNext(e.target.value)} className="w-52" disabled={stage === "booked"}>
          {stages.map((s) => <option key={s.value} value={s.value} disabled={s.value === "booked"}>{s.label}</option>)}
        </Select>
      </Field>
      {next === "lost" && (
        <Field label="Reason lost" name="lostReason" required>
          <Input name="lostReason" required maxLength={300} placeholder="e.g. Bought elsewhere" className="w-56" />
        </Field>
      )}
      {next !== stage && <SubmitButton size="md">Update stage</SubmitButton>}
    </ActionForm>
  );
}

export function LogActivityForm({ leadId }: { leadId: string }) {
  const [type, setType] = useState("call");
  return (
    <ActionForm action={logActivityAction} className="space-y-3">
      <input type="hidden" name="leadId" value={leadId} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Type" name="type">
          <Select name="type" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="call">Call</option><option value="whatsapp">WhatsApp</option><option value="email">Email</option>
            <option value="meeting">Meeting</option><option value="note">Internal note</option>
          </Select>
        </Field>
        {type !== "note" && (
          <>
            <Field label="Direction" name="direction">
              <Select name="direction" defaultValue="outbound"><option value="outbound">We reached out</option><option value="inbound">Customer reached us</option></Select>
            </Field>
            <Field label="Outcome" name="outcome">
              <Select name="outcome" defaultValue="">
                <option value="">—</option><option>Connected</option><option>No answer</option><option>Busy</option><option>Interested</option><option>Not interested</option><option>Call back later</option>
              </Select>
            </Field>
          </>
        )}
      </div>
      <Field label={type === "note" ? "Note (internal only)" : "Summary"} name="body" required>
        <Textarea name="body" required maxLength={4000} placeholder={type === "note" ? "Visible to your team only" : "What was discussed?"} />
      </Field>
      <div className="flex justify-end"><SubmitButton size="sm">Save activity</SubmitButton></div>
    </ActionForm>
  );
}

export function ScheduleFollowUpButton({ leadId, members, canAssign }: { leadId: string; members: Opt[]; canAssign: boolean }) {
  return (
    <Dialog title="Schedule follow-up" trigger={(open) => <Button size="sm" variant="secondary" onClick={open}><CalendarPlus className="size-3.5" /> Follow-up</Button>}>
      <ActionForm action={scheduleFollowUpAction} className="space-y-3">
        <input type="hidden" name="leadId" value={leadId} />
        <IsoDateTime name="dueAt" label="When" defaultHours={24} />
        <FormField label="Type" name="type" as="select" required defaultValue="call" options={[{ value: "call", label: "Call" }, { value: "whatsapp", label: "WhatsApp" }, { value: "email", label: "Email" }, { value: "meeting", label: "Meeting" }, { value: "other", label: "Other" }]} />
        {canAssign && <FormField label="Assign to" name="assignedToId" as="select" options={members} hint="Defaults to the lead owner" />}
        <FormField label="Note" name="note" as="textarea" />
        <div className="flex justify-end"><SubmitButton>Schedule</SubmitButton></div>
      </ActionForm>
    </Dialog>
  );
}

export function CompleteFollowUpButton({ id }: { id: string }) {
  const [again, setAgain] = useState(false);
  return (
    <Dialog title="Complete follow-up" trigger={(open) => <Button size="sm" variant="secondary" onClick={open}><Check className="size-3.5" /> Done</Button>}>
      <ActionForm action={completeFollowUpAction} className="space-y-3">
        <input type="hidden" name="id" value={id} />
        <FormField label="Outcome" name="outcome" as="select" required options={[
          { value: "connected", label: "Connected" }, { value: "interested", label: "Interested" }, { value: "call_back_later", label: "Call back later" },
          { value: "no_answer", label: "No answer" }, { value: "busy", label: "Busy" }, { value: "not_interested", label: "Not interested" }, { value: "wrong_number", label: "Wrong number" },
        ]} />
        <FormField label="Notes" name="note" as="textarea" />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-emerald" checked={again} onChange={(e) => setAgain(e.target.checked)} /> Schedule the next follow-up</label>
        {again && <IsoDateTime name="nextDueAt" label="Next follow-up" defaultHours={48} />}
        <div className="flex justify-end"><SubmitButton>Complete</SubmitButton></div>
      </ActionForm>
    </Dialog>
  );
}

export function ScheduleVisitButton({ leadId, projects, members, canAssign, defaultProject }: { leadId: string; projects: Opt[]; members: Opt[]; canAssign: boolean; defaultProject?: string | null }) {
  return (
    <Dialog title="Schedule site visit" trigger={(open) => <Button size="sm" variant="secondary" onClick={open} disabled={!projects.length} title={!projects.length ? "Add a project first" : undefined}><MapPin className="size-3.5" /> Site visit</Button>}>
      <ActionForm action={scheduleVisitAction} className="space-y-3">
        <input type="hidden" name="leadId" value={leadId} />
        <FormField label="Project" name="projectId" as="select" required options={projects} defaultValue={defaultProject ?? undefined} />
        <IsoDateTime name="scheduledAt" label="Date & time" defaultHours={48} />
        {canAssign && <FormField label="Sales executive" name="assignedToId" as="select" options={members} hint="Defaults to the lead owner" />}
        <FormField label="Notes for the visit" name="note" as="textarea" />
        <div className="flex justify-end"><SubmitButton>Schedule visit</SubmitButton></div>
      </ActionForm>
    </Dialog>
  );
}

export function VisitOutcomeButton({ id }: { id: string }) {
  const [status, setStatus] = useState("completed");
  return (
    <Dialog title="Record visit outcome" trigger={(open) => <Button size="sm" variant="secondary" onClick={open}>Record outcome</Button>}>
      <ActionForm action={visitOutcomeAction} className="space-y-3">
        <input type="hidden" name="id" value={id} />
        <Field label="Outcome" name="status">
          <Select name="status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="completed">Visit completed</option><option value="no_show">Customer didn&apos;t show up</option><option value="cancelled">Cancelled</option>
          </Select>
        </Field>
        {status === "completed" && <FormField label="Customer interest" name="interestLevel" as="select" required options={[{ value: "high", label: "High" }, { value: "medium", label: "Medium" }, { value: "low", label: "Low" }]} />}
        <FormField label="Feedback" name="feedback" as="textarea" placeholder="Units liked, objections, family decision makers…" />
        <FormField label="Create a follow-up in (days)" name="followUpInDays" type="number" defaultValue={1} inputProps={{ min: 0, max: 60 }} hint="Leave blank for no follow-up; 0 = later today" />
        <div className="flex justify-end"><SubmitButton>Save outcome</SubmitButton></div>
      </ActionForm>
    </Dialog>
  );
}

export function ReserveUnitButton({ leadId, units }: { leadId: string; units: Opt[] }) {
  return (
    <Dialog title="Reserve a unit" description="Holds the unit for this lead. Expired holds are released automatically." trigger={(open) => <Button size="sm" variant="secondary" onClick={open} disabled={!units.length}>Reserve unit</Button>}>
      <ActionForm action={reserveUnitAction} className="space-y-3">
        <input type="hidden" name="leadId" value={leadId} />
        <FormField label="Unit" name="unitId" as="select" required options={units} />
        <FormField label="Hold for" name="hours" as="select" required defaultValue="72" options={[{ value: "24", label: "24 hours" }, { value: "72", label: "3 days" }, { value: "168", label: "7 days" }, { value: "336", label: "14 days" }]} />
        <div className="flex justify-end"><SubmitButton>Reserve</SubmitButton></div>
      </ActionForm>
    </Dialog>
  );
}

export function DeleteLeadButton({ leadId, name }: { leadId: string; name: string }) {
  return (
    <Dialog title="Delete lead" trigger={(open) => <Button variant="danger" onClick={open}>Delete</Button>}>
      <ActionForm action={deleteLeadAction} className="space-y-4">
        <input type="hidden" name="id" value={leadId} />
        <p className="text-sm text-ink-2">Permanently delete <strong>{name}</strong> and their activity, follow-ups, visits and messages? Bookings are kept. This can&apos;t be undone.</p>
        <div className="flex justify-end"><SubmitButton variant="danger">Delete lead</SubmitButton></div>
      </ActionForm>
    </Dialog>
  );
}
