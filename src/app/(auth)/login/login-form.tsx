"use client";

import { ActionForm, FormField, SubmitButton } from "@/components/ui/form";
import { loginAction } from "../actions";

export function LoginForm({ next }: { next?: string }) {
  return (
    <ActionForm action={loginAction} resetOnSuccess={false} className="space-y-4">
      {next && <input type="hidden" name="next" value={next} />}
      <FormField label="Work email" name="email" type="email" required inputProps={{ autoComplete: "email", autoFocus: true }} />
      <FormField label="Password" name="password" type="password" required inputProps={{ autoComplete: "current-password" }} />
      <SubmitButton className="w-full" pendingText="Signing in…">
        Sign in
      </SubmitButton>
    </ActionForm>
  );
}
