import "server-only";
import { and, count, desc, eq, gt, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/lib/db";
import { withSystem, type TenantCtx } from "@/lib/db/tenant";
import { auditLogs, customFieldDefs, invitations, leads, memberships, organizations, sessions, users } from "@/lib/db/schema";
import { assertCan, ROLES, type Role } from "@/lib/auth/permissions";
import { NotFoundError, UserError } from "@/lib/errors";
import { randomToken, sha256 } from "@/lib/security/crypto";
import { zOptMoney } from "@/lib/validation";
import { audit } from "./audit";

export const PLANS = {
  trial: { label: "Trial", seats: 5, leadsPerMonth: 1000, price: null },
  growth: { label: "Growth", seats: 25, leadsPerMonth: 20000, price: null },
  enterprise: { label: "Enterprise", seats: 500, leadsPerMonth: 500000, price: null },
} as const;

export async function members(tx: Tx) {
  return tx
    .select({
      membershipId: memberships.id, userId: users.id, name: users.name, email: users.email, role: memberships.role, isActive: memberships.isActive,
      phone: memberships.phone, monthlyBookingTarget: memberships.monthlyBookingTarget, monthlyRevenueTarget: memberships.monthlyRevenueTarget,
      receivesLeads: memberships.receivesLeads, lastLoginAt: users.lastLoginAt, joinedAt: memberships.createdAt,
      openLeads: sql<number>`(select count(*) from leads l where l.owner_id = ${users.id} and l.stage not in ('booked','lost'))`.mapWith(Number),
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .orderBy(desc(memberships.isActive), users.name);
}

export const inviteSchema = z.object({
  email: z.email("Enter a valid email").trim().toLowerCase().max(200),
  name: z.string().trim().max(100).optional(),
  role: z.enum(ROLES),
});

/** Creates an invitation and returns the one-time link token (valid 7 days). */
export async function inviteMember(tx: Tx, ctx: TenantCtx, input: z.input<typeof inviteSchema>) {
  assertCan(ctx.role, "users:manage");
  const d = inviteSchema.parse(input);
  const [org] = await tx.select({ plan: organizations.plan }).from(organizations).where(eq(organizations.id, ctx.orgId));
  const [{ n }] = await tx.select({ n: count() }).from(memberships).where(eq(memberships.isActive, true));
  const seats = PLANS[(org?.plan as keyof typeof PLANS) ?? "trial"]?.seats ?? 5;
  if (Number(n) >= seats) throw new UserError(`Your plan includes ${seats} seats. Deactivate a member or upgrade to invite more.`);
  const already = await tx
    .select({ id: memberships.id })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(sql`lower(${users.email}) = ${d.email}`, eq(memberships.isActive, true)));
  if (already.length) throw new UserError("This person is already a member.");
  const token = randomToken(32);
  await tx.insert(invitations).values({
    organizationId: ctx.orgId, email: d.email, name: d.name, role: d.role, tokenHash: sha256(token), invitedById: ctx.userId,
    expiresAt: new Date(Date.now() + 7 * 86400_000),
  });
  await audit(tx, ctx, "member.invited", { type: "invitation" }, { email: d.email, role: d.role });
  return token;
}

export async function pendingInvitations(tx: Tx) {
  return tx
    .select({ id: invitations.id, email: invitations.email, role: invitations.role, expiresAt: invitations.expiresAt, createdAt: invitations.createdAt })
    .from(invitations)
    .where(and(isNull(invitations.acceptedAt), gt(invitations.expiresAt, new Date())))
    .orderBy(desc(invitations.createdAt));
}

export async function revokeInvitation(tx: Tx, ctx: TenantCtx, id: string) {
  assertCan(ctx.role, "users:manage");
  if (!z.uuid().safeParse(id).success) throw new NotFoundError("Invitation");
  const r = await tx.delete(invitations).where(eq(invitations.id, id)).returning({ id: invitations.id });
  if (!r.length) throw new NotFoundError("Invitation");
}

async function adminCount(tx: Tx) {
  const [{ n }] = await tx.select({ n: count() }).from(memberships).where(and(eq(memberships.role, "org_admin"), eq(memberships.isActive, true)));
  return Number(n);
}

async function getMembership(tx: Tx, membershipId: string) {
  if (!z.uuid().safeParse(membershipId).success) throw new NotFoundError("Member");
  const [m] = await tx.select().from(memberships).where(eq(memberships.id, membershipId));
  if (!m) throw new NotFoundError("Member");
  return m;
}

export async function changeRole(tx: Tx, ctx: TenantCtx, membershipId: string, role: Role) {
  assertCan(ctx.role, "users:manage");
  if (!ROLES.includes(role)) throw new UserError("Unknown role.");
  const m = await getMembership(tx, membershipId);
  if (m.role === "org_admin" && role !== "org_admin" && (await adminCount(tx)) <= 1) throw new UserError("The organization needs at least one admin.");
  await tx.update(memberships).set({ role }).where(eq(memberships.id, m.id));
  await audit(tx, ctx, "member.role_changed", { type: "user", id: m.userId }, { from: m.role, to: role });
}

export async function setMemberActive(tx: Tx, ctx: TenantCtx, membershipId: string, active: boolean) {
  assertCan(ctx.role, "users:manage");
  const m = await getMembership(tx, membershipId);
  if (!active && m.userId === ctx.userId) throw new UserError("You can't deactivate yourself.");
  if (!active && m.role === "org_admin" && (await adminCount(tx)) <= 1) throw new UserError("The organization needs at least one active admin.");
  await tx.update(memberships).set({ isActive: active }).where(eq(memberships.id, m.id));
  if (!active) {
    // Sign them out of this organization and release their open leads for reassignment.
    await withSystem((stx) => stx.delete(sessions).where(and(eq(sessions.userId, m.userId), eq(sessions.organizationId, ctx.orgId))));
    await tx.update(leads).set({ ownerId: null }).where(and(eq(leads.ownerId, m.userId), sql`${leads.stage} not in ('booked','lost')`));
  }
  await audit(tx, ctx, active ? "member.reactivated" : "member.deactivated", { type: "user", id: m.userId });
}

export const targetSchema = z.object({
  monthlyBookingTarget: z.coerce.number().int().min(0).max(10_000).optional(),
  monthlyRevenueTarget: zOptMoney,
  phone: z.string().trim().max(30).optional(),
  receivesLeads: z.enum(["on", "true"]).optional(),
});

export async function updateMemberSettings(tx: Tx, ctx: TenantCtx, membershipId: string, input: z.input<typeof targetSchema>) {
  assertCan(ctx.role, "team:manage");
  const m = await getMembership(tx, membershipId);
  const d = targetSchema.parse(input);
  await tx
    .update(memberships)
    .set({ monthlyBookingTarget: d.monthlyBookingTarget ?? null, monthlyRevenueTarget: d.monthlyRevenueTarget ?? null, phone: d.phone ?? null, receivesLeads: !!d.receivesLeads })
    .where(eq(memberships.id, m.id));
}

export const orgSchema = z.object({
  name: z.string().trim().min(2, "Enter the organization name").max(120),
  currency: z.enum(["INR", "USD", "AED", "GBP", "EUR", "SGD"]),
  timezone: z.string().trim().min(3).max(60).refine((tz) => { try { new Intl.DateTimeFormat("en", { timeZone: tz }); return true; } catch { return false; } }, "Unknown time zone"),
  neglectDays: z.coerce.number().int().min(1).max(60),
  aiAgentEnabled: z.enum(["on", "true"]).optional(),
});

export async function getOrganization(tx: Tx, orgId: string) {
  const [o] = await tx.select().from(organizations).where(eq(organizations.id, orgId));
  if (!o) throw new NotFoundError("Organization");
  return o;
}

export async function updateOrganization(tx: Tx, ctx: TenantCtx, input: z.input<typeof orgSchema>) {
  assertCan(ctx.role, "org:manage");
  const d = orgSchema.parse(input);
  await tx.update(organizations).set({ name: d.name, currency: d.currency, timezone: d.timezone, neglectDays: d.neglectDays, aiAgentEnabled: !!d.aiAgentEnabled }).where(eq(organizations.id, ctx.orgId));
  await audit(tx, ctx, "organization.updated", { type: "organization", id: ctx.orgId });
}

export const customFieldSchema = z.object({
  label: z.string().trim().min(1, "Label is required").max(60),
  fieldType: z.enum(["text", "number", "date", "select"]),
  options: z.string().max(500).optional(),
});

export async function addCustomField(tx: Tx, ctx: TenantCtx, input: z.input<typeof customFieldSchema>) {
  assertCan(ctx.role, "org:manage");
  const d = customFieldSchema.parse(input);
  const key = d.label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "field";
  const options = d.fieldType === "select" ? (d.options ?? "").split(",").map((o) => o.trim()).filter(Boolean).slice(0, 30) : null;
  if (d.fieldType === "select" && !options?.length) throw new UserError("Add comma-separated options for a dropdown field.");
  const [{ n }] = await tx.select({ n: count() }).from(customFieldDefs);
  if (Number(n) >= 30) throw new UserError("You can define up to 30 custom fields.");
  const r = await tx.insert(customFieldDefs).values({ organizationId: ctx.orgId, key, label: d.label, fieldType: d.fieldType, options }).onConflictDoNothing().returning({ id: customFieldDefs.id });
  if (!r.length) throw new UserError("A field with this name already exists.");
}

export async function deleteCustomField(tx: Tx, ctx: TenantCtx, id: string) {
  assertCan(ctx.role, "org:manage");
  if (!z.uuid().safeParse(id).success) throw new NotFoundError("Field");
  await tx.delete(customFieldDefs).where(eq(customFieldDefs.id, id));
}

export async function customFields(tx: Tx) {
  return tx.select().from(customFieldDefs).orderBy(customFieldDefs.createdAt);
}

export async function auditLog(tx: Tx, ctx: TenantCtx, limit = 50, offset = 0) {
  assertCan(ctx.role, "audit:read");
  const [rows, [{ total }]] = await Promise.all([
    tx
      .select({ id: auditLogs.id, action: auditLogs.action, entityType: auditLogs.entityType, entityId: auditLogs.entityId, details: auditLogs.details, ip: auditLogs.ip, createdAt: auditLogs.createdAt, userName: users.name })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.userId))
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit)
      .offset(offset),
    tx.select({ total: count() }).from(auditLogs),
  ]);
  return { rows, total: Number(total) };
}

// Sessions belong to the user (not the tenant), so they're managed through system queries scoped to the user id.
export async function mySessions(userId: string) {
  return withSystem((tx) =>
    tx
      .select({ id: sessions.id, ip: sessions.ip, userAgent: sessions.userAgent, createdAt: sessions.createdAt, lastSeenAt: sessions.lastSeenAt, expiresAt: sessions.expiresAt })
      .from(sessions)
      .where(and(eq(sessions.userId, userId), gt(sessions.expiresAt, new Date())))
      .orderBy(desc(sessions.lastSeenAt)),
  );
}

export async function revokeSession(userId: string, sessionId: string) {
  if (!z.uuid().safeParse(sessionId).success) throw new NotFoundError("Session");
  await withSystem((tx) => tx.delete(sessions).where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId))));
}

export async function revokeOtherSessions(userId: string, keepSessionId: string) {
  await withSystem((tx) => tx.delete(sessions).where(and(eq(sessions.userId, userId), ne(sessions.id, keepSessionId))));
}

export async function changePassword(userId: string, current: string, next: string, keepSessionId: string) {
  const bcrypt = (await import("bcryptjs")).default;
  const { passwordSchema, hashPassword } = await import("./accounts");
  const parsed = passwordSchema.safeParse(next);
  if (!parsed.success) throw new UserError(parsed.error.issues[0].message);
  const [u] = await withSystem((tx) => tx.select({ hash: users.passwordHash }).from(users).where(eq(users.id, userId)));
  if (!u || !(await bcrypt.compare(current, u.hash))) throw new UserError("Your current password is incorrect.");
  const hash = await hashPassword(next);
  await withSystem((tx) => tx.update(users).set({ passwordHash: hash }).where(eq(users.id, userId)));
  await revokeOtherSessions(userId, keepSessionId);
}

export async function usage(tx: Tx) {
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const [r] = (
    await tx.execute<{ seats: string; leads_month: string; leads_total: string; projects: string; units: string }>(sql`
      select (select count(*) from memberships where is_active) as seats,
        (select count(*) from leads where created_at >= ${monthStart}) as leads_month,
        (select count(*) from leads) as leads_total,
        (select count(*) from projects) as projects,
        (select count(*) from units) as units`)
  ).rows;
  return { seats: Number(r.seats), leadsMonth: Number(r.leads_month), leadsTotal: Number(r.leads_total), projects: Number(r.projects), units: Number(r.units) };
}
