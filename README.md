# Oikos AI

The operating system for real estate sales and revenue — a multi-tenant SaaS for developers, builders and sales teams to capture leads, run the sales pipeline, manage inventory, bookings and collections, and understand marketing ROI and revenue.

## Modules

| Area | What it does |
| --- | --- |
| **Dashboard** | KPIs with period comparison (leads, qualified, visits, bookings, conversion, booked revenue, spend, CPL, cost per booking), revenue and lead trends, funnel, campaign / executive / project performance, follow-ups, activity, AI recommendations. Date and project filters. |
| **CRM** | Leads with full profile and interaction timeline, Kanban pipeline (drag & drop), contacts, follow-ups, site visits, duplicate detection (phone/email), assignment and bulk assignment, tags, custom fields, CSV/XLSX import, CSV export. |
| **AI lead intelligence** | Deterministic, explainable scoring from real data (budget vs live inventory, timeline, responses, recency, follow-ups, visits, stage, the org's own source conversion). Conversion probability calibrated on the org's closed leads (≥ 30), next best action. |
| **Sales team** | Leaderboard, calls, follow-ups, visits, bookings, revenue, conversion, first-response time, monthly targets. Roles: Organization Admin, Sales Manager, Sales Executive, Marketing Manager (+ platform Super Admin). |
| **Property** | Projects, towers/units (bulk generation with floor rise), available → reserved → booked → sold, reservations with expiry. |
| **Bookings & payments** | Bookings tied to lead + unit, payment plans/milestones, payments, outstanding and overdue receivables, cancellations with refunds (unit released). |
| **Marketing intelligence** | Campaigns, spend (manual or CSV import), first-touch attribution: leads, qualified, visits, bookings, revenue, CPL, cost per booking, ROI; source conversion. |
| **Revenue intelligence** | Actual (booked, collected) vs projected (pipeline-weighted + trend forecast), breakdowns by project/campaign/executive/source, leakage (overdue, cancellations, discounts, late losses, idle hot leads, stalled negotiations). |
| **AI insights** | Rule-based recommendations citing their numbers; Claude-powered assistant and weekly briefing that answer only through tenant-scoped data tools. |
| **WhatsApp** | Official WhatsApp Business Cloud API: inbox, text (24h window) and template messages, delivery/read status from signed webhooks, inbound lead capture, human handoff, AI agent. |
| **Automation & notifications** | Rules (round-robin/fixed assignment, notify owner/managers, create follow-up, send WhatsApp template) on lead created / stage change / neglect / overdue follow-up / upcoming visit; built-in alerts for missed follow-ups, qualified leads, visits and payments. |
| **Lead capture** | Hosted web forms, REST API with API keys, Meta Lead Ads and Google Ads lead-form webhooks. |
| **Reports** | 8 reports (lead acquisition, conversion, sales performance, marketing ROI, project performance, revenue, bookings, follow-up activity) as CSV or PDF. |

## Architecture

- **Next.js 16** (App Router, Server Components, Server Actions), TypeScript, Tailwind CSS 4, Recharts.
- **PostgreSQL** via Drizzle ORM. Production: Neon. Local dev/tests: embedded **PGlite** (no database server needed).
- **Tenant isolation in the database**: every tenant table has `organization_id` and row-level-security policies. Each request runs in a transaction that switches to the restricted `oikos_app` role with `app.org_id` set (`src/lib/db/tenant.ts`), so even a query without a tenant filter can't read or write another organization's rows. Role/ownership rules (e.g. executives see only their leads) are enforced on top in the service layer.
- Services in `src/lib/services/*` hold all business logic and are tested directly; pages and actions are thin.

## Security

Bcrypt (cost 12) passwords, lockout after 5 failures, DB-backed rate limiting (sign-in, sign-up, API, forms, AI), opaque session tokens stored hashed with HttpOnly/Secure/SameSite cookies, Server Action origin checks (CSRF), CSP and security headers, zod validation on every input, AES-256-GCM encryption for integration credentials, HMAC verification of Meta webhooks, constant-time secret comparisons, CSV formula-injection protection, upload type/size/row limits, audit log.

## Run locally

```bash
npm install
npm run dev          # http://localhost:3000 — uses embedded PGlite in ./.data
```

Copy `.env.example` to `.env.local` to set `ANTHROPIC_API_KEY` (AI assistant/agent) or point `DATABASE_URL` at Postgres.

## Tests

```bash
npm test             # Vitest: unit + integration (real Postgres via PGlite, RLS isolation, workflows, security)
npx playwright install chromium
npm run build && npm run test:e2e   # Playwright: end-to-end workflows, security, responsive, performance smoke
```

## Deploy (Vercel + Neon)

1. Connect a Neon database to the Vercel project (sets `DATABASE_URL` and `DATABASE_URL_UNPOOLED`).
2. Set `SECRET_KEY` and `CRON_SECRET` (long random strings); optionally `ANTHROPIC_API_KEY` and `APP_URL`.
3. Deploy. `npm run vercel-build` applies migrations (`scripts/migrate.ts`) before building; a daily cron calls `/api/cron`.

Migrations live in `drizzle/`. After changing `src/lib/db/schema.ts`, run `npm run db:generate`; when adding a tenant table, add it to `TENANT_TABLES` and generate an RLS migration (`node scripts/gen-rls.mjs`).
