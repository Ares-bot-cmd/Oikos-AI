"""
Populates the database with sample data that mirrors what's currently
hardcoded in the frontend, so the app is immediately usable end-to-end.

Run with:  python -m app.seed
"""
from datetime import datetime, timedelta

from .database import Base, engine, SessionLocal
from . import models


MONTHLY_METRICS = [
    # month, ad_spend, leads, site_visits, bookings, revenue
    ("2026-04", 150000, 360, 120, 26, 46_800_000),
    ("2026-05", 158000, 375, 128, 28, 49_400_000),
    ("2026-06", 165000, 392, 135, 29, 51_900_000),
    ("2026-07", 171000, 405, 142, 31, 55_100_000),
    ("2026-08", 176000, 418, 149, 33, 58_200_000),
    ("2026-09", 180000, 428, 156, 34, 61_200_000),
]

LEADS = [
    dict(
        name="R. Kapoor", source="Instagram DM", interested_in="2BR · Tower B",
        status=models.LeadStatus.hot, stage=models.LeadStage.site_visit_booked,
        score=88, budget=1_910_000, minutes_ago=12,
    ),
    dict(
        name="S. Al-Farsi", source="Web form", interested_in="Penthouse · Tower A",
        status=models.LeadStatus.hot, stage=models.LeadStage.offer,
        score=81, budget=4_200_000, minutes_ago=40,
    ),
    dict(
        name="M. Chen", source="WhatsApp", interested_in="1BR · Tower C",
        status=models.LeadStatus.warm, stage=models.LeadStage.qualified,
        score=56, budget=1_200_000, minutes_ago=120,
    ),
    dict(
        name="A. Verma", source="Referral", interested_in="3BR · Tower B",
        status=models.LeadStatus.warm, stage=models.LeadStage.qualified,
        score=49, budget=2_600_000, minutes_ago=300,
    ),
    dict(
        name="J. Osei", source="Web form", interested_in="Studio · Tower C",
        status=models.LeadStatus.cold, stage=models.LeadStage.new,
        score=22, budget=800_000, minutes_ago=1440,
    ),
    dict(
        name="P. Nair", source="Ad click", interested_in="1BR · Tower A",
        status=models.LeadStatus.cold, stage=models.LeadStage.new,
        score=16, budget=1_050_000, minutes_ago=2880,
    ),
]

INSIGHTS = [
    dict(
        kind=models.InsightKind.up,
        title="Revenue is up 9% this month, driven almost entirely by Tower A.",
        body=(
            "Penthouse enquiries from the new Instagram campaign are converting "
            "to bookings at 2.3x the rate of other channels this quarter."
        ),
        action_line="recommended: shift 15% more ad budget from Google Search to Instagram",
    ),
    dict(
        kind=models.InsightKind.down,
        title="Bookings dipped 3% despite leads being up 12%.",
        body=(
            "The gap is concentrated in Tower C — leads are qualifying fine, but "
            "visit-to-booking conversion fell from 24% to 15% after the last "
            "price adjustment."
        ),
        action_line="recommended: revisit the Tower C studio price, or add a limited-time incentive",
    ),
    dict(
        kind=models.InsightKind.action,
        title="3 hot leads have gone quiet for 24+ hours.",
        body=(
            "R. Kapoor and two others scored above 80 have had no outbound "
            "contact in over a day — the single highest-leverage gap in the "
            "pipeline today."
        ),
        action_line="recommended: escalate to a human rep via WhatsApp now",
    ),
    dict(
        kind=models.InsightKind.up,
        title="Referral leads close 40% faster than paid channels.",
        body=(
            "Average time from first contact to booking is 11 days for "
            "referrals vs. 19 days for paid ads, across the last quarter."
        ),
        action_line="recommended: launch a referral incentive for existing buyers",
    ),
]

# Chat script for the first (hottest) lead, mirrors the frontend's WhatsApp demo.
CHAT_SCRIPT = [
    (models.MessageSender.buyer, "Hi, I saw the 2BR listing in Tower B. Is it still available?"),
    (models.MessageSender.ai, "Yes, it's available! It's a 2-bedroom on floor 15, sea-facing, AED 1.91M. Are you looking to move in soon, or planning ahead?"),
    (models.MessageSender.buyer, "Planning ahead, maybe in the next 2 months."),
    (models.MessageSender.ai, "Got it. Would you like to book a site visit this week? I have Thursday 4 PM or Saturday 11 AM open."),
    (models.MessageSender.buyer, "Saturday 11 AM works."),
    (models.MessageSender.ai, "Booked - Saturday 11 AM, Tower B. I've also notified our sales lead Aisha, she'll call you shortly to confirm payment plan options."),
]


def seed():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        if db.query(models.Lead).first():
            print("Database already has data — skipping seed.")
            return

        now = datetime.utcnow()

        for m in MONTHLY_METRICS:
            month, ad_spend, leads_count, site_visits, bookings, revenue = m
            db.add(
                models.MonthlyMetric(
                    month=month,
                    ad_spend=ad_spend,
                    leads_count=leads_count,
                    site_visits=site_visits,
                    bookings=bookings,
                    revenue=revenue,
                )
            )

        lead_objs = []
        for l in LEADS:
            lead_objs.append(
                models.Lead(
                    name=l["name"],
                    source=l["source"],
                    interested_in=l["interested_in"],
                    status=l["status"],
                    stage=l["stage"],
                    score=l["score"],
                    budget=l["budget"],
                    last_touch=now - timedelta(minutes=l["minutes_ago"]),
                    created_at=now - timedelta(days=7),
                )
            )
        db.add_all(lead_objs)
        db.flush()  # assign IDs

        for insight in INSIGHTS:
            db.add(models.Insight(**insight))

        # Attach the sample chat thread to the hottest lead (R. Kapoor).
        hottest = max(lead_objs, key=lambda l: l.score)
        chat_time = now - timedelta(minutes=15)
        for sender, text in CHAT_SCRIPT:
            db.add(
                models.Message(
                    lead_id=hottest.id,
                    sender=sender,
                    text=text,
                    timestamp=chat_time,
                )
            )
            chat_time += timedelta(seconds=45)

        db.commit()
        print("Seed complete.")
    finally:
        db.close()


if __name__ == "__main__":
    seed()
