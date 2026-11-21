import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { captureLead, captureSchema, resolveApiKey } from "@/lib/services/capture";
import { rateLimit } from "@/lib/security/rate-limit";
import { UserError } from "@/lib/errors";
import { sha256 } from "@/lib/security/crypto";

const MAX_BYTES = 32 * 1024;

/** Lead capture API. Auth: `Authorization: Bearer ok_live_…`. */
export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const key = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  const orgId = await resolveApiKey(key);
  if (!orgId) return NextResponse.json({ error: "Invalid or missing API key" }, { status: 401, headers: { "WWW-Authenticate": "Bearer" } });
  if (!(await rateLimit(`api:${sha256(key!)}`, 120, 60))) {
    return NextResponse.json({ error: "Rate limit exceeded (120 requests per minute)" }, { status: 429, headers: { "Retry-After": "60" } });
  }
  if (!req.headers.get("content-type")?.includes("application/json")) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }
  const raw = await req.text();
  if (raw.length > MAX_BYTES) return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = captureSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }, { status: 422 });
  }
  try {
    const r = await captureLead(orgId, parsed.data, "api", "Lead received via API");
    return NextResponse.json({ id: r.id, merged: r.merged }, { status: r.merged ? 200 : 201 });
  } catch (e) {
    if (e instanceof UserError || e instanceof z.ZodError) return NextResponse.json({ error: e.message }, { status: 422 });
    console.error("[api/v1/leads]", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
