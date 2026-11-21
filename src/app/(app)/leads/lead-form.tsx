"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { useSubmit } from "@/lib/use-submit";
import type { ActionState } from "@/lib/actions";
import { Checkbox, Field, Input, Select } from "@/components/ui/field";
import { FormField, SubmitButton } from "@/components/ui/form";
import { Notice } from "@/components/ui/states";
import { toast } from "@/components/ui/toast";
import { useDialog } from "@/components/ui/dialog";
import { createLeadAction, updateLeadAction } from "./actions";

type Opt = { value: string; label: string };
export type LeadFormOptions = {
  projects: Opt[];
  campaigns: Opt[];
  members: Opt[];
  sources: Opt[];
  timelines: Opt[];
  customFields: { key: string; label: string; fieldType: string; options: string[] | null }[];
  canAssign: boolean;
};

export type LeadDefaults = Partial<Record<string, string | number | null>> & { customFields?: Record<string, string> };

export function LeadForm({ options, defaults, leadId }: { options: LeadFormOptions; defaults?: LeadDefaults; leadId?: string }) {
  const [state, action] = useActionState<ActionState, FormData>(leadId ? updateLeadAction : createLeadAction, null);
  const { onSubmit } = useSubmit(action);
  const dialog = useDialog();
  const last = useRef<ActionState>(null);
  const [allowDup, setAllowDup] = useState(false);
  const dups = (state?.data as { duplicates?: { id: string; name: string }[] } | undefined)?.duplicates;
  const errors = state?.fieldErrors ?? {};
  const v = (k: string) => (defaults?.[k] == null ? undefined : String(defaults[k]));

  useEffect(() => {
    if (!state || state === last.current) return;
    last.current = state;
    if (state.ok) {
      if (state.message) toast(state.message);
      dialog?.close();
    }
  }, [state, dialog]);

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {leadId && <input type="hidden" name="id" value={leadId} />}
      {state?.error && !dups && <Notice tone="danger">{state.error}</Notice>}
      {dups && (
        <Notice tone="warning">
          <div className="font-medium">Possible duplicate</div>
          <div className="mt-1">
            A lead with this phone or email already exists:{" "}
            {dups.map((d, i) => (
              <span key={d.id}>
                {i > 0 && ", "}
                <Link href={`/leads/${d.id}`} className="font-medium underline">{d.name}</Link>
              </span>
            ))}
            .
          </div>
          <Checkbox className="mt-2" label="Create a separate lead anyway" name="allowDuplicate" checked={allowDup} onChange={(e) => setAllowDup(e.target.checked)} />
        </Notice>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <F label="Full name" name="name" required defaultValue={v("name")} error={errors.name} className="sm:col-span-2" />
        <F label="Phone" name="phone" type="tel" defaultValue={v("phone")} error={errors.phone} placeholder="+91 98765 43210" />
        <F label="Email" name="email" type="email" defaultValue={v("email")} error={errors.email} />
        <F label="Budget from (₹)" name="budgetMin" type="number" defaultValue={v("budgetMin")} error={errors.budgetMin} inputProps={{ min: 0, step: 1000 }} />
        <F label="Budget up to (₹)" name="budgetMax" type="number" defaultValue={v("budgetMax")} error={errors.budgetMax} inputProps={{ min: 0, step: 1000 }} />
        <S label="Preferred project" name="projectId" options={options.projects} defaultValue={v("projectId")} />
        <F label="Preferred location" name="preferredLocation" defaultValue={v("preferredLocation")} />
        <F label="Property type" name="propertyType" defaultValue={v("propertyType")} placeholder="Apartment, Villa…" />
        <F label="Configuration" name="configuration" defaultValue={v("configuration")} placeholder="2BHK, 3BHK…" />
        <S label="Buying timeline" name="timeline" options={options.timelines} defaultValue={v("timeline") ?? "unknown"} required />
        <S label="Priority" name="priority" required defaultValue={v("priority") ?? "medium"} options={["low", "medium", "high", "urgent"].map((p) => ({ value: p, label: p[0].toUpperCase() + p.slice(1) }))} />
        <S label="Source" name="source" options={options.sources} defaultValue={v("source") ?? "manual"} required />
        <S label="Campaign" name="campaignId" options={options.campaigns} defaultValue={v("campaignId")} />
        {options.canAssign && <S label="Lead owner" name="ownerId" options={options.members} defaultValue={v("ownerId")} />}
        <F label="Tags" name="tags" defaultValue={v("tags")} hint="Comma separated, e.g. nri, investor" />
        {options.customFields.map((cf) =>
          cf.fieldType === "select" ? (
            <S key={cf.key} label={cf.label} name={`cf_${cf.key}`} options={(cf.options ?? []).map((o) => ({ value: o, label: o }))} defaultValue={defaults?.customFields?.[cf.key]} />
          ) : (
            <F key={cf.key} label={cf.label} name={`cf_${cf.key}`} type={cf.fieldType === "number" ? "number" : cf.fieldType === "date" ? "date" : "text"} defaultValue={defaults?.customFields?.[cf.key]} />
          ),
        )}
        <FormField label="Notes" name="notes" as="textarea" defaultValue={v("notes")} className="sm:col-span-2" />
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <SubmitButton pendingText="Saving…">{leadId ? "Save changes" : "Create lead"}</SubmitButton>
      </div>
    </form>
  );
}

// Plain field helpers (this form manages its own action state).
function F({ label, name, error, hint, className, required, inputProps, ...rest }: { label: string; name: string; error?: string; hint?: string; className?: string; required?: boolean; type?: string; defaultValue?: string; placeholder?: string; inputProps?: Record<string, unknown> }) {
  return (
    <Field label={label} name={name} error={error} hint={hint} className={className} required={required}>
      <Input id={name} name={name} required={required} aria-invalid={error ? true : undefined} {...rest} {...inputProps} />
    </Field>
  );
}

function S({ label, name, options, defaultValue, required }: { label: string; name: string; options: Opt[]; defaultValue?: string; required?: boolean }) {
  return (
    <Field label={label} name={name} required={required}>
      <Select id={name} name={name} defaultValue={defaultValue ?? ""} required={required}>
        {!required && <option value="">—</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </Select>
    </Field>
  );
}
