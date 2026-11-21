"use client";

import { useState } from "react";
import { FileText, Plus, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ActionForm, FormField, SubmitButton } from "@/components/ui/form";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { createTemplateAction, sendTemplateAction, sendTextAction } from "./actions";

type Tpl = { id: string; name: string; language: string; body: string; variableCount: number };

export function Composer({ leadId, windowOpen, templates, connected }: { leadId: string; windowOpen: boolean; templates: Tpl[]; connected: boolean }) {
  return (
    <div className="border-t border-line p-3">
      {windowOpen ? (
        <ActionForm action={sendTextAction} className="flex items-end gap-2">
          <input type="hidden" name="leadId" value={leadId} />
          <Textarea name="body" required maxLength={4096} rows={2} aria-label="Message" placeholder={connected ? "Type a message…" : "Connect WhatsApp to send messages"} disabled={!connected} className="min-h-11 flex-1 resize-none" />
          <SubmitButton className="h-11"><Send className="size-4" /> Send</SubmitButton>
        </ActionForm>
      ) : (
        <p className="mb-2 text-[12.5px] text-muted">The 24-hour customer service window is closed. WhatsApp only allows approved templates until the customer replies.</p>
      )}
      <div className="mt-2 flex justify-end">
        <TemplateSender leadId={leadId} templates={templates} disabled={!connected} />
      </div>
    </div>
  );
}

function TemplateSender({ leadId, templates, disabled }: { leadId: string; templates: Tpl[]; disabled: boolean }) {
  const [id, setId] = useState(templates[0]?.id ?? "");
  const tpl = templates.find((t) => t.id === id);
  return (
    <Dialog title="Send template" description="Templates must be approved in your WhatsApp Business Manager." trigger={(open) => <Button size="sm" variant="secondary" onClick={open} disabled={disabled || !templates.length} title={!templates.length ? "Add a template first" : undefined}><FileText className="size-3.5" /> Send template</Button>}>
      <ActionForm action={sendTemplateAction} className="space-y-3">
        <input type="hidden" name="leadId" value={leadId} />
        <Field label="Template" name="templateId">
          <Select name="templateId" value={id} onChange={(e) => setId(e.target.value)}>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.language})</option>)}
          </Select>
        </Field>
        {tpl && <p className="whitespace-pre-wrap rounded-md bg-ivory p-3 text-[13px] text-ink-2">{tpl.body}</p>}
        {tpl && Array.from({ length: tpl.variableCount }).map((_, i) => (
          <Field key={`${tpl.id}-${i}`} label={`Value for {{${i + 1}}}`} name={`param-${i}`}>
            <Input name="param" maxLength={200} placeholder={i === 0 ? "Defaults to the customer's first name" : ""} />
          </Field>
        ))}
        <div className="flex justify-end"><SubmitButton>Send</SubmitButton></div>
      </ActionForm>
    </Dialog>
  );
}

export function NewTemplateButton() {
  return (
    <Dialog title="Add message template" description="Register a template that is already approved in WhatsApp Business Manager. Use {{1}}, {{2}}… for variables." trigger={(open) => <Button size="sm" variant="secondary" onClick={open}><Plus className="size-3.5" /> Template</Button>}>
      <ActionForm action={createTemplateAction} className="space-y-3">
        <FormField label="Template name (exact)" name="name" required placeholder="site_visit_reminder" />
        <FormField label="Language code" name="language" required defaultValue="en" />
        <FormField label="Purpose" name="purpose" as="select" required defaultValue="general" options={[
          { value: "general", label: "General" }, { value: "welcome", label: "Welcome / first response" }, { value: "follow_up", label: "Follow-up" },
          { value: "visit_confirmation", label: "Visit confirmation" }, { value: "visit_reminder", label: "Visit reminder" }, { value: "payment_reminder", label: "Payment reminder" },
        ]} />
        <FormField label="Body" name="body" as="textarea" required placeholder="Hi {{1}}, this is a reminder about your site visit…" />
        <div className="flex justify-end"><SubmitButton>Add template</SubmitButton></div>
      </ActionForm>
    </Dialog>
  );
}
