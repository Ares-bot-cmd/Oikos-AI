import "server-only";
import path from "node:path";
import { drizzle as drizzlePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

export type DB = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
export type Executor = DB | Tx;

type Holder = { db?: DB; ready?: Promise<void> };
const g = globalThis as unknown as { __oikosDb?: Holder };
const holder: Holder = (g.__oikosDb ??= {});

export const MIGRATIONS_DIR = path.join(process.cwd(), "drizzle");

function databaseUrl() {
  return (process.env.DATABASE_URL || process.env.POSTGRES_URL || "").trim();
}

async function createDb(): Promise<{ db: DB; ready: Promise<void> }> {
  const url = databaseUrl();
  if (url) {
    const { Pool } = await import("pg");
    const pool = new Pool({
      connectionString: url,
      max: Number(process.env.DB_POOL_MAX || 5),
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
    });
    return { db: drizzlePg(pool, { schema }), ready: Promise.resolve() };
  }
  if (process.env.NODE_ENV === "production" && process.env.VERCEL) {
    throw new Error("DATABASE_URL must be set in production.");
  }
  // Local development and tests: embedded Postgres (PGlite), migrated on first use.
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const dir = process.env.PGLITE_DIR || path.join(process.cwd(), ".data", "pglite");
  const client = dir === "memory://" ? new PGlite() : new PGlite(dir);
  const db = drizzle(client, { schema });
  const ready = migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return { db: db as unknown as DB, ready };
}

let creating: Promise<DB> | undefined;

/** Returns the shared database handle (connected and migrated). */
export async function getDb(): Promise<DB> {
  if (holder.db) {
    await holder.ready;
    return holder.db;
  }
  creating ??= createDb().then(({ db, ready }) => {
    holder.db = db;
    holder.ready = ready;
    return ready.then(() => db);
  });
  return creating;
}

export { schema };
