import { NextResponse, type NextRequest } from "next/server";
import { markIntegrationEvent, processGoogleLead, verifyToken, webhookIntegration } from "@/lib/services/capture";
import { UserError } from "@/lib/errors";

type Ctx = { params: Promise<{ id: string }> };

/** Google Ads lead form webhook. Google sends the configured key as `google_key` in the JSON body. */
export async function POST(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const integration = await webhookIntegration(id, "google_leads");
  if (!integration) return new NextResponse("Not found", { status: 404 });
  const raw = await req.text();
  if (raw.length > 100_000) return new NextResponse("Payload too large", { status: 413 });
  let body: Parameters<typeof processGoogleLead>[1] & { google_key?: string };
  try {
    body = JSON.parse(raw);
  } catch {
    return new NextResponse("Bad request", { status: 400 });
  }
  if (!verifyToken(integration.secrets.googleKey, body.google_key ?? null)) return new NextResponse("Invalid key", { status: 401 });
  try {
    const r = await processGoogleLead(integration, body);
    await markIntegrationEvent(integration.id);
    return NextResponse.json({ ok: true, id: r.id });
  } catch (e) {
    const message = e instanceof UserError ? e.message : "Failed to process lead";
    if (!(e instanceof UserError)) console.error("[webhook/google-leads]", e);
    await markIntegrationEvent(integration.id, message);
    return NextResponse.json({ error: message }, { status: e instanceof UserError ? 422 : 500 });
  }
}
