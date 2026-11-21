import "server-only";
import { revalidatePath } from "next/cache";
import { ctxOf, requireSession, type Session } from "@/lib/auth/session";
import { withTenant, type TenantCtx } from "@/lib/db/tenant";
import type { Tx } from "@/lib/db";
import { runAction, type ActionState } from "@/lib/actions";
import { NotFoundError } from "@/lib/errors";
import { notFound } from "next/navigation";

/**
 * Standard server action body: verifies the session (never trusts client-supplied ids for
 * identity or tenant), runs `fn` inside a row-level-security transaction, and refreshes the UI.
 */
export async function tenantAction(fn: (tx: Tx, ctx: TenantCtx, session: Session) => Promise<ActionState | void>): Promise<ActionState> {
  const result = await runAction(async () => {
    const session = await requireSession();
    const ctx = ctxOf(session);
    return (await withTenant(ctx, (tx) => fn(tx, ctx, session))) ?? { ok: true };
  });
  if (result?.ok) revalidatePath("/", "layout");
  return result;
}

/** Page data loader: one tenant transaction per render. */
export async function loadPage<T>(fn: (tx: Tx, ctx: TenantCtx, session: Session) => Promise<T>) {
  const session = await requireSession();
  const ctx = ctxOf(session);
  try {
    const data = await withTenant(ctx, (tx) => fn(tx, ctx, session));
    return { session, ctx, data };
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
}
