import "server-only";
import { headers } from "next/headers";

/** Public base URL for links we hand out (invites, webhooks, forms). */
export async function appUrl(): Promise<string> {
  const configured = process.env.APP_URL?.trim().replace(/\/$/, "");
  if (configured) return configured;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
