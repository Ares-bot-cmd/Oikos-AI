"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useSubmit } from "@/lib/use-submit";
import type { ActionState } from "@/lib/actions";
import type { ImportResult } from "@/lib/services/imports";
import { Field, Select } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/form";
import { Notice } from "@/components/ui/states";
import { importLeadsAction } from "../actions";

export function ImportForm({ members, canAssign }: { members: { value: string; label: string }[]; canAssign: boolean }) {
  const [state, action] = useActionState<ActionState, FormData>(importLeadsAction, null);
  const { onSubmit } = useSubmit(action);
  const result = state?.data as ImportResult | undefined;
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {state?.error && <Notice tone="danger">{state.error}</Notice>}
      {result && (
        <Notice tone={result.errors.length ? "warning" : "positive"}>
          <div className="font-medium">Import complete</div>
          <div className="tnum mt-1">{result.created} created · {result.updated} updated · {result.skipped} skipped (duplicates or empty) · {result.errors.length} with errors</div>
          {result.errors.length > 0 && (
            <ul className="mt-2 max-h-40 list-disc overflow-y-auto pl-5 text-[12.5px]">
              {result.errors.map((e) => <li key={e.row}>Row {e.row}: {e.message}</li>)}
            </ul>
          )}
          <Link href="/leads?sort=created&dir=desc" className="mt-2 inline-block font-medium underline">View leads</Link>
        </Notice>
      )}
      <Field label="File (.csv or .xlsx)" name="file" required>
        <input id="file" name="file" type="file" required accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-line-strong file:bg-surface file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-ivory" />
      </Field>
      <Field label="When a lead already exists (same phone or email)" name="duplicateMode">
        <Select id="duplicateMode" name="duplicateMode" defaultValue="skip">
          <option value="skip">Skip the row</option>
          <option value="update">Update the existing lead with new details</option>
        </Select>
      </Field>
      {canAssign && (
        <Field label="Assign new leads to" name="ownerId">
          <Select id="ownerId" name="ownerId" defaultValue="">
            <option value="">Leave unassigned / use automation rules</option>
            {members.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </Select>
        </Field>
      )}
      <SubmitButton pendingText="Importing…">Import leads</SubmitButton>
    </form>
  );
}
