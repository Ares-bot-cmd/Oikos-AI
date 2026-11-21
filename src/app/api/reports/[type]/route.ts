import { NextResponse, type NextRequest } from "next/server";
import { ctxOf, getSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { withTenant } from "@/lib/db/tenant";
import { ForbiddenError } from "@/lib/auth/permissions";
import { dateRange } from "@/lib/list-params";
import { buildReport, REPORTS, reportPdf, type ReportType } from "@/lib/services/reports";
import { audit } from "@/lib/services/audit";
import { toCsv } from "@/lib/utils";

export async function GET(req: NextRequest, { params }: { params: Promise<{ type: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(session.role, "reports:read")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { type } = await params;
  if (!(type in REPORTS)) return NextResponse.json({ error: "Unknown report" }, { status: 404 });
  const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
  const format = sp.format === "pdf" ? "pdf" : "csv";
  const { current } = dateRange(sp, "30d");
  const ctx = ctxOf(session);
  try {
    const report = await withTenant(ctx, async (tx) => {
      const r = await buildReport(tx, ctx, type as ReportType, current.from, current.to);
      await audit(tx, ctx, "report.downloaded", { type: "report", id: type }, { format, from: current.from, to: current.to });
      return r;
    });
    const filename = `${type.replace(/_/g, "-")}-${new Date().toISOString().slice(0, 10)}.${format}`;
    const headers = { "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store" };
    if (format === "pdf") {
      const bytes = await reportPdf(report, session.orgName);
      return new NextResponse(Buffer.from(bytes), { headers: { ...headers, "Content-Type": "application/pdf" } });
    }
    const summary = report.summary?.length ? toCsv(["Summary", "Value"], report.summary.map((s) => [s.label, s.value])) + "\r\n" : "";
    return new NextResponse("﻿" + summary + toCsv(report.headers, report.rows), { headers: { ...headers, "Content-Type": "text/csv; charset=utf-8" } });
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    console.error("[report]", e);
    return NextResponse.json({ error: "Could not generate the report" }, { status: 500 });
  }
}
