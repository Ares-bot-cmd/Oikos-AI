"use client";

import { CalendarClock, MapPin, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ActionForm, FormField, SubmitButton } from "@/components/ui/form";
import { IsoDateTime } from "@/app/(app)/leads/[id]/panels";
import { rescheduleFollowUpAction, rescheduleVisitAction, scheduleFollowUpAction, scheduleVisitAction } from "@/app/(app)/leads/actions";

type Opt = { value: string; label: string };

export function RescheduleFollowUpButton({ id }: { id: string }) {
  return (
    <Dialog title="Reschedule follow-up" trigger={(open) => <Button size="sm" variant="ghost" onClick={open}><CalendarClock className="size-3.5" /> Reschedule</Button>}>
      <ActionForm action={rescheduleFollowUpAction} className="space-y-3">
        <input type="hidden" name="id" value={id} />
        <IsoDateTime name="dueAt" label="New date & time" defaultHours={24} />
        <div className="flex justify-end"><SubmitButton>Reschedule</SubmitButton></div>
      </ActionForm>
    </Dialog>
  );
}

export function RescheduleVisitButton({ id }: { id: string }) {
  return (
    <Dialog title="Reschedule site visit" trigger={(open) => <Button size="sm" variant="ghost" onClick={open}><CalendarClock className="size-3.5" /> Reschedule</Button>}>
      <ActionForm action={rescheduleVisitAction} className="space-y-3">
        <input type="hidden" name="id" value={id} />
        <IsoDateTime name="scheduledAt" label="New date & time" defaultHours={48} />
        <div className="flex justify-end"><SubmitButton>Reschedule</SubmitButton></div>
      </ActionForm>
    </Dialog>
  );
}

export function NewFollowUpButton({ leads, members, canAssign }: { leads: Opt[]; members: Opt[]; canAssign: boolean }) {
  return (
    <Dialog title="Schedule follow-up" trigger={(open) => <Button onClick={open} disabled={!leads.length}><Plus className="size-4" /> Follow-up</Button>}>
      <ActionForm action={scheduleFollowUpAction} className="space-y-3">
        <FormField label="Lead" name="leadId" as="select" required options={leads} />
        <IsoDateTime name="dueAt" label="When" defaultHours={24} />
        <FormField label="Type" name="type" as="select" required defaultValue="call" options={[{ value: "call", label: "Call" }, { value: "whatsapp", label: "WhatsApp" }, { value: "email", label: "Email" }, { value: "meeting", label: "Meeting" }]} />
        {canAssign && <FormField label="Assign to" name="assignedToId" as="select" options={members} hint="Defaults to the lead owner" />}
        <FormField label="Note" name="note" as="textarea" />
        <div className="flex justify-end"><SubmitButton>Schedule</SubmitButton></div>
      </ActionForm>
    </Dialog>
  );
}

export function NewVisitButton({ leads, projects, members, canAssign }: { leads: Opt[]; projects: Opt[]; members: Opt[]; canAssign: boolean }) {
  return (
    <Dialog title="Schedule site visit" trigger={(open) => <Button onClick={open} disabled={!leads.length || !projects.length} title={!projects.length ? "Add a project first" : undefined}><MapPin className="size-4" /> Schedule visit</Button>}>
      <ActionForm action={scheduleVisitAction} className="space-y-3">
        <FormField label="Lead" name="leadId" as="select" required options={leads} />
        <FormField label="Project" name="projectId" as="select" required options={projects} />
        <IsoDateTime name="scheduledAt" label="Date & time" defaultHours={48} />
        {canAssign && <FormField label="Sales executive" name="assignedToId" as="select" options={members} hint="Defaults to the lead owner" />}
        <FormField label="Notes" name="note" as="textarea" />
        <div className="flex justify-end"><SubmitButton>Schedule visit</SubmitButton></div>
      </ActionForm>
    </Dialog>
  );
}
