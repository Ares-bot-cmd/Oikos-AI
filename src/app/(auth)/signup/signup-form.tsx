"use client";

import { ActionForm, FormField, SubmitButton } from "@/components/ui/form";
import { signupAction } from "../actions";

export function SignupForm() {
  return (
    <ActionForm action={signupAction} resetOnSuccess={false} className="space-y-4">
      <FormField label="Your name" name="name" required inputProps={{ autoComplete: "name", autoFocus: true }} />
      <FormField label="Company name" name="organization" required placeholder="e.g. Greenfield Developers" />
      <FormField label="Work email" name="email" type="email" required inputProps={{ autoComplete: "email" }} />
      <FormField
        label="Password"
        name="password"
        type="password"
        required
        hint="At least 10 characters, with a letter and a number."
        inputProps={{ autoComplete: "new-password" }}
      />
      <SubmitButton className="w-full" pendingText="Creating workspace…">
        Create workspace
      </SubmitButton>
    </ActionForm>
  );
}
