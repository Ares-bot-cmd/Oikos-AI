import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = await getDb();
    await db.execute(sql`select 1`);
    return NextResponse.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[health]", e);
    return NextResponse.json({ status: "error" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
