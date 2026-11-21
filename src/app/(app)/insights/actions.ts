"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSession, ctxOf } from "@/lib/auth/session";
import { aiAvailable } from "@/lib/ai/claude";
import { aiBriefing, askAssistant } from "@/lib/ai/assistant";
import { rateLimit } from "@/lib/security/rate-limit";

const historySchema = z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(8000) })).min(1).max(24);

export type AskResult = { answer?: string; error?: string; tools?: string[] };

export async function askAction(history: unknown): Promise<AskResult> {
  const session = await requireSession();
  if (!aiAvailable()) return { error: "The AI assistant isn't configured on this server (ANTHROPIC_API_KEY is missing)." };
  const parsed = historySchema.safeParse(history);
  if (!parsed.success) return { error: "Invalid conversation." };
  if (!(await rateLimit(`ai:${session.userId}`, 40, 3600))) return { error: "You've reached the hourly limit for AI questions. Try again later." };
  try {
    const r = await askAssistant({ ...ctxOf(session), orgName: session.orgName, currency: session.currency }, parsed.data);
    return { answer: r.answer, tools: [...new Set(r.tools)] };
  } catch (e) {
    console.error("[assistant]", e);
    return { error: "The AI assistant couldn't answer right now. Please try again." };
  }
}

export async function briefingAction(): Promise<AskResult> {
  const session = await requireSession();
  if (!aiAvailable()) return { error: "The AI assistant isn't configured on this server (ANTHROPIC_API_KEY is missing)." };
  if (!(await rateLimit(`ai:${session.userId}`, 40, 3600))) return { error: "You've reached the hourly limit for AI requests. Try again later." };
  try {
    const r = await aiBriefing({ ...ctxOf(session), orgName: session.orgName, currency: session.currency });
    return { answer: r.answer, tools: [...new Set(r.tools)] };
  } catch (e) {
    console.error("[briefing]", e);
    return { error: "Couldn't generate the briefing right now. Please try again." };
  }
}

export async function refreshInsightsAction() {
  await requireSession();
  revalidatePath("/insights");
}
