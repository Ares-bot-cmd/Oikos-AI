"use server";

import { redirect } from "next/navigation";
import { formObject, runAction, type ActionState } from "@/lib/actions";
import { acceptInvitation, authenticate, isMember, joinWithInvitation, signup } from "@/lib/services/accounts";
import { clientMeta, createSession, destroySession, getSession } from "@/lib/auth/session";
import { flash } from "@/lib/flash";
import { withSystem } from "@/lib/db/tenant";
import { sessions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";

function safeNext(next: string | undefined) {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/dashboard";
}

export async function loginAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const data = formObject(fd);
  let target = "/dashboard";
  const result = await runAction(async () => {
    const { ip } = await clientMeta();
    const { userId, orgId } = await authenticate({ email: data.email ?? "", password: data.password ?? "" }, ip);
    await createSession(userId, orgId);
    target = safeNext(data.next);
  });
  if (result?.error || result?.fieldErrors) return result;
  redirect(target);
}

export async function signupAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const data = formObject(fd);
  const result = await runAction(async () => {
    const { ip } = await clientMeta();
    const { userId, orgId } = await signup(
      { name: data.name ?? "", email: data.email ?? "", password: data.password ?? "", organization: data.organization ?? "" },
      ip,
    );
    await createSession(userId, orgId);
    await flash("Welcome to Oikos AI — your workspace is ready.");
  });
  if (result?.error || result?.fieldErrors) return result;
  redirect("/dashboard?welcome=1");
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}

export async function switchOrgAction(fd: FormData) {
  const session = await getSession();
  if (!session) redirect("/login");
  const orgId = z.uuid().safeParse(fd.get("orgId"));
  if (orgId.success && (await isMember(session.userId, orgId.data))) {
    await withSystem((tx) => tx.update(sessions).set({ organizationId: orgId.data }).where(eq(sessions.id, session.sessionId)));
  }
  redirect("/dashboard");
}

export async function acceptInviteAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const data = formObject(fd);
  const result = await runAction(async () => {
    const { userId, orgId } = await acceptInvitation({ token: data.token ?? "", name: data.name ?? "", password: data.password ?? "" });
    await createSession(userId, orgId);
    await flash("Welcome aboard! Your account is ready.");
  });
  if (result?.error || result?.fieldErrors) return result;
  redirect("/dashboard");
}

export async function joinInviteAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const session = await getSession();
  if (!session) redirect("/login");
  const token = String(fd.get("token") ?? "");
  const result = await runAction(async () => {
    const { orgId } = await joinWithInvitation(token, session.userId, session.email);
    await withSystem((tx) => tx.update(sessions).set({ organizationId: orgId }).where(eq(sessions.id, session.sessionId)));
    await flash("You've joined the organization.");
  });
  if (result?.error) return result;
  redirect("/dashboard");
}
