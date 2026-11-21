import { beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { withSystem, withTenant, type TenantCtx } from "@/lib/db/tenant";
import { leadActivities, leads, memberships, units, users } from "@/lib/db/schema";
import { hashPassword, signup } from "@/lib/services/accounts";
import { assignLeads, changeStage, createLead, DuplicateLeadError, getLead, listLeads, logActivity } from "@/lib/services/leads";
import { bulkCreateUnits, createProject, listUnits, reserveUnit } from "@/lib/services/projects";
import { completeFollowUp, listFollowUps, scheduleFollowUp } from "@/lib/services/followups";
import { recordVisitOutcome, scheduleVisit } from "@/lib/services/visits";
import { bookingDetail, cancelBooking, createBooking, recordPayment } from "@/lib/services/bookings";
import { campaignMetrics, createCampaign, recordSpend } from "@/lib/services/marketing";
import { kpis } from "@/lib/services/analytics";
import { revenueForecast, revenueSummary } from "@/lib/services/revenue";
import { generateInsights } from "@/lib/services/insights";
import { buildReport, reportPdf } from "@/lib/services/reports";
import { createRule } from "@/lib/services/automation";
import { captureLead, createApiKey, resolveApiKey, processWhatsAppValue, saveIntegration } from "@/lib/services/capture";
import { importLeads } from "@/lib/services/imports";
import { sendText } from "@/lib/services/whatsapp";
import { listNotifications } from "@/lib/services/notifications";
import { sweepOrganization } from "@/lib/services/sweep";
import { isoDate } from "@/lib/utils";

let admin: TenantCtx;
let exec1: TenantCtx;
let exec2: TenantCtx;
let projectId: string;

async function addMember(orgId: string, email: string, name: string, role: "sales_executive" | "sales_manager" | "marketing_manager"): Promise<TenantCtx> {
  const passwordHash = await hashPassword("member-pass-123");
  const userId = await withSystem(async (tx) => {
    const [u] = await tx.insert(users).values({ email, name, passwordHash }).returning({ id: users.id });
    await tx.insert(memberships).values({ organizationId: orgId, userId: u.id, role });
    return u.id;
  });
  return { orgId, userId, role };
}

const T = <R>(ctx: TenantCtx, fn: Parameters<typeof withTenant<R>>[1]) => withTenant(ctx, fn);

beforeAll(async () => {
  const s = await signup({ name: "Owner One", email: "owner@greenfield.test", password: "owner-pass-123", organization: "Greenfield Developers" });
  admin = { orgId: s.orgId, userId: s.userId, role: "org_admin" };
  exec1 = await addMember(s.orgId, "e1@greenfield.test", "Exec One", "sales_executive");
  exec2 = await addMember(s.orgId, "e2@greenfield.test", "Exec Two", "sales_executive");
  projectId = await T(admin, (tx) =>
    createProject(tx, admin, { name: "Skyline Residences", location: "Baner, Pune", propertyType: "Apartment", status: "under_construction", totalUnits: 40, priceFrom: 7_500_000, priceTo: 12_000_000 }),
  );
  const res = await T(admin, (tx) =>
    bulkCreateUnits(tx, admin, { projectId, tower: "A", floorFrom: 1, floorTo: 4, unitsPerFloor: 4, configuration: "2BHK", carpetArea: 850, basePrice: 8_000_000, floorRise: 100_000 }),
  );
  expect(res.created).toBe(16);
});

describe("CRM workflow", () => {
  it("creates a lead, detects duplicates, and scores it with explanations", async () => {
    const { id } = await T(admin, (tx) =>
      createLead(tx, admin, { name: "Priya Sharma", phone: "98765 43210", email: "priya@example.com", budgetMax: 9_000_000, timeline: "within_3_months", projectId, configuration: "2BHK", source: "manual" }),
    );
    const lead = await T(admin, (tx) => getLead(tx, admin, id));
    expect(lead.phoneNormalized).toBe("919876543210");
    expect(lead.score).toBeGreaterThan(0);
    expect(lead.scoreReasons?.some((r) => r.label.includes("fits"))).toBe(true);
    expect(lead.nextAction).toMatch(/Call now/);

    await expect(T(admin, (tx) => createLead(tx, admin, { name: "Priya S", phone: "+91 9876543210", source: "manual" }))).rejects.toBeInstanceOf(DuplicateLeadError);
  });

  it("assigns leads and restricts executives to their own leads", async () => {
    const { rows } = await T(admin, (tx) => listLeads(tx, admin, { q: "Priya" }));
    await T(admin, (tx) => assignLeads(tx, admin, [rows[0].id], exec1.userId));
    const mine = await T(exec1, (tx) => listLeads(tx, exec1, {}));
    const theirs = await T(exec2, (tx) => listLeads(tx, exec2, {}));
    expect(mine.total).toBe(1);
    expect(theirs.total).toBe(0);
    await expect(T(exec2, (tx) => getLead(tx, exec2, rows[0].id))).rejects.toThrow(/not found/);
    await expect(T(exec1, (tx) => assignLeads(tx, exec1, [rows[0].id], exec2.userId))).rejects.toThrow(/permission/);
  });

  it("logs contact, schedules + completes follow-ups, and updates the stage", async () => {
    const [{ id }] = (await T(exec1, (tx) => listLeads(tx, exec1, {}))).rows;
    await T(exec1, (tx) => logActivity(tx, exec1, id, { type: "call", direction: "outbound", body: "Discussed 2BHK options" }));
    expect((await T(exec1, (tx) => getLead(tx, exec1, id))).stage).toBe("contacted");
    await T(exec1, (tx) => changeStage(tx, exec1, id, "qualified"));
    await T(exec1, (tx) => scheduleFollowUp(tx, exec1, { leadId: id, dueAt: new Date(Date.now() + 3600_000).toISOString(), type: "call" }));
    const { rows } = await T(exec1, (tx) => listFollowUps(tx, exec1, "today"));
    expect(rows.length).toBe(1);
    await T(exec1, (tx) => completeFollowUp(tx, exec1, rows[0].id, { outcome: "interested", note: "Wants to visit Saturday" }));
    const lead = await T(exec1, (tx) => getLead(tx, exec1, id));
    expect(lead.stage).toBe("follow_up");
    await expect(T(exec1, (tx) => changeStage(tx, exec1, id, "lost"))).rejects.toThrow(/reason/);
  });

  it("schedules a site visit and records the outcome", async () => {
    const [{ id }] = (await T(exec1, (tx) => listLeads(tx, exec1, {}))).rows;
    const visitId = await T(exec1, (tx) => scheduleVisit(tx, exec1, { leadId: id, projectId, scheduledAt: new Date(Date.now() + 86400_000).toISOString() }));
    expect((await T(exec1, (tx) => getLead(tx, exec1, id))).stage).toBe("site_visit_scheduled");
    await T(exec1, (tx) => recordVisitOutcome(tx, exec1, visitId, { status: "completed", interestLevel: "high", feedback: "Liked east-facing units", followUpInDays: 1 }));
    const lead = await T(exec1, (tx) => getLead(tx, exec1, id));
    expect(lead.scoreReasons?.some((r) => r.label === "Completed a site visit")).toBe(true);
    await T(exec1, (tx) => changeStage(tx, exec1, id, "negotiation"));
  });

  it("books a unit, tracks payments and milestones, and keeps inventory in sync", async () => {
    const [{ id: leadId }] = (await T(exec1, (tx) => listLeads(tx, exec1, {}))).rows;
    const { rows: avail } = await T(admin, (tx) => listUnits(tx, { project: projectId, status: "available" }));
    const unit = avail[0];
    const other = await T(admin, (tx) => createLead(tx, admin, { name: "Rahul Mehta", phone: "9123456780", source: "referral" }));
    await T(admin, (tx) => reserveUnit(tx, admin, unit.id, other.id));
    // Reserved for someone else → cannot book
    await expect(
      T(exec1, (tx) => createBooking(tx, exec1, { leadId, unitId: unit.id, bookingDate: isoDate(new Date()), agreementValue: 8_200_000, bookingAmount: 820_000, plan: "clp" })),
    ).rejects.toThrow(/reserved for another/);

    const bookingId = await T(exec1, (tx) =>
      createBooking(tx, exec1, { leadId, unitId: avail[1].id, bookingDate: isoDate(new Date()), agreementValue: 8_000_000, bookingAmount: 800_000, plan: "clp", bookingAmountReceived: "on", paymentMethod: "upi" }),
    );
    const [u] = await withSystem((tx) => tx.select({ status: units.status }).from(units).where(eq(units.id, avail[1].id)));
    expect(u.status).toBe("booked");
    expect((await T(exec1, (tx) => getLead(tx, exec1, leadId))).stage).toBe("booked");

    let detail = await T(admin, (tx) => bookingDetail(tx, admin, bookingId));
    expect(detail.milestones).toHaveLength(6);
    expect(detail.milestones.reduce((s, m) => s + m.amount, 0)).toBeCloseTo(8_000_000);
    expect(detail.totals.paid).toBe(800_000);
    expect(detail.milestones[0].status).toBe("paid");

    await T(admin, (tx) => recordPayment(tx, admin, bookingId, { amount: 1_600_000, paidOn: isoDate(new Date()), method: "bank_transfer", reference: "NEFT123" }));
    await expect(T(admin, (tx) => recordPayment(tx, admin, bookingId, { amount: 99_000_000, paidOn: isoDate(new Date()), method: "upi" }))).rejects.toThrow(/outstanding/);
    detail = await T(admin, (tx) => bookingDetail(tx, admin, bookingId));
    expect(detail.totals.outstanding).toBe(5_600_000);

    const summary = await T(admin, (tx) => revenueSummary(tx, admin, new Date(Date.now() - 86400_000), new Date(Date.now() + 86400_000)));
    expect(summary.booked).toBe(8_000_000);
    expect(summary.collected).toBe(2_400_000);
  });

  it("cancels a booking, releasing the unit and recording the reason", async () => {
    const lead = await T(admin, (tx) => createLead(tx, admin, { name: "Cancel Case", phone: "9000000001", source: "walk_in" }));
    const { rows: avail } = await T(admin, (tx) => listUnits(tx, { project: projectId, status: "available" }));
    const bookingId = await T(admin, (tx) => createBooking(tx, admin, { leadId: lead.id, unitId: avail[0].id, bookingDate: isoDate(new Date()), agreementValue: 8_100_000, bookingAmount: 500_000, plan: "custom" }));
    await T(admin, (tx) => cancelBooking(tx, admin, bookingId, { reason: "Loan not approved", refundAmount: 0 }));
    const [u] = await withSystem((tx) => tx.select({ status: units.status }).from(units).where(eq(units.id, avail[0].id)));
    expect(u.status).toBe("available");
    expect((await T(admin, (tx) => getLead(tx, admin, lead.id))).stage).toBe("lost");
  });

  it("produces KPIs, a forecast, insights and reports from the recorded data", async () => {
    const from = new Date(Date.now() - 30 * 86400_000), to = new Date(Date.now() + 86400_000);
    const k = await T(admin, (tx) => kpis(tx, admin, from, to));
    expect(k.bookings).toBe(1);
    expect(k.revenue).toBe(8_000_000);
    expect(k.siteVisits).toBe(1);
    const fc = await T(admin, (tx) => revenueForecast(tx, admin));
    expect(fc.months).toHaveLength(3);
    expect(fc.method).toMatch(/pipeline/);
    const insights = await T(admin, (tx) => generateInsights(tx, admin));
    expect(insights.length).toBeGreaterThan(0);
    for (const i of insights) expect(i.detail.length).toBeGreaterThan(10);
    const report = await T(admin, (tx) => buildReport(tx, admin, "revenue", from, to));
    expect(report.summary?.find((s) => s.label.startsWith("Booked"))?.value).toBe("8000000");
    const pdf = await reportPdf(report, "Greenfield Developers");
    expect(Buffer.from(pdf.slice(0, 5)).toString()).toBe("%PDF-");
    await expect(T(exec1, (tx) => buildReport(tx, exec1, "revenue", from, to))).rejects.toThrow(/permission/);
  });
});

describe("marketing attribution", () => {
  it("attributes leads, bookings and spend to campaigns", async () => {
    const campaignId = await T(admin, (tx) => createCampaign(tx, admin, { name: "Diwali Meta", channel: "meta_ads", projectId }));
    await T(admin, (tx) => recordSpend(tx, admin, { campaignId, spendDate: isoDate(new Date()), amount: 50_000 }));
    await T(admin, (tx) => createLead(tx, admin, { name: "Ad Lead 1", phone: "9000000101", source: "meta_ads", campaignId }));
    await T(admin, (tx) => createLead(tx, admin, { name: "Ad Lead 2", phone: "9000000102", source: "meta_ads", campaignId }));
    const metrics = await T(admin, (tx) => campaignMetrics(tx, new Date(Date.now() - 86400_000), new Date(Date.now() + 86400_000)));
    const m = metrics.find((x) => x.id === campaignId)!;
    expect(m.spend).toBe(50_000);
    expect(m.leads).toBe(2);
    expect(m.cpl).toBe(25_000);
    expect(m.roi).toBe(-1);
  });
});

describe("automation & notifications", () => {
  it("round-robins new leads across executives and notifies them", async () => {
    await T(admin, (tx) => createRule(tx, admin, { name: "Round robin", trigger: "lead_created", action: "assign_round_robin" }));
    const a = await T(admin, (tx) => createLead(tx, admin, { name: "RR One", phone: "9000000201", source: "website" }));
    const b = await T(admin, (tx) => createLead(tx, admin, { name: "RR Two", phone: "9000000202", source: "website" }));
    const owners = await withSystem((tx) => tx.select({ id: leads.id, ownerId: leads.ownerId }).from(leads).where(eq(leads.organizationId, admin.orgId)));
    const oa = owners.find((o) => o.id === a.id)!.ownerId;
    const ob = owners.find((o) => o.id === b.id)!.ownerId;
    expect(new Set([oa, ob])).toEqual(new Set([exec1.userId, exec2.userId]));
    const n = await T(exec1, (tx) => listNotifications(tx, exec1.userId!));
    expect(n.rows.some((x) => x.type === "lead_assigned")).toBe(true);
  });

  it("the sweep flags missed follow-ups once (deduplicated)", async () => {
    const lead = await T(admin, (tx) => createLead(tx, admin, { name: "Overdue Case", phone: "9000000301", source: "manual", ownerId: exec2.userId! }));
    await T(admin, (tx) => scheduleFollowUp(tx, admin, { leadId: lead.id, dueAt: new Date(Date.now() - 3600_000).toISOString(), assignedToId: exec2.userId! }));
    await sweepOrganization(admin.orgId);
    await sweepOrganization(admin.orgId);
    const n = await T(exec2, (tx) => listNotifications(tx, exec2.userId!));
    expect(n.rows.filter((x) => x.type === "follow_up_missed" && x.title.includes("Overdue Case"))).toHaveLength(1);
  });
});

describe("lead capture", () => {
  it("accepts leads through an API key and merges repeat enquiries", async () => {
    const key = await T(admin, (tx) => createApiKey(tx, admin, "Website"));
    expect(await resolveApiKey(key)).toBe(admin.orgId);
    expect(await resolveApiKey("ok_live_wrong")).toBeNull();
    const first = await captureLead(admin.orgId, { name: "Web Visitor", phone: "9000000401", project: "Skyline Residences" }, "api");
    const again = await captureLead(admin.orgId, { name: "Web Visitor", phone: "+91 90000 00401" }, "api");
    expect(again.id).toBe(first.id);
    expect(again.merged).toBe(true);
  });

  it("imports leads from rows with validation and duplicate handling", async () => {
    const result = await T(admin, (tx) =>
      importLeads(tx, admin, [
        { name: "Imported A", phone: "9000000501", budget: "85 lakh", timeline: "within 3 months", project: "Skyline Residences" },
        { name: "Imported B", email: "not-an-email" },
        { name: "Dup of Web", phone: "9000000401" },
        { full_name: "Imported C", mobile: "9000000502" },
      ], "skip"),
    );
    expect(result.created).toBe(2);
    expect(result.skipped).toBe(1);
    expect(result.errors).toHaveLength(1);
    const { rows } = await T(admin, (tx) => listLeads(tx, admin, { q: "Imported A" }));
    const lead = await T(admin, (tx) => getLead(tx, admin, rows[0].id));
    expect(lead.budgetMax).toBe(8_500_000);
    expect(lead.timeline).toBe("within_3_months");
  });

  it("stores inbound WhatsApp messages, creating a lead, and sends replies via the Cloud API", async () => {
    await T(admin, (tx) => saveIntegration(tx, admin, "whatsapp", { phoneNumberId: "1234567890" }, { accessToken: "test-token", appSecret: "secret" }));
    const touched = await processWhatsAppValue(admin.orgId, {
      contacts: [{ wa_id: "919811112222", profile: { name: "Anita" } }],
      messages: [{ from: "919811112222", id: "wamid.IN1", type: "text", text: { body: "Hi, price of 2BHK?" } }],
    });
    expect(touched).toHaveLength(1);
    // Meta redelivery of the same message is ignored
    expect(await processWhatsAppValue(admin.orgId, { messages: [{ from: "919811112222", id: "wamid.IN1", type: "text", text: { body: "Hi, price of 2BHK?" } }] })).toHaveLength(0);

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ messages: [{ id: "wamid.OUT1" }] }), { status: 200 }));
    await T(admin, (tx) => sendText(tx, admin, touched[0], "Hello Anita! 2BHK units start at ₹80 L."));
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/1234567890/messages");
    expect(JSON.parse(String((init as RequestInit).body)).to).toBe("919811112222");
    fetchMock.mockRestore();

    await processWhatsAppValue(admin.orgId, { statuses: [{ id: "wamid.OUT1", status: "read" }] });
    await processWhatsAppValue(admin.orgId, { statuses: [{ id: "wamid.OUT1", status: "delivered" }] }); // out of order: must not regress
    const acts = await withSystem((tx) => tx.select({ body: leadActivities.body }).from(leadActivities).where(eq(leadActivities.leadId, touched[0])));
    expect(acts.some((a) => a.body?.includes("Hello Anita"))).toBe(true);
  });

  it("records a failed send with Meta's error instead of pretending it was delivered", async () => {
    const [{ id }] = (await T(admin, (tx) => listLeads(tx, admin, { q: "Anita" }))).rows;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ error: { message: "Invalid OAuth access token", code: 190 } }), { status: 401 }));
    await expect(T(admin, (tx) => sendText(tx, admin, id, "Test"))).rejects.toThrow(/Invalid OAuth/);
    fetchMock.mockRestore();
  });
});
