"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { formObject, type ActionState } from "@/lib/actions";
import { tenantAction } from "@/lib/server-action";
import { flash } from "@/lib/flash";
import { addMilestone, cancelBooking, createBooking, deleteMilestone, deletePayment, recordPayment } from "@/lib/services/bookings";

export async function createBookingAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const d = formObject(fd);
  let id = "";
  const res = await tenantAction(async (tx, ctx) => {
    id = await createBooking(tx, ctx, {
      leadId: d.leadId ?? "", unitId: d.unitId ?? "", bookingDate: d.bookingDate ?? "", agreementValue: d.agreementValue as unknown as number,
      bookingAmount: d.bookingAmount as unknown as number, customerName: d.customerName, customerPhone: d.customerPhone, customerEmail: d.customerEmail,
      salesUserId: d.salesUserId, plan: (d.plan ?? "custom") as "custom", bookingAmountReceived: d.bookingAmountReceived as "on" | undefined,
      paymentMethod: d.paymentMethod as "upi" | undefined, paymentReference: d.paymentReference, notes: d.notes,
    });
  });
  if (res?.ok && id) {
    await flash("Booking recorded. The unit is now marked as booked.");
    redirect(`/bookings/${id}`);
  }
  return res;
}

export async function recordPaymentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const d = formObject(fd);
  return tenantAction(async (tx, ctx) => {
    await recordPayment(tx, ctx, z.uuid().parse(d.bookingId), {
      amount: d.amount as unknown as number, paidOn: d.paidOn ?? "", method: (d.method ?? "bank_transfer") as "upi", reference: d.reference, milestoneId: d.milestoneId, notes: d.notes,
    });
    return { ok: true, message: "Payment recorded." };
  });
}

export async function deletePaymentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return tenantAction(async (tx, ctx) => {
    await deletePayment(tx, ctx, z.uuid().parse(fd.get("id")));
    return { ok: true, message: "Payment deleted." };
  });
}

export async function addMilestoneAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const d = formObject(fd);
  return tenantAction(async (tx, ctx) => {
    await addMilestone(tx, ctx, z.uuid().parse(d.bookingId), { name: d.name ?? "", dueDate: d.dueDate ?? "", amount: d.amount as unknown as number });
    return { ok: true, message: "Milestone added." };
  });
}

export async function deleteMilestoneAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return tenantAction(async (tx, ctx) => {
    await deleteMilestone(tx, ctx, z.uuid().parse(fd.get("id")));
    return { ok: true, message: "Milestone removed." };
  });
}

export async function cancelBookingAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const d = formObject(fd);
  return tenantAction(async (tx, ctx) => {
    await cancelBooking(tx, ctx, z.uuid().parse(d.id), { reason: d.reason ?? "", refundAmount: d.refundAmount as unknown as number });
    return { ok: true, message: "Booking cancelled and unit released." };
  });
}
