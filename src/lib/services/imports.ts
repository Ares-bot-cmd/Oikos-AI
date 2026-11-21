import "server-only";
import Papa from "papaparse";
import type { Tx } from "@/lib/db";
import type { TenantCtx } from "@/lib/db/tenant";
import { assertCan } from "@/lib/auth/permissions";
import { UserError } from "@/lib/errors";
import { campaigns, projects } from "@/lib/db/schema";
import { createLead, DuplicateLeadError, findDuplicates, leadInputSchema, orgScoringStats, SOURCES, TIMELINES, updateLead, getLead } from "./leads";
import { audit } from "./audit";

export const MAX_IMPORT_BYTES = 4 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 2000;

/** Recognised header names (normalised) for each lead field. */
const HEADER_MAP: Record<string, string> = {
  name: "name", full_name: "name", customer_name: "name", lead_name: "name", customer: "name",
  phone: "phone", mobile: "phone", phone_number: "phone", mobile_number: "phone", contact_number: "phone", whatsapp: "phone",
  email: "email", email_address: "email", e_mail: "email",
  budget: "budgetMax", budget_max: "budgetMax", max_budget: "budgetMax", budget_min: "budgetMin", min_budget: "budgetMin",
  location: "preferredLocation", preferred_location: "preferredLocation", city: "preferredLocation", locality: "preferredLocation",
  property_type: "propertyType", type: "propertyType", configuration: "configuration", bhk: "configuration", unit_type: "configuration",
  timeline: "timeline", purchase_timeline: "timeline", project: "project", project_name: "project", campaign: "campaign", campaign_name: "campaign",
  source: "source", lead_source: "source", notes: "notes", remarks: "notes", comments: "notes", tags: "tags",
};

const norm = (h: string) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

/** Validates and parses an uploaded CSV/XLSX file into header→value rows. */
export async function parseLeadFile(file: File): Promise<Record<string, string>[]> {
  if (!file || file.size === 0) throw new UserError("Choose a file to import.");
  if (file.size > MAX_IMPORT_BYTES) throw new UserError("Files must be 4 MB or smaller.");
  const name = file.name.toLowerCase();
  const buf = Buffer.from(await file.arrayBuffer());
  let rows: Record<string, string>[];
  if (name.endsWith(".csv")) {
    const text = buf.toString("utf8").replace(/^﻿/, "");
    const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: "greedy", transformHeader: norm });
    rows = parsed.data;
  } else if (name.endsWith(".xlsx")) {
    // ZIP magic number check: an .xlsx must be a zip container.
    if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) throw new UserError("This doesn't look like a valid .xlsx file.");
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    if (!ws) throw new UserError("The workbook has no sheets.");
    const headers: string[] = [];
    rows = [];
    ws.eachRow({ includeEmpty: false }, (row, i) => {
      const values = (row.values as unknown[]).slice(1).map((v) => {
        if (v == null) return "";
        if (v instanceof Date) return v.toISOString().slice(0, 10);
        if (typeof v === "object" && v && "text" in v) return String((v as { text: unknown }).text);
        if (typeof v === "object" && v && "result" in v) return String((v as { result: unknown }).result ?? "");
        return String(v);
      });
      if (i === 1) headers.push(...values.map(norm));
      else rows.push(Object.fromEntries(headers.map((h, j) => [h, (values[j] ?? "").trim()])));
    });
  } else {
    throw new UserError("Upload a .csv or .xlsx file.");
  }
  if (rows.length > MAX_IMPORT_ROWS) throw new UserError(`Import at most ${MAX_IMPORT_ROWS.toLocaleString("en-IN")} rows at a time.`);
  return rows;
}

function mapTimeline(v: string | undefined) {
  if (!v) return "unknown";
  const s = v.toLowerCase();
  if ((TIMELINES as readonly string[]).includes(s)) return s;
  if (/immediate|now|asap|ready/.test(s)) return "immediate";
  if (/1|2|3 ?month|quarter/.test(s)) return "within_3_months";
  if (/6 ?month|half/.test(s)) return "within_6_months";
  if (/year|later|12/.test(s)) return "later";
  return "unknown";
}

function money(v: string | undefined) {
  if (!v) return undefined;
  const s = v.toLowerCase().replace(/[,₹\s]/g, "");
  const m = s.match(/^([\d.]+)(cr|crore|l|lac|lakh|lakhs|k)?$/);
  if (!m) return undefined;
  const n = Number(m[1]);
  const mult = m[2]?.startsWith("c") ? 1e7 : m[2]?.startsWith("l") ? 1e5 : m[2] === "k" ? 1e3 : 1;
  return Number.isFinite(n) ? n * mult : undefined;
}

export type ImportResult = { created: number; updated: number; skipped: number; errors: { row: number; message: string }[] };

/**
 * Imports parsed rows. Duplicates (same phone or email) are skipped or used to update the
 * existing lead, depending on `duplicateMode`.
 */
export async function importLeads(tx: Tx, ctx: TenantCtx, rows: Record<string, string>[], duplicateMode: "skip" | "update", ownerId?: string): Promise<ImportResult> {
  assertCan(ctx.role, "leads:import");
  const result: ImportResult = { created: 0, updated: 0, skipped: 0, errors: [] };
  const projectRows = await tx.select({ id: projects.id, name: projects.name }).from(projects);
  const campaignRows = await tx.select({ id: campaigns.id, name: campaigns.name }).from(campaigns);
  const projectByName = new Map(projectRows.map((p) => [p.name.toLowerCase(), p.id]));
  const campaignByName = new Map(campaignRows.map((c) => [c.name.toLowerCase(), c.id]));
  const stats = await orgScoringStats(tx);

  for (const [i, raw] of rows.entries()) {
    const rowNo = i + 2;
    const r: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      const field = HEADER_MAP[k];
      if (field && v != null && String(v).trim() !== "" && !r[field]) r[field] = String(v).trim();
    }
    if (!r.name && !r.phone && !r.email) { result.skipped++; continue; }
    const sourceRaw = r.source?.toLowerCase().replace(/[^a-z_]/g, "_");
    const input = {
      name: r.name || r.email || r.phone || "Imported lead",
      phone: r.phone, email: r.email, budgetMin: money(r.budgetMin), budgetMax: money(r.budgetMax),
      preferredLocation: r.preferredLocation, propertyType: r.propertyType, configuration: r.configuration,
      timeline: mapTimeline(r.timeline) as (typeof TIMELINES)[number],
      projectId: r.project ? projectByName.get(r.project.toLowerCase()) : undefined,
      campaignId: r.campaign ? campaignByName.get(r.campaign.toLowerCase()) : undefined,
      source: ((SOURCES as readonly string[]).includes(sourceRaw ?? "") ? sourceRaw : "import") as (typeof SOURCES)[number],
      notes: r.notes, tags: r.tags, ownerId,
    };
    const parsed = leadInputSchema.safeParse(input);
    if (!parsed.success) {
      result.errors.push({ row: rowNo, message: parsed.error.issues[0]?.message ?? "Invalid row" });
      continue;
    }
    try {
      const dups = await findDuplicates(tx, input.phone, input.email);
      if (dups.length) {
        if (duplicateMode === "skip") { result.skipped++; continue; }
        const existing = await getLead(tx, ctx, dups[0].id).catch(() => null);
        if (!existing) { result.skipped++; continue; }
        await updateLead(tx, ctx, existing.id, {
          ...input,
          name: existing.name,
          ownerId: existing.ownerId ?? undefined,
          budgetMin: input.budgetMin ?? existing.budgetMin ?? undefined,
          budgetMax: input.budgetMax ?? existing.budgetMax ?? undefined,
          projectId: input.projectId ?? existing.projectId ?? undefined,
          campaignId: input.campaignId ?? existing.campaignId ?? undefined,
          source: existing.source,
          tags: [...existing.tags, ...(input.tags ? input.tags.split(",") : [])].join(","),
          notes: [existing.notes, input.notes].filter(Boolean).join("\n") || undefined,
        });
        result.updated++;
        continue;
      }
      await createLead(tx, ctx, input, { allowDuplicate: false, activityNote: "Imported from file", stats });
      result.created++;
    } catch (e) {
      if (e instanceof DuplicateLeadError) { result.skipped++; continue; }
      if (e instanceof UserError) { result.errors.push({ row: rowNo, message: e.message }); continue; }
      throw e;
    }
  }
  await audit(tx, ctx, "leads.imported", { type: "lead" }, { created: result.created, updated: result.updated, skipped: result.skipped, errors: result.errors.length });
  result.errors = result.errors.slice(0, 100);
  return result;
}
