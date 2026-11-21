CREATE TYPE "public"."activity_type" AS ENUM('note', 'call', 'email', 'whatsapp', 'meeting', 'stage_change', 'assignment', 'follow_up', 'site_visit', 'booking', 'payment', 'system');--> statement-breakpoint
CREATE TYPE "public"."automation_action" AS ENUM('assign_round_robin', 'assign_user', 'notify_owner', 'notify_managers', 'create_follow_up', 'send_whatsapp_template');--> statement-breakpoint
CREATE TYPE "public"."automation_trigger" AS ENUM('lead_created', 'lead_stage_changed', 'lead_neglected', 'follow_up_overdue', 'site_visit_upcoming');--> statement-breakpoint
CREATE TYPE "public"."booking_status" AS ENUM('active', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."campaign_channel" AS ENUM('meta_ads', 'google_ads', 'website', 'portal', 'whatsapp', 'referral', 'offline', 'other');--> statement-breakpoint
CREATE TYPE "public"."follow_up_status" AS ENUM('pending', 'done', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."follow_up_type" AS ENUM('call', 'whatsapp', 'email', 'meeting', 'other');--> statement-breakpoint
CREATE TYPE "public"."integration_provider" AS ENUM('whatsapp', 'meta_leads', 'google_leads');--> statement-breakpoint
CREATE TYPE "public"."intent" AS ENUM('hot', 'warm', 'cold');--> statement-breakpoint
CREATE TYPE "public"."lead_source" AS ENUM('manual', 'import', 'website', 'api', 'meta_ads', 'google_ads', 'whatsapp', 'portal', 'referral', 'walk_in', 'other');--> statement-breakpoint
CREATE TYPE "public"."lead_stage" AS ENUM('new', 'contacted', 'qualified', 'follow_up', 'site_visit_scheduled', 'negotiation', 'booked', 'lost');--> statement-breakpoint
CREATE TYPE "public"."message_direction" AS ENUM('inbound', 'outbound');--> statement-breakpoint
CREATE TYPE "public"."message_status" AS ENUM('pending', 'sent', 'delivered', 'read', 'failed', 'received');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('bank_transfer', 'cheque', 'upi', 'card', 'cash', 'home_loan', 'other');--> statement-breakpoint
CREATE TYPE "public"."priority" AS ENUM('low', 'medium', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('planning', 'pre_launch', 'under_construction', 'ready_to_move', 'completed');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('org_admin', 'sales_manager', 'sales_executive', 'marketing_manager');--> statement-breakpoint
CREATE TYPE "public"."purchase_timeline" AS ENUM('immediate', 'within_3_months', 'within_6_months', 'later', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."unit_status" AS ENUM('available', 'reserved', 'booked', 'sold');--> statement-breakpoint
CREATE TYPE "public"."visit_status" AS ENUM('scheduled', 'confirmed', 'completed', 'no_show', 'cancelled');--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"created_by_id" uuid,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"details" jsonb,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"trigger" "automation_trigger" NOT NULL,
	"conditions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"action" "automation_action" NOT NULL,
	"action_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"rr_cursor" integer DEFAULT 0 NOT NULL,
	"run_count" integer DEFAULT 0 NOT NULL,
	"last_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"rule_id" uuid NOT NULL,
	"subject_key" text NOT NULL,
	"result" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"lead_id" uuid,
	"project_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"customer_name" text NOT NULL,
	"customer_phone" text,
	"customer_email" text,
	"booking_date" date NOT NULL,
	"agreement_value" numeric(16, 2) NOT NULL,
	"booking_amount" numeric(16, 2) NOT NULL,
	"status" "booking_status" DEFAULT 'active' NOT NULL,
	"sales_user_id" uuid,
	"campaign_id" uuid,
	"source" "lead_source",
	"cancelled_at" timestamp with time zone,
	"cancellation_reason" text,
	"refund_amount" numeric(16, 2),
	"notes" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_spend" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"spend_date" date NOT NULL,
	"amount" numeric(16, 2) NOT NULL,
	"impressions" integer,
	"clicks" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"channel" "campaign_channel" NOT NULL,
	"project_id" uuid,
	"external_id" text,
	"utm_campaign" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"start_date" date,
	"end_date" date,
	"budget" numeric(16, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custom_field_defs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"field_type" text DEFAULT 'text' NOT NULL,
	"options" text[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "follow_ups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"assigned_to_id" uuid,
	"due_at" timestamp with time zone NOT NULL,
	"type" "follow_up_type" DEFAULT 'call' NOT NULL,
	"note" text,
	"status" "follow_up_status" DEFAULT 'pending' NOT NULL,
	"outcome" text,
	"completed_at" timestamp with time zone,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider" "integration_provider" NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"secrets_enc" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_event_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"role" "role" NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitations_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "lead_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"user_id" uuid,
	"type" "activity_type" NOT NULL,
	"direction" "message_direction",
	"outcome" text,
	"body" text,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_forms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"intro" text,
	"project_id" uuid,
	"campaign_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"submissions" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_forms_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"phone_normalized" text,
	"email" text,
	"email_normalized" text,
	"budget_min" numeric(16, 2),
	"budget_max" numeric(16, 2),
	"preferred_location" text,
	"property_type" text,
	"configuration" text,
	"timeline" "purchase_timeline" DEFAULT 'unknown' NOT NULL,
	"project_id" uuid,
	"source" "lead_source" DEFAULT 'manual' NOT NULL,
	"campaign_id" uuid,
	"owner_id" uuid,
	"stage" "lead_stage" DEFAULT 'new' NOT NULL,
	"stage_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"priority" "priority" DEFAULT 'medium' NOT NULL,
	"lost_reason" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" text,
	"score" integer,
	"conversion_probability" numeric(5, 4),
	"intent" "intent",
	"score_reasons" jsonb,
	"next_action" text,
	"scored_at" timestamp with time zone,
	"score_before_close" integer,
	"closed_at" timestamp with time zone,
	"last_contacted_at" timestamp with time zone,
	"last_inbound_at" timestamp with time zone,
	"whatsapp_handoff" boolean DEFAULT false NOT NULL,
	"duplicate_of_id" uuid,
	"external_ref" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "role" NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"phone" text,
	"monthly_booking_target" integer,
	"monthly_revenue_target" numeric(16, 2),
	"receives_leads" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"purpose" text DEFAULT 'general' NOT NULL,
	"body" text NOT NULL,
	"variable_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"link" text,
	"dedupe_key" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"timezone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"plan" text DEFAULT 'trial' NOT NULL,
	"trial_ends_at" timestamp with time zone,
	"ai_agent_enabled" boolean DEFAULT false NOT NULL,
	"neglect_days" integer DEFAULT 3 NOT NULL,
	"last_sweep_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "payment_milestones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"name" text NOT NULL,
	"due_date" date NOT NULL,
	"amount" numeric(16, 2) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"milestone_id" uuid,
	"amount" numeric(16, 2) NOT NULL,
	"paid_on" date NOT NULL,
	"method" "payment_method" NOT NULL,
	"reference" text,
	"notes" text,
	"recorded_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"location" text NOT NULL,
	"city" text,
	"developer" text,
	"property_type" text NOT NULL,
	"status" "project_status" DEFAULT 'under_construction' NOT NULL,
	"total_units" integer DEFAULT 0 NOT NULL,
	"price_from" numeric(16, 2),
	"price_to" numeric(16, 2),
	"rera_number" text,
	"possession_date" date,
	"description" text,
	"amenities" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limits_key_window_start_pk" PRIMARY KEY("key","window_start")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" uuid NOT NULL,
	"organization_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "site_visits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"assigned_to_id" uuid,
	"scheduled_at" timestamp with time zone NOT NULL,
	"status" "visit_status" DEFAULT 'scheduled' NOT NULL,
	"customer_confirmed" boolean DEFAULT false NOT NULL,
	"reschedule_count" integer DEFAULT 0 NOT NULL,
	"interest_level" text,
	"feedback" text,
	"completed_at" timestamp with time zone,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"tower" text DEFAULT '' NOT NULL,
	"unit_number" text NOT NULL,
	"floor" integer NOT NULL,
	"configuration" text NOT NULL,
	"carpet_area" numeric(10, 2) NOT NULL,
	"price" numeric(16, 2) NOT NULL,
	"facing" text,
	"floor_plan_url" text,
	"status" "unit_status" DEFAULT 'available' NOT NULL,
	"reserved_for_lead_id" uuid,
	"reserved_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"is_super_admin" boolean DEFAULT false NOT NULL,
	"failed_logins" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"lead_id" uuid,
	"direction" "message_direction" NOT NULL,
	"body" text,
	"template_name" text,
	"wa_message_id" text,
	"status" "message_status" NOT NULL,
	"error" text,
	"sent_by_id" uuid,
	"sent_by_agent" boolean DEFAULT false NOT NULL,
	"status_updated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_rule_id_automation_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."automation_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_sales_user_id_users_id_fk" FOREIGN KEY ("sales_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_spend" ADD CONSTRAINT "campaign_spend_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_spend" ADD CONSTRAINT "campaign_spend_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_defs" ADD CONSTRAINT "custom_field_defs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_assigned_to_id_users_id_fk" FOREIGN KEY ("assigned_to_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_id_users_id_fk" FOREIGN KEY ("invited_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_forms" ADD CONSTRAINT "lead_forms_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_forms" ADD CONSTRAINT "lead_forms_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_forms" ADD CONSTRAINT "lead_forms_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_milestones" ADD CONSTRAINT "payment_milestones_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_milestones" ADD CONSTRAINT "payment_milestones_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_milestone_id_payment_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."payment_milestones"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_id_users_id_fk" FOREIGN KEY ("recorded_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_visits" ADD CONSTRAINT "site_visits_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_visits" ADD CONSTRAINT "site_visits_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_visits" ADD CONSTRAINT "site_visits_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_visits" ADD CONSTRAINT "site_visits_assigned_to_id_users_id_fk" FOREIGN KEY ("assigned_to_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_visits" ADD CONSTRAINT "site_visits_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_sent_by_id_users_id_fk" FOREIGN KEY ("sent_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_org_created_idx" ON "audit_logs" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "automation_runs_rule_subject_idx" ON "automation_runs" USING btree ("rule_id","subject_key");--> statement-breakpoint
CREATE INDEX "bookings_org_date_idx" ON "bookings" USING btree ("organization_id","booking_date");--> statement-breakpoint
CREATE UNIQUE INDEX "spend_campaign_date_idx" ON "campaign_spend" USING btree ("campaign_id","spend_date");--> statement-breakpoint
CREATE INDEX "campaigns_org_idx" ON "campaigns" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "custom_fields_org_key_idx" ON "custom_field_defs" USING btree ("organization_id","key");--> statement-breakpoint
CREATE INDEX "follow_ups_org_due_idx" ON "follow_ups" USING btree ("organization_id","status","due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "integrations_org_provider_idx" ON "integrations" USING btree ("organization_id","provider");--> statement-breakpoint
CREATE INDEX "activities_lead_idx" ON "lead_activities" USING btree ("lead_id","created_at");--> statement-breakpoint
CREATE INDEX "leads_org_stage_idx" ON "leads" USING btree ("organization_id","stage");--> statement-breakpoint
CREATE INDEX "leads_org_owner_idx" ON "leads" USING btree ("organization_id","owner_id");--> statement-breakpoint
CREATE INDEX "leads_org_created_idx" ON "leads" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "leads_org_phone_idx" ON "leads" USING btree ("organization_id","phone_normalized");--> statement-breakpoint
CREATE INDEX "leads_org_email_idx" ON "leads" USING btree ("organization_id","email_normalized");--> statement-breakpoint
CREATE INDEX "leads_org_campaign_idx" ON "leads" USING btree ("organization_id","campaign_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_org_user_idx" ON "memberships" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","read_at","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedupe_idx" ON "notifications" USING btree ("organization_id","user_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "milestones_booking_idx" ON "payment_milestones" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "payments_org_paid_idx" ON "payments" USING btree ("organization_id","paid_on");--> statement-breakpoint
CREATE INDEX "projects_org_idx" ON "projects" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "visits_org_sched_idx" ON "site_visits" USING btree ("organization_id","scheduled_at");--> statement-breakpoint
CREATE UNIQUE INDEX "units_project_unit_idx" ON "units" USING btree ("project_id","tower","unit_number");--> statement-breakpoint
CREATE INDEX "units_org_status_idx" ON "units" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_idx" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "wa_lead_idx" ON "whatsapp_messages" USING btree ("lead_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "wa_message_id_idx" ON "whatsapp_messages" USING btree ("wa_message_id");