import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { buildCalibration, calibratedProbability, scoreLead, suggestNextAction, type LeadFeatures, type OrgScoringStats } from "@/lib/services/scoring";
import { buildForecast, dealValue, linearProjection } from "@/lib/services/revenue";
import { allocateMilestones } from "@/lib/services/bookings";
import { can, ROLES } from "@/lib/auth/permissions";
import { decryptJson, encryptJson, verifyMetaSignature } from "@/lib/security/crypto";
import { csvCell, formatMoney, normalizeEmail, normalizePhone, toCsv } from "@/lib/utils";

const base: LeadFeatures = {
  stage: "new", timeline: "unknown", source: "manual", budgetMax: null, hasPhone: true, hasEmail: false, hasProject: false,
  unitsInBudget: null, unitsConsidered: 0, cheapestAvailable: null, inboundLast30: 0, daysSinceLastContact: null, daysSinceCreated: 0,
  daysInStage: 0, completedFollowUps: 0, overdueFollowUps: 0, visitsCompleted: 0, upcomingVisitWithinHours: null, visitNoShows: 0, bestVisitInterest: null,
};
const noStats: OrgScoringStats = { overallRate: null, sourceRates: {}, calibration: null, closedCount: 0 };

describe("lead scoring", () => {
  it("is deterministic and explains every point", () => {
    const f: LeadFeatures = { ...base, budgetMax: 9e6, unitsInBudget: 3, unitsConsidered: 10, timeline: "immediate", inboundLast30: 2, daysSinceLastContact: 1, visitsCompleted: 1, bestVisitInterest: "high", stage: "negotiation" };
    const a = scoreLead(f, noStats);
    const b = scoreLead(f, noStats);
    expect(a).toEqual(b);
    expect(a.score).toBe(Math.min(99, 30 + a.reasons.reduce((s, r) => s + r.points, 0)));
    expect(a.intent).toBe("hot");
    expect(a.reasons.map((r) => r.label)).toContain("Completed a site visit");
  });

  it("penalises budget below inventory, no contact and overdue follow-ups", () => {
    const f: LeadFeatures = { ...base, budgetMax: 3e6, unitsInBudget: 0, unitsConsidered: 5, cheapestAvailable: 7e6, daysSinceCreated: 5, overdueFollowUps: 2 };
    const r = scoreLead(f, noStats);
    expect(r.reasons.find((x) => x.label.includes("below the cheapest"))?.points).toBe(-10);
    expect(r.reasons.find((x) => x.label.includes("Not contacted"))?.points).toBe(-10);
    expect(r.intent).toBe("cold");
    expect(r.score).toBeGreaterThanOrEqual(0);
  });

  it("uses the organization's own source conversion only with enough data", () => {
    const stats: OrgScoringStats = { overallRate: 0.1, sourceRates: { referral: { rate: 0.3, n: 40 }, meta_ads: { rate: 0.02, n: 5 } }, calibration: null, closedCount: 45 };
    expect(scoreLead({ ...base, source: "referral" }, stats).reasons.some((r) => r.label.startsWith("Referral leads convert"))).toBe(true);
    expect(scoreLead({ ...base, source: "meta_ads" }, stats).reasons.some((r) => r.label.includes("convert at"))).toBe(false);
  });

  it("booked and lost leads have fixed outcomes", () => {
    expect(scoreLead({ ...base, stage: "booked" }, noStats).probability).toBe(1);
    expect(scoreLead({ ...base, stage: "lost" }, noStats).probability).toBe(0);
  });

  it("calibrates probability on closed leads once there are enough", () => {
    const closed = [...Array(40)].map((_, i) => ({ score: i < 20 ? 85 : 25, booked: i < 16 }));
    const stats: OrgScoringStats = { ...noStats, calibration: buildCalibration(closed), closedCount: 40 };
    expect(calibratedProbability(85, stats)).toBeCloseTo((16 + 1) / (20 + 2), 4);
    expect(calibratedProbability(25, stats)).toBeCloseTo(1 / 22, 4);
    expect(calibratedProbability(85, noStats)).toBeLessThan(0.6);
  });

  it("suggests a contact-first next action for new leads", () => {
    expect(suggestNextAction(base)).toMatch(/hasn't been contacted/);
    expect(suggestNextAction({ ...base, daysSinceLastContact: 2, stage: "qualified" })).toMatch(/site visit/i);
  });
});

describe("forecasting", () => {
  it("fits a linear trend", () => {
    expect(linearProjection([10, 20, 30], 2).map(Math.round)).toEqual([40, 50]);
    expect(linearProjection([5, 5], 2)).toEqual([]);
  });

  it("values deals from budget, then project price, then org median", () => {
    expect(dealValue({ stage: "new", probability: 0.1, budgetMin: 8e6, budgetMax: 10e6, projectMedian: 1 }, 2)).toBe(9e6);
    expect(dealValue({ stage: "new", probability: 0.1, budgetMin: null, budgetMax: null, projectMedian: 7e6 }, 2)).toBe(7e6);
    expect(dealValue({ stage: "new", probability: 0.1, budgetMin: null, budgetMax: null, projectMedian: null }, 5e6)).toBe(5e6);
  });

  it("distributes weighted pipeline across months by stage", () => {
    const fc = buildForecast([{ stage: "negotiation", probability: 0.5, budgetMin: null, budgetMax: 1e7, projectMedian: null }], null, [], new Date(2026, 0, 15));
    expect(fc.months.map((m) => m.month)).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(fc.months[0].pipeline).toBeCloseTo(1e7 * 0.5 * 0.6);
    expect(fc.weightedValue).toBe(5e6);
    expect(fc.months.reduce((s, m) => s + m.expectedBookings, 0)).toBeCloseTo(0.5);
    expect(fc.months[0].trend).toBeNull();
  });
});

describe("payment milestones", () => {
  it("applies payments in due-date order and flags overdue", () => {
    const ms = allocateMilestones([{ amount: 100, dueDate: "2026-01-01" }, { amount: 200, dueDate: "2026-02-01" }, { amount: 300, dueDate: "2026-12-01" }], 150, "2026-03-01");
    expect(ms.map((m) => m.status)).toEqual(["paid", "overdue", "upcoming"]);
    expect(ms[1].outstanding).toBe(150);
  });
});

describe("permissions", () => {
  it("restricts executives and marketing appropriately", () => {
    expect(can("sales_executive", "leads:read_all")).toBe(false);
    expect(can("sales_executive", "reports:read")).toBe(false);
    expect(can("marketing_manager", "payments:write")).toBe(false);
    expect(can("sales_manager", "users:manage")).toBe(false);
    for (const r of ROLES) expect(can(r, "leads:write")).toBe(true);
    expect(can("org_admin", "billing:manage")).toBe(true);
  });
});

describe("security utilities", () => {
  it("encrypts secrets with authenticated encryption", () => {
    const enc = encryptJson({ token: "abc" });
    expect(enc).not.toContain("abc");
    expect(decryptJson(enc)).toEqual({ token: "abc" });
    const tampered = enc.slice(0, -2) + (enc.endsWith("A") ? "BB" : "AA");
    expect(decryptJson(tampered)).toBeNull();
  });

  it("verifies Meta webhook signatures", () => {
    const body = '{"entry":[]}';
    const sig = "sha256=" + createHmac("sha256", "s3cret").update(body).digest("hex");
    expect(verifyMetaSignature(body, sig, "s3cret")).toBe(true);
    expect(verifyMetaSignature(body + " ", sig, "s3cret")).toBe(false);
    expect(verifyMetaSignature(body, null, "s3cret")).toBe(false);
  });

  it("neutralises spreadsheet formula injection in CSV exports", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell("+91 98765")).toBe("'+91 98765");
    expect(toCsv(["a"], [["x,y"]])).toBe('a\r\n"x,y"\r\n');
  });
});

describe("normalisation & formatting", () => {
  it("normalises Indian phone numbers and emails", () => {
    expect(normalizePhone("098765 43210")).toBe("919876543210");
    expect(normalizePhone("+91-98765-43210")).toBe("919876543210");
    expect(normalizePhone("12")).toBeNull();
    expect(normalizeEmail(" Priya@Example.COM ")).toBe("priya@example.com");
    expect(normalizeEmail("nope")).toBeNull();
  });

  it("formats rupees in lakh/crore", () => {
    expect(formatMoney(12_500_000, "INR", true)).toBe("₹1.25 Cr");
    expect(formatMoney(8_600_000, "INR", true)).toBe("₹86.00 L");
  });
});
