"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { formObject, type ActionState } from "@/lib/actions";
import { tenantAction } from "@/lib/server-action";
import { flash } from "@/lib/flash";
import {
  assignLeads, changeStage, createLead, deleteLead, DuplicateLeadError, logActivity, setCustomFields, STAGES, updateLead, type LeadStage,
} from "@/lib/services/leads";
import { cancelFollowUp, completeFollowUp, rescheduleFollowUp, scheduleFollowUp } from "@/lib/services/followups";
import { confirmVisit, recordVisitOutcome, rescheduleVisit, scheduleVisit } from "@/lib/services/visits";
import { reserveUnit } from "@/lib/services/projects";
import { importLeads, parseLeadFile, type ImportResult } from "@/lib/services/imports";
import { flushPending } from "@/lib/services/whatsapp";
import { UserError } from "@/lib/errors";

function customFieldValues(fd: FormData) {
  const out: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (k.startsWith("cf_") && typeof v === "string") out[k.slice(3)] = v;
  return out;
}

function leadFields(d: Record<string, string | undefined>) {
  return {
    name: d.name ?? "", phone: d.phone, email: d.email, budgetMin: d.budgetMin as unknown as number, budgetMax: d.budgetMax as unknown as number,
    preferredLocation: d.preferredLocation, propertyType: d.propertyType, configuration: d.configuration,
    timeline: (d.timeline ?? "unknown") as "unknown", projectId: d.projectId, source: (d.source ?? "manual") as "manual",
    campaignId: d.campaignId, ownerId: d.ownerId, priority: (d.priority ?? "medium") as "medium", tags: d.tags, notes: d.notes,
  };
}

export async function createLeadAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const d = formObject(fd);
  let newId: string | null = null;
  const res = await tenantAction(async (tx, ctx) => {
    try {
      const r = await createLead(tx, ctx, leadFields(d), { allowDuplicate: d.allowDuplicate === "on" });
      newId = r.id;
      const cf = customFieldValues(fd);
      if (Object.keys(cf).length) await setCustomFields(tx, ctx, r.id, cf);
    } catch (e) {
      if (e instanceof DuplicateLeadError) return { error: e.message, data: { duplicates: e.duplicates } };
      throw e;
    }
  });
  if (res?.ok && newId) {
    await flash("Lead created.");
    redirect(`/leads/${newId}`);
  }
  return res;
}

export async function updateLeadAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const d = formObject(fd);
  return tenantAction(async (tx, ctx) => {
    const id = z.uuid().parse(d.id);
    const r = await updateLead(tx, ctx, id, leadFields(d));
    await setCustomFields(tx, ctx, id, customFieldValues(fd));
    return { ok: true, message: r.duplicates.length ? `Saved. Possible duplicate of ${r.duplicates.map((x) => x.name).join(", ")}.` : "Lead updated." };
  });
}

export async function deleteLeadAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const res = await tenantAction(async (tx, ctx) => {
    await deleteLead(tx, ctx, z.uuid().parse(fd.get("id")));
  });
  if (res?.ok) {
    await flash("Lead deleted.");
    redirect("/leads");
  }
  return res;
}

export async function assignLeadsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const ids = fd.getAll("ids").map(String);
  const owner = String(fd.get("ownerId") ?? "");
  return tenantAction(async (tx, ctx) => {
    if (!ids.length) throw new UserError("Select at least one lead.");
    const n = await assignLeads(tx, ctx, ids, owner === "unassign" ? null : z.uuid({ error: "Choose a team member" }).parse(owner));
    return { ok: true, message: `${n} lead${n === 1 ? "" : "s"} ${owner === "unassign" ? "unassigned" : "assigned"}.` };
  });
}

export async function changeStageAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const d = formObject(fd);
  return tenantAction(async (tx, ctx) => {
    const stage = z.enum(STAGES).parse(d.stage) as LeadStage;
    await changeStage(tx, ctx, z.uuid().parse(d.id), stage, d.lostReason);
    return { ok: true, message: "Stage updated." };
  });
}

export async function logActivityAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const d = formObject(fd);
  return tenantAction(async (tx, ctx) => {
    await logActivity(tx, ctx, z.uuid().parse(d.leadId), { type: d.type as "note", direction: d.direction as "outbound", outcome: d.outcome, body: d.body ?? "" });
    return { ok: true, message: "Activity logged." };
  });
}

export async function scheduleFollowUpAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const d = formObject(fd);
  return tenantAction(async (tx, ctx) => {
    await scheduleFollowUp(tx, ctx, { leadId: d.leadId ?? "", dueAt: d.dueAt ?? "", type: (d.type ?? "call") as "call", note: d.note, assignedToId: d.assignedToId });
    return { ok: true, message: "Follow-up scheduled." };
  });
}

export async function completeFollowUpAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const d = formObject(fd);
  return tenantAction(async (tx, ctx) => {
    await completeFollowUp(tx, ctx, z.uuid().parse(d.id), { outcome: d.outcome as "connected", note: d.note, nextDueAt: d.nextDueAt });
    return { ok: true, message: "Follow-up completed." };
  });
}

export async function cancelFollowUpAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return tenantAction(async (tx, ctx) => {
    await cancelFollowUp(tx, ctx, z.uuid().parse(fd.get("id")));
    return { ok: true, message: "Follow-up cancelled." };
  });
}

export async function rescheduleFollowUpAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const d = formObject(fd);
  return tenantAction(async (tx, ctx) => {
    await rescheduleFollowUp(tx, ctx, z.uuid().parse(d.id), d.dueAt ?? "");
    return { ok: true, message: "Follow-up rescheduled." };
  });
}

export async function scheduleVisitAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const d = formObject(fd);
  return tenantAction(async (tx, ctx) => {
    await scheduleVisit(tx, ctx, { leadId: d.leadId ?? "", projectId: d.projectId ?? "", scheduledAt: d.scheduledAt ?? "", assignedToId: d.assignedToId, note: d.note });
    return { ok: true, message: "Site visit scheduled." };
  });
}

export async function confirmVisitAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return tenantAction(async (tx, ctx) => {
    await confirmVisit(tx, ctx, z.uuid().parse(fd.get("id")));
    return { ok: true, message: "Visit confirmed." };
  });
}

export async function rescheduleVisitAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const d = formObject(fd);
  return tenantAction(async (tx, ctx) => {
    await rescheduleVisit(tx, ctx, z.uuid().parse(d.id), d.scheduledAt ?? "");
    return { ok: true, message: "Visit rescheduled." };
  });
}

export async function visitOutcomeAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const d = formObject(fd);
  return tenantAction(async (tx, ctx) => {
    await recordVisitOutcome(tx, ctx, z.uuid().parse(d.id), {
      status: d.status as "completed", interestLevel: d.interestLevel as "high", feedback: d.feedback, followUpInDays: d.followUpInDays as unknown as number,
    });
    return { ok: true, message: "Visit outcome recorded." };
  });
}

export async function reserveUnitAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const d = formObject(fd);
  return tenantAction(async (tx, ctx) => {
    await reserveUnit(tx, ctx, z.uuid({ error: "Choose a unit" }).parse(d.unitId), z.uuid().parse(d.leadId), Number(d.hours ?? 72));
    return { ok: true, message: "Unit reserved." };
  });
}

export async function importLeadsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const file = fd.get("file");
  const mode = fd.get("duplicateMode") === "update" ? "update" : "skip";
  const owner = String(fd.get("ownerId") ?? "") || undefined;
  let result: ImportResult | null = null;
  const res = await tenantAction(async (tx, ctx) => {
    if (!(file instanceof File)) throw new UserError("Choose a file to import.");
    const rows = await parseLeadFile(file);
    if (!rows.length) throw new UserError("The file has no data rows.");
    result = await importLeads(tx, ctx, rows, mode, owner && z.uuid().safeParse(owner).success ? owner : undefined);
    await flushPending(tx, ctx);
  });
  if (res?.error) return res;
  const r = result as ImportResult | null;
  return { ok: true, message: r ? `Imported ${r.created} new, updated ${r.updated}, skipped ${r.skipped}.` : "Import finished.", data: r };
}

export async function refreshAction() {
  revalidatePath("/", "layout");
}
