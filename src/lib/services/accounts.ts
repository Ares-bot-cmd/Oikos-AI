import "server-only";
import bcrypt from "bcryptjs";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { withSystem } from "@/lib/db/tenant";
import { auditLogs, invitations, memberships, organizations, users } from "@/lib/db/schema";
import { UserError } from "@/lib/errors";
import { rateLimit, RateLimitError } from "@/lib/security/rate-limit";
import { sha256 } from "@/lib/security/crypto";
import { slugify } from "@/lib/utils";
import type { Role } from "@/lib/auth/permissions";

const BCRYPT_COST = 12;
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
// Compared against when the email doesn't exist, so response time doesn't reveal accounts.
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= bcrypt.hash("not-a-real-password-" + Math.random(), BCRYPT_COST));

export const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters")
  .max(128, "Use 128 characters or fewer")
  .regex(/[A-Za-z]/, "Include at least one letter")
  .regex(/[0-9]/, "Include at least one number");

export const signupSchema = z.object({
  name: z.string().trim().min(2, "Enter your full name").max(100),
  email: z.email("Enter a valid email address").trim().toLowerCase().max(200),
  password: passwordSchema,
  organization: z.string().trim().min(2, "Enter your company name").max(120),
});

export async function hashPassword(password: string) {
  return bcrypt.hash(password, BCRYPT_COST);
}

export async function signup(input: z.infer<typeof signupSchema>, ip = "unknown") {
  const data = signupSchema.parse(input);
  if (!(await rateLimit(`signup:${ip}`, 10, 3600))) throw new RateLimitError();
  const passwordHash = await hashPassword(data.password);
  return withSystem(async (tx) => {
    const existing = await tx
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.email}) = ${data.email}`)
      .limit(1);
    if (existing.length) throw new UserError("An account with this email already exists. Sign in instead.");
    const [user] = await tx.insert(users).values({ email: data.email, name: data.name, passwordHash }).returning({ id: users.id });
    const slug = `${slugify(data.organization) || "org"}-${Math.random().toString(36).slice(2, 7)}`;
    const [org] = await tx
      .insert(organizations)
      .values({ name: data.organization, slug, trialEndsAt: new Date(Date.now() + 14 * 86400_000) })
      .returning({ id: organizations.id });
    await tx.insert(memberships).values({ organizationId: org.id, userId: user.id, role: "org_admin" });
    await tx.insert(auditLogs).values({
      organizationId: org.id,
      userId: user.id,
      action: "organization.created",
      entityType: "organization",
      entityId: org.id,
      ip,
    });
    return { userId: user.id, orgId: org.id };
  });
}

export const loginSchema = z.object({
  email: z.email("Enter a valid email address").trim().toLowerCase(),
  password: z.string().min(1, "Enter your password").max(128),
});

const INVALID = "Invalid email or password.";

export async function authenticate(input: z.infer<typeof loginSchema>, ip = "unknown") {
  const { email, password } = loginSchema.parse(input);
  const [ipOk, emailOk] = await Promise.all([
    rateLimit(`login-ip:${ip}`, 30, 900),
    rateLimit(`login-email:${email}`, 10, 900),
  ]);
  if (!ipOk || !emailOk) throw new RateLimitError("Too many sign-in attempts. Try again in 15 minutes.");

  const user = await withSystem(async (tx) => {
    const rows = await tx.select().from(users).where(sql`lower(${users.email}) = ${email}`).limit(1);
    return rows[0] ?? null;
  });
  if (!user) {
    await bcrypt.compare(password, await getDummyHash());
    throw new UserError(INVALID);
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new UserError("This account is temporarily locked after repeated failed sign-ins. Try again later.");
  }
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    const failed = user.failedLogins + 1;
    await withSystem((tx) =>
      tx
        .update(users)
        .set({
          failedLogins: failed >= MAX_FAILED ? 0 : failed,
          lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null,
        })
        .where(eq(users.id, user.id)),
    );
    throw new UserError(INVALID);
  }
  return withSystem(async (tx) => {
    await tx.update(users).set({ failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() }).where(eq(users.id, user.id));
    const [m] = await tx
      .select({ orgId: memberships.organizationId })
      .from(memberships)
      .where(and(eq(memberships.userId, user.id), eq(memberships.isActive, true)))
      .orderBy(desc(memberships.createdAt))
      .limit(1);
    if (!m) throw new UserError("Your account isn't active in any organization. Contact your administrator.");
    return { userId: user.id, orgId: m.orgId };
  });
}

export async function userOrganizations(userId: string) {
  return withSystem((tx) =>
    tx
      .select({ id: organizations.id, name: organizations.name, role: memberships.role })
      .from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
      .where(and(eq(memberships.userId, userId), eq(memberships.isActive, true)))
      .orderBy(organizations.name),
  );
}

export async function isMember(userId: string, orgId: string) {
  const rows = await withSystem((tx) =>
    tx
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.userId, userId), eq(memberships.organizationId, orgId), eq(memberships.isActive, true)))
      .limit(1),
  );
  return rows.length > 0;
}

export async function findInvitation(token: string) {
  return withSystem(async (tx) => {
    const rows = await tx
      .select({
        id: invitations.id,
        email: invitations.email,
        name: invitations.name,
        role: invitations.role,
        orgId: invitations.organizationId,
        orgName: organizations.name,
        expiresAt: invitations.expiresAt,
      })
      .from(invitations)
      .innerJoin(organizations, eq(organizations.id, invitations.organizationId))
      .where(and(eq(invitations.tokenHash, sha256(token)), isNull(invitations.acceptedAt)))
      .limit(1);
    const inv = rows[0];
    return inv && inv.expiresAt > new Date() ? inv : null;
  });
}

export const acceptSchema = z.object({
  token: z.string().min(20).max(200),
  name: z.string().trim().min(2, "Enter your full name").max(100),
  password: passwordSchema,
});

export async function acceptInvitation(input: z.infer<typeof acceptSchema>) {
  const data = acceptSchema.parse(input);
  const inv = await findInvitation(data.token);
  if (!inv) throw new UserError("This invitation is invalid or has expired. Ask your admin for a new one.");
  const passwordHash = await hashPassword(data.password);
  return withSystem(async (tx) => {
    const existing = await tx.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${inv.email.toLowerCase()}`).limit(1);
    let userId = existing[0]?.id;
    if (!userId) {
      const [u] = await tx.insert(users).values({ email: inv.email.toLowerCase(), name: data.name, passwordHash }).returning({ id: users.id });
      userId = u.id;
    } else {
      // Existing account: the invitation proves email ownership only if they also know the password.
      throw new UserError("You already have an Oikos account. Sign in with it and open this invitation link again.");
    }
    await tx
      .insert(memberships)
      .values({ organizationId: inv.orgId, userId, role: inv.role as Role })
      .onConflictDoUpdate({ target: [memberships.organizationId, memberships.userId], set: { isActive: true, role: inv.role as Role } });
    await tx.update(invitations).set({ acceptedAt: new Date() }).where(eq(invitations.id, inv.id));
    await tx.insert(auditLogs).values({ organizationId: inv.orgId, userId, action: "invitation.accepted", entityType: "user", entityId: userId });
    return { userId, orgId: inv.orgId };
  });
}

/** For a signed-in user opening an invitation addressed to their email. */
export async function joinWithInvitation(token: string, userId: string, userEmail: string) {
  const inv = await findInvitation(token);
  if (!inv) throw new UserError("This invitation is invalid or has expired.");
  if (inv.email.toLowerCase() !== userEmail.toLowerCase()) {
    throw new UserError("This invitation was sent to a different email address.");
  }
  await withSystem(async (tx) => {
    await tx
      .insert(memberships)
      .values({ organizationId: inv.orgId, userId, role: inv.role as Role })
      .onConflictDoUpdate({ target: [memberships.organizationId, memberships.userId], set: { isActive: true, role: inv.role as Role } });
    await tx.update(invitations).set({ acceptedAt: new Date() }).where(eq(invitations.id, inv.id));
  });
  return { orgId: inv.orgId };
}
