"use client";

import { useMemo, useState } from "react";
import { todayISO, useClientValue } from "@/lib/use-client-value";
import { Plus, Wallet, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ActionForm, FormField, SubmitButton } from "@/components/ui/form";
import { Checkbox, Field, Input, Select } from "@/components/ui/field";
import { formatMoney } from "@/lib/utils";
import { addMilestoneAction, cancelBookingAction, createBookingAction, recordPaymentAction } from "./actions";

type Opt = { value: string; label: string };
const METHODS: Opt[] = [
  { value: "bank_transfer", label: "Bank transfer" }, { value: "upi", label: "UPI" }, { value: "cheque", label: "Cheque" }, { value: "card", label: "Card" },
  { value: "home_loan", label: "Home loan disbursement" }, { value: "cash", label: "Cash" }, { value: "other", label: "Other" },
];

export function BookingForm({
  leads, units, members, plans, defaultLead, canAssign, currency,
}: {
  leads: (Opt & { name: string; phone: string | null; email: string | null; projectId: string | null })[];
  units: (Opt & { price: number; projectId: string })[];
  members: Opt[]; plans: Opt[]; defaultLead?: string; canAssign: boolean; currency: string;
}) {
  const [leadId, setLeadId] = useState(defaultLead ?? "");
  const [unitId, setUnitId] = useState("");
  const [value, setValue] = useState("");
  const [received, setReceived] = useState(true);
  const lead = leads.find((l) => l.value === leadId);
  const sortedUnits = useMemo(
    () => [...units].sort((a, b) => Number(b.projectId === lead?.projectId) - Number(a.projectId === lead?.projectId)),
    [units, lead?.projectId],
  );
  const date = useClientValue(todayISO, "");

  return (
    <ActionForm action={createBookingAction} resetOnSuccess={false} className="space-y-5">
      <section className="grid gap-3 sm:grid-cols-2">
        <Field label="Customer (lead)" name="leadId" required>
          <Select id="leadId" name="leadId" required value={leadId} onChange={(e) => setLeadId(e.target.value)}>
            <option value="" disabled>Select the lead…</option>
            {leads.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
          </Select>
        </Field>
        <Field label="Unit" name="unitId" required hint={units.length ? "Available units, and any reserved for this lead" : "No available units — add inventory first"}>
          <Select id="unitId" name="unitId" required value={unitId} onChange={(e) => {
            setUnitId(e.target.value);
            const u = units.find((x) => x.value === e.target.value);
            if (u) setValue(String(u.price)); // default to list price; editable below
          }}>
            <option value="" disabled>Select a unit…</option>
            {sortedUnits.map((u) => <option key={u.value} value={u.value}>{u.label} · {formatMoney(u.price, currency, true)}</option>)}
          </Select>
        </Field>
        <FormField label="Booking date" name="bookingDate" type="date" required defaultValue={date} key={date} />
        <Field label="Agreement value (₹)" name="agreementValue" required hint="Defaults to the unit's list price; enter the negotiated value">
          <Input id="agreementValue" name="agreementValue" type="number" min={1} step={1000} required value={value} onChange={(e) => setValue(e.target.value)} />
        </Field>
        <FormField label="Booking amount (₹)" name="bookingAmount" type="number" required inputProps={{ min: 0, step: 1000 }} />
        <FormField label="Payment plan" name="plan" as="select" required defaultValue="clp" options={plans} hint="Creates the milestone schedule automatically" />
        {canAssign && <FormField label="Credited to (sales executive)" name="salesUserId" as="select" options={members} hint="Defaults to the lead owner" />}
      </section>

      <section className="rounded-md border border-line p-3">
        <Checkbox name="bookingAmountReceived" label="Booking amount has been received" checked={received} onChange={(e) => setReceived(e.target.checked)} />
        {received && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <FormField label="Method" name="paymentMethod" as="select" required defaultValue="bank_transfer" options={METHODS} />
            <FormField label="Reference / UTR" name="paymentReference" />
          </div>
        )}
      </section>

      <details className="rounded-md border border-line p-3 text-sm">
        <summary className="cursor-pointer font-medium text-ink-2">Customer details on the agreement (optional)</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <FormField label="Name" name="customerName" defaultValue={lead?.name} key={`n${leadId}`} />
          <FormField label="Phone" name="customerPhone" defaultValue={lead?.phone} key={`p${leadId}`} />
          <FormField label="Email" name="customerEmail" type="email" defaultValue={lead?.email} key={`e${leadId}`} />
        </div>
      </details>
      <FormField label="Notes" name="notes" as="textarea" />
      <div className="flex justify-end"><SubmitButton pendingText="Recording…">Record booking</SubmitButton></div>
    </ActionForm>
  );
}

export function RecordPaymentButton({ bookingId, milestones, outstanding, currency }: { bookingId: string; milestones: Opt[]; outstanding: number; currency: string }) {
  const date = useClientValue(todayISO, "");
  return (
    <Dialog title="Record payment" description={`Outstanding: ${formatMoney(outstanding, currency)}`} trigger={(open) => <Button onClick={open} disabled={outstanding <= 0}><Wallet className="size-4" /> Record payment</Button>}>
      <ActionForm action={recordPaymentAction} className="space-y-3">
        <input type="hidden" name="bookingId" value={bookingId} />
        <FormField label="Amount (₹)" name="amount" type="number" required inputProps={{ min: 1, step: "0.01", max: outstanding }} />
        <FormField label="Paid on" name="paidOn" type="date" required defaultValue={date} key={date} />
        <FormField label="Method" name="method" as="select" required defaultValue="bank_transfer" options={METHODS} />
        <FormField label="Reference / UTR / cheque no." name="reference" />
        {milestones.length > 0 && <FormField label="Against milestone" name="milestoneId" as="select" options={milestones} hint="Optional — payments are applied to milestones in due-date order" />}
        <FormField label="Notes" name="notes" />
        <div className="flex justify-end"><SubmitButton>Save payment</SubmitButton></div>
      </ActionForm>
    </Dialog>
  );
}

export function AddMilestoneButton({ bookingId, unscheduled, currency }: { bookingId: string; unscheduled: number; currency: string }) {
  return (
    <Dialog title="Add payment milestone" description={`Unscheduled amount: ${formatMoney(unscheduled, currency)}`} trigger={(open) => <Button size="sm" variant="secondary" onClick={open}><Plus className="size-3.5" /> Milestone</Button>}>
      <ActionForm action={addMilestoneAction} className="space-y-3">
        <input type="hidden" name="bookingId" value={bookingId} />
        <FormField label="Milestone" name="name" required placeholder="e.g. Plinth completion" />
        <FormField label="Due date" name="dueDate" type="date" required />
        <FormField label="Amount (₹)" name="amount" type="number" required defaultValue={unscheduled > 0 ? unscheduled : undefined} inputProps={{ min: 1, step: "0.01" }} />
        <div className="flex justify-end"><SubmitButton>Add milestone</SubmitButton></div>
      </ActionForm>
    </Dialog>
  );
}

export function CancelBookingButton({ id, paid, currency }: { id: string; paid: number; currency: string }) {
  return (
    <Dialog title="Cancel booking" description="The unit becomes available again and the lead is marked lost. This is recorded in the audit log." trigger={(open) => <Button variant="danger" onClick={open}><XCircle className="size-4" /> Cancel booking</Button>}>
      <ActionForm action={cancelBookingAction} className="space-y-3">
        <input type="hidden" name="id" value={id} />
        <FormField label="Reason" name="reason" required as="textarea" />
        <FormField label="Refund amount (₹)" name="refundAmount" type="number" defaultValue={0} inputProps={{ min: 0, max: paid, step: "0.01" }} hint={`Received so far: ${formatMoney(paid, currency)}`} />
        <div className="flex justify-end"><SubmitButton variant="danger">Cancel booking</SubmitButton></div>
      </ActionForm>
    </Dialog>
  );
}
