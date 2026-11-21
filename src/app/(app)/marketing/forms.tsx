"use client";

import { todayISO, useClientValue } from "@/lib/use-client-value";
import { IndianRupee, Pencil, Plus, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ActionForm, FormField, SubmitButton } from "@/components/ui/form";
import { Checkbox, Field } from "@/components/ui/field";
import { createCampaignAction, importSpendAction, recordSpendAction, updateCampaignAction } from "./actions";

type Opt = { value: string; label: string };
export const CHANNEL_OPTS: Opt[] = [
  { value: "meta_ads", label: "Meta Ads" }, { value: "google_ads", label: "Google Ads" }, { value: "website", label: "Website" },
  { value: "portal", label: "Property portal" }, { value: "whatsapp", label: "WhatsApp" }, { value: "referral", label: "Referral" },
  { value: "offline", label: "Offline / events" }, { value: "other", label: "Other" },
];

function CampaignFields({ projects, v }: { projects: Opt[]; v?: Record<string, string | number | boolean | null> }) {
  const val = (k: string) => (v?.[k] == null ? undefined : (v[k] as string | number));
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <FormField label="Campaign name" name="name" required defaultValue={val("name")} className="sm:col-span-2" />
      <FormField label="Channel" name="channel" as="select" required options={CHANNEL_OPTS} defaultValue={val("channel")} />
      <FormField label="Project" name="projectId" as="select" options={projects} defaultValue={val("projectId")} />
      <FormField label="Ad platform campaign ID" name="externalId" defaultValue={val("externalId")} hint="Matches Meta/Google lead webhooks to this campaign" />
      <FormField label="UTM campaign" name="utmCampaign" defaultValue={val("utmCampaign")} />
      <FormField label="Start date" name="startDate" type="date" defaultValue={val("startDate")} />
      <FormField label="End date" name="endDate" type="date" defaultValue={val("endDate")} />
      <FormField label="Budget (₹)" name="budget" type="number" defaultValue={val("budget")} inputProps={{ min: 0, step: 1000 }} />
    </div>
  );
}

export function NewCampaignButton({ projects }: { projects: Opt[] }) {
  return (
    <Dialog wide title="New campaign" trigger={(open) => <Button onClick={open}><Plus className="size-4" /> Campaign</Button>}>
      <ActionForm action={createCampaignAction} className="space-y-4">
        <CampaignFields projects={projects} />
        <div className="flex justify-end"><SubmitButton>Create campaign</SubmitButton></div>
      </ActionForm>
    </Dialog>
  );
}

export function EditCampaignButton({ projects, campaign }: { projects: Opt[]; campaign: Record<string, string | number | boolean | null> & { id: string; isActive: boolean } }) {
  return (
    <Dialog wide title="Edit campaign" trigger={(open) => <Button size="sm" variant="ghost" onClick={open} aria-label="Edit campaign"><Pencil className="size-3.5" /></Button>}>
      <ActionForm action={updateCampaignAction} resetOnSuccess={false} className="space-y-4">
        <input type="hidden" name="id" value={campaign.id} />
        <CampaignFields projects={projects} v={campaign} />
        <Checkbox name="isActive" label="Campaign is active" defaultChecked={campaign.isActive} />
        <div className="flex justify-end"><SubmitButton>Save</SubmitButton></div>
      </ActionForm>
    </Dialog>
  );
}

export function RecordSpendButton({ campaigns }: { campaigns: Opt[] }) {
  const date = useClientValue(todayISO, "");
  return (
    <Dialog title="Record spend" description="Enter daily spend per campaign. Re-entering a date replaces it." trigger={(open) => <Button variant="secondary" onClick={open} disabled={!campaigns.length}><IndianRupee className="size-4" /> Record spend</Button>}>
      <ActionForm action={recordSpendAction} className="space-y-3">
        <FormField label="Campaign" name="campaignId" as="select" required options={campaigns} />
        <FormField label="Date" name="spendDate" type="date" required defaultValue={date} key={date} />
        <FormField label="Amount spent (₹)" name="amount" type="number" required inputProps={{ min: 0, step: "0.01" }} />
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Impressions" name="impressions" type="number" inputProps={{ min: 0 }} />
          <FormField label="Clicks" name="clicks" type="number" inputProps={{ min: 0 }} />
        </div>
        <div className="flex justify-end"><SubmitButton>Save</SubmitButton></div>
      </ActionForm>
    </Dialog>
  );
}

export function ImportSpendButton() {
  return (
    <Dialog title="Import spend (CSV)" description="Columns: campaign (name or ad-platform ID), date (YYYY-MM-DD or DD/MM/YYYY), amount, optional impressions and clicks. Export this from Meta Ads Manager or Google Ads." trigger={(open) => <Button variant="secondary" onClick={open}><Upload className="size-4" /> Import</Button>}>
      <ActionForm action={importSpendAction} className="space-y-3">
        <Field label="CSV file" name="file" required>
          <input id="file" name="file" type="file" accept=".csv,text/csv" required className="block w-full text-sm" />
        </Field>
        <div className="flex justify-end"><SubmitButton pendingText="Importing…">Import</SubmitButton></div>
      </ActionForm>
    </Dialog>
  );
}
