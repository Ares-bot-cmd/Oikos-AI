"use client";

import { ActionForm, FormField, SubmitButton } from "@/components/ui/form";
import { acceptInviteAction, joinInviteAction } from "../../actions";

export function InviteForms({ token, defaultName, signedInAs }: { token: string; defaultName: string; signedInAs: string | null }) {
  if (signedInAs) {
    return (
      <ActionForm action={joinInviteAction} resetOnSuccess={false} className="space-y-4">
        <input type="hidden" name="token" value={token} />
        <p className="text-[13.5px] text-ink-2">You&apos;re signed in as {signedInAs}.</p>
        <SubmitButton className="w-full">Join organization</SubmitButton>
      </ActionForm>
    );
  }
  return (
    <ActionForm action={acceptInviteAction} resetOnSuccess={false} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <FormField label="Your name" name="name" required defaultValue={defaultName} inputProps={{ autoComplete: "name" }} />
      <FormField
        label="Choose a password"
        name="password"
        type="password"
        required
        hint="At least 10 characters, with a letter and a number."
        inputProps={{ autoComplete: "new-password" }}
      />
      <SubmitButton className="w-full" pendingText="Creating account…">
        Create account &amp; join
      </SubmitButton>
    </ActionForm>
  );
}
