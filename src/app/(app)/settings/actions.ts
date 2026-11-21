"use server";

import { z } from "zod";
import { formObject, type ActionState } from "@/lib/actions";
import { tenantAction } from "@/lib/server-action";
import { requireSession } from "@/lib/auth/session";
import { runAction } from "@/lib/actions";
import { ROLES } from "@/lib/auth/permissions";
import {
  addCustomField, changePassword, changeRole, deleteCustomField, inviteMember, revokeInvitation, revokeOtherSessions, revokeSession,
  setMemberActive, updateOrganization,
} from "@/lib/services/org";
import { createApiKey, createForm, disconnectIntegration, revokeApiKey, saveIntegration, toggleForm, type Provider } from "@/lib/services/capture";
import { appUrl } from "@/lib/app-url";

export async function updateOrgAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const d = formObject(fd);
  return tenantAction(async (tx, ctx) => {
    await updateOrganization(tx, ctx, { name: d.name ?? "", currency: (d.currency ?? "INR") as "INR", timezone: d.timezone ?? "", neglectDays: d.neglectDays as unknown as number, aiAgentEnabled: d.aiAgentEnabled as "on" | undefined });
    return { ok: true, message: "Organization settings saved." };
  });
}

export async function addCustomFieldAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const d = formObject(fd);
  return tenantAction(async (tx, ctx) => {
    await addCustomField(tx, ctx, { label: d.label ?? "", fieldType: (d.fieldType ?? "text") as "text", options: d.options });
    return { ok: true, message: "Custom field added." };
  });
}

export async function deleteCustomFieldAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return tenantAction(async (tx, ctx) => {
    await deleteCustomField(tx, ctx, z.uuid().parse(fd.get("id")));
    return { ok: true, message: "Custom field removed." };
  });
}

export async function inviteAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const d = formObject(fd);
  return tenantAction(async (tx, ctx) => {
    const token = await inviteMember(tx, ctx, { email: d.email ?? "", name: d.name, role: (d.role ?? "sales_executive") as "sales_executive" });
    // No email provider is configured: the admin shares this one-time link directly.
    return { ok: true, message: "Invitation created. Copy the link and send it to your colleague.", data: { link: `${await appUrl()}/invite/${token}` } };
  });
}

export async function revokeInviteAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return tenantAction(async (tx, ctx) => {
    await revokeInvitation(tx, ctx, z.uuid().parse(fd.get("id")));
    return { ok: true, message: "Invitation revoked." };
  });
}

export async function changeRoleAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const d = formObject(fd);
  return tenantAction(async (tx, ctx) => {
    await changeRole(tx, ctx, z.uuid().parse(d.membershipId), z.enum(ROLES).parse(d.role));
    return { ok: true, message: "Role updated." };
  });
}

export async function setActiveAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const d = formObject(fd);
  return tenantAction(async (tx, ctx) => {
    await setMemberActive(tx, ctx, z.uuid().parse(d.membershipId), d.active === "true");
    return { ok: true, message: d.active === "true" ? "Member reactivated." : "Member deactivated and signed out. Their open leads are now unassigned." };
  });
}

export async function saveIntegrationAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const d = formObject(fd);
  const provider = z.enum(["whatsapp", "meta_leads", "google_leads"]).parse(d.provider) as Provider;
  return tenantAction(async (tx, ctx) => {
    if (provider === "whatsapp") {
      const cfg = z.object({ phoneNumberId: z.string().regex(/^\d{5,30}$/, "Phone number ID is numeric"), wabaId: z.string().max(40).optional(), displayPhone: z.string().max(30).optional() }).parse(d);
      await saveIntegration(tx, ctx, "whatsapp", cfg as Record<string, string>, { accessToken: d.accessToken, appSecret: d.appSecret });
    } else if (provider === "meta_leads") {
      const cfg = z.object({ pageId: z.string().regex(/^\d{3,40}$/, "Page ID is numeric").optional(), defaultProjectId: z.uuid().optional() }).parse(d);
      await saveIntegration(tx, ctx, "meta_leads", cfg as Record<string, string>, { pageAccessToken: d.pageAccessToken, appSecret: d.appSecret });
    } else {
      const cfg = z.object({ defaultProjectId: z.uuid().optional() }).parse(d);
      await saveIntegration(tx, ctx, "google_leads", cfg as Record<string, string>, {});
    }
    return { ok: true, message: "Integration saved." };
  });
}

export async function disconnectIntegrationAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const provider = z.enum(["whatsapp", "meta_leads", "google_leads"]).parse(fd.get("provider")) as Provider;
  return tenantAction(async (tx, ctx) => {
    await disconnectIntegration(tx, ctx, provider);
    return { ok: true, message: "Integration disconnected and its credentials deleted." };
  });
}

export async function createApiKeyAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return tenantAction(async (tx, ctx) => {
    const key = await createApiKey(tx, ctx, String(fd.get("name") ?? ""));
    return { ok: true, message: "API key created. Copy it now — it won't be shown again.", data: { key } };
  });
}

export async function revokeApiKeyAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return tenantAction(async (tx, ctx) => {
    await revokeApiKey(tx, ctx, z.uuid().parse(fd.get("id")));
    return { ok: true, message: "API key revoked." };
  });
}

export async function createFormAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const d = formObject(fd);
  return tenantAction(async (tx, ctx) => {
    const slug = await createForm(tx, ctx, { title: d.title ?? "", intro: d.intro, projectId: d.projectId, campaignId: d.campaignId });
    return { ok: true, message: "Lead form created.", data: { link: `${await appUrl()}/f/${slug}` } };
  });
}

export async function toggleFormAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return tenantAction(async (tx, ctx) => {
    await toggleForm(tx, ctx, z.uuid().parse(fd.get("id")), fd.get("active") === "true");
    return { ok: true, message: fd.get("active") === "true" ? "Form enabled." : "Form disabled." };
  });
}

export async function changePasswordAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const d = formObject(fd);
  return runAction(async () => {
    const s = await requireSession();
    if (d.next !== d.confirm) return { error: "The new passwords don't match.", fieldErrors: { confirm: "Doesn't match" } };
    await changePassword(s.userId, d.current ?? "", d.next ?? "", s.sessionId);
    return { ok: true, message: "Password changed. Other sessions were signed out." };
  });
}

export async function revokeSessionAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const s = await requireSession();
    const id = String(fd.get("id") ?? "");
    if (id === "others") await revokeOtherSessions(s.userId, s.sessionId);
    else await revokeSession(s.userId, id);
    return { ok: true, message: "Session signed out." };
  });
}
