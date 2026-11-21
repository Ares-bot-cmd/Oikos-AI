// Writes the row-level-security migration for every table in TENANT_TABLES (src/lib/db/schema.ts).
// Usage: node scripts/gen-rls.mjs drizzle/<NNNN>_tenant_rls.sql
import fs from "node:fs";

const out = process.argv[2];
if (!out) throw new Error("Pass the target migration file");
const src = fs.readFileSync("src/lib/db/schema.ts", "utf8");
const tables = src
  .match(/TENANT_TABLES = \[([\s\S]*?)\]/)[1]
  .match(/"([a-z_]+)"/g)
  .map((s) => s.slice(1, -1));

const B = "\n--> statement-breakpoint\n";
const s = [];
s.push(`-- Row-level security: every tenant table is readable/writable by the restricted
-- oikos_app role only for rows of the organization set in app.org_id. Application
-- requests run inside a transaction that switches to oikos_app (src/lib/db/tenant.ts).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'oikos_app') THEN
    CREATE ROLE oikos_app NOLOGIN;
  END IF;
END $$`);
s.push(`DO $$ BEGIN
  EXECUTE format('GRANT oikos_app TO %I', current_user);
EXCEPTION WHEN others THEN
  RAISE NOTICE 'could not grant oikos_app to %: %', current_user, SQLERRM;
END $$`);
s.push(`CREATE OR REPLACE FUNCTION app_org_id() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.org_id', true), '')::uuid
$$`);
s.push(`GRANT USAGE ON SCHEMA public TO oikos_app`);
s.push(`GRANT EXECUTE ON FUNCTION app_org_id() TO oikos_app`);
for (const t of tables) {
  s.push(`ALTER TABLE "${t}" ENABLE ROW LEVEL SECURITY`);
  s.push(`CREATE POLICY "${t}_tenant_isolation" ON "${t}" TO oikos_app USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id())`);
  s.push(`GRANT SELECT, INSERT, UPDATE, DELETE ON "${t}" TO oikos_app`);
}
s.push(`ALTER TABLE "organizations" ENABLE ROW LEVEL SECURITY`);
s.push(`CREATE POLICY "organizations_self" ON "organizations" TO oikos_app USING (id = app_org_id()) WITH CHECK (id = app_org_id())`);
s.push(`GRANT SELECT, UPDATE ON "organizations" TO oikos_app`);
s.push(`ALTER TABLE "users" ENABLE ROW LEVEL SECURITY`);
s.push(`CREATE POLICY "users_same_org" ON "users" TO oikos_app USING (EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = users.id AND m.organization_id = app_org_id()))`);
s.push(`-- Password hashes and lockout state are never readable from a tenant transaction.
GRANT SELECT ("id", "email", "name", "created_at", "last_login_at") ON "users" TO oikos_app`);
fs.writeFileSync(out, s.join(";" + B) + ";\n");
console.log(`RLS for ${tables.length} tenant tables → ${out}`);
