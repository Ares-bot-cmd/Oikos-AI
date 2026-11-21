"use server";

import Papa from "papaparse";
import { z } from "zod";
import { formObject, type ActionState } from "@/lib/actions";
import { tenantAction } from "@/lib/server-action";
import { UserError } from "@/lib/errors";
import { createCampaign, deleteCampaign, importSpend, recordSpend, updateCampaign } from "@/lib/services/marketing";

type Obj = Record<string, string | undefined>;
const campaignInput = (d: Obj) => ({
  name: d.name ?? "", channel: (d.channel ?? "other") as "other", projectId: d.projectId, externalId: d.externalId, utmCampaign: d.utmCampaign,
  startDate: d.startDate, endDate: d.endDate, budget: d.budget as unknown as number,
});

export async function createCampaignAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return tenantAction(async (tx, ctx) => {
    await createCampaign(tx, ctx, campaignInput(formObject(fd)));
    return { ok: true, message: "Campaign created." };
  });
}

export async function updateCampaignAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const d = formObject(fd);
  return tenantAction(async (tx, ctx) => {
    await updateCampaign(tx, ctx, z.uuid().parse(d.id), { ...campaignInput(d), isActive: d.isActive === "on" });
    return { ok: true, message: "Campaign saved." };
  });
}

export async function deleteCampaignAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return tenantAction(async (tx, ctx) => {
    await deleteCampaign(tx, ctx, z.uuid().parse(fd.get("id")));
    return { ok: true, message: "Campaign deleted. Its leads keep their history." };
  });
}

export async function recordSpendAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const d = formObject(fd);
  return tenantAction(async (tx, ctx) => {
    await recordSpend(tx, ctx, { campaignId: d.campaignId ?? "", spendDate: d.spendDate ?? "", amount: d.amount as unknown as number, impressions: d.impressions as unknown as number, clicks: d.clicks as unknown as number });
    return { ok: true, message: "Spend recorded." };
  });
}

export async function importSpendAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const file = fd.get("file");
  return tenantAction(async (tx, ctx) => {
    if (!(file instanceof File) || file.size === 0) throw new UserError("Choose a CSV file.");
    if (file.size > 2 * 1024 * 1024) throw new UserError("CSV files must be 2 MB or smaller.");
    if (!file.name.toLowerCase().endsWith(".csv")) throw new UserError("Upload a .csv file.");
    const parsed = Papa.parse<Record<string, string>>((await file.text()).replace(/^﻿/, ""), {
      header: true, skipEmptyLines: "greedy", transformHeader: (h) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_"),
    });
    const r = await importSpend(tx, ctx, parsed.data);
    return { ok: true, message: `Imported ${r.imported} spend rows${r.errorCount ? `, ${r.errorCount} skipped (${r.errors[0]})` : ""}.` };
  });
}
