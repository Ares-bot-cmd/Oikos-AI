/**
 * Applies database migrations. Runs during the Vercel build (`vercel-build`), so schema
 * changes never happen inside a request. Uses the direct (non-pooled) connection because
 * advisory locks and DDL need a real session.
 */
import "dotenv/config";
import path from "node:path";
import { Client } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const url = (
  process.env.DATABASE_URL_UNPOOLED ||
  process.env.POSTGRES_URL_NON_POOLING ||
  process.env.DATABASE_URL ||
  ""
).trim();

async function main() {
  if (!url) {
    if (process.env.VERCEL_ENV === "production") {
      throw new Error("No DATABASE_URL configured for the production build.");
    }
    console.log("[migrate] No DATABASE_URL — skipping (local dev uses embedded PGlite).");
    return;
  }
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 15_000 });
  await client.connect();
  try {
    await client.query("SET lock_timeout = '20s'");
    await client.query("SELECT pg_advisory_lock(727274)");

    // One-time cleanup of the retired Python/Alembic schema, which used conflicting table names.
    const legacy = await client.query("SELECT to_regclass('public.alembic_version') AS t");
    if (legacy.rows[0]?.t) {
      console.log("[migrate] Removing the legacy (Alembic) schema before the first migration…");
      await client.query("DROP SCHEMA public CASCADE");
      await client.query("CREATE SCHEMA public");
      await client.query("GRANT USAGE ON SCHEMA public TO PUBLIC");
    }

    await migrate(drizzle(client), { migrationsFolder: path.join(process.cwd(), "drizzle") });
    console.log("[migrate] Database is up to date.");
  } finally {
    await client.query("SELECT pg_advisory_unlock(727274)").catch(() => {});
    await client.end();
  }
}

main().catch((err) => {
  console.error("[migrate] failed:", err);
  process.exit(1);
});
