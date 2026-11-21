import "server-only";
import { sql } from "drizzle-orm";
import { getDb, type Tx } from "./index";
import type { Role } from "@/lib/auth/permissions";

/** Who is acting, and on behalf of which organization. Built only from a verified session or API key. */
export type TenantCtx = {
  orgId: string;
  userId: string | null;
  role: Role | "system";
};

/**
 * Runs `fn` in a transaction that the database itself restricts to one organization:
 * the connection switches to the non-owner `oikos_app` role, and row-level security
 * policies only expose rows whose organization_id matches app.org_id. A query that
 * forgets a WHERE organization_id clause still cannot read or write another tenant.
 */
export async function withTenant<T>(ctx: TenantCtx, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!ctx.orgId) throw new Error("withTenant requires an organization");
  const db = await getDb();
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.org_id', ${ctx.orgId}, true), set_config('app.user_id', ${ctx.userId ?? ""}, true), set_config('role', 'oikos_app', true)`,
    );
    return fn(tx);
  });
}

/**
 * Privileged access for flows that run before a tenant is known (sign-in, session lookup,
 * webhook routing, platform admin). Never call this with user-controlled organization ids
 * without verifying ownership first.
 */
export async function withSystem<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const db = await getDb();
  return db.transaction(fn);
}
