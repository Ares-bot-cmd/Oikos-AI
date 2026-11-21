/**
 * Explainable lead scoring. Every point comes from a concrete fact about the lead
 * (budget fit against real inventory, timeline, responses, follow-ups, site visits,
 * stage, and how this organization's lead sources actually convert). No randomness.
 *
 * Conversion probability is calibrated on the organization's own closed leads
 * (booked vs lost) once there are at least CALIBRATION_MIN of them; until then a
 * conservative default curve is used and labelled as such.
 */
export type Stage = "new" | "contacted" | "qualified" | "follow_up" | "site_visit_scheduled" | "negotiation" | "booked" | "lost";
export type Timeline = "immediate" | "within_3_months" | "within_6_months" | "later" | "unknown";

export type LeadFeatures = {
  stage: Stage;
  timeline: Timeline;
  source: string;
  budgetMax: number | null;
  hasPhone: boolean;
  hasEmail: boolean;
  hasProject: boolean;
  /** Available/reserved units in the preferred project (or org-wide if none) priced within budget. */
  unitsInBudget: number | null;
  /** Available units considered (same scope as unitsInBudget). */
  unitsConsidered: number;
  cheapestAvailable: number | null;
  inboundLast30: number;
  daysSinceLastContact: number | null;
  daysSinceCreated: number;
  daysInStage: number;
  completedFollowUps: number;
  overdueFollowUps: number;
  visitsCompleted: number;
  upcomingVisitWithinHours: number | null;
  visitNoShows: number;
  bestVisitInterest: "high" | "medium" | "low" | null;
};

export type SourceStat = { rate: number; n: number };
export type OrgScoringStats = {
  overallRate: number | null;
  sourceRates: Record<string, SourceStat>;
  /** Booking rate per 20-point score band, from closed leads. Null until enough history. */
  calibration: { rate: number; n: number }[] | null;
  closedCount: number;
};

export type ScoreResult = {
  score: number;
  probability: number;
  intent: "hot" | "warm" | "cold";
  reasons: { label: string; points: number }[];
  nextAction: string | null;
};

export const CALIBRATION_MIN = 30;
const SOURCE_MIN = 20;

const fmtInr = (n: number) =>
  n >= 1e7 ? `₹${(n / 1e7).toFixed(2)} Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(1)} L` : `₹${Math.round(n).toLocaleString("en-IN")}`;

const SOURCE_LABEL: Record<string, string> = {
  meta_ads: "Meta Ads", google_ads: "Google Ads", website: "Website", api: "API", whatsapp: "WhatsApp",
  portal: "Property portal", referral: "Referral", walk_in: "Walk-in", manual: "Manual entry", import: "Import", other: "Other",
};

export function scoreLead(f: LeadFeatures, stats: OrgScoringStats): ScoreResult {
  if (f.stage === "booked") {
    return { score: 100, probability: 1, intent: "hot", reasons: [{ label: "Booking completed", points: 0 }], nextAction: "Track the payment schedule for this booking" };
  }
  if (f.stage === "lost") {
    return { score: 0, probability: 0, intent: "cold", reasons: [{ label: "Marked as lost", points: 0 }], nextAction: null };
  }

  const reasons: { label: string; points: number }[] = [];
  const add = (label: string, points: number) => reasons.push({ label, points });

  // Budget fit against real inventory
  if (f.budgetMax == null) {
    add("Budget not captured yet", 0);
  } else if (f.unitsConsidered === 0) {
    add("No available inventory to compare budget against", 0);
  } else if ((f.unitsInBudget ?? 0) > 0) {
    add(`Budget ${fmtInr(f.budgetMax)} fits ${f.unitsInBudget} available unit${f.unitsInBudget === 1 ? "" : "s"}`, 15);
  } else {
    add(`Budget ${fmtInr(f.budgetMax)} is below the cheapest available unit${f.cheapestAvailable ? ` (${fmtInr(f.cheapestAvailable)})` : ""}`, -10);
  }

  // Purchase timeline
  const tl: Record<Timeline, [string, number]> = {
    immediate: ["Wants to buy immediately", 15],
    within_3_months: ["Plans to buy within 3 months", 10],
    within_6_months: ["Plans to buy within 6 months", 4],
    later: ["Buying timeline is more than 6 months away", -5],
    unknown: ["Purchase timeline not captured", 0],
  };
  add(...tl[f.timeline]);

  // Engagement
  if (f.inboundLast30 > 0) add(`Responded ${f.inboundLast30} time${f.inboundLast30 === 1 ? "" : "s"} in the last 30 days`, Math.min(15, f.inboundLast30 * 5));

  // Contact recency
  if (f.daysSinceLastContact == null) {
    if (f.daysSinceCreated >= 1) add(`Not contacted in ${f.daysSinceCreated} day${f.daysSinceCreated === 1 ? "" : "s"} since enquiry`, -10);
  } else if (f.daysSinceLastContact <= 3) {
    add("Contacted in the last 3 days", 5);
  } else if (f.daysSinceLastContact > 14) {
    add(`No contact for ${f.daysSinceLastContact} days`, -10);
  }

  // Follow-up discipline
  if (f.completedFollowUps > 0) add(`${f.completedFollowUps} follow-up${f.completedFollowUps === 1 ? "" : "s"} completed`, Math.min(8, f.completedFollowUps * 2));
  if (f.overdueFollowUps > 0) add(`${f.overdueFollowUps} overdue follow-up${f.overdueFollowUps === 1 ? "" : "s"}`, -Math.min(10, f.overdueFollowUps * 5));

  // Site visits
  if (f.visitsCompleted > 0) add("Completed a site visit", 20);
  if (f.bestVisitInterest === "high") add("Showed high interest during the visit", 8);
  if (f.bestVisitInterest === "low") add("Showed low interest during the visit", -5);
  if (f.upcomingVisitWithinHours != null) add("Site visit scheduled", 10);
  if (f.visitNoShows > 0) add(`Missed ${f.visitNoShows} scheduled visit${f.visitNoShows === 1 ? "" : "s"}`, -8);

  // Stage
  if (f.stage === "negotiation") add("In negotiation", 15);
  else if (f.stage === "qualified") add("Qualified by the sales team", 5);
  else if (f.stage === "contacted") add("Initial contact made", 2);

  // Source quality from this organization's own history
  const src = stats.sourceRates[f.source];
  if (src && src.n >= SOURCE_MIN && stats.overallRate && stats.overallRate > 0) {
    const ratio = src.rate / stats.overallRate;
    const pts = Math.max(-8, Math.min(8, Math.round((ratio - 1) * 10)));
    if (pts !== 0) {
      add(
        `${SOURCE_LABEL[f.source] ?? f.source} leads convert at ${(src.rate * 100).toFixed(1)}% vs ${(stats.overallRate * 100).toFixed(1)}% overall`,
        pts,
      );
    }
  }

  // Contactability
  if (!f.hasPhone) add("No phone number", -5);
  else if (f.hasEmail) add("Phone and email on file", 3);

  const raw = 30 + reasons.reduce((s, r) => s + r.points, 0);
  const score = Math.max(0, Math.min(99, Math.round(raw)));
  const probability = calibratedProbability(score, stats);
  const intent = score >= 70 ? "hot" : score >= 45 ? "warm" : "cold";
  return { score, probability, intent, reasons: reasons.sort((a, b) => Math.abs(b.points) - Math.abs(a.points)), nextAction: suggestNextAction(f) };
}

export function calibratedProbability(score: number, stats: OrgScoringStats): number {
  const band = Math.min(4, Math.floor(score / 20));
  const cal = stats.calibration?.[band];
  if (cal && stats.closedCount >= CALIBRATION_MIN) {
    // Laplace-smoothed booking rate of closed leads that had a similar score.
    return round4((cal.rate * cal.n + 1) / (cal.n + 2));
  }
  // Default curve until the organization has enough closed leads.
  return round4(0.6 / (1 + Math.exp(-(score - 65) / 10)));
}

function round4(n: number) {
  return Math.round(n * 10000) / 10000;
}

export function suggestNextAction(f: LeadFeatures): string {
  if (f.daysSinceLastContact == null) return "Call now — this enquiry hasn't been contacted yet";
  if (f.overdueFollowUps > 0) return "Complete the overdue follow-up today";
  if (f.upcomingVisitWithinHours != null && f.upcomingVisitWithinHours <= 48) return "Confirm the upcoming site visit with the customer";
  if (f.visitsCompleted > 0 && f.stage !== "negotiation") return "Share the cost sheet and move to negotiation";
  if (f.stage === "negotiation" && f.daysInStage > 7) return `Negotiation has stalled for ${f.daysInStage} days — involve a manager or offer a closing incentive`;
  if ((f.stage === "qualified" || f.stage === "follow_up") && f.visitsCompleted === 0 && f.upcomingVisitWithinHours == null) return "Schedule a site visit";
  if (f.budgetMax == null || f.timeline === "unknown") return "Qualify the lead: confirm budget and buying timeline";
  if (f.daysSinceLastContact > 7) return `Re-engage — no contact for ${f.daysSinceLastContact} days`;
  return "Schedule the next follow-up";
}

/** Builds per-band booking rates from closed leads' final scores (used for calibration). */
export function buildCalibration(closed: { score: number; booked: boolean }[]) {
  const bands = Array.from({ length: 5 }, () => ({ booked: 0, n: 0 }));
  for (const c of closed) {
    const b = bands[Math.min(4, Math.max(0, Math.floor(c.score / 20)))];
    b.n++;
    if (c.booked) b.booked++;
  }
  return bands.map((b) => ({ rate: b.n ? b.booked / b.n : 0, n: b.n }));
}
