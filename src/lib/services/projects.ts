import "server-only";
import { and, asc, count, desc, eq, gte, ilike, lte, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/lib/db";
import type { TenantCtx } from "@/lib/db/tenant";
import { bookings, leadActivities, leads, projects, units } from "@/lib/db/schema";
import { assertCan } from "@/lib/auth/permissions";
import { NotFoundError, UserError } from "@/lib/errors";
import { zDate, zOptMoney, zText } from "@/lib/validation";
import { audit } from "./audit";
import { getLead } from "./leads";

export const PROJECT_STATUSES = ["planning", "pre_launch", "under_construction", "ready_to_move", "completed"] as const;
export const PROJECT_STATUS_LABELS: Record<(typeof PROJECT_STATUSES)[number], string> = {
  planning: "Planning", pre_launch: "Pre-launch", under_construction: "Under construction", ready_to_move: "Ready to move", completed: "Completed",
};
export const PROPERTY_TYPES = ["Apartment", "Villa", "Row house", "Plot", "Commercial", "Office", "Retail", "Mixed use"] as const;
export const UNIT_STATUSES = ["available", "reserved", "booked", "sold"] as const;
export type UnitStatus = (typeof UNIT_STATUSES)[number];

export const projectSchema = z
  .object({
    name: z.string().trim().min(2, "Name is required").max(120),
    location: z.string().trim().min(2, "Location is required").max(200),
    city: zText(80).optional(),
    developer: zText(120).optional(),
    propertyType: z.string().trim().min(1, "Choose a property type").max(40),
    status: z.enum(PROJECT_STATUSES).default("under_construction"),
    totalUnits: z.coerce.number().int().min(0).max(100_000).default(0),
    priceFrom: zOptMoney,
    priceTo: zOptMoney,
    reraNumber: zText(80).optional(),
    possessionDate: zDate.optional(),
    description: zText(4000).optional(),
    amenities: zText(1000).optional(),
  })
  .refine((v) => v.priceFrom == null || v.priceTo == null || v.priceFrom <= v.priceTo, { message: "'From' price can't exceed 'to' price", path: ["priceFrom"] });

export async function createProject(tx: Tx, ctx: TenantCtx, input: z.input<typeof projectSchema>) {
  assertCan(ctx.role, "projects:write");
  const d = projectSchema.parse(input);
  const [p] = await tx.insert(projects).values({ organizationId: ctx.orgId, ...d }).returning({ id: projects.id });
  await audit(tx, ctx, "project.created", { type: "project", id: p.id }, { name: d.name });
  return p.id;
}

export async function getProject(tx: Tx, id: string) {
  if (!z.uuid().safeParse(id).success) throw new NotFoundError("Project");
  const [p] = await tx.select().from(projects).where(eq(projects.id, id)).limit(1);
  if (!p) throw new NotFoundError("Project");
  return p;
}

export async function updateProject(tx: Tx, ctx: TenantCtx, id: string, input: z.input<typeof projectSchema>) {
  assertCan(ctx.role, "projects:write");
  const p = await getProject(tx, id);
  const d = projectSchema.parse(input);
  await tx
    .update(projects)
    .set({ ...d, city: d.city ?? null, developer: d.developer ?? null, priceFrom: d.priceFrom ?? null, priceTo: d.priceTo ?? null, reraNumber: d.reraNumber ?? null, possessionDate: d.possessionDate ?? null, description: d.description ?? null, amenities: d.amenities ?? null })
    .where(eq(projects.id, p.id));
}

export async function deleteProject(tx: Tx, ctx: TenantCtx, id: string) {
  assertCan(ctx.role, "projects:write");
  const p = await getProject(tx, id);
  const [b] = await tx.select({ n: count() }).from(bookings).where(eq(bookings.projectId, p.id));
  if (Number(b.n) > 0) throw new UserError("This project has bookings and can't be deleted.");
  await tx.delete(projects).where(eq(projects.id, p.id));
  await audit(tx, ctx, "project.deleted", { type: "project", id: p.id }, { name: p.name });
}

export async function listProjects(tx: Tx, opts: { q?: string; status?: string } = {}) {
  const where = and(
    opts.q ? ilike(projects.name, `%${opts.q}%`) : undefined,
    opts.status && (PROJECT_STATUSES as readonly string[]).includes(opts.status) ? eq(projects.status, opts.status as "planning") : undefined,
  );
  const rows = await tx
    .select({
      project: projects,
      unitCount: sql<number>`(select count(*) from units u where u.project_id = ${projects.id})`.mapWith(Number),
      available: sql<number>`(select count(*) from units u where u.project_id = ${projects.id} and u.status = 'available')`.mapWith(Number),
      reserved: sql<number>`(select count(*) from units u where u.project_id = ${projects.id} and u.status = 'reserved')`.mapWith(Number),
      booked: sql<number>`(select count(*) from units u where u.project_id = ${projects.id} and u.status in ('booked','sold'))`.mapWith(Number),
      inventoryValue: sql<number>`(select coalesce(sum(u.price),0) from units u where u.project_id = ${projects.id} and u.status = 'available')`.mapWith(Number),
      bookedValue: sql<number>`(select coalesce(sum(b.agreement_value),0) from bookings b where b.project_id = ${projects.id} and b.status <> 'cancelled')`.mapWith(Number),
      leadCount: sql<number>`(select count(*) from leads l where l.project_id = ${projects.id})`.mapWith(Number),
    })
    .from(projects)
    .where(where)
    .orderBy(asc(projects.name));
  return rows.map((r) => ({ ...r.project, unitCount: r.unitCount, available: r.available, reserved: r.reserved, booked: r.booked, inventoryValue: r.inventoryValue, bookedValue: r.bookedValue, leadCount: r.leadCount }));
}

export async function projectOptions(tx: Tx) {
  return tx.select({ id: projects.id, name: projects.name }).from(projects).orderBy(asc(projects.name));
}

// ─── Units ──────────────────────────────────────────────────────────────────

export const unitSchema = z.object({
  projectId: z.uuid({ error: "Choose a project" }),
  tower: zText(40).optional(),
  unitNumber: z.string().trim().min(1, "Unit number is required").max(40),
  floor: z.coerce.number({ error: "Enter the floor" }).int().min(-5).max(200),
  configuration: z.string().trim().min(1, "Configuration is required").max(40),
  carpetArea: z.coerce.number({ error: "Enter carpet area" }).positive("Carpet area must be positive").max(1_000_000),
  price: z.coerce.number({ error: "Enter the price" }).positive("Price must be positive").max(1e12),
  facing: zText(40).optional(),
  floorPlanUrl: z.url("Enter a valid URL").max(500).refine((u) => /^https:\/\//.test(u), "Use an https:// link").optional(),
});

export async function createUnit(tx: Tx, ctx: TenantCtx, input: z.input<typeof unitSchema>) {
  assertCan(ctx.role, "projects:write");
  const d = unitSchema.parse(input);
  await getProject(tx, d.projectId);
  try {
    const [u] = await tx.insert(units).values({ organizationId: ctx.orgId, ...d, tower: d.tower ?? "" }).returning({ id: units.id });
    return u.id;
  } catch (e) {
    if (String((e as { cause?: { message?: string } })?.cause?.message ?? e).includes("units_project_unit_idx")) throw new UserError("That unit number already exists in this tower.");
    throw e;
  }
}

export const bulkUnitSchema = z
  .object({
    projectId: z.uuid({ error: "Choose a project" }),
    tower: zText(40).optional(),
    floorFrom: z.coerce.number().int().min(-5).max(200),
    floorTo: z.coerce.number().int().min(-5).max(200),
    unitsPerFloor: z.coerce.number().int().min(1).max(50),
    configuration: z.string().trim().min(1).max(40),
    carpetArea: z.coerce.number().positive().max(1_000_000),
    basePrice: z.coerce.number().positive().max(1e12),
    floorRise: z.coerce.number().min(0).max(1e9).default(0),
  })
  .refine((v) => v.floorTo >= v.floorFrom, { message: "'To' floor must be at or above 'from' floor", path: ["floorTo"] })
  .refine((v) => (v.floorTo - v.floorFrom + 1) * v.unitsPerFloor <= 2000, { message: "Generate at most 2,000 units at a time", path: ["unitsPerFloor"] });

/** Generates units like 1201, 1202… with an optional per-floor price rise. Skips numbers that already exist. */
export async function bulkCreateUnits(tx: Tx, ctx: TenantCtx, input: z.input<typeof bulkUnitSchema>) {
  assertCan(ctx.role, "projects:write");
  const d = bulkUnitSchema.parse(input);
  await getProject(tx, d.projectId);
  const values = [];
  for (let f = d.floorFrom; f <= d.floorTo; f++) {
    for (let n = 1; n <= d.unitsPerFloor; n++) {
      values.push({
        organizationId: ctx.orgId, projectId: d.projectId, tower: d.tower ?? "", unitNumber: `${f}${String(n).padStart(2, "0")}`,
        floor: f, configuration: d.configuration, carpetArea: d.carpetArea, price: Math.round(d.basePrice + Math.max(0, f - d.floorFrom) * d.floorRise),
      });
    }
  }
  let created = 0;
  for (let i = 0; i < values.length; i += 500) {
    const res = await tx.insert(units).values(values.slice(i, i + 500)).onConflictDoNothing().returning({ id: units.id });
    created += res.length;
  }
  return { created, skipped: values.length - created };
}

export async function getUnit(tx: Tx, id: string) {
  if (!z.uuid().safeParse(id).success) throw new NotFoundError("Unit");
  const [u] = await tx.select().from(units).where(eq(units.id, id)).limit(1);
  if (!u) throw new NotFoundError("Unit");
  return u;
}

export async function updateUnit(tx: Tx, ctx: TenantCtx, id: string, input: z.input<typeof unitSchema>) {
  assertCan(ctx.role, "projects:write");
  const u = await getUnit(tx, id);
  const d = unitSchema.parse(input);
  if (d.projectId !== u.projectId && u.status !== "available") throw new UserError("Only available units can move to another project.");
  await tx.update(units).set({ ...d, tower: d.tower ?? "", facing: d.facing ?? null, floorPlanUrl: d.floorPlanUrl ?? null }).where(eq(units.id, u.id));
}

export async function deleteUnit(tx: Tx, ctx: TenantCtx, id: string) {
  assertCan(ctx.role, "projects:write");
  const u = await getUnit(tx, id);
  if (u.status !== "available") throw new UserError("Only available units can be deleted.");
  await tx.delete(units).where(eq(units.id, u.id));
}

/** Holds a unit for a lead (default 72h). Released automatically by the sweep when it expires. */
export async function reserveUnit(tx: Tx, ctx: TenantCtx, unitId: string, leadId: string, hours = 72) {
  assertCan(ctx.role, "bookings:write");
  const u = await getUnit(tx, unitId);
  const lead = await getLead(tx, ctx, leadId);
  if (u.status !== "available") throw new UserError("This unit isn't available.");
  const until = new Date(Date.now() + Math.min(Math.max(hours, 1), 24 * 14) * 3600_000);
  const res = await tx
    .update(units)
    .set({ status: "reserved", reservedForLeadId: lead.id, reservedUntil: until })
    .where(and(eq(units.id, u.id), eq(units.status, "available")))
    .returning({ id: units.id });
  if (!res.length) throw new UserError("This unit was just taken by someone else.");
  await tx.insert(leadActivities).values({
    organizationId: ctx.orgId, leadId: lead.id, userId: ctx.userId, type: "system",
    body: `Unit ${u.tower ? u.tower + "-" : ""}${u.unitNumber} reserved until ${until.toISOString()}`,
  });
}

export async function releaseUnit(tx: Tx, ctx: TenantCtx, unitId: string) {
  assertCan(ctx.role, "bookings:write");
  const u = await getUnit(tx, unitId);
  if (u.status !== "reserved") throw new UserError("Only reserved units can be released.");
  await tx.update(units).set({ status: "available", reservedForLeadId: null, reservedUntil: null }).where(eq(units.id, u.id));
}

export async function markUnitSold(tx: Tx, ctx: TenantCtx, unitId: string) {
  assertCan(ctx.role, "bookings:write");
  const u = await getUnit(tx, unitId);
  if (u.status !== "booked") throw new UserError("Only booked units can be marked as sold (registered).");
  await tx.update(units).set({ status: "sold" }).where(eq(units.id, u.id));
  await audit(tx, ctx, "unit.sold", { type: "unit", id: u.id });
}

export async function releaseExpiredReservations(tx: Tx) {
  const r = await tx
    .update(units)
    .set({ status: "available", reservedForLeadId: null, reservedUntil: null })
    .where(and(eq(units.status, "reserved"), lte(units.reservedUntil, new Date())))
    .returning({ id: units.id });
  return r.length;
}

export const UNIT_SORTS = ["unit", "floor", "price", "area", "status"] as const;
export type UnitFilters = {
  project?: string; status?: string; configuration?: string; q?: string; minPrice?: number; maxPrice?: number;
  sort?: (typeof UNIT_SORTS)[number]; dir?: "asc" | "desc"; limit?: number; offset?: number;
};

export async function listUnits(tx: Tx, f: UnitFilters) {
  const conds: (SQL | undefined)[] = [
    f.project && z.uuid().safeParse(f.project).success ? eq(units.projectId, f.project) : undefined,
    f.status && (UNIT_STATUSES as readonly string[]).includes(f.status) ? eq(units.status, f.status as UnitStatus) : undefined,
    f.configuration ? eq(units.configuration, f.configuration) : undefined,
    f.q ? ilike(units.unitNumber, `%${f.q}%`) : undefined,
    f.minPrice != null ? gte(units.price, f.minPrice) : undefined,
    f.maxPrice != null ? lte(units.price, f.maxPrice) : undefined,
  ];
  const where = and(...conds);
  const dir = f.dir === "desc" ? desc : asc;
  const order = { unit: [asc(projects.name), dir(units.tower), dir(units.unitNumber)], floor: [dir(units.floor), asc(units.unitNumber)], price: [dir(units.price)], area: [dir(units.carpetArea)], status: [dir(units.status), asc(units.unitNumber)] }[f.sort ?? "unit"];
  const [rows, [{ total }], summary] = await Promise.all([
    tx
      .select({ unit: units, projectName: projects.name, reservedFor: leads.name })
      .from(units)
      .innerJoin(projects, eq(projects.id, units.projectId))
      .leftJoin(leads, eq(leads.id, units.reservedForLeadId))
      .where(where)
      .orderBy(...order)
      .limit(f.limit ?? 50)
      .offset(f.offset ?? 0),
    tx.select({ total: count() }).from(units).where(where),
    tx.select({ status: units.status, n: count(), value: sql<number>`coalesce(sum(${units.price}),0)`.mapWith(Number) }).from(units).where(where).groupBy(units.status),
  ]);
  return {
    rows: rows.map((r) => ({ ...r.unit, projectName: r.projectName, reservedFor: r.reservedFor })),
    total: Number(total),
    summary: Object.fromEntries(UNIT_STATUSES.map((s) => { const x = summary.find((y) => y.status === s); return [s, { n: Number(x?.n ?? 0), value: x?.value ?? 0 }]; })) as Record<UnitStatus, { n: number; value: number }>,
  };
}

export async function configurations(tx: Tx) {
  const rows = await tx.selectDistinct({ c: units.configuration }).from(units).orderBy(asc(units.configuration));
  return rows.map((r) => r.c);
}

export async function availableUnitsFor(tx: Tx, projectId?: string, leadId?: string) {
  return tx
    .select({ id: units.id, label: sql<string>`concat(${projects.name}, ' · ', nullif(${units.tower}, '') || '-', ${units.unitNumber}, ' · ', ${units.configuration})`, price: units.price, status: units.status, projectId: units.projectId })
    .from(units)
    .innerJoin(projects, eq(projects.id, units.projectId))
    .where(
      and(
        projectId && z.uuid().safeParse(projectId).success ? eq(units.projectId, projectId) : undefined,
        leadId ? sql`(${units.status} = 'available' or (${units.status} = 'reserved' and ${units.reservedForLeadId} = ${leadId}))` : sql`${units.status} in ('available','reserved')`,
      ),
    )
    .orderBy(asc(projects.name), asc(units.tower), asc(units.unitNumber))
    .limit(1000);
}
