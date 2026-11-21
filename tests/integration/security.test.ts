import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withSystem, withTenant, type TenantCtx } from "@/lib/db/tenant";
import { integrations, users } from "@/lib/db/schema";
import { authenticate, signup } from "@/lib/services/accounts";
import { rateLimit } from "@/lib/security/rate-limit";
import { saveIntegration, getIntegrations, webhookIntegration } from "@/lib/services/capture";
import { createLead, listLeads } from "@/lib/services/leads";
import { createRule } from "@/lib/services/automation";
import { auditLog, changeRole, members, setMemberActive } from "@/lib/services/org";

let A: TenantCtx;

beforeAll(async () => {
  const a = await signup({ name: "Sec Owner", email: "sec@owner.test", password: "owner-pass-123", organization: "Sec Org" });
  A = { orgId: a.orgId, userId: a.userId, role: "org_admin" };
});

describe("authentication", () => {
  it("stores bcrypt hashes, never plain passwords", async () => {
    const [u] = await withSystem((tx) => tx.select({ hash: users.passwordHash }).from(users).where(eq(users.id, A.userId!)));
    expect(u.hash).toMatch(/^\$2[aby]\$12\$/);
    expect(u.hash).not.toContain("owner-pass-123");
  });

  it("rejects weak passwords and duplicate accounts", async () => {
    await expect(signup({ name: "Weak", email: "weak@x.test", password: "short", organization: "Weak Org" })).rejects.toThrow();
    await expect(signup({ name: "Dup", email: "SEC@owner.test", password: "another-pass-1", organization: "Dup Org" })).rejects.toThrow(/already exists/);
  });

  it("locks the account after 5 failed attempts", async () => {
    await signup({ name: "Lock", email: "lock@x.test", password: "lock-pass-123", organization: "Lock Org" });
    for (let i = 0; i < 5; i++) await expect(authenticate({ email: "lock@x.test", password: "bad-password" }, `ip-${i}`)).rejects.toThrow(/Invalid/);
    await expect(authenticate({ email: "lock@x.test", password: "lock-pass-123" }, "ip-x")).rejects.toThrow(/locked/);
  });

  it("does not reveal whether an email exists", async () => {
    await expect(authenticate({ email: "nobody@x.test", password: "whatever-1" }, "ip-y")).rejects.toThrow("Invalid email or password.");
  });
});

describe("rate limiting", () => {
  it("allows up to the limit within a window", async () => {
    const key = `t:${Math.random()}`;
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await rateLimit(key, 3, 60));
    expect(results).toEqual([true, true, true, false]);
  });
});

describe("integration secrets", () => {
  it("are encrypted at rest and never returned to the client", async () => {
    await withTenant(A, (tx) => saveIntegration(tx, A, "whatsapp", { phoneNumberId: "111" }, { accessToken: "EAAG-super-secret", appSecret: "app-secret" }));
    const [row] = await withSystem((tx) => tx.select().from(integrations).where(eq(integrations.organizationId, A.orgId)));
    expect(row.secretsEnc).not.toContain("EAAG-super-secret");
    const view = await withTenant(A, (tx) => getIntegrations(tx));
    expect(JSON.stringify(view)).not.toContain("EAAG-super-secret");
    expect(view.whatsapp?.secretFlags.accessToken).toBe(true);
    const wh = await webhookIntegration(row.id, "whatsapp");
    expect(wh?.orgId).toBe(A.orgId);
    expect(await webhookIntegration(row.id, "meta_leads")).toBeNull();
  });
});

describe("authorization", () => {
  it("blocks executives from admin operations even when calling services directly", async () => {
    const exec: TenantCtx = { ...A, role: "sales_executive" };
    await expect(withTenant(exec, (tx) => createRule(tx, exec, { name: "x", trigger: "lead_created", action: "notify_owner" }))).rejects.toThrow(/permission/);
    await expect(withTenant(exec, (tx) => auditLog(tx, exec))).rejects.toThrow(/permission/);
    const marketing: TenantCtx = { ...A, role: "marketing_manager" };
    await expect(withTenant(marketing, (tx) => saveIntegration(tx, { ...marketing, role: "sales_manager" }, "whatsapp", {}, {}))).rejects.toThrow(/permission/);
  });

  it("keeps at least one admin and prevents self-deactivation", async () => {
    const team = await withTenant(A, (tx) => members(tx));
    const me = team.find((m) => m.userId === A.userId)!;
    await expect(withTenant(A, (tx) => changeRole(tx, A, me.membershipId, "sales_manager"))).rejects.toThrow(/at least one admin/);
    await expect(withTenant(A, (tx) => setMemberActive(tx, A, me.membershipId, false))).rejects.toThrow(/yourself/);
  });

  it("treats SQL metacharacters in search as plain text", async () => {
    await withTenant(A, (tx) => createLead(tx, A, { name: "Robert'); DROP TABLE leads;--", phone: "9000044444" }));
    const r = await withTenant(A, (tx) => listLeads(tx, A, { q: "'); DROP TABLE" }));
    expect(r.total).toBe(1);
    const all = await withTenant(A, (tx) => listLeads(tx, A, { q: "%" }));
    expect(all.total).toBe(0); // % is escaped, not a wildcard
  });
});
