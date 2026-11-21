// Starts `next start` against a freshly created embedded database for end-to-end tests.
import { rmSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";

const port = process.argv[2] ?? "3200";
const dir = path.join(process.cwd(), ".data", "e2e-pglite");
rmSync(dir, { recursive: true, force: true });

const env = {
  ...process.env,
  DATABASE_URL: "",
  POSTGRES_URL: "",
  PGLITE_DIR: dir,
  SECRET_KEY: "e2e-secret-key-not-for-production-0123456789",
  CRON_SECRET: "e2e-cron-secret",
  ANTHROPIC_API_KEY: "",
  RATE_LIMIT_MULTIPLIER: "50",
  APP_URL: `http://localhost:${port}`,
};
const child = spawn(process.execPath, [path.join("node_modules", "next", "dist", "bin", "next"), "start", "-p", port], { env, stdio: "inherit" });
const stop = () => child.kill();
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("exit", (code) => process.exit(code ?? 0));
