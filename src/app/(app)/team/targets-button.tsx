"use client";

import { Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ActionForm, FormField, SubmitButton } from "@/components/ui/form";
import { Checkbox } from "@/components/ui/field";
import { updateTargetsAction } from "./actions";

export function TargetsButton({ m }: { m: { membershipId: string; name: string; monthlyBookingTarget: number | null; monthlyRevenueTarget: number | null; phone: string | null; receivesLeads: boolean } }) {
  return (
    <Dialog title={`Targets · ${m.name}`} trigger={(open) => <Button size="sm" variant="ghost" onClick={open}><Target className="size-3.5" /> Targets</Button>}>
      <ActionForm action={updateTargetsAction} resetOnSuccess={false} className="space-y-3">
        <input type="hidden" name="membershipId" value={m.membershipId} />
        <FormField label="Monthly booking target" name="monthlyBookingTarget" type="number" defaultValue={m.monthlyBookingTarget} inputProps={{ min: 0 }} />
        <FormField label="Monthly revenue target (₹)" name="monthlyRevenueTarget" type="number" defaultValue={m.monthlyRevenueTarget} inputProps={{ min: 0, step: 100000 }} hint="Attainment uses revenue when set, otherwise bookings." />
        <FormField label="Phone" name="phone" type="tel" defaultValue={m.phone} />
        <Checkbox name="receivesLeads" label="Include in round-robin lead assignment" defaultChecked={m.receivesLeads} />
        <div className="flex justify-end"><SubmitButton>Save</SubmitButton></div>
      </ActionForm>
    </Dialog>
  );
}
