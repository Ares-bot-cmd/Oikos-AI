import { NextResponse, type NextRequest } from "next/server";
import { safeEqual } from "@/lib/security/crypto";
import { sweepAll } from "@/lib/services/sweep";

export const maxDuration = 300;

/** Scheduled sweep (Vercel Cron sends `Authorization: Bearer $CRON_SECRET`). */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || !safeEqual(auth, `Bearer ${secret}`)) return new NextResponse("Unauthorized", { status: 401 });
  const results = await sweepAll();
  return NextResponse.json({ ok: true, organizations: Object.keys(results).length });
}
