"use server";

import { formObject, runAction, type ActionState } from "@/lib/actions";
import { submitPublicForm } from "@/lib/services/capture";
import { clientMeta } from "@/lib/auth/session";
import { rateLimit, RateLimitError } from "@/lib/security/rate-limit";
import { UserError } from "@/lib/errors";

export async function submitFormAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const d = formObject(fd);
  return runAction(async () => {
    // Bots fill the hidden field; pretend success so they don't retry.
    if (d.website) return { ok: true };
    const { ip } = await clientMeta();
    if (!(await rateLimit(`form:${ip}`, 10, 3600))) throw new RateLimitError("Too many submissions from your network. Please try again later.");
    if (!d.consent) throw new UserError("Please agree to be contacted so we can respond.");
    await submitPublicForm(String(d.slug ?? ""), {
      name: d.name ?? "",
      phone: d.phone,
      email: d.email,
      budget_max: d.budget ? Number(d.budget) : undefined,
      timeline: d.timeline as "immediate" | undefined,
      notes: d.notes,
      source: "website",
    });
    return { ok: true };
  });
}
