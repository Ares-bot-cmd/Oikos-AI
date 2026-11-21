import type { Metadata } from "next";
import { loadPage } from "@/lib/server-action";
import { can } from "@/lib/auth/permissions";
import { aiAvailable } from "@/lib/ai/claude";
import { appUrl } from "@/lib/app-url";
import { getIntegrations, integrationSecrets, listApiKeys, listForms } from "@/lib/services/capture";
import { projectOptions } from "@/lib/services/projects";
import { campaignOptions } from "@/lib/services/marketing";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Badge } from "@/components/ui/badge";
import { InlineAction } from "@/components/ui/form";
import { NoAccess } from "@/components/app/bits";
import { formatDateTime, relativeTime } from "@/lib/utils";
import { disconnectIntegrationAction, revokeApiKeyAction, toggleFormAction } from "../actions";
import { CopyField, CreateApiKeyButton, CreateFormButton, IntegrationForm } from "../forms";

export const metadata: Metadata = { title: "Integrations" };

export default async function IntegrationsSettings() {
  const { session, data } = await loadPage(async (tx, ctx) => {
    if (!can(ctx.role, "integrations:manage")) return null;
    const [ints, keys, forms, projects, campaigns] = await Promise.all([getIntegrations(tx), listApiKeys(tx), listForms(tx), projectOptions(tx), campaignOptions(tx)]);
    // Verify tokens / Google key are shown to admins so they can paste them into Meta / Google.
    const [wa, meta, google] = await Promise.all([
      ints.whatsapp ? integrationSecrets(tx, ctx, "whatsapp") : null,
      ints.meta_leads ? integrationSecrets(tx, ctx, "meta_leads") : null,
      ints.google_leads ? integrationSecrets(tx, ctx, "google_leads") : null,
    ]);
    return { ints, keys, forms, projects, campaigns, tokens: { wa: wa?.verifyToken, meta: meta?.verifyToken, google: google?.googleKey } };
  });
  if (!data) return <NoAccess what="integrations" />;
  const base = await appUrl();
  const { ints, tokens } = data;
  const projects = data.projects.map((p) => ({ value: p.id, label: p.name }));
  const tz = session.timezone;
  const status = (i?: { lastEventAt: Date | null; lastError: string | null }) =>
    !i ? <Badge>Not connected</Badge> : i.lastError ? <Badge tone="danger">Error: {i.lastError.slice(0, 60)}</Badge> : <Badge tone="positive">Connected{i.lastEventAt ? ` · last event ${relativeTime(i.lastEventAt)}` : " · no events yet"}</Badge>;

  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader title="WhatsApp Business (Cloud API)" description="Send and receive WhatsApp messages, templates, reminders and the AI agent" actions={status(ints.whatsapp)} />
        <div className="grid gap-6 p-4 lg:grid-cols-2">
          <IntegrationForm
            provider="whatsapp"
            configured={!!ints.whatsapp}
            fields={[
              { name: "phoneNumberId", label: "Phone number ID", value: ints.whatsapp?.config.phoneNumberId, required: true, hint: "Meta App → WhatsApp → API setup" },
              { name: "wabaId", label: "WhatsApp Business Account ID", value: ints.whatsapp?.config.wabaId },
              { name: "displayPhone", label: "Display phone number", value: ints.whatsapp?.config.displayPhone },
            ]}
            secretFields={[
              { name: "accessToken", label: "Permanent access token", set: !!ints.whatsapp?.secretFlags.accessToken, hint: "System-user token with whatsapp_business_messaging" },
              { name: "appSecret", label: "App secret", set: !!ints.whatsapp?.secretFlags.appSecret, hint: "Used to verify webhook signatures" },
            ]}
          />
          <div className="space-y-3 text-[13px]">
            <p className="text-ink-2">In your Meta app, set the WhatsApp webhook to the URL below with this verify token, and subscribe to <code>messages</code>.</p>
            {ints.whatsapp ? (
              <>
                <CopyField label="Callback URL" value={`${base}/api/webhooks/whatsapp/${ints.whatsapp.id}`} />
                {tokens.wa && <CopyField label="Verify token" value={tokens.wa} />}
                <InlineAction action={disconnectIntegrationAction} fields={{ provider: "whatsapp" }} variant="danger" confirm="Disconnect WhatsApp and delete its stored credentials?">Disconnect</InlineAction>
              </>
            ) : <p className="text-muted">Save the connection to get your webhook URL.</p>}
          </div>
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Meta Lead Ads (Facebook & Instagram)" description="New lead-form submissions arrive as leads instantly, attributed to the matching campaign ID" actions={status(ints.meta_leads)} />
        <div className="grid gap-6 p-4 lg:grid-cols-2">
          <IntegrationForm
            provider="meta_leads"
            configured={!!ints.meta_leads}
            projects={projects}
            defaultProject={ints.meta_leads?.config.defaultProjectId}
            fields={[{ name: "pageId", label: "Facebook Page ID", value: ints.meta_leads?.config.pageId }]}
            secretFields={[
              { name: "pageAccessToken", label: "Page access token", set: !!ints.meta_leads?.secretFlags.pageAccessToken, hint: "Needs leads_retrieval and pages_manage_ads" },
              { name: "appSecret", label: "App secret", set: !!ints.meta_leads?.secretFlags.appSecret },
            ]}
          />
          <div className="space-y-3 text-[13px]">
            <p className="text-ink-2">In your Meta app, add a <strong>Page</strong> webhook subscription to the <code>leadgen</code> field using this URL and verify token. Set each campaign&apos;s &quot;Ad platform campaign ID&quot; in Marketing for attribution.</p>
            {ints.meta_leads ? (
              <>
                <CopyField label="Callback URL" value={`${base}/api/webhooks/meta-leads/${ints.meta_leads.id}`} />
                {tokens.meta && <CopyField label="Verify token" value={tokens.meta} />}
                <InlineAction action={disconnectIntegrationAction} fields={{ provider: "meta_leads" }} variant="danger" confirm="Disconnect Meta Lead Ads?">Disconnect</InlineAction>
              </>
            ) : <p className="text-muted">Save the connection to get your webhook URL.</p>}
          </div>
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Google Ads lead forms" description="Lead form extensions post directly to Oikos through a webhook" actions={status(ints.google_leads)} />
        <div className="grid gap-6 p-4 lg:grid-cols-2">
          <IntegrationForm provider="google_leads" configured={!!ints.google_leads} projects={projects} defaultProject={ints.google_leads?.config.defaultProjectId} fields={[]} secretFields={[]} />
          <div className="space-y-3 text-[13px]">
            <p className="text-ink-2">In Google Ads → your lead form → <em>Lead delivery</em>, add a webhook with this URL and key. Campaign IDs are matched to campaigns in Marketing.</p>
            {ints.google_leads ? (
              <>
                <CopyField label="Webhook URL" value={`${base}/api/webhooks/google-leads/${ints.google_leads.id}`} />
                {tokens.google && <CopyField label="Key" value={tokens.google} />}
                <InlineAction action={disconnectIntegrationAction} fields={{ provider: "google_leads" }} variant="danger" confirm="Disconnect Google Ads lead forms?">Disconnect</InlineAction>
              </>
            ) : <p className="text-muted">Click Connect to generate your webhook URL and key.</p>}
          </div>
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Website forms & API" description="Capture leads from your website, landing pages or any system" actions={<><CreateFormButton projects={projects} campaigns={data.campaigns.map((c) => ({ value: c.id, label: c.name }))} /><CreateApiKeyButton /></>} />
        <div className="grid gap-6 p-4 lg:grid-cols-2">
          <div>
            <h3 className="mb-2 text-[13.5px] font-semibold">Hosted lead forms</h3>
            <ul className="divide-y divide-line rounded-md border border-line">
              {data.forms.map(({ form, projectName, campaignName }) => (
                <li key={form.id} className="flex items-center justify-between gap-3 px-3 py-2 text-[13px]">
                  <div className="min-w-0">
                    <a href={`/f/${form.slug}`} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline">{form.title}</a>
                    <div className="truncate text-xs text-muted">{form.submissions} submissions{projectName ? ` · ${projectName}` : ""}{campaignName ? ` · ${campaignName}` : ""}</div>
                  </div>
                  <InlineAction action={toggleFormAction} fields={{ id: form.id, active: String(!form.isActive) }} variant="ghost">{form.isActive ? "Disable" : "Enable"}</InlineAction>
                </li>
              ))}
              {!data.forms.length && <li className="px-3 py-4 text-center text-xs text-muted">No forms yet.</li>}
            </ul>
          </div>
          <div>
            <h3 className="mb-2 text-[13.5px] font-semibold">API keys</h3>
            <ul className="divide-y divide-line rounded-md border border-line">
              {data.keys.map((k) => (
                <li key={k.id} className="flex items-center justify-between gap-3 px-3 py-2 text-[13px]">
                  <div><span className="font-medium">{k.name}</span> <code className="text-xs text-muted">{k.prefix}…</code>
                    <div className="text-xs text-muted">{k.revokedAt ? `Revoked ${formatDateTime(k.revokedAt, tz)}` : k.lastUsedAt ? `Last used ${relativeTime(k.lastUsedAt)}` : "Never used"}</div>
                  </div>
                  {!k.revokedAt && <InlineAction action={revokeApiKeyAction} fields={{ id: k.id }} variant="ghost" confirm="Revoke this key? Systems using it will stop working.">Revoke</InlineAction>}
                </li>
              ))}
              {!data.keys.length && <li className="px-3 py-4 text-center text-xs text-muted">No API keys yet.</li>}
            </ul>
            <pre className="mt-3 overflow-x-auto rounded-md bg-forest p-3 text-[11.5px] leading-relaxed text-ivory">{`POST ${base}/api/v1/leads
Authorization: Bearer ok_live_…
Content-Type: application/json

{ "name": "Priya Sharma", "phone": "+919876543210",
  "email": "priya@example.com", "budget_max": 9000000,
  "project": "Skyline Residences", "campaign": "Diwali Meta",
  "source": "website", "notes": "Wants 2BHK" }`}</pre>
          </div>
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="AI (Anthropic Claude)" description="Powers the AI assistant, briefings and the WhatsApp agent" actions={aiAvailable() ? <Badge tone="positive">Configured on server</Badge> : <Badge tone="warning">Not configured</Badge>} />
        <p className="p-4 text-[13px] text-ink-2">The API key is a server environment variable (<code>ANTHROPIC_API_KEY</code>) and is never sent to the browser. Lead scoring, forecasting and the rule-based insights work without it.</p>
      </Panel>
    </div>
  );
}
