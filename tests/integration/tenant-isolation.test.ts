import { beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { withSystem, withTenant, type TenantCtx } from "@/lib/db/tenant";
import { leads, projects, users } from "@/lib/db/schema";
import { signup } from "@/lib/services/accounts";

let A: TenantCtx;
let B: TenantCtx;

beforeAll(async () => {
  const a = await signup({ name: "Asha Rao", email: "asha@alpha.test", password: "alpha-pass-123", organization: "Alpha Builders" });
  const b = await signup({ name: "Bilal Khan", email: "bilal@beta.test", password: "beta-pass-1234", organization: "Beta Homes" });
  A = { orgId: a.orgId, userId: a.userId, role: "org_admin" };
  B = { orgId: b.orgId, userId: b.userId, role: "org_admin" };
  await withTenant(A, (tx) => tx.insert(leads).values({ organizationId: A.orgId, name: "Alpha Lead" }));
  await withTenant(B, (tx) => tx.insert(leads).values({ organizationId: B.orgId, name: "Beta Lead" }));
});

describe("database-enforced tenant isolation (row-level security)", () => {
  it("returns only the current organization's rows even without a WHERE clause", async () => {
    const seenByA = await withTenant(A, (tx) => tx.select({ name: leads.name }).from(leads));
    const seenByB = await withTenant(B, (tx) => tx.select({ name: leads.name }).from(leads));
    expect(seenByA.map((r) => r.name)).toEqual(["Alpha Lead"]);
    expect(seenByB.map((r) => r.name)).toEqual(["Beta Lead"]);
  });

  it("cannot read another organization's lead by id (IDOR)", async () => {
    const [betaLead] = await withSystem((tx) => tx.select({ id: leads.id }).from(leads).where(eq(leads.name, "Beta Lead")));
    const rows = await withTenant(A, (tx) => tx.select().from(leads).where(eq(leads.id, betaLead.id)));
    expect(rows).toHaveLength(0);
  });

  it("cannot update or delete another organization's rows", async () => {
    const [betaLead] = await withSystem((tx) => tx.select({ id: leads.id }).from(leads).where(eq(leads.name, "Beta Lead")));
    const updated = await withTenant(A, (tx) => tx.update(leads).set({ name: "hacked" }).where(eq(leads.id, betaLead.id)).returning());
    const deleted = await withTenant(A, (tx) => tx.delete(leads).where(eq(leads.id, betaLead.id)).returning());
    expect(updated).toHaveLength(0);
    expect(deleted).toHaveLength(0);
    const [still] = await withSystem((tx) => tx.select({ name: leads.name }).from(leads).where(eq(leads.id, betaLead.id)));
    expect(still.name).toBe("Beta Lead");
  });

  it("rejects inserting rows tagged with another organization", async () => {
    await expect(
      withTenant(A, (tx) => tx.insert(projects).values({ organizationId: B.orgId, name: "x", location: "y", propertyType: "apartment" })),
    ).rejects.toThrow();
  });

  it("cannot move a row into another organization", async () => {
    const [alphaLead] = await withSystem((tx) => tx.select({ id: leads.id }).from(leads).where(eq(leads.name, "Alpha Lead")));
    await expect(
      withTenant(A, (tx) => tx.update(leads).set({ organizationId: B.orgId }).where(eq(leads.id, alphaLead.id))),
    ).rejects.toThrow();
  });

  it("never exposes password hashes inside a tenant transaction", async () => {
    const err = await withTenant(A, (tx) => tx.execute(sql`select password_hash from users`)).catch((e) => e);
    expect(String(err?.cause?.message ?? err)).toMatch(/permission denied/);
    const visible = await withTenant(A, (tx) => tx.select({ id: users.id, email: users.email }).from(users));
    expect(visible.map((u) => u.email)).toEqual(["asha@alpha.test"]);
  });

  it("sees no tenant data when no organization is set", async () => {
    const rows = await withSystem(async (tx) => {
      await tx.execute(sql`select set_config('role', 'oikos_app', true)`);
      return tx.select({ id: leads.id }).from(leads);
    });
    expect(rows).toHaveLength(0);
  });
});
