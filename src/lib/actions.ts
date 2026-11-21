import "server-only";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { ForbiddenError } from "@/lib/auth/permissions";
import { RateLimitError } from "@/lib/security/rate-limit";
import { UserError } from "@/lib/errors";

export { UserError, NotFoundError } from "@/lib/errors";

export type ActionState = {
  ok?: boolean;
  message?: string;
  error?: string;
  fieldErrors?: Record<string, string>;
  data?: unknown;
} | null;

/** Runs a server action body and converts expected failures into form state. */
export async function runAction(fn: () => Promise<ActionState | void>): Promise<ActionState> {
  try {
    return (await fn()) ?? { ok: true };
  } catch (err) {
    unstable_rethrow(err); // let redirect()/notFound() through
    if (err instanceof z.ZodError) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of err.issues) {
        const key = issue.path.join(".") || "form";
        fieldErrors[key] ??= issue.message;
      }
      return { error: "Please correct the highlighted fields.", fieldErrors };
    }
    if (err instanceof ForbiddenError || err instanceof RateLimitError || err instanceof UserError) {
      return { error: err.message };
    }
    console.error("[action] unexpected error", err);
    return { error: "Something went wrong. Please try again." };
  }
}

/** FormData → plain object; empty strings become undefined so optional fields validate cleanly. */
export function formObject(fd: FormData): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of fd.entries()) {
    if (typeof v !== "string" || k.startsWith("$ACTION")) continue;
    const t = v.trim();
    out[k] = t === "" ? undefined : t;
  }
  return out;
}
