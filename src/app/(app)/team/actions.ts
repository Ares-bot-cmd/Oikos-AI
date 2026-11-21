"use server";

import { z } from "zod";
import { formObject, type ActionState } from "@/lib/actions";
import { tenantAction } from "@/lib/server-action";
import { updateMemberSettings } from "@/lib/services/org";

export async function updateTargetsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const d = formObject(fd);
  return tenantAction(async (tx, ctx) => {
    await updateMemberSettings(tx, ctx, z.uuid().parse(d.membershipId), {
      monthlyBookingTarget: d.monthlyBookingTarget as unknown as number,
      monthlyRevenueTarget: d.monthlyRevenueTarget as unknown as number,
      phone: d.phone,
      receivesLeads: d.receivesLeads as "on" | undefined,
    });
    return { ok: true, message: "Targets saved." };
  });
}
