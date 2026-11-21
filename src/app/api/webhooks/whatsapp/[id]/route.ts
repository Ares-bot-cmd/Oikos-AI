import { after, NextResponse, type NextRequest } from "next/server";
import { markIntegrationEvent, processWhatsAppValue, verifyToken, webhookIntegration } from "@/lib/services/capture";
import { verifyMetaSignature } from "@/lib/security/crypto";
import { runWhatsAppAgent } from "@/lib/ai/agent";

type Ctx = { params: Promise<{ id: string }> };

/** Meta's webhook verification handshake. */
export async function GET(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const integration = await webhookIntegration(id, "whatsapp");
  const p = req.nextUrl.searchParams;
  if (!integration || p.get("hub.mode") !== "subscribe" || !verifyToken(integration.secrets.verifyToken, p.get("hub.verify_token"))) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  return new NextResponse(p.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const integration = await webhookIntegration(id, "whatsapp");
  if (!integration) return new NextResponse("Not found", { status: 404 });
  const raw = await req.text();
  if (raw.length > 1_000_000) return new NextResponse("Payload too large", { status: 413 });
  // Without a configured app secret we cannot verify the sender, so we refuse the payload.
  if (!integration.secrets.appSecret || !verifyMetaSignature(raw, req.headers.get("x-hub-signature-256"), integration.secrets.appSecret)) {
    return new NextResponse("Invalid signature", { status: 401 });
  }
  let body: { entry?: { changes?: { field?: string; value?: Record<string, unknown> }[] }[] };
  try {
    body = JSON.parse(raw);
  } catch {
    return new NextResponse("Bad request", { status: 400 });
  }
  const touched = new Set<string>();
  try {
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field !== "messages" || !change.value) continue;
        // Ignore events for other phone numbers on the same Meta app.
        const meta = change.value.metadata as { phone_number_id?: string } | undefined;
        if (meta?.phone_number_id && meta.phone_number_id !== integration.config.phoneNumberId) continue;
        for (const leadId of await processWhatsAppValue(integration.orgId, change.value)) touched.add(leadId);
      }
    }
    await markIntegrationEvent(integration.id);
  } catch (e) {
    console.error("[webhook/whatsapp]", e);
    await markIntegrationEvent(integration.id, "Failed to process an incoming event");
    return new NextResponse("Error", { status: 500 }); // Meta retries
  }
  // Reply with the AI agent after acknowledging Meta (it must get a fast 200).
  if (touched.size) {
    after(async () => {
      for (const leadId of touched) {
        await runWhatsAppAgent(integration.orgId, leadId).catch((e) => console.error("[agent]", e));
      }
    });
  }
  return NextResponse.json({ ok: true });
}
