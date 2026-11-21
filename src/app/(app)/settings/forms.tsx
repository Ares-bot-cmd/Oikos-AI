"use client";

import { useState } from "react";
import { Copy, KeyRound, Plus, UserPlus } from "lucide-react";
import type { ActionState } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ActionForm, FormField, SubmitButton } from "@/components/ui/form";
import { Checkbox, Field, Select } from "@/components/ui/field";
import { Notice } from "@/components/ui/states";
import { toast } from "@/components/ui/toast";
import {
  addCustomFieldAction, changePasswordAction, changeRoleAction, createApiKeyAction, createFormAction, inviteAction, saveIntegrationAction, updateOrgAction,
} from "./actions";

type Opt = { value: string; label: string };

export function CopyField({ value, label }: { value: string; label?: string }) {
  return (
    <div>
      {label && <div className="mb-1 text-[12px] font-medium text-ink-2">{label}</div>}
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md border border-line bg-ivory px-2.5 py-1.5 text-[12.5px]">{value}</code>
        <Button size="sm" variant="secondary" onClick={() => navigator.clipboard.writeText(value).then(() => toast("Copied to clipboard"))} aria-label={`Copy ${label ?? "value"}`}>
          <Copy className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

export function OrgForm({ org }: { org: { name: string; currency: string; timezone: string; neglectDays: number; aiAgentEnabled: boolean } }) {
  return (
    <ActionForm action={updateOrgAction} resetOnSuccess={false} className="grid max-w-2xl gap-4 sm:grid-cols-2">
      <FormField label="Organization name" name="name" required defaultValue={org.name} className="sm:col-span-2" />
      <FormField label="Currency" name="currency" as="select" required defaultValue={org.currency} options={["INR", "USD", "AED", "GBP", "EUR", "SGD"].map((c) => ({ value: c, label: c }))} />
      <FormField label="Time zone" name="timezone" required defaultValue={org.timezone} hint="IANA name, e.g. Asia/Kolkata" />
      <FormField label="Alert when a lead isn't contacted for (days)" name="neglectDays" type="number" required defaultValue={org.neglectDays} inputProps={{ min: 1, max: 60 }} />
      <div className="flex items-end pb-2"><Checkbox name="aiAgentEnabled" label="AI agent replies to inbound WhatsApp messages" defaultChecked={org.aiAgentEnabled} /></div>
      <div className="sm:col-span-2"><SubmitButton>Save settings</SubmitButton></div>
    </ActionForm>
  );
}

export function AddCustomFieldButton() {
  const [type, setType] = useState("text");
  return (
    <Dialog title="Add custom lead field" trigger={(open) => <Button size="sm" variant="secondary" onClick={open}><Plus className="size-3.5" /> Field</Button>}>
      <ActionForm action={addCustomFieldAction} className="space-y-3">
        <FormField label="Label" name="label" required placeholder="e.g. Loan pre-approved" />
        <Field label="Type" name="fieldType">
          <Select name="fieldType" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="text">Text</option><option value="number">Number</option><option value="date">Date</option><option value="select">Dropdown</option>
          </Select>
        </Field>
        {type === "select" && <FormField label="Options (comma separated)" name="options" required placeholder="Yes, No, In progress" />}
        <div className="flex justify-end"><SubmitButton>Add field</SubmitButton></div>
      </ActionForm>
    </Dialog>
  );
}

export function InviteButton({ roles }: { roles: Opt[] }) {
  const [link, setLink] = useState<string | null>(null);
  return (
    <Dialog title="Invite a team member" description="We'll generate a one-time invitation link valid for 7 days." trigger={(open) => <Button onClick={() => { setLink(null); open(); }}><UserPlus className="size-4" /> Invite</Button>}>
      {link ? (
        <div className="space-y-3">
          <Notice tone="positive">Invitation created. Send this link to your colleague — it works once and expires in 7 days.</Notice>
          <CopyField value={link} label="Invitation link" />
        </div>
      ) : (
        <ActionForm action={inviteAction} keepOpen resetOnSuccess={false} onSuccess={(s: ActionState) => setLink((s?.data as { link: string }).link)} className="space-y-3">
          <FormField label="Email" name="email" type="email" required />
          <FormField label="Name" name="name" />
          <FormField label="Role" name="role" as="select" required defaultValue="sales_executive" options={roles} />
          <div className="flex justify-end"><SubmitButton>Create invitation</SubmitButton></div>
        </ActionForm>
      )}
    </Dialog>
  );
}

export function RoleSelect({ membershipId, role, roles, disabled }: { membershipId: string; role: string; roles: Opt[]; disabled?: boolean }) {
  return (
    <ActionForm action={changeRoleAction} resetOnSuccess={false} className="flex items-center gap-1.5">
      <input type="hidden" name="membershipId" value={membershipId} />
      <Select name="role" defaultValue={role} aria-label="Role" className="h-8 w-44 text-[13px]" disabled={disabled} onChange={(e) => e.currentTarget.form?.requestSubmit()}>
        {roles.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
      </Select>
    </ActionForm>
  );
}

export function IntegrationForm({ provider, fields, secretFields, configured, projects, defaultProject }: {
  provider: "whatsapp" | "meta_leads" | "google_leads";
  fields: { name: string; label: string; value?: string; hint?: string; required?: boolean }[];
  secretFields: { name: string; label: string; set: boolean; hint?: string }[];
  configured: boolean;
  projects?: Opt[];
  defaultProject?: string;
}) {
  return (
    <ActionForm action={saveIntegrationAction} resetOnSuccess={false} className="space-y-3">
      <input type="hidden" name="provider" value={provider} />
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((f) => <FormField key={f.name} label={f.label} name={f.name} defaultValue={f.value} hint={f.hint} required={f.required} />)}
        {secretFields.map((f) => (
          <FormField
            key={f.name}
            label={f.label}
            name={f.name}
            type="password"
            required={!f.set}
            placeholder={f.set ? "•••••••• (saved — leave blank to keep)" : ""}
            hint={f.hint ?? "Stored encrypted; never shown again"}
            inputProps={{ autoComplete: "off" }}
          />
        ))}
        {projects && <FormField label="Default project for these leads" name="defaultProjectId" as="select" options={projects} defaultValue={defaultProject} />}
      </div>
      <SubmitButton>{configured ? "Update" : "Connect"}</SubmitButton>
    </ActionForm>
  );
}

export function CreateApiKeyButton() {
  const [key, setKey] = useState<string | null>(null);
  return (
    <Dialog title="Create API key" trigger={(open) => <Button size="sm" variant="secondary" onClick={() => { setKey(null); open(); }}><KeyRound className="size-3.5" /> New key</Button>}>
      {key ? (
        <div className="space-y-3">
          <Notice tone="warning">Copy this key now. For security it is stored only as a hash and can&apos;t be shown again.</Notice>
          <CopyField value={key} label="API key" />
        </div>
      ) : (
        <ActionForm action={createApiKeyAction} keepOpen resetOnSuccess={false} onSuccess={(s: ActionState) => setKey((s?.data as { key: string }).key)} className="space-y-3">
          <FormField label="Name" name="name" required placeholder="e.g. Website contact form" />
          <div className="flex justify-end"><SubmitButton>Create key</SubmitButton></div>
        </ActionForm>
      )}
    </Dialog>
  );
}

export function CreateFormButton({ projects, campaigns }: { projects: Opt[]; campaigns: Opt[] }) {
  const [link, setLink] = useState<string | null>(null);
  return (
    <Dialog title="Create hosted lead form" trigger={(open) => <Button size="sm" variant="secondary" onClick={() => { setLink(null); open(); }}><Plus className="size-3.5" /> New form</Button>}>
      {link ? (
        <div className="space-y-3"><Notice tone="positive">Your form is live. Share the link or embed it on your website.</Notice><CopyField value={link} label="Form link" /></div>
      ) : (
        <ActionForm action={createFormAction} keepOpen resetOnSuccess={false} onSuccess={(s: ActionState) => setLink((s?.data as { link: string }).link)} className="space-y-3">
          <FormField label="Title" name="title" required placeholder="Book a site visit at Skyline Residences" />
          <FormField label="Intro text" name="intro" as="textarea" />
          <FormField label="Project" name="projectId" as="select" options={projects} />
          <FormField label="Campaign (for attribution)" name="campaignId" as="select" options={campaigns} />
          <div className="flex justify-end"><SubmitButton>Create form</SubmitButton></div>
        </ActionForm>
      )}
    </Dialog>
  );
}

export function PasswordForm() {
  return (
    <ActionForm action={changePasswordAction} className="max-w-sm space-y-3">
      <FormField label="Current password" name="current" type="password" required inputProps={{ autoComplete: "current-password" }} />
      <FormField label="New password" name="next" type="password" required hint="At least 10 characters, with a letter and a number." inputProps={{ autoComplete: "new-password" }} />
      <FormField label="Confirm new password" name="confirm" type="password" required inputProps={{ autoComplete: "new-password" }} />
      <SubmitButton>Change password</SubmitButton>
    </ActionForm>
  );
}
