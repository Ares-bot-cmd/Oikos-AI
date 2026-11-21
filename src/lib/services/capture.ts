import "server-only";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/lib/db";
import { withSystem, withTenant, type TenantCtx } from "@/lib/db/tenant";
import { apiKeys, campaigns, integrations, leadActivities, leadForms, leads, organizations, projects, whatsappMessages } from "@/lib/db/schema";
import { assertCan } from "@/lib/auth/permissions";
import { NotFoundError, UserError } from "@/lib/errors";
import { decryptJson, encryptJson, randomToken, safeEqual, sha256 } from "@/lib/security/crypto";
import { normalizePhone, slugify } from "@/lib/utils";
import { audit } from "./audit";
import { createLead, rescoreLead, type LeadInput } from "./leads";
import { applyStatus } from "./whatsapp";

const SYSTEM = (orgId: string): TenantCtx => ({ orgId, userId: null, role: "system" });

// ─── API keys ───────────────────────────────────────────────────────────────

export async function createApiKey(tx: Tx, ctx: TenantCtx, name: string) {
  assertCan(ctx.role, "integrations:manage");
  const clean = z.string().trim().min(2, "Name the key").max(80).parse(name);
  const raw = `ok_live_${randomToken(24)}`;
  await tx.insert(apiKeys).values({ organizationId: ctx.orgId, name: clean, prefix: raw.slice(0, 14), keyHash: sha256(raw), createdById: ctx.userId });
  await audit(tx, ctx, "api_key.created", { type: "api_key" }, { name: clean });
  return raw; // shown once, never stored in plain text
}

export async function revokeApiKey(tx: Tx, ctx: TenantCtx, id: string) {
  assertCan(ctx.role, "integrations:manage");
  if (!z.uuid().safeParse(id).success) throw new NotFoundError("API key");
  const r = await tx.update(apiKeys).set({ revokedAt: new Date() }).where(and(eq(apiKeys.id, id), isNull(apiKeys.revokedAt))).returning({ id: apiKeys.id });
  if (!r.length) throw new NotFoundError("API key");
  await audit(tx, ctx, "api_key.revoked", { type: "api_key", id });
}

export async function listApiKeys(tx: Tx) {
  return tx.select({ id: apiKeys.id, name: apiKeys.name, prefix: apiKeys.prefix, lastUsedAt: apiKeys.lastUsedAt, revokedAt: apiKeys.revokedAt, createdAt: apiKeys.createdAt }).from(apiKeys).orderBy(desc(apiKeys.createdAt));
}

/** Resolves a bearer key to its organization (system lookup by hash). */
export async function resolveApiKey(raw: string | null): Promise<string | null> {
  if (!raw || !raw.startsWith("ok_live_") || raw.length > 100) return null;
  return withSystem(async (tx) => {
    const [k] = await tx.select({ id: apiKeys.id, orgId: apiKeys.organizationId }).from(apiKeys).where(and(eq(apiKeys.keyHash, sha256(raw)), isNull(apiKeys.revokedAt))).limit(1);
    if (!k) return null;
    await tx.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, k.id));
    return k.orgId;
  });
}

// ─── Inbound lead payload (API, forms, ad webhooks) ─────────────────────────

export const captureSchema = z.object({
  name: z.string().trim().min(1, "name is required").max(120),
  phone: z.string().trim().max(30).optional(),
  email: z.email().trim().max(200).optional(),
  budget_min: z.coerce.number().min(0).max(1e13).optional(),
  budget_max: z.coerce.number().min(0).max(1e13).optional(),
  preferred_location: z.string().trim().max(120).optional(),
  property_type: z.string().trim().max(60).optional(),
  configuration: z.string().trim().max(60).optional(),
  timeline: z.enum(["immediate", "within_3_months", "within_6_months", "later", "unknown"]).optional(),
  project: z.string().trim().max(120).optional(),
  campaign: z.string().trim().max(120).optional(),
  source: z.enum(["website", "api", "meta_ads", "google_ads", "portal", "referral", "walk_in", "other"]).optional(),
  notes: z.string().trim().max(2000).optional(),
  external_ref: z.string().trim().max(200).optional(),
});
export type CapturePayload = z.infer<typeof captureSchema>;

async function resolveProjectCampaign(tx: Tx, project?: string, campaign?: string) {
  let projectId: string | undefined;
  let campaignId: string | undefined;
  if (project) {
    const [p] = await tx
      .select({ id: projects.id })
      .from(projects)
      .where(z.uuid().safeParse(project).success ? eq(projects.id, project) : sql`lower(${projects.name}) = ${project.toLowerCase()}`)
      .limit(1);
    projectId = p?.id;
  }
  if (campaign) {
    const [c] = await tx
      .select({ id: campaigns.id, projectId: campaigns.projectId })
      .from(campaigns)
      .where(
        z.uuid().safeParse(campaign).success
          ? eq(campaigns.id, campaign)
          : sql`lower(${campaigns.name}) = ${campaign.toLowerCase()} or ${campaigns.externalId} = ${campaign} or lower(${campaigns.utmCampaign}) = ${campaign.toLowerCase()}`,
      )
      .limit(1);
    campaignId = c?.id;
    projectId ??= c?.projectId ?? undefined;
  }
  return { projectId, campaignId };
}

/** Creates (or merges into an existing duplicate) a lead from an external source. */
export async function captureLead(orgId: string, payload: CapturePayload, defaultSource: LeadInput["source"], note?: string) {
  const d = captureSchema.parse(payload);
  if (!d.phone && !d.email) throw new UserError("phone or email is required");
  if (d.phone && !normalizePhone(d.phone)) throw new UserError("phone is not a valid number");
  return withTenant(SYSTEM(orgId), async (tx) => {
    const { projectId, campaignId } = await resolveProjectCampaign(tx, d.project, d.campaign);
    return createLead(
      tx,
      SYSTEM(orgId),
      {
        name: d.name, phone: d.phone, email: d.email, budgetMin: d.budget_min, budgetMax: d.budget_max, preferredLocation: d.preferred_location,
        propertyType: d.property_type, configuration: d.configuration, timeline: d.timeline ?? "unknown", projectId, campaignId,
        source: d.source ?? defaultSource, notes: d.notes, externalRef: d.external_ref,
      },
      { mergeDuplicates: true, activityNote: note },
    );
  });
}

// ─── Hosted lead forms ──────────────────────────────────────────────────────

export const formSchema = z.object({
  title: z.string().trim().min(2, "Give the form a title").max(120),
  intro: z.string().trim().max(500).optional(),
  projectId: z.uuid().optional(),
  campaignId: z.uuid().optional(),
});

export async function createForm(tx: Tx, ctx: TenantCtx, input: z.input<typeof formSchema>) {
  assertCan(ctx.role, "integrations:manage");
  const d = formSchema.parse(input);
  const slug = `${slugify(d.title) || "enquiry"}-${randomToken(4).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5)}`;
  await tx.insert(leadForms).values({ organizationId: ctx.orgId, slug, ...d });
  return slug;
}

export async function toggleForm(tx: Tx, ctx: TenantCtx, id: string, active: boolean) {
  assertCan(ctx.role, "integrations:manage");
  const r = await tx.update(leadForms).set({ isActive: active }).where(eq(leadForms.id, id)).returning({ id: leadForms.id });
  if (!r.length) throw new NotFoundError("Form");
}

export async function listForms(tx: Tx) {
  return tx
    .select({ form: leadForms, projectName: projects.name, campaignName: campaigns.name })
    .from(leadForms)
    .leftJoin(projects, eq(projects.id, leadForms.projectId))
    .leftJoin(campaigns, eq(campaigns.id, leadForms.campaignId))
    .orderBy(desc(leadForms.createdAt));
}

export async function publicForm(slug: string) {
  if (!/^[a-z0-9-]{3,80}$/.test(slug)) return null;
  return withSystem(async (tx) => {
    const [row] = await tx
      .select({ id: leadForms.id, orgId: leadForms.organizationId, title: leadForms.title, intro: leadForms.intro, isActive: leadForms.isActive, orgName: organizations.name, projectId: leadForms.projectId, campaignId: leadForms.campaignId, projectName: projects.name })
      .from(leadForms)
      .innerJoin(organizations, eq(organizations.id, leadForms.organizationId))
      .leftJoin(projects, eq(projects.id, leadForms.projectId))
      .where(eq(leadForms.slug, slug))
      .limit(1);
    return row && row.isActive ? row : null;
  });
}

export async function submitPublicForm(slug: string, payload: CapturePayload) {
  const form = await publicForm(slug);
  if (!form) throw new NotFoundError("Form");
  const result = await captureLead(form.orgId, { ...payload, project: form.projectId ?? payload.project, campaign: form.campaignId ?? payload.campaign }, "website", `Website form: ${form.title}`);
  await withSystem((tx) => tx.update(leadForms).set({ submissions: sql`${leadForms.submissions} + 1` }).where(eq(leadForms.id, form.id)));
  return result;
}

// ─── Integration settings ───────────────────────────────────────────────────

export type Provider = "whatsapp" | "meta_leads" | "google_leads";

export async function getIntegrations(tx: Tx) {
  const rows = await tx.select().from(integrations);
  return Object.fromEntries(
    rows.map((r) => {
      const secrets = decryptJson<Record<string, string>>(r.secretsEnc) ?? {};
      // Never send secrets to the browser: only whether each one is set.
      const secretFlags = Object.fromEntries(Object.entries(secrets).map(([k, v]) => [k, !!v]));
      return [r.provider, { id: r.id, config: r.config, secretFlags, isActive: r.isActive, lastEventAt: r.lastEventAt, lastError: r.lastError }];
    }),
  ) as Partial<Record<Provider, { id: string; config: Record<string, string>; secretFlags: Record<string, boolean>; isActive: boolean; lastEventAt: Date | null; lastError: string | null }>>;
}

/** Saves an integration. Blank secret fields keep the stored value. */
export async function saveIntegration(tx: Tx, ctx: TenantCtx, provider: Provider, config: Record<string, string>, secrets: Record<string, string | undefined>) {
  assertCan(ctx.role, "integrations:manage");
  const [existing] = await tx.select().from(integrations).where(eq(integrations.provider, provider));
  const merged = { ...(decryptJson<Record<string, string>>(existing?.secretsEnc) ?? {}) };
  for (const [k, v] of Object.entries(secrets)) if (v) merged[k] = v;
  if (provider !== "google_leads" && !merged.verifyToken) merged.verifyToken = randomToken(18);
  if (provider === "google_leads" && !merged.googleKey) merged.googleKey = randomToken(18);
  const values = { config, secretsEnc: encryptJson(merged), isActive: true, lastError: null };
  if (existing) await tx.update(integrations).set(values).where(eq(integrations.id, existing.id));
  else await tx.insert(integrations).values({ organizationId: ctx.orgId, provider, ...values });
  await audit(tx, ctx, "integration.saved", { type: "integration", id: provider });
}

export async function disconnectIntegration(tx: Tx, ctx: TenantCtx, provider: Provider) {
  assertCan(ctx.role, "integrations:manage");
  await tx.delete(integrations).where(eq(integrations.provider, provider));
  await audit(tx, ctx, "integration.disconnected", { type: "integration", id: provider });
}

export async function integrationSecrets(tx: Tx, ctx: TenantCtx, provider: Provider) {
  assertCan(ctx.role, "integrations:manage");
  const [row] = await tx.select().from(integrations).where(eq(integrations.provider, provider));
  return row ? decryptJson<Record<string, string>>(row.secretsEnc) : null;
}

/** System lookup for webhooks: the integration id in the URL selects the organization and its secrets. */
export async function webhookIntegration(id: string, provider: Provider) {
  if (!z.uuid().safeParse(id).success) return null;
  return withSystem(async (tx) => {
    const [row] = await tx.select().from(integrations).where(and(eq(integrations.id, id), eq(integrations.provider, provider), eq(integrations.isActive, true)));
    if (!row) return null;
    return { id: row.id, orgId: row.organizationId, config: row.config as Record<string, string>, secrets: decryptJson<Record<string, string>>(row.secretsEnc) ?? {} };
  });
}

export async function markIntegrationEvent(id: string, error?: string) {
  await withSystem((tx) => tx.update(integrations).set({ lastEventAt: new Date(), lastError: error?.slice(0, 500) ?? null }).where(eq(integrations.id, id)));
}

export function verifyToken(expected: string | undefined, given: string | null) {
  return !!expected && !!given && safeEqual(expected, given);
}

// ─── Meta Lead Ads ──────────────────────────────────────────────────────────

const META_FIELD_MAP: Record<string, keyof CapturePayload> = {
  full_name: "name", name: "name", first_name: "name", phone_number: "phone", phone: "phone", email: "email",
  city: "preferred_location", budget: "budget_max", what_is_your_budget: "budget_max", configuration: "configuration",
};

export async function processMetaLeadgen(integration: NonNullable<Awaited<ReturnType<typeof webhookIntegration>>>, leadgenId: string) {
  const token = integration.secrets.pageAccessToken;
  if (!token) throw new Error("Page access token not configured");
  const version = process.env.WHATSAPP_GRAPH_VERSION || "v23.0";
  const res = await fetch(`https://graph.facebook.com/${version}/${encodeURIComponent(leadgenId)}?fields=field_data,campaign_id,campaign_name,ad_id,form_id,created_time`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  });
  const json = (await res.json().catch(() => ({}))) as { field_data?: { name: string; values: string[] }[]; campaign_id?: string; campaign_name?: string; error?: { message: string } };
  if (!res.ok || !json.field_data) throw new Error(json.error?.message ?? `Graph API HTTP ${res.status}`);
  const payload: Record<string, string> = {};
  const extras: string[] = [];
  for (const f of json.field_data) {
    const key = META_FIELD_MAP[f.name.toLowerCase()];
    const value = f.values?.[0] ?? "";
    if (key && !payload[key]) payload[key] = key === "budget_max" ? value.replace(/[^\d.]/g, "") : value;
    else extras.push(`${f.name}: ${value}`);
  }
  return captureLead(
    integration.orgId,
    {
      ...(payload as unknown as CapturePayload),
      name: payload.name || "Meta lead",
      campaign: json.campaign_id ?? json.campaign_name,
      project: integration.config.defaultProjectId || undefined,
      source: "meta_ads",
      external_ref: `meta:${leadgenId}`,
      notes: extras.length ? extras.join("\n").slice(0, 2000) : undefined,
    },
    "meta_ads",
    "Lead from Meta Lead Ads",
  );
}

// ─── Google Ads lead form webhook ───────────────────────────────────────────

const GOOGLE_COLUMNS: Record<string, keyof CapturePayload> = {
  FULL_NAME: "name", FIRST_NAME: "name", PHONE_NUMBER: "phone", EMAIL: "email", CITY: "preferred_location",
};

export async function processGoogleLead(integration: NonNullable<Awaited<ReturnType<typeof webhookIntegration>>>, body: {
  lead_id?: string; campaign_id?: string | number; user_column_data?: { column_id?: string; column_name?: string; string_value?: string }[]; is_test?: boolean;
}) {
  const payload: Record<string, string> = {};
  const extras: string[] = [];
  for (const c of body.user_column_data ?? []) {
    const key = c.column_id ? GOOGLE_COLUMNS[c.column_id] : undefined;
    if (key && !payload[key]) payload[key] = c.string_value ?? "";
    else if (c.string_value) extras.push(`${c.column_name ?? c.column_id}: ${c.string_value}`);
  }
  return captureLead(
    integration.orgId,
    {
      ...(payload as unknown as CapturePayload),
      name: payload.name || "Google Ads lead",
      campaign: body.campaign_id != null ? String(body.campaign_id) : undefined,
      project: integration.config.defaultProjectId || undefined,
      source: "google_ads",
      external_ref: body.lead_id ? `google:${body.lead_id}` : undefined,
      notes: [body.is_test ? "Test lead from Google Ads" : null, ...extras].filter(Boolean).join("\n").slice(0, 2000) || undefined,
    },
    "google_ads",
    "Lead from Google Ads lead form",
  );
}

// ─── WhatsApp inbound ───────────────────────────────────────────────────────

type WaValue = {
  contacts?: { profile?: { name?: string }; wa_id?: string }[];
  messages?: { from: string; id: string; timestamp?: string; type: string; text?: { body: string }; button?: { text: string }; interactive?: { button_reply?: { title: string }; list_reply?: { title: string } } }[];
  statuses?: { id: string; status: string; errors?: { title?: string; message?: string }[] }[];
};

/** Stores inbound messages (creating a lead for new numbers) and applies delivery statuses. Returns leads that received messages. */
export async function processWhatsAppValue(orgId: string, value: WaValue) {
  const touched: string[] = [];
  await withTenant(SYSTEM(orgId), async (tx) => {
    for (const s of value.statuses ?? []) {
      await applyStatus(tx, s.id, s.status, s.errors?.[0]?.message ?? s.errors?.[0]?.title);
    }
    for (const m of value.messages ?? []) {
      const phone = normalizePhone(m.from);
      if (!phone) continue;
      const exists = await tx.select({ id: whatsappMessages.id }).from(whatsappMessages).where(eq(whatsappMessages.waMessageId, m.id)).limit(1);
      if (exists.length) continue; // Meta retries deliveries; process each message once
      const body = m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? `[${m.type} message]`;
      let [lead] = await tx.select({ id: leads.id, stage: leads.stage }).from(leads).where(eq(leads.phoneNormalized, phone)).limit(1);
      if (!lead) {
        const name = value.contacts?.find((c) => c.wa_id === m.from)?.profile?.name?.slice(0, 120) || `WhatsApp +${phone}`;
        const created = await createLead(tx, SYSTEM(orgId), { name, phone: `+${phone}`, source: "whatsapp", notes: body.slice(0, 2000) }, { mergeDuplicates: true, activityNote: "Lead started a WhatsApp conversation" });
        lead = { id: created.id, stage: "new" };
      }
      await tx.insert(whatsappMessages).values({ organizationId: orgId, leadId: lead.id, direction: "inbound", body: body.slice(0, 4096), waMessageId: m.id, status: "received", statusUpdatedAt: new Date() });
      await tx.insert(leadActivities).values({ organizationId: orgId, leadId: lead.id, type: "whatsapp", direction: "inbound", body: body.slice(0, 4000) });
      await tx.update(leads).set({ lastInboundAt: new Date(), updatedAt: new Date() }).where(eq(leads.id, lead.id));
      await rescoreLead(tx, SYSTEM(orgId), lead.id);
      touched.push(lead.id);
    }
  });
  return [...new Set(touched)];
}
