"""
Pydantic schemas — request bodies and API responses.
"""
from datetime import datetime
from typing import Optional, List

from pydantic import BaseModel, ConfigDict

from .models import LeadStatus, LeadStage, MessageSender, InsightKind


# ---------- Lead ----------

class LeadBase(BaseModel):
    name: str
    source: str
    interested_in: str
    status: LeadStatus = LeadStatus.cold
    stage: LeadStage = LeadStage.new
    score: int = 0
    budget: Optional[float] = None


class LeadCreate(LeadBase):
    pass


class LeadUpdate(BaseModel):
    name: Optional[str] = None
    source: Optional[str] = None
    interested_in: Optional[str] = None
    status: Optional[LeadStatus] = None
    stage: Optional[LeadStage] = None
    score: Optional[int] = None
    budget: Optional[float] = None


class LeadOut(LeadBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    last_touch: datetime
    created_at: datetime


# ---------- Message ----------

class MessageCreate(BaseModel):
    sender: MessageSender
    text: str


class MessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    lead_id: int
    sender: MessageSender
    text: str
    timestamp: datetime


# ---------- Insight ----------

class InsightCreate(BaseModel):
    kind: InsightKind
    title: str
    body: str
    action_line: Optional[str] = None


class InsightOut(InsightCreate):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime


# ---------- Monthly metric / dashboard / funnel ----------

class MonthlyMetricOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    month: str
    ad_spend: float
    leads_count: int
    site_visits: int
    bookings: int
    revenue: float


class KPI(BaseModel):
    label: str
    value: float
    delta_pct: float
    direction: str  # "up" | "down"


class PipelineStage(BaseModel):
    stage: str
    count: int
    share_pct: float


class DashboardOut(BaseModel):
    kpis: List[KPI]
    trend: List[MonthlyMetricOut]
    pipeline: List[PipelineStage]


class FunnelStep(BaseModel):
    label: str
    value: float
    display: str
    pct_of_leads: Optional[float] = None


class FunnelOut(BaseModel):
    steps: List[FunnelStep]
    cost_per_lead: float
    cost_per_booking: float
    roas: float
