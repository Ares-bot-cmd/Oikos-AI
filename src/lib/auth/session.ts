import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, gt } from "drizzle-orm";
import { withSystem, type TenantCtx } from "@/lib/db/tenant";
import { memberships, organizations, sessions, users } from "@/lib/db/schema";
import { randomToken, sha256 } from "@/lib/security/crypto";
import { assertCan, type Permission, type Role } from "./permissions";

const SESSION_DAYS = 14;
const secure = process.env.NODE_ENV === "production";
export const SESSION_COOKIE = secure ? "__Host-oikos_session" : "oikos_session";

export type Session = {
  sessionId: string;
  userId: string;
  name: string;
  email: string;
  isSuperAdmin: boolean;
  orgId: string;
  orgName: string;
  currency: string;
  timezone: string;
  role: Role;
};

export async function clientMeta() {
  const h = await headers();
  const ip = (h.get("x-forwarded-for") || "").split(",")[0].trim() || h.get("x-real-ip") || "unknown";
  return { ip, userAgent: (h.get("user-agent") || "").slice(0, 300) };
}

export async function createSession(userId: string, orgId: string | null) {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000);
  const meta = await clientMeta();
  await withSystem((tx) =>
    tx.insert(sessions).values({
      tokenHash: sha256(token),
      userId,
      organizationId: orgId,
      expiresAt,
      ip: meta.ip,
      userAgent: meta.userAgent,
    }),
  );
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await withSystem((tx) => tx.delete(sessions).where(eq(sessions.tokenHash, sha256(token))));
  }
  jar.delete(SESSION_COOKIE);
}

/** Resolves the signed-in user for this request (deduplicated per request). */
export const getSession = cache(async (): Promise<Session | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || token.length > 200) return null;
  return withSystem(async (tx) => {
    const rows = await tx
      .select({
        sessionId: sessions.id,
        lastSeenAt: sessions.lastSeenAt,
        userId: users.id,
        name: users.name,
        email: users.email,
        isSuperAdmin: users.isSuperAdmin,
        orgId: organizations.id,
        orgName: organizations.name,
        currency: organizations.currency,
        timezone: organizations.timezone,
        role: memberships.role,
        active: memberships.isActive,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .innerJoin(organizations, eq(organizations.id, sessions.organizationId))
      .innerJoin(
        memberships,
        and(eq(memberships.userId, sessions.userId), eq(memberships.organizationId, sessions.organizationId)),
      )
      .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, new Date())))
      .limit(1);
    const row = rows[0];
    if (!row || !row.active) return null;
    if (Date.now() - row.lastSeenAt.getTime() > 3600_000) {
      await tx.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, row.sessionId));
    }
    return {
      sessionId: row.sessionId,
      userId: row.userId,
      name: row.name,
      email: row.email,
      isSuperAdmin: row.isSuperAdmin,
      orgId: row.orgId,
      orgName: row.orgName,
      currency: row.currency,
      timezone: row.timezone,
      role: row.role,
    };
  });
});

export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (!s) redirect("/login");
  return s;
}

export function ctxOf(s: Session): TenantCtx {
  return { orgId: s.orgId, userId: s.userId, role: s.role };
}

/** Signed-in session plus tenant context; throws ForbiddenError when the role lacks `permission`. */
export async function requireCtx(permission?: Permission) {
  const session = await requireSession();
  if (permission) assertCan(session.role, permission);
  return { session, ctx: ctxOf(session) };
}
