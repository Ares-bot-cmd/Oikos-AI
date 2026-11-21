import "server-only";
import Anthropic from "@anthropic-ai/sdk";

export const MODEL = "claude-opus-5-5";
/** Server-side fallback on safety refusals (routes by refusal category). */
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";

let client: Anthropic | null = null;

export function aiAvailable() {
  return !!process.env.ANTHROPIC_API_KEY;
}

export function getClaude(): Anthropic {
  if (!aiAvailable()) throw new Error("ANTHROPIC_API_KEY is not configured");
  client ??= new Anthropic({ maxRetries: 2, timeout: 60_000 });
  return client;
}

export { Anthropic };
