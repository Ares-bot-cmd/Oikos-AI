import "server-only";
import { and, asc, eq, gte, lt } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import type { TenantCtx } from "@/lib/db/tenant";
import { campaigns, followUps, leads, projects, users } from "@/lib/db/schema";
import { assertCan, can } from "@/lib/auth/permissions";
import { formatPercent, isoDate } from "@/lib/utils";
import { executivePerformance, funnel, projectPerformance } from "./analytics";
import { campaignMetrics, sourceMetrics } from "./marketing";
import { listBookings } from "./bookings";
import { revenueBreakdown, revenueSummary } from "./revenue";
import { SOURCE_LABELS, STAGE_LABELS } from "./leads";

export const REPORTS = {
  lead_acquisition: { title: "Lead acquisition", description: "Every lead created in the period with source, campaign, project, owner and current stage." },
  lead_conversion: { title: "Lead conversion", description: "Cohort funnel and conversion by lead source." },
  sales_performance: { title: "Sales performance", description: "Leads, calls, follow-ups, visits, bookings, revenue and targets by executive." },
  marketing_roi: { title: "Marketing ROI", description: "Spend, leads, bookings, cost per lead / booking and ROI by campaign." },
  project_performance: { title: "Project performance", description: "Leads, visits, bookings, revenue and absorption by project." },
  revenue: { title: "Revenue", description: "Booked revenue, collections, receivables and revenue by project." },
  bookings: { title: "Bookings", description: "All bookings in the period with value and amount received." },
  follow_up_activity: { title: "Follow-up activity", description: "Follow-ups due in the period with status, outcome and assignee." },
} as const;
export type ReportType = keyof typeof REPORTS;

export type ReportTable = { title: string; subtitle: string; headers: string[]; rows: (string | number | null)[][]; summary?: { label: string; value: string }[] };

const n2 = (v: number | null | undefined) => (v == null ? null : Math.round(v * 100) / 100);

export async function buildReport(tx: Tx, ctx: TenantCtx, type: ReportType, from: Date, to: Date): Promise<ReportTable> {
  assertCan(ctx.role, "reports:read");
  const subtitle = `${isoDate(from)} to ${isoDate(new Date(to.getTime() - 1))}`;
  const title = REPORTS[type].title;
  switch (type) {
    case "lead_acquisition": {
      const rows = await tx
        .select({ name: leads.name, phone: leads.phone, email: leads.email, source: leads.source, campaign: campaigns.name, project: projects.name, owner: users.name, stage: leads.stage, score: leads.score, intent: leads.intent, createdAt: leads.createdAt })
        .from(leads)
        .leftJoin(campaigns, eq(campaigns.id, leads.campaignId))
        .leftJoin(projects, eq(projects.id, leads.projectId))
        .leftJoin(users, eq(users.id, leads.ownerId))
        .where(and(gte(leads.createdAt, from), lt(leads.createdAt, to)))
        .orderBy(asc(leads.createdAt))
        .limit(20000);
      return {
        title, subtitle,
        headers: ["Created", "Name", "Phone", "Email", "Source", "Campaign", "Project", "Owner", "Stage", "Score", "Intent"],
        rows: rows.map((r) => [r.createdAt.toISOString().slice(0, 16).replace("T", " "), r.name, r.phone, r.email, SOURCE_LABELS[r.source], r.campaign, r.project, r.owner, STAGE_LABELS[r.stage], r.score, r.intent]),
        summary: [{ label: "Leads", value: String(rows.length) }],
      };
    }
    case "lead_conversion": {
      const f = await funnel(tx, ctx, from, to);
      const s = await sourceMetrics(tx, from, to);
      return {
        title, subtitle,
        headers: ["Group", "Step / source", "Leads", "Qualified", "Booked", "Rate"],
        rows: [
          ...f.map((x) => ["Funnel", x.label, x.value, null, null, x.stepRate == null ? "—" : formatPercent(x.stepRate)]),
          ...s.map((x) => ["Source", SOURCE_LABELS[x.source as keyof typeof SOURCE_LABELS] ?? x.source, x.leads, x.qualified, x.booked, formatPercent(x.conversion)]),
        ],
      };
    }
    case "sales_performance": {
      const rows = await executivePerformance(tx, ctx, from, to);
      return {
        title, subtitle,
        headers: ["Executive", "Leads", "Contacted", "Calls", "Follow-ups done", "Overdue", "Visits", "Bookings", "Revenue", "Conversion", "Avg response (h)", "Target attainment"],
        rows: rows.map((r) => [r.name, r.leads, r.contacted, r.calls, r.followUpsDone, r.overdueFollowUps, r.visits, r.bookings, n2(r.revenue), formatPercent(r.conversion), n2(r.avgResponseHours), r.targetAttainment == null ? "—" : formatPercent(r.targetAttainment)]),
      };
    }
    case "marketing_roi": {
      assertCan(ctx.role, "marketing:read");
      const rows = await campaignMetrics(tx, from, to);
      const spend = rows.reduce((s, r) => s + r.spend, 0);
      const revenue = rows.reduce((s, r) => s + r.revenue, 0);
      return {
        title, subtitle,
        headers: ["Campaign", "Channel", "Project", "Spend", "Leads", "Qualified", "Visits", "Bookings", "Revenue", "CPL", "Cost / booking", "ROI"],
        rows: rows.map((r) => [r.name, r.channel, r.projectName, n2(r.spend), r.leads, r.qualified, r.visits, r.bookings, n2(r.revenue), n2(r.cpl), n2(r.cpb), r.roi == null ? "—" : formatPercent(r.roi)]),
        summary: [{ label: "Total spend", value: spend.toFixed(0) }, { label: "Attributed revenue", value: revenue.toFixed(0) }, { label: "ROI", value: spend ? formatPercent((revenue - spend) / spend) : "—" }],
      };
    }
    case "project_performance": {
      const rows = await projectPerformance(tx, from, to);
      return {
        title, subtitle,
        headers: ["Project", "Location", "Leads", "Visits", "Bookings", "Revenue", "Lead→booking", "Units", "Available", "Sold", "Absorption"],
        rows: rows.map((r) => [r.name, r.location, r.leads, r.visits, r.bookings, n2(r.revenue), formatPercent(r.conversion), r.units, r.available, r.sold, formatPercent(r.absorption)]),
      };
    }
    case "revenue": {
      assertCan(ctx.role, "revenue:read");
      const s = await revenueSummary(tx, ctx, from, to);
      const by = await revenueBreakdown(tx, ctx, "project", from, to);
      return {
        title, subtitle,
        headers: ["Project", "Bookings", "Booked revenue", "Collected to date"],
        rows: by.map((r) => [r.key, r.bookings, n2(r.revenue), n2(r.collected)]),
        summary: [
          { label: "Booked revenue (actual)", value: s.booked.toFixed(0) }, { label: "Collections in period", value: s.collected.toFixed(0) },
          { label: "Outstanding receivables", value: s.outstanding.toFixed(0) }, { label: "Overdue", value: s.overdue.toFixed(0) },
          { label: "Cancelled value", value: s.cancelledValue.toFixed(0) },
        ],
      };
    }
    case "bookings": {
      const { rows } = await listBookings(tx, ctx, { from, to, limit: 10000, sort: "date", dir: "asc" });
      return {
        title, subtitle,
        headers: ["Date", "Customer", "Project", "Unit", "Agreement value", "Received", "Outstanding", "Status", "Sales executive"],
        rows: rows.map((r) => [r.bookingDate, r.customerName, r.projectName, `${r.tower ? r.tower + "-" : ""}${r.unitNumber}`, n2(r.agreementValue), n2(r.paid), n2(Math.max(0, r.agreementValue - r.paid)), r.status, r.salesName]),
      };
    }
    case "follow_up_activity": {
      const rows = await tx
        .select({ dueAt: followUps.dueAt, type: followUps.type, status: followUps.status, outcome: followUps.outcome, completedAt: followUps.completedAt, lead: leads.name, assignee: users.name })
        .from(followUps)
        .innerJoin(leads, eq(leads.id, followUps.leadId))
        .leftJoin(users, eq(users.id, followUps.assignedToId))
        .where(and(gte(followUps.dueAt, from), lt(followUps.dueAt, to), can(ctx.role, "leads:read_all") ? undefined : eq(followUps.assignedToId, ctx.userId!)))
        .orderBy(asc(followUps.dueAt))
        .limit(20000);
      const overdue = rows.filter((r) => r.status === "pending" && r.dueAt < new Date()).length;
      return {
        title, subtitle,
        headers: ["Due", "Lead", "Type", "Assignee", "Status", "Outcome", "Completed"],
        rows: rows.map((r) => [r.dueAt.toISOString().slice(0, 16).replace("T", " "), r.lead, r.type, r.assignee, r.status === "pending" && r.dueAt < new Date() ? "overdue" : r.status, r.outcome, r.completedAt?.toISOString().slice(0, 16).replace("T", " ") ?? null]),
        summary: [{ label: "Follow-ups", value: String(rows.length) }, { label: "Done", value: String(rows.filter((r) => r.status === "done").length) }, { label: "Overdue", value: String(overdue) }],
      };
    }
  }
}

/** Renders a report as a simple, paginated landscape PDF table (Helvetica, A4). */
export async function reportPdf(report: ReportTable, orgName: string): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 842, H = 595, M = 32;
  const forest = rgb(0.09, 0.23, 0.18), muted = rgb(0.43, 0.48, 0.45), line = rgb(0.9, 0.91, 0.88);
  // WinAnsi can't encode characters like ₹ or →; replace them so the PDF always renders.
  const clean = (v: unknown) => String(v ?? "").replace(/₹/g, "Rs ").replace(/→/g, "->").replace(/[–—]/g, "-").replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
  const cols = report.headers.length;
  const colW = (W - 2 * M) / cols;
  const size = cols > 9 ? 7 : 8;
  const fit = (text: string, f = font) => {
    const full = clean(text);
    let t = full;
    while (t.length > 1 && f.widthOfTextAtSize(t === full ? t : t + "..", size) > colW - 6) t = t.slice(0, -1);
    return t === full ? t : t + "..";
  };
  let page = doc.addPage([W, H]);
  let y = H - M;
  const header = (first: boolean) => {
    if (first) {
      page.drawText(clean(orgName), { x: M, y, size: 9, font, color: muted });
      y -= 18;
      page.drawText(clean(report.title), { x: M, y, size: 16, font: bold, color: forest });
      y -= 14;
      page.drawText(clean(report.subtitle) + `  ·  generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`, { x: M, y, size: 8.5, font, color: muted });
      y -= 16;
      if (report.summary?.length) {
        page.drawText(clean(report.summary.map((s) => `${s.label}: ${s.value}`).join("   |   ")), { x: M, y, size: 8.5, font: bold, color: forest });
        y -= 16;
      }
    }
    page.drawRectangle({ x: M, y: y - 4, width: W - 2 * M, height: 15, color: rgb(0.96, 0.95, 0.93) });
    report.headers.forEach((h, i) => page.drawText(fit(h, bold), { x: M + i * colW + 3, y, size, font: bold, color: forest }));
    y -= 15;
  };
  header(true);
  if (!report.rows.length) page.drawText("No data for this period.", { x: M, y: y - 4, size: 9, font, color: muted });
  for (const row of report.rows) {
    if (y < M + 14) {
      page = doc.addPage([W, H]);
      y = H - M;
      header(false);
    }
    row.forEach((v, i) => page.drawText(fit(typeof v === "number" ? v.toLocaleString("en-IN") : String(v ?? "")), { x: M + i * colW + 3, y, size, font, color: rgb(0.15, 0.17, 0.15) }));
    page.drawLine({ start: { x: M, y: y - 4 }, end: { x: W - M, y: y - 4 }, thickness: 0.4, color: line });
    y -= 13;
  }
  const pages = doc.getPages();
  pages.forEach((p, i) => p.drawText(`Page ${i + 1} of ${pages.length}`, { x: W - M - 60, y: 16, size: 7.5, font, color: muted }));
  return doc.save();
}

