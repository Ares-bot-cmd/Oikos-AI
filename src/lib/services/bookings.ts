import "server-only";
import { and, asc, count, desc, eq, gte, ilike, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/lib/db";
import type { TenantCtx } from "@/lib/db/tenant";
import { bookings, leadActivities, leads, paymentMilestones, payments, projects, units, users } from "@/lib/db/schema";
import { assertCan, can } from "@/lib/auth/permissions";
import { NotFoundError, UserError } from "@/lib/errors";
import { isoDate } from "@/lib/utils";
import { zDate, zMoney, zText } from "@/lib/validation";
import { audit } from "./audit";
import { getLead, setStage } from "./leads";
import { managerIds, notifyMany } from "./notifications";

export const PAYMENT_METHODS = ["bank_transfer", "cheque", "upi", "card", "cash", "home_loan", "other"] as const;
export const PAYMENT_METHOD_LABELS: Record<(typeof PAYMENT_METHODS)[number], string> = {
  bank_transfer: "Bank transfer", cheque: "Cheque", upi: "UPI", card: "Card", cash: "Cash", home_loan: "Home loan disbursement", other: "Other",
};
export const PAYMENT_PLANS = {
  custom: { label: "Custom (add milestones later)", parts: [] as { name: string; pct: number; months: number }[] },
  clp: {
    label: "Construction-linked (10 / 20 / 20 / 20 / 20 / 10)",
    parts: [
      { name: "Booking", pct: 10, months: 0 }, { name: "Agreement", pct: 20, months: 1 }, { name: "Foundation", pct: 20, months: 4 },
      { name: "Slab completion", pct: 20, months: 10 }, { name: "Finishing", pct: 20, months: 18 }, { name: "Possession", pct: 10, months: 24 },
    ],
  },
  dp: { label: "Down payment (10 / 80 / 10)", parts: [{ name: "Booking", pct: 10, months: 0 }, { name: "Down payment", pct: 80, months: 1 }, { name: "Possession", pct: 10, months: 12 }] },
  flexi: { label: "Flexi (20 / 30 / 50)", parts: [{ name: "Booking", pct: 20, months: 0 }, { name: "Within 6 months", pct: 30, months: 6 }, { name: "Possession", pct: 50, months: 18 }] },
} as const;

function bookingScope(ctx: TenantCtx): SQL | undefined {
  return can(ctx.role, "leads:read_all") ? undefined : eq(bookings.salesUserId, ctx.userId!);
}

export const bookingSchema = z
  .object({
    leadId: z.uuid({ error: "Choose the customer's lead" }),
    unitId: z.uuid({ error: "Choose a unit" }),
    bookingDate: zDate,
    agreementValue: zMoney.refine((v) => v > 0, "Agreement value must be positive"),
    bookingAmount: zMoney,
    customerName: zText(120).optional(),
    customerPhone: zText(30).optional(),
    customerEmail: z.email().max(200).optional(),
    salesUserId: z.uuid().optional(),
    plan: z.enum(Object.keys(PAYMENT_PLANS) as [keyof typeof PAYMENT_PLANS]).default("custom"),
    bookingAmountReceived: z.enum(["on", "true"]).optional(),
    paymentMethod: z.enum(PAYMENT_METHODS).optional(),
    paymentReference: zText(120).optional(),
    notes: zText(2000).optional(),
  })
  .refine((v) => v.bookingAmount <= v.agreementValue, { message: "Booking amount can't exceed the agreement value", path: ["bookingAmount"] });

export async function createBooking(tx: Tx, ctx: TenantCtx, input: z.input<typeof bookingSchema>) {
  assertCan(ctx.role, "bookings:write");
  const d = bookingSchema.parse(input);
  const lead = await getLead(tx, ctx, d.leadId);
  if (lead.stage === "booked") throw new UserError("This lead already has an active booking.");
  const [unit] = await tx.select().from(units).where(eq(units.id, d.unitId)).limit(1);
  if (!unit) throw new UserError("Selected unit not found.");
  // Atomic: only an available unit, or one reserved for this same lead, can be booked.
  const claimed = await tx
    .update(units)
    .set({ status: "booked", reservedForLeadId: null, reservedUntil: null })
    .where(and(eq(units.id, unit.id), or(eq(units.status, "available"), and(eq(units.status, "reserved"), eq(units.reservedForLeadId, lead.id)))))
    .returning({ id: units.id });
  if (!claimed.length) throw new UserError(unit.status === "reserved" ? "This unit is reserved for another customer." : "This unit is no longer available.");

  const salesUserId = d.salesUserId ?? lead.ownerId ?? ctx.userId;
  const [b] = await tx
    .insert(bookings)
    .values({
      organizationId: ctx.orgId, leadId: lead.id, projectId: unit.projectId, unitId: unit.id,
      customerName: d.customerName ?? lead.name, customerPhone: d.customerPhone ?? lead.phone, customerEmail: d.customerEmail ?? lead.email,
      bookingDate: d.bookingDate, agreementValue: d.agreementValue, bookingAmount: d.bookingAmount, salesUserId,
      campaignId: lead.campaignId, source: lead.source, notes: d.notes, createdById: ctx.userId,
    })
    .returning({ id: bookings.id });

  const plan = PAYMENT_PLANS[d.plan];
  if (plan.parts.length) {
    const start = new Date(d.bookingDate + "T00:00:00");
    let allocated = 0;
    const rows = plan.parts.map((p, i) => {
      const due = new Date(start.getFullYear(), start.getMonth() + p.months, start.getDate());
      const amount = i === plan.parts.length - 1 ? Math.round((d.agreementValue - allocated) * 100) / 100 : Math.round(d.agreementValue * p.pct) / 100;
      allocated += amount;
      return { organizationId: ctx.orgId, bookingId: b.id, name: p.name, dueDate: isoDate(due), amount, sortOrder: i };
    });
    await tx.insert(paymentMilestones).values(rows);
  }
  if (d.bookingAmountReceived && d.bookingAmount > 0) {
    await tx.insert(payments).values({
      organizationId: ctx.orgId, bookingId: b.id, amount: d.bookingAmount, paidOn: d.bookingDate, method: d.paymentMethod ?? "bank_transfer",
      reference: d.paymentReference, notes: "Booking amount", recordedById: ctx.userId,
    });
  }
  await setStage(tx, ctx, lead.id, lead.stage, "booked");
  await tx.insert(leadActivities).values({
    organizationId: ctx.orgId, leadId: lead.id, userId: ctx.userId, type: "booking",
    body: `Booked unit ${unit.tower ? unit.tower + "-" : ""}${unit.unitNumber} for ${d.agreementValue.toLocaleString("en-IN")}`, meta: { bookingId: b.id },
  });
  await audit(tx, ctx, "booking.created", { type: "booking", id: b.id }, { unitId: unit.id, agreementValue: d.agreementValue });
  await notifyMany(tx, ctx.orgId, await managerIds(tx), { type: "booking_created", title: `New booking: ${lead.name}`, body: `Unit ${unit.unitNumber}`, link: `/bookings/${b.id}` });
  return b.id;
}

export async function getBooking(tx: Tx, ctx: TenantCtx, id: string) {
  if (!z.uuid().safeParse(id).success) throw new NotFoundError("Booking");
  const [row] = await tx
    .select({ booking: bookings, projectName: projects.name, unit: units, salesName: users.name })
    .from(bookings)
    .innerJoin(projects, eq(projects.id, bookings.projectId))
    .innerJoin(units, eq(units.id, bookings.unitId))
    .leftJoin(users, eq(users.id, bookings.salesUserId))
    .where(and(eq(bookings.id, id), bookingScope(ctx)))
    .limit(1);
  if (!row) throw new NotFoundError("Booking");
  return { ...row.booking, projectName: row.projectName, unit: row.unit, salesName: row.salesName };
}

export type MilestoneStatus = "paid" | "partial" | "overdue" | "due" | "upcoming";

/** Applies total payments to milestones in due-date order (FIFO) to derive each milestone's status. */
export function allocateMilestones<M extends { amount: number; dueDate: string }>(milestones: M[], totalPaid: number, today = isoDate(new Date())) {
  let remaining = totalPaid;
  return [...milestones]
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .map((m) => {
      const paid = Math.min(m.amount, Math.max(0, remaining));
      remaining -= paid;
      const outstanding = Math.round((m.amount - paid) * 100) / 100;
      const soon = new Date(today + "T00:00:00").getTime() + 7 * 86400_000;
      let status: MilestoneStatus;
      if (outstanding <= 0.005) status = "paid";
      else if (m.dueDate < today) status = "overdue";
      else if (paid > 0) status = "partial";
      else if (new Date(m.dueDate + "T00:00:00").getTime() <= soon) status = "due";
      else status = "upcoming";
      return { ...m, paid, outstanding, status };
    });
}

export async function bookingDetail(tx: Tx, ctx: TenantCtx, id: string) {
  const booking = await getBooking(tx, ctx, id);
  const [ms, ps] = await Promise.all([
    tx.select().from(paymentMilestones).where(eq(paymentMilestones.bookingId, booking.id)).orderBy(asc(paymentMilestones.dueDate), asc(paymentMilestones.sortOrder)),
    tx
      .select({ payment: payments, recordedBy: users.name, milestoneName: paymentMilestones.name })
      .from(payments)
      .leftJoin(users, eq(users.id, payments.recordedById))
      .leftJoin(paymentMilestones, eq(paymentMilestones.id, payments.milestoneId))
      .where(eq(payments.bookingId, booking.id))
      .orderBy(desc(payments.paidOn), desc(payments.createdAt)),
  ]);
  const totalPaid = ps.reduce((s, p) => s + p.payment.amount, 0);
  const milestones = allocateMilestones(ms, totalPaid);
  const scheduled = ms.reduce((s, m) => s + m.amount, 0);
  return {
    booking,
    milestones,
    payments: ps.map((p) => ({ ...p.payment, recordedBy: p.recordedBy, milestoneName: p.milestoneName })),
    totals: {
      paid: totalPaid,
      outstanding: Math.max(0, booking.agreementValue - totalPaid),
      overdue: milestones.filter((m) => m.status === "overdue").reduce((s, m) => s + m.outstanding, 0),
      unscheduled: Math.max(0, booking.agreementValue - scheduled),
    },
  };
}

export const milestoneSchema = z.object({
  name: z.string().trim().min(1, "Name the milestone").max(80),
  dueDate: zDate,
  amount: zMoney.refine((v) => v > 0, "Amount must be positive"),
});

export async function addMilestone(tx: Tx, ctx: TenantCtx, bookingId: string, input: z.input<typeof milestoneSchema>) {
  assertCan(ctx.role, "payments:write");
  const b = await getBooking(tx, ctx, bookingId);
  if (b.status === "cancelled") throw new UserError("This booking is cancelled.");
  const d = milestoneSchema.parse(input);
  const [{ total }] = await tx.select({ total: sql<number>`coalesce(sum(${paymentMilestones.amount}),0)`.mapWith(Number) }).from(paymentMilestones).where(eq(paymentMilestones.bookingId, b.id));
  if (total + d.amount > b.agreementValue + 0.01) throw new UserError("Milestones can't add up to more than the agreement value.");
  await tx.insert(paymentMilestones).values({ organizationId: ctx.orgId, bookingId: b.id, ...d });
}

export async function deleteMilestone(tx: Tx, ctx: TenantCtx, milestoneId: string) {
  assertCan(ctx.role, "payments:write");
  if (!z.uuid().safeParse(milestoneId).success) throw new NotFoundError("Milestone");
  const [m] = await tx.select().from(paymentMilestones).where(eq(paymentMilestones.id, milestoneId));
  if (!m) throw new NotFoundError("Milestone");
  await getBooking(tx, ctx, m.bookingId);
  await tx.delete(paymentMilestones).where(eq(paymentMilestones.id, m.id));
}

export const paymentSchema = z.object({
  amount: zMoney.refine((v) => v > 0, "Amount must be positive"),
  paidOn: zDate,
  method: z.enum(PAYMENT_METHODS),
  reference: zText(120).optional(),
  milestoneId: z.uuid().optional(),
  notes: zText(500).optional(),
});

export async function recordPayment(tx: Tx, ctx: TenantCtx, bookingId: string, input: z.input<typeof paymentSchema>) {
  assertCan(ctx.role, "payments:write");
  const detail = await bookingDetail(tx, ctx, bookingId);
  const b = detail.booking;
  if (b.status === "cancelled") throw new UserError("Payments can't be recorded on a cancelled booking.");
  const d = paymentSchema.parse(input);
  if (d.paidOn > isoDate(new Date())) throw new UserError("Payment date can't be in the future.");
  if (d.amount > detail.totals.outstanding + 0.01) throw new UserError(`This exceeds the outstanding balance (${detail.totals.outstanding.toLocaleString("en-IN")}).`);
  if (d.milestoneId && !detail.milestones.some((m) => m.id === d.milestoneId)) throw new UserError("Milestone not found on this booking.");
  const [p] = await tx.insert(payments).values({ organizationId: ctx.orgId, bookingId: b.id, recordedById: ctx.userId, ...d }).returning({ id: payments.id });
  if (detail.totals.paid + d.amount >= b.agreementValue - 0.01) {
    await tx.update(bookings).set({ status: "completed" }).where(eq(bookings.id, b.id));
  }
  if (b.leadId) {
    await tx.insert(leadActivities).values({ organizationId: ctx.orgId, leadId: b.leadId, userId: ctx.userId, type: "payment", body: `Payment of ${d.amount.toLocaleString("en-IN")} received (${PAYMENT_METHOD_LABELS[d.method]})` });
  }
  await audit(tx, ctx, "payment.recorded", { type: "booking", id: b.id }, { amount: d.amount, paymentId: p.id });
  return p.id;
}

export async function deletePayment(tx: Tx, ctx: TenantCtx, paymentId: string) {
  assertCan(ctx.role, "payments:write");
  if (!z.uuid().safeParse(paymentId).success) throw new NotFoundError("Payment");
  const [p] = await tx.select().from(payments).where(eq(payments.id, paymentId));
  if (!p) throw new NotFoundError("Payment");
  const b = await getBooking(tx, ctx, p.bookingId);
  await tx.delete(payments).where(eq(payments.id, p.id));
  if (b.status === "completed") await tx.update(bookings).set({ status: "active" }).where(eq(bookings.id, b.id));
  await audit(tx, ctx, "payment.deleted", { type: "booking", id: b.id }, { amount: p.amount, paidOn: p.paidOn });
}

export const cancelSchema = z.object({
  reason: z.string().trim().min(3, "Give a cancellation reason").max(500),
  refundAmount: zMoney.optional(),
});

export async function cancelBooking(tx: Tx, ctx: TenantCtx, id: string, input: z.input<typeof cancelSchema>) {
  assertCan(ctx.role, "payments:write");
  const detail = await bookingDetail(tx, ctx, id);
  const b = detail.booking;
  if (b.status === "cancelled") throw new UserError("This booking is already cancelled.");
  const d = cancelSchema.parse(input);
  if ((d.refundAmount ?? 0) > detail.totals.paid + 0.01) throw new UserError("Refund can't exceed the amount received.");
  await tx.update(bookings).set({ status: "cancelled", cancelledAt: new Date(), cancellationReason: d.reason, refundAmount: d.refundAmount ?? 0 }).where(eq(bookings.id, b.id));
  await tx.update(units).set({ status: "available" }).where(and(eq(units.id, b.unitId), inArray(units.status, ["booked", "sold"])));
  if (b.leadId) {
    const [lead] = await tx.select({ stage: leads.stage }).from(leads).where(eq(leads.id, b.leadId));
    if (lead) await setStage(tx, ctx, b.leadId, lead.stage, "lost", `Booking cancelled: ${d.reason}`);
  }
  await audit(tx, ctx, "booking.cancelled", { type: "booking", id: b.id }, { reason: d.reason, refund: d.refundAmount ?? 0 });
}

export const BOOKING_SORTS = ["date", "value", "customer", "paid"] as const;

export async function listBookings(
  tx: Tx,
  ctx: TenantCtx,
  f: { q?: string; status?: string; project?: string; from?: Date; to?: Date; sort?: (typeof BOOKING_SORTS)[number]; dir?: "asc" | "desc"; limit?: number; offset?: number },
) {
  const paid = sql<number>`(select coalesce(sum(p.amount),0) from payments p where p.booking_id = ${bookings.id})`.mapWith(Number);
  const where = and(
    bookingScope(ctx),
    f.q ? or(ilike(bookings.customerName, `%${f.q}%`), ilike(units.unitNumber, `%${f.q}%`)) : undefined,
    f.status && ["active", "completed", "cancelled"].includes(f.status) ? eq(bookings.status, f.status as "active") : undefined,
    f.project && z.uuid().safeParse(f.project).success ? eq(bookings.projectId, f.project) : undefined,
    f.from ? gte(bookings.bookingDate, isoDate(f.from)) : undefined,
    f.to ? lt(bookings.bookingDate, isoDate(f.to)) : undefined,
  );
  const dir = f.dir === "asc" ? asc : desc;
  const order = { date: [dir(bookings.bookingDate)], value: [dir(bookings.agreementValue)], customer: [dir(bookings.customerName)], paid: [dir(paid)] }[f.sort ?? "date"];
  const [rows, [{ total }]] = await Promise.all([
    tx
      .select({
        id: bookings.id, customerName: bookings.customerName, bookingDate: bookings.bookingDate, agreementValue: bookings.agreementValue,
        status: bookings.status, projectName: projects.name, unitNumber: units.unitNumber, tower: units.tower, salesName: users.name, paid,
      })
      .from(bookings)
      .innerJoin(projects, eq(projects.id, bookings.projectId))
      .innerJoin(units, eq(units.id, bookings.unitId))
      .leftJoin(users, eq(users.id, bookings.salesUserId))
      .where(where)
      .orderBy(...order, desc(bookings.createdAt))
      .limit(f.limit ?? 25)
      .offset(f.offset ?? 0),
    tx.select({ total: count() }).from(bookings).innerJoin(units, eq(units.id, bookings.unitId)).where(where),
  ]);
  return { rows, total: Number(total) };
}

/** All non-cancelled bookings with their milestone schedule, for receivables and reminders. */
export async function receivables(tx: Tx, ctx: TenantCtx, project?: string) {
  const bs = await tx
    .select({ id: bookings.id, customerName: bookings.customerName, agreementValue: bookings.agreementValue, salesUserId: bookings.salesUserId, projectName: projects.name, unitNumber: units.unitNumber, tower: units.tower })
    .from(bookings)
    .innerJoin(projects, eq(projects.id, bookings.projectId))
    .innerJoin(units, eq(units.id, bookings.unitId))
    .where(and(bookingScope(ctx), sql`${bookings.status} <> 'cancelled'`, project && z.uuid().safeParse(project).success ? eq(bookings.projectId, project) : undefined));
  if (!bs.length) return [];
  const ids = bs.map((b) => b.id);
  const [ms, paidRows] = await Promise.all([
    tx.select().from(paymentMilestones).where(inArray(paymentMilestones.bookingId, ids)),
    tx.select({ bookingId: payments.bookingId, paid: sql<number>`sum(${payments.amount})`.mapWith(Number) }).from(payments).where(inArray(payments.bookingId, ids)).groupBy(payments.bookingId),
  ]);
  const paidBy = new Map(paidRows.map((p) => [p.bookingId, p.paid]));
  return bs.map((b) => {
    const paid = paidBy.get(b.id) ?? 0;
    const milestones = allocateMilestones(ms.filter((m) => m.bookingId === b.id), paid);
    return {
      ...b,
      paid,
      outstanding: Math.max(0, b.agreementValue - paid),
      overdue: milestones.filter((m) => m.status === "overdue").reduce((s, m) => s + m.outstanding, 0),
      milestones,
    };
  });
}

export async function listPayments(tx: Tx, ctx: TenantCtx, f: { q?: string; method?: string; from?: Date; to?: Date; limit?: number; offset?: number }) {
  const where = and(
    bookingScope(ctx),
    f.q ? ilike(bookings.customerName, `%${f.q}%`) : undefined,
    f.method && (PAYMENT_METHODS as readonly string[]).includes(f.method) ? eq(payments.method, f.method as "upi") : undefined,
    f.from ? gte(payments.paidOn, isoDate(f.from)) : undefined,
    f.to ? lt(payments.paidOn, isoDate(f.to)) : undefined,
  );
  const [rows, [{ total, sum }]] = await Promise.all([
    tx
      .select({ id: payments.id, amount: payments.amount, paidOn: payments.paidOn, method: payments.method, reference: payments.reference, bookingId: bookings.id, customerName: bookings.customerName, projectName: projects.name, unitNumber: units.unitNumber })
      .from(payments)
      .innerJoin(bookings, eq(bookings.id, payments.bookingId))
      .innerJoin(projects, eq(projects.id, bookings.projectId))
      .innerJoin(units, eq(units.id, bookings.unitId))
      .where(where)
      .orderBy(desc(payments.paidOn), desc(payments.createdAt))
      .limit(f.limit ?? 25)
      .offset(f.offset ?? 0),
    tx.select({ total: count(), sum: sql<number>`coalesce(sum(${payments.amount}),0)`.mapWith(Number) }).from(payments).innerJoin(bookings, eq(bookings.id, payments.bookingId)).where(where),
  ]);
  return { rows, total: Number(total), sum };
}

export async function cancellations(tx: Tx, ctx: TenantCtx) {
  return tx
    .select({ id: bookings.id, customerName: bookings.customerName, cancelledAt: bookings.cancelledAt, reason: bookings.cancellationReason, refundAmount: bookings.refundAmount, agreementValue: bookings.agreementValue, projectName: projects.name, unitNumber: units.unitNumber })
    .from(bookings)
    .innerJoin(projects, eq(projects.id, bookings.projectId))
    .innerJoin(units, eq(units.id, bookings.unitId))
    .where(and(bookingScope(ctx), eq(bookings.status, "cancelled")))
    .orderBy(desc(bookings.cancelledAt))
    .limit(100);
}
