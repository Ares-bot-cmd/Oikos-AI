import "server-only";
import { and, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { memberships, notifications } from "@/lib/db/schema";

export type NotificationInput = { type: string; title: string; body?: string; link?: string; dedupeKey?: string };

/** Inserts an in-app notification. With a dedupeKey, the same event never notifies a user twice. */
export async function notify(tx: Tx, orgId: string, userId: string, n: NotificationInput) {
  await tx
    .insert(notifications)
    .values({ organizationId: orgId, userId, type: n.type, title: n.title.slice(0, 200), body: n.body?.slice(0, 500), link: n.link, dedupeKey: n.dedupeKey })
    .onConflictDoNothing();
}

export async function managerIds(tx: Tx): Promise<string[]> {
  const rows = await tx
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.isActive, true), inArray(memberships.role, ["org_admin", "sales_manager"])));
  return rows.map((r) => r.userId);
}

export async function notifyMany(tx: Tx, orgId: string, userIds: (string | null | undefined)[], n: NotificationInput) {
  for (const id of new Set(userIds.filter(Boolean) as string[])) await notify(tx, orgId, id, n);
}

export async function unreadCount(tx: Tx, userId: string) {
  const [r] = await tx.select({ n: count() }).from(notifications).where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return Number(r.n);
}

export async function listNotifications(tx: Tx, userId: string, opts: { unreadOnly?: boolean; limit?: number; offset?: number } = {}) {
  const where = and(eq(notifications.userId, userId), opts.unreadOnly ? isNull(notifications.readAt) : undefined);
  const [rows, [{ total }]] = await Promise.all([
    tx.select().from(notifications).where(where).orderBy(desc(notifications.createdAt)).limit(opts.limit ?? 25).offset(opts.offset ?? 0),
    tx.select({ total: count() }).from(notifications).where(where),
  ]);
  return { rows, total: Number(total) };
}

export async function markRead(tx: Tx, userId: string, id?: string) {
  await tx
    .update(notifications)
    .set({ readAt: sql`now()` })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt), id ? eq(notifications.id, id) : undefined));
}
