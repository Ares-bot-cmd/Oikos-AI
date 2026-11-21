// Each test file gets its own in-memory Postgres (PGlite), migrated from ./drizzle.
process.env.PGLITE_DIR = "memory://";
delete (globalThis as { __oikosDb?: unknown }).__oikosDb;
