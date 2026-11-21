import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ─── Enums ──────────────────────────────────────────────────────────────────

export const roleEnum = pgEnum("role", [
  "org_admin",
  "sales_manager",
  "sales_executive",
  "marketing_manager",
]);

export const leadStageEnum = pgEnum("lead_stage", [
  "new",
  "contacted",
  "qualified",
  "follow_up",
  "site_visit_scheduled",
  "negotiation",
  "booked",
  "lost",
]);

export const priorityEnum = pgEnum("priority", ["low", "medium", "high", "urgent"]);
export const intentEnum = pgEnum("intent", ["hot", "warm", "cold"]);

export const leadSourceEnum = pgEnum("lead_source", [
  "manual",
  "import",
  "website",
  "api",
  "meta_ads",
  "google_ads",
  "whatsapp",
  "portal",
  "referral",
  "walk_in",
  "other",
]);

export const timelineEnum = pgEnum("purchase_timeline", [
  "immediate",
  "within_3_months",
  "within_6_months",
  "later",
  "unknown",
]);

export const activityTypeEnum = pgEnum("activity_type", [
  "note",
  "call",
  "email",
  "whatsapp",
  "meeting",
  "stage_change",
  "assignment",
  "follow_up",
  "site_visit",
  "booking",
  "payment",
  "system",
]);

export const followUpStatusEnum = pgEnum("follow_up_status", ["pending", "done", "cancelled"]);
export const followUpTypeEnum = pgEnum("follow_up_type", ["call", "whatsapp", "email", "meeting", "other"]);

export const visitStatusEnum = pgEnum("visit_status", [
  "scheduled",
  "confirmed",
  "completed",
  "no_show",
  "cancelled",
]);

export const projectStatusEnum = pgEnum("project_status", [
  "planning",
  "pre_launch",
  "under_construction",
  "ready_to_move",
  "completed",
]);

export const unitStatusEnum = pgEnum("unit_status", ["available", "reserved", "booked", "sold"]);

export const channelEnum = pgEnum("campaign_channel", [
  "meta_ads",
  "google_ads",
  "website",
  "portal",
  "whatsapp",
  "referral",
  "offline",
  "other",
]);

export const bookingStatusEnum = pgEnum("booking_status", ["active", "completed", "cancelled"]);
export const paymentMethodEnum = pgEnum("payment_method", [
  "bank_transfer",
  "cheque",
  "upi",
  "card",
  "cash",
  "home_loan",
  "other",
]);

export const messageDirectionEnum = pgEnum("message_direction", ["inbound", "outbound"]);
export const messageStatusEnum = pgEnum("message_status", [
  "pending",
  "sent",
  "delivered",
  "read",
  "failed",
  "received",
]);

export const integrationProviderEnum = pgEnum("integration_provider", [
  "whatsapp",
  "meta_leads",
  "google_leads",
]);

export const automationTriggerEnum = pgEnum("automation_trigger", [
  "lead_created",
  "lead_stage_changed",
  "lead_neglected",
  "follow_up_overdue",
  "site_visit_upcoming",
]);

export const automationActionEnum = pgEnum("automation_action", [
  "assign_round_robin",
  "assign_user",
  "notify_owner",
  "notify_managers",
  "create_follow_up",
  "send_whatsapp_template",
]);

// ─── Helpers ────────────────────────────────────────────────────────────────

const id = () => uuid("id").primaryKey().defaultRandom();
const orgId = () => uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" });
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const money = (name: string) => numeric(name, { precision: 16, scale: 2, mode: "number" });

// ─── Tenancy & identity ─────────────────────────────────────────────────────

export const organizations = pgTable("organizations", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  currency: text("currency").notNull().default("INR"),
  timezone: text("timezone").notNull().default("Asia/Kolkata"),
  plan: text("plan").notNull().default("trial"),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  aiAgentEnabled: boolean("ai_agent_enabled").notNull().default(false),
  neglectDays: integer("neglect_days").notNull().default(3),
  lastSweepAt: timestamp("last_sweep_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const users = pgTable(
  "users",
  {
    id: id(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    passwordHash: text("password_hash").notNull(),
    isSuperAdmin: boolean("is_super_admin").notNull().default(false),
    failedLogins: integer("failed_logins").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("users_email_lower_idx").on(sql`lower(${t.email})`)],
);

export const memberships = pgTable(
  "memberships",
  {
    id: id(),
    organizationId: orgId(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: roleEnum("role").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    phone: text("phone"),
    monthlyBookingTarget: integer("monthly_booking_target"),
    monthlyRevenueTarget: money("monthly_revenue_target"),
    receivesLeads: boolean("receives_leads").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("memberships_org_user_idx").on(t.organizationId, t.userId)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    tokenHash: text("token_hash").notNull().unique(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const invitations = pgTable("invitations", {
  id: id(),
  organizationId: orgId(),
  email: text("email").notNull(),
  name: text("name"),
  role: roleEnum("role").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  invitedById: uuid("invited_by_id").references(() => users.id, { onDelete: "set null" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    organizationId: orgId(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    details: jsonb("details").$type<Record<string, unknown>>(),
    ip: text("ip"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_org_created_idx").on(t.organizationId, t.createdAt)],
);

export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] })],
);

// ─── Property ───────────────────────────────────────────────────────────────

export const projects = pgTable(
  "projects",
  {
    id: id(),
    organizationId: orgId(),
    name: text("name").notNull(),
    location: text("location").notNull(),
    city: text("city"),
    developer: text("developer"),
    propertyType: text("property_type").notNull(),
    status: projectStatusEnum("status").notNull().default("under_construction"),
    totalUnits: integer("total_units").notNull().default(0),
    priceFrom: money("price_from"),
    priceTo: money("price_to"),
    reraNumber: text("rera_number"),
    possessionDate: date("possession_date"),
    description: text("description"),
    amenities: text("amenities"),
    createdAt: createdAt(),
  },
  (t) => [index("projects_org_idx").on(t.organizationId)],
);

export const units = pgTable(
  "units",
  {
    id: id(),
    organizationId: orgId(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    tower: text("tower").notNull().default(""),
    unitNumber: text("unit_number").notNull(),
    floor: integer("floor").notNull(),
    configuration: text("configuration").notNull(),
    carpetArea: numeric("carpet_area", { precision: 10, scale: 2, mode: "number" }).notNull(),
    price: money("price").notNull(),
    facing: text("facing"),
    floorPlanUrl: text("floor_plan_url"),
    status: unitStatusEnum("status").notNull().default("available"),
    reservedForLeadId: uuid("reserved_for_lead_id"),
    reservedUntil: timestamp("reserved_until", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("units_project_unit_idx").on(t.projectId, t.tower, t.unitNumber),
    index("units_org_status_idx").on(t.organizationId, t.status),
  ],
);

// ─── Marketing ──────────────────────────────────────────────────────────────

export const campaigns = pgTable(
  "campaigns",
  {
    id: id(),
    organizationId: orgId(),
    name: text("name").notNull(),
    channel: channelEnum("channel").notNull(),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    externalId: text("external_id"),
    utmCampaign: text("utm_campaign"),
    isActive: boolean("is_active").notNull().default(true),
    startDate: date("start_date"),
    endDate: date("end_date"),
    budget: money("budget"),
    createdAt: createdAt(),
  },
  (t) => [index("campaigns_org_idx").on(t.organizationId)],
);

export const campaignSpend = pgTable(
  "campaign_spend",
  {
    id: id(),
    organizationId: orgId(),
    campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
    spendDate: date("spend_date").notNull(),
    amount: money("amount").notNull(),
    impressions: integer("impressions"),
    clicks: integer("clicks"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("spend_campaign_date_idx").on(t.campaignId, t.spendDate)],
);

// ─── CRM ────────────────────────────────────────────────────────────────────

export const leads = pgTable(
  "leads",
  {
    id: id(),
    organizationId: orgId(),
    name: text("name").notNull(),
    phone: text("phone"),
    phoneNormalized: text("phone_normalized"),
    email: text("email"),
    emailNormalized: text("email_normalized"),
    budgetMin: money("budget_min"),
    budgetMax: money("budget_max"),
    preferredLocation: text("preferred_location"),
    propertyType: text("property_type"),
    configuration: text("configuration"),
    timeline: timelineEnum("timeline").notNull().default("unknown"),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    source: leadSourceEnum("source").notNull().default("manual"),
    campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    stage: leadStageEnum("stage").notNull().default("new"),
    stageChangedAt: timestamp("stage_changed_at", { withTimezone: true }).notNull().defaultNow(),
    priority: priorityEnum("priority").notNull().default("medium"),
    lostReason: text("lost_reason"),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    customFields: jsonb("custom_fields").$type<Record<string, string>>().notNull().default({}),
    notes: text("notes"),
    // Explainable scoring (see services/scoring.ts)
    score: integer("score"),
    conversionProbability: numeric("conversion_probability", { precision: 5, scale: 4, mode: "number" }),
    intent: intentEnum("intent"),
    scoreReasons: jsonb("score_reasons").$type<{ label: string; points: number }[]>(),
    nextAction: text("next_action"),
    scoredAt: timestamp("scored_at", { withTimezone: true }),
    // Score the lead had while still open, captured when it is booked or lost (calibration input).
    scoreBeforeClose: integer("score_before_close"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    lastContactedAt: timestamp("last_contacted_at", { withTimezone: true }),
    lastInboundAt: timestamp("last_inbound_at", { withTimezone: true }),
    whatsappHandoff: boolean("whatsapp_handoff").notNull().default(false),
    duplicateOfId: uuid("duplicate_of_id"),
    externalRef: text("external_ref"),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("leads_org_stage_idx").on(t.organizationId, t.stage),
    index("leads_org_owner_idx").on(t.organizationId, t.ownerId),
    index("leads_org_created_idx").on(t.organizationId, t.createdAt),
    index("leads_org_phone_idx").on(t.organizationId, t.phoneNormalized),
    index("leads_org_email_idx").on(t.organizationId, t.emailNormalized),
    index("leads_org_campaign_idx").on(t.organizationId, t.campaignId),
  ],
);

export const leadActivities = pgTable(
  "lead_activities",
  {
    id: id(),
    organizationId: orgId(),
    leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    type: activityTypeEnum("type").notNull(),
    direction: messageDirectionEnum("direction"),
    outcome: text("outcome"),
    body: text("body"),
    meta: jsonb("meta").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index("activities_lead_idx").on(t.leadId, t.createdAt)],
);

export const customFieldDefs = pgTable(
  "custom_field_defs",
  {
    id: id(),
    organizationId: orgId(),
    key: text("key").notNull(),
    label: text("label").notNull(),
    fieldType: text("field_type").notNull().default("text"),
    options: text("options").array(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("custom_fields_org_key_idx").on(t.organizationId, t.key)],
);

export const followUps = pgTable(
  "follow_ups",
  {
    id: id(),
    organizationId: orgId(),
    leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
    assignedToId: uuid("assigned_to_id").references(() => users.id, { onDelete: "set null" }),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    type: followUpTypeEnum("type").notNull().default("call"),
    note: text("note"),
    status: followUpStatusEnum("status").notNull().default("pending"),
    outcome: text("outcome"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("follow_ups_org_due_idx").on(t.organizationId, t.status, t.dueAt)],
);

export const siteVisits = pgTable(
  "site_visits",
  {
    id: id(),
    organizationId: orgId(),
    leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    assignedToId: uuid("assigned_to_id").references(() => users.id, { onDelete: "set null" }),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    status: visitStatusEnum("status").notNull().default("scheduled"),
    customerConfirmed: boolean("customer_confirmed").notNull().default(false),
    rescheduleCount: integer("reschedule_count").notNull().default(0),
    interestLevel: text("interest_level"),
    feedback: text("feedback"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("visits_org_sched_idx").on(t.organizationId, t.scheduledAt)],
);

// ─── Bookings & payments ────────────────────────────────────────────────────

export const bookings = pgTable(
  "bookings",
  {
    id: id(),
    organizationId: orgId(),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "restrict" }),
    unitId: uuid("unit_id").notNull().references(() => units.id, { onDelete: "restrict" }),
    customerName: text("customer_name").notNull(),
    customerPhone: text("customer_phone"),
    customerEmail: text("customer_email"),
    bookingDate: date("booking_date").notNull(),
    agreementValue: money("agreement_value").notNull(),
    bookingAmount: money("booking_amount").notNull(),
    status: bookingStatusEnum("status").notNull().default("active"),
    salesUserId: uuid("sales_user_id").references(() => users.id, { onDelete: "set null" }),
    campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
    source: leadSourceEnum("source"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancellationReason: text("cancellation_reason"),
    refundAmount: money("refund_amount"),
    notes: text("notes"),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("bookings_org_date_idx").on(t.organizationId, t.bookingDate)],
);

export const paymentMilestones = pgTable(
  "payment_milestones",
  {
    id: id(),
    organizationId: orgId(),
    bookingId: uuid("booking_id").notNull().references(() => bookings.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    dueDate: date("due_date").notNull(),
    amount: money("amount").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("milestones_booking_idx").on(t.bookingId)],
);

export const payments = pgTable(
  "payments",
  {
    id: id(),
    organizationId: orgId(),
    bookingId: uuid("booking_id").notNull().references(() => bookings.id, { onDelete: "cascade" }),
    milestoneId: uuid("milestone_id").references(() => paymentMilestones.id, { onDelete: "set null" }),
    amount: money("amount").notNull(),
    paidOn: date("paid_on").notNull(),
    method: paymentMethodEnum("method").notNull(),
    reference: text("reference"),
    notes: text("notes"),
    recordedById: uuid("recorded_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("payments_org_paid_idx").on(t.organizationId, t.paidOn)],
);

// ─── Messaging & automation ─────────────────────────────────────────────────

export const integrations = pgTable(
  "integrations",
  {
    id: id(),
    organizationId: orgId(),
    provider: integrationProviderEnum("provider").notNull(),
    // Non-secret settings (ids, phone number id, default project…)
    config: jsonb("config").$type<Record<string, string>>().notNull().default({}),
    // AES-256-GCM encrypted JSON of secrets (tokens, app secret)
    secretsEnc: text("secrets_enc"),
    isActive: boolean("is_active").notNull().default(true),
    lastEventAt: timestamp("last_event_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("integrations_org_provider_idx").on(t.organizationId, t.provider)],
);

export const whatsappMessages = pgTable(
  "whatsapp_messages",
  {
    id: id(),
    organizationId: orgId(),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "cascade" }),
    direction: messageDirectionEnum("direction").notNull(),
    body: text("body"),
    templateName: text("template_name"),
    waMessageId: text("wa_message_id"),
    status: messageStatusEnum("status").notNull(),
    error: text("error"),
    sentById: uuid("sent_by_id").references(() => users.id, { onDelete: "set null" }),
    sentByAgent: boolean("sent_by_agent").notNull().default(false),
    statusUpdatedAt: timestamp("status_updated_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("wa_lead_idx").on(t.leadId, t.createdAt),
    uniqueIndex("wa_message_id_idx").on(t.waMessageId),
  ],
);

export const messageTemplates = pgTable("message_templates", {
  id: id(),
  organizationId: orgId(),
  name: text("name").notNull(),
  language: text("language").notNull().default("en"),
  purpose: text("purpose").notNull().default("general"),
  body: text("body").notNull(),
  variableCount: integer("variable_count").notNull().default(0),
  createdAt: createdAt(),
});

export const automationRules = pgTable("automation_rules", {
  id: id(),
  organizationId: orgId(),
  name: text("name").notNull(),
  trigger: automationTriggerEnum("trigger").notNull(),
  conditions: jsonb("conditions").$type<Record<string, string>>().notNull().default({}),
  action: automationActionEnum("action").notNull(),
  actionConfig: jsonb("action_config").$type<Record<string, string>>().notNull().default({}),
  isActive: boolean("is_active").notNull().default(true),
  rrCursor: integer("rr_cursor").notNull().default(0),
  runCount: integer("run_count").notNull().default(0),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  createdAt: createdAt(),
});

/** Idempotency for automations fired by the scheduled sweep (one run per rule per subject). */
export const automationRuns = pgTable(
  "automation_runs",
  {
    id: id(),
    organizationId: orgId(),
    ruleId: uuid("rule_id").notNull().references(() => automationRules.id, { onDelete: "cascade" }),
    subjectKey: text("subject_key").notNull(),
    result: text("result"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("automation_runs_rule_subject_idx").on(t.ruleId, t.subjectKey)],
);

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    organizationId: orgId(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    link: text("link"),
    dedupeKey: text("dedupe_key"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("notifications_user_idx").on(t.userId, t.readAt, t.createdAt),
    uniqueIndex("notifications_dedupe_idx").on(t.organizationId, t.userId, t.dedupeKey),
  ],
);

// ─── Lead capture ───────────────────────────────────────────────────────────

export const apiKeys = pgTable("api_keys", {
  id: id(),
  organizationId: orgId(),
  name: text("name").notNull(),
  prefix: text("prefix").notNull(),
  keyHash: text("key_hash").notNull().unique(),
  createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const leadForms = pgTable("lead_forms", {
  id: id(),
  organizationId: orgId(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  intro: text("intro"),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
  isActive: boolean("is_active").notNull().default(true),
  submissions: integer("submissions").notNull().default(0),
  createdAt: createdAt(),
});

/** Tables that carry organization_id and are protected by row-level security. */
export const TENANT_TABLES = [
  "memberships",
  "invitations",
  "audit_logs",
  "projects",
  "units",
  "campaigns",
  "campaign_spend",
  "leads",
  "lead_activities",
  "custom_field_defs",
  "follow_ups",
  "site_visits",
  "bookings",
  "payment_milestones",
  "payments",
  "integrations",
  "whatsapp_messages",
  "message_templates",
  "automation_rules",
  "automation_runs",
  "notifications",
  "api_keys",
  "lead_forms",
] as const;
