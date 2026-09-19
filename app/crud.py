"""
Plain data-access helpers, kept separate from the route handlers so the
routers stay thin and the DB logic is easy to unit test / reuse.
"""
from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session
from sqlalchemy import desc

from . import models, schemas


# ---------- Lead ----------

def get_leads(db: Session, skip: int = 0, limit: int = 200):
    return (
        db.query(models.Lead)
        .order_by(desc(models.Lead.score))
        .offset(skip)
        .limit(limit)
        .all()
    )


def get_lead(db: Session, lead_id: int) -> Optional[models.Lead]:
    return db.query(models.Lead).filter(models.Lead.id == lead_id).first()


def create_lead(db: Session, lead: schemas.LeadCreate) -> models.Lead:
    db_lead = models.Lead(**lead.model_dump())
    db.add(db_lead)
    db.commit()
    db.refresh(db_lead)
    return db_lead


def update_lead(
    db: Session, lead_id: int, patch: schemas.LeadUpdate
) -> Optional[models.Lead]:
    db_lead = get_lead(db, lead_id)
    if not db_lead:
        return None
    for field, value in patch.model_dump(exclude_unset=True).items():
        setattr(db_lead, field, value)
    db_lead.last_touch = datetime.utcnow()
    db.commit()
    db.refresh(db_lead)
    return db_lead


def delete_lead(db: Session, lead_id: int) -> bool:
    db_lead = get_lead(db, lead_id)
    if not db_lead:
        return False
    db.delete(db_lead)
    db.commit()
    return True


# ---------- Message ----------

def get_messages_for_lead(db: Session, lead_id: int):
    return (
        db.query(models.Message)
        .filter(models.Message.lead_id == lead_id)
        .order_by(models.Message.timestamp)
        .all()
    )


def add_message(
    db: Session, lead_id: int, message: schemas.MessageCreate
) -> models.Message:
    db_message = models.Message(lead_id=lead_id, **message.model_dump())
    db.add(db_message)
    # Touch the lead so "last_touch" reflects the newest interaction.
    lead = get_lead(db, lead_id)
    if lead:
        lead.last_touch = datetime.utcnow()
    db.commit()
    db.refresh(db_message)
    return db_message


# ---------- Insight ----------

def get_insights(db: Session, limit: int = 50):
    return (
        db.query(models.Insight)
        .order_by(desc(models.Insight.created_at))
        .limit(limit)
        .all()
    )


def create_insight(db: Session, insight: schemas.InsightCreate) -> models.Insight:
    db_insight = models.Insight(**insight.model_dump())
    db.add(db_insight)
    db.commit()
    db.refresh(db_insight)
    return db_insight


# ---------- Monthly metrics ----------

def get_monthly_metrics(db: Session, months: int = 6):
    rows = (
        db.query(models.MonthlyMetric)
        .order_by(models.MonthlyMetric.month)
        .all()
    )
    return rows[-months:]


def latest_two_metrics(db: Session):
    rows = get_monthly_metrics(db, months=2)
    if len(rows) < 2:
        return None, rows[-1] if rows else None
    return rows[-2], rows[-1]
