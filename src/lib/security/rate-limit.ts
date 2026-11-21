import "server-only";
import { sql } from "drizzle-orm";
import { withSystem } from "@/lib/db/tenant";

/**
 * Fixed-window rate limiter backed by Postgres, so limits hold across serverless instances.
 * Returns true when the request is allowed.
 */
// Test environments (many sign-ups from one IP) can scale limits up; production uses the defaults.
const MULTIPLIER = Math.max(1, Number(process.env.RATE_LIMIT_MULTIPLIER || 1));

export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  limit = limit * MULTIPLIER;
  const now = Date.now();
  const windowStart = new Date(Math.floor(now / (windowSeconds * 1000)) * windowSeconds * 1000);
  const count = await withSystem(async (tx) => {
    const res = await tx.execute<{ count: number }>(sql`
      insert into rate_limits (key, window_start, count) values (${key}, ${windowStart.toISOString()}, 1)
      on conflict (key, window_start) do update set count = rate_limits.count + 1
      returning count`);
    // Opportunistic cleanup of old windows.
    if (Math.random() < 0.02) {
      await tx.execute(sql`delete from rate_limits where window_start < now() - interval '1 day'`);
    }
    return Number(res.rows[0]?.count ?? 0);
  });
  return count <= limit;
}

export class RateLimitError extends Error {
  constructor(message = "Too many attempts. Please wait a moment and try again.") {
    super(message);
    this.name = "RateLimitError";
  }
}
