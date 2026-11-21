"use client";

import { useActionState } from "react";
import { useSubmit } from "@/lib/use-submit";
import { CheckCircle2 } from "lucide-react";
import type { ActionState } from "@/lib/actions";
import { FormField, SubmitButton } from "@/components/ui/form";
import { Notice } from "@/components/ui/states";
import { submitFormAction } from "./actions";

export function PublicLeadForm({ slug }: { slug: string }) {
  const [state, action] = useActionState<ActionState, FormData>(submitFormAction, null);
  const { onSubmit } = useSubmit(action);
  if (state?.ok) {
    return (
      <div className="flex flex-col items-center py-6 text-center">
        <CheckCircle2 className="size-10 text-positive" />
        <h2 className="mt-3 text-lg font-semibold">Thank you!</h2>
        <p className="mt-1 text-[13.5px] text-ink-2">We&apos;ve received your details. Our team will contact you shortly.</p>
      </div>
    );
  }
  return (
    <form onSubmit={onSubmit} className="space-y-3">
      {state?.error && <Notice tone="danger">{state.error}</Notice>}
      <input type="hidden" name="slug" value={slug} />
      {/* Honeypot: hidden from people, filled by bots. */}
      <div aria-hidden className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
        <label>Company website<input type="text" name="website" tabIndex={-1} autoComplete="off" /></label>
      </div>
      <FormField label="Full name" name="name" required inputProps={{ autoComplete: "name", maxLength: 120 }} />
      <FormField label="Mobile number" name="phone" type="tel" required inputProps={{ autoComplete: "tel", maxLength: 30 }} />
      <FormField label="Email" name="email" type="email" inputProps={{ autoComplete: "email" }} />
      <FormField label="Budget" name="budget" as="select" options={[
        { value: "5000000", label: "Up to ₹50 L" }, { value: "10000000", label: "₹50 L – ₹1 Cr" },
        { value: "20000000", label: "₹1 – 2 Cr" }, { value: "50000000", label: "Above ₹2 Cr" },
      ]} />
      <FormField label="When are you planning to buy?" name="timeline" as="select" options={[
        { value: "immediate", label: "Immediately" }, { value: "within_3_months", label: "Within 3 months" },
        { value: "within_6_months", label: "Within 6 months" }, { value: "later", label: "Later" },
      ]} />
      <FormField label="Message" name="notes" as="textarea" inputProps={{ maxLength: 1000 }} />
      <label className="flex items-start gap-2 text-[12px] text-ink-2">
        <input type="checkbox" name="consent" required className="mt-0.5 size-4 accent-emerald" />
        I agree to be contacted by phone, WhatsApp or email about this enquiry.
      </label>
      <SubmitButton className="w-full" pendingText="Sending…">Submit enquiry</SubmitButton>
    </form>
  );
}
