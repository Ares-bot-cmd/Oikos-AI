import { after, NextResponse, type NextRequest } from "next/server";
import { markIntegrationEvent, processMetaLeadgen, verifyToken, webhookIntegration } from "@/lib/services/capture";
import { verifyMetaSignature } from "@/lib/security/crypto";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const integration = await webhookIntegration(id, "meta_leads");
  const p = req.nextUrl.searchParams;
  if (!integration || p.get("hub.mode") !== "subscribe" || !verifyToken(integration.secrets.verifyToken, p.get("hub.verify_token"))) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  return new NextResponse(p.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const integration = await webhookIntegration(id, "meta_leads");
  if (!integration) return new NextResponse("Not found", { status: 404 });
  const raw = await req.text();
  if (raw.length > 500_000) return new NextResponse("Payload too large", { status: 413 });
  if (!integration.secrets.appSecret || !verifyMetaSignature(raw, req.headers.get("x-hub-signature-256"), integration.secrets.appSecret)) {
    return new NextResponse("Invalid signature", { status: 401 });
  }
  let body: { entry?: { id?: string; changes?: { field?: string; value?: { leadgen_id?: string; page_id?: string } }[] }[] };
  try {
    body = JSON.parse(raw);
  } catch {
    return new NextResponse("Bad request", { status: 400 });
  }
  const leadgenIds: string[] = [];
  for (const entry of body.entry ?? []) {
    for (const c of entry.changes ?? []) {
      if (c.field !== "leadgen" || !c.value?.leadgen_id) continue;
      if (integration.config.pageId && c.value.page_id && c.value.page_id !== integration.config.pageId) continue;
      leadgenIds.push(String(c.value.leadgen_id).slice(0, 64));
    }
  }
  // Fetch lead details from the Graph API after acknowledging the webhook.
  after(async () => {
    for (const leadgenId of leadgenIds) {
      try {
        await processMetaLeadgen(integration, leadgenId);
        await markIntegrationEvent(integration.id);
      } catch (e) {
        console.error("[webhook/meta-leads]", e);
        await markIntegrationEvent(integration.id, e instanceof Error ? e.message : "Failed to fetch lead");
      }
    }
  });
  return NextResponse.json({ ok: true, received: leadgenIds.length });
}
