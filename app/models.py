"""
ORM models for the Oikos AI backend.

Tables:
  - Lead:      one row per prospective buyer, drives the Dashboard + Lead
               Scoring views.
  - Message:   WhatsApp-style conversation turns tied to a Lead, drives the
               WhatsApp Agent view.
  - Insight:   AI-generated commentary cards, drives the AI Insights view.
  - MonthlyMetric: one row per month, drives the KPI row, the bookings/
               revenue trend chart, and the Marketing -> Revenue funnel.
"""
import enum
from datetime import datetime

from sqlalchemy import (
    Column,
    Integer,
    String,
    Float,
    DateTime,
    ForeignKey,
    Enum as SAEnum,
)
from sqlalchemy.orm import relationship

from .database import Base


class LeadStatus(str, enum.Enum):
    hot = "hot"
    warm = "warm"
    cold = "cold"


class LeadStage(str, enum.Enum):
    new = "new"
    qualified = "qualified"
    site_visit_booked = "site_visit_booked"
    offer = "offer"
    booked = "booked"


class MessageSender(str, enum.Enum):
    buyer = "buyer"
    ai = "ai"
    human = "human"


class InsightKind(str, enum.Enum):
    up = "up"
    down = "down"
    action = "action"


class Lead(Base):
    __tablename__ = "leads"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    source = Column(String, nullable=False)          # e.g. "Instagram DM", "Web form"
    interested_in = Column(String, nullable=False)    # e.g. "2BR · Tower B"
    status = Column(SAEnum(LeadStatus), default=LeadStatus.cold, nullable=False)
    stage = Column(SAEnum(LeadStage), default=LeadStage.new, nullable=False)
    score = Column(Integer, default=0, nullable=False)  # 0-100
    budget = Column(Float, nullable=True)
    last_touch = Column(DateTime, default=datetime.utcnow, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    messages = relationship(
        "Message", back_populates="lead", cascade="all, delete-orphan"
    )


class Message(Base):
    __tablename__ = "messages"

    id = Column(Integer, primary_key=True, index=True)
    lead_id = Column(Integer, ForeignKey("leads.id"), nullable=False)
    sender = Column(SAEnum(MessageSender), nullable=False)
    text = Column(String, nullable=False)
    timestamp = Column(DateTime, default=datetime.utcnow, nullable=False)

    lead = relationship("Lead", back_populates="messages")


class Insight(Base):
    __tablename__ = "insights"

    id = Column(Integer, primary_key=True, index=True)
    kind = Column(SAEnum(InsightKind), nullable=False)
    title = Column(String, nullable=False)
    body = Column(String, nullable=False)
    action_line = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class MonthlyMetric(Base):
    """One row per calendar month — powers KPIs, the trend chart, and the funnel."""

    __tablename__ = "monthly_metrics"

    id = Column(Integer, primary_key=True, index=True)
    month = Column(String, nullable=False, unique=True)  # e.g. "2026-09"
    ad_spend = Column(Float, default=0)
    leads_count = Column(Integer, default=0)
    site_visits = Column(Integer, default=0)
    bookings = Column(Integer, default=0)
    revenue = Column(Float, default=0)
