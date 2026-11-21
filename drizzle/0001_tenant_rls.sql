-- Row-level security: every tenant table is readable/writable by the restricted
-- oikos_app role only for rows of the organization set in app.org_id. Application
-- requests run inside a transaction that switches to oikos_app (src/lib/db/tenant.ts).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'oikos_app') THEN
    CREATE ROLE oikos_app NOLOGIN;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  EXECUTE format('GRANT oikos_app TO %I', current_user);
EXCEPTION WHEN others THEN
  RAISE NOTICE 'could not grant oikos_app to %: %', current_user, SQLERRM;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_org_id() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.org_id', true), '')::uuid
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO oikos_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_org_id() TO oikos_app;
--> statement-breakpoint
ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "memberships_tenant_isolation" ON "memberships" TO oikos_app USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "memberships" TO oikos_app;
--> statement-breakpoint
ALTER TABLE "invitations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "invitations_tenant_isolation" ON "invitations" TO oikos_app USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "invitations" TO oikos_app;
--> statement-breakpoint
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "audit_logs_tenant_isolation" ON "audit_logs" TO oikos_app USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "audit_logs" TO oikos_app;
--> statement-breakpoint
ALTER TABLE "projects" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "projects_tenant_isolation" ON "projects" TO oikos_app USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "projects" TO oikos_app;
--> statement-breakpoint
ALTER TABLE "units" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "units_tenant_isolation" ON "units" TO oikos_app USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "units" TO oikos_app;
--> statement-breakpoint
ALTER TABLE "campaigns" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "campaigns_tenant_isolation" ON "campaigns" TO oikos_app USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "campaigns" TO oikos_app;
--> statement-breakpoint
ALTER TABLE "campaign_spend" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "campaign_spend_tenant_isolation" ON "campaign_spend" TO oikos_app USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "campaign_spend" TO oikos_app;
--> statement-breakpoint
ALTER TABLE "leads" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "leads_tenant_isolation" ON "leads" TO oikos_app USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "leads" TO oikos_app;
--> statement-breakpoint
ALTER TABLE "lead_activities" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "lead_activities_tenant_isolation" ON "lead_activities" TO oikos_app USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "lead_activities" TO oikos_app;
--> statement-breakpoint
ALTER TABLE "custom_field_defs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "custom_field_defs_tenant_isolation" ON "custom_field_defs" TO oikos_app USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "custom_field_defs" TO oikos_app;
--> statement-breakpoint
ALTER TABLE "follow_ups" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "follow_ups_tenant_isolation" ON "follow_ups" TO oikos_app USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "follow_ups" TO oikos_app;
--> statement-breakpoint
ALTER TABLE "site_visits" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "site_visits_tenant_isolation" ON "site_visits" TO oikos_app USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "site_visits" TO oikos_app;
--> statement-breakpoint
ALTER TABLE "bookings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "bookings_tenant_isolation" ON "bookings" TO oikos_app USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "bookings" TO oikos_app;
--> statement-breakpoint
ALTER TABLE "payment_milestones" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "payment_milestones_tenant_isolation" ON "payment_milestones" TO oikos_app USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "payment_milestones" TO oikos_app;
--> statement-breakpoint
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "payments_tenant_isolation" ON "payments" TO oikos_app USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "payments" TO oikos_app;
--> statement-breakpoint
ALTER TABLE "integrations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "integrations_tenant_isolation" ON "integrations" TO oikos_app USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "integrations" TO oikos_app;
--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "whatsapp_messages_tenant_isolation" ON "whatsapp_messages" TO oikos_app USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "whatsapp_messages" TO oikos_app;
--> statement-breakpoint
ALTER TABLE "message_templates" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "message_templates_tenant_isolation" ON "message_templates" TO oikos_app USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "message_templates" TO oikos_app;
--> statement-breakpoint
ALTER TABLE "automation_rules" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "automation_rules_tenant_isolation" ON "automation_rules" TO oikos_app USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "automation_rules" TO oikos_app;
--> statement-breakpoint
ALTER TABLE "automation_runs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "automation_runs_tenant_isolation" ON "automation_runs" TO oikos_app USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "automation_runs" TO oikos_app;
--> statement-breakpoint
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "notifications_tenant_isolation" ON "notifications" TO oikos_app USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "notifications" TO oikos_app;
--> statement-breakpoint
ALTER TABLE "api_keys" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "api_keys_tenant_isolation" ON "api_keys" TO oikos_app USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "api_keys" TO oikos_app;
--> statement-breakpoint
ALTER TABLE "lead_forms" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "lead_forms_tenant_isolation" ON "lead_forms" TO oikos_app USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "lead_forms" TO oikos_app;
--> statement-breakpoint
ALTER TABLE "organizations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "organizations_self" ON "organizations" TO oikos_app USING (id = app_org_id()) WITH CHECK (id = app_org_id());
--> statement-breakpoint
GRANT SELECT, UPDATE ON "organizations" TO oikos_app;
--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "users_same_org" ON "users" TO oikos_app USING (EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = users.id AND m.organization_id = app_org_id()));
--> statement-breakpoint
-- Password hashes and lockout state are never readable from a tenant transaction.
GRANT SELECT ("id", "email", "name", "created_at", "last_login_at") ON "users" TO oikos_app;
