"use server";

import { z } from "zod";
import { formObject, type ActionState } from "@/lib/actions";
import { tenantAction } from "@/lib/server-action";
import { createRule, deleteRule, toggleRule } from "@/lib/services/automation";

export async function createRuleAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const d = formObject(fd);
  const userIds = fd.getAll("userIds").map(String).filter(Boolean).join(",");
  return tenantAction(async (tx, ctx) => {
    await createRule(tx, ctx, {
      name: d.name ?? "", trigger: d.trigger as "lead_created", action: d.action as "notify_owner", condSource: d.condSource, condProjectId: d.condProjectId,
      condStage: d.condStage, userIds: userIds || undefined, userId: d.userId, hours: d.hours as unknown as number, followUpType: d.followUpType as "call",
      template: d.template, language: d.language, message: d.message,
    });
    return { ok: true, message: "Automation rule created." };
  });
}

export async function toggleRuleAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return tenantAction(async (tx, ctx) => {
    await toggleRule(tx, ctx, z.uuid().parse(fd.get("id")), fd.get("active") === "true");
    return { ok: true, message: fd.get("active") === "true" ? "Rule enabled." : "Rule paused." };
  });
}

export async function deleteRuleAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return tenantAction(async (tx, ctx) => {
    await deleteRule(tx, ctx, z.uuid().parse(fd.get("id")));
    return { ok: true, message: "Rule deleted." };
  });
}
