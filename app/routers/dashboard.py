from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import crud, schemas
from ..database import get_db
from ..models import LeadStage

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])

STAGE_ORDER = [
    LeadStage.new,
    LeadStage.qualified,
    LeadStage.site_visit_booked,
    LeadStage.offer,
    LeadStage.booked,
]
STAGE_LABELS = {
    LeadStage.new: "New lead",
    LeadStage.qualified: "Qualified",
    LeadStage.site_visit_booked: "Site visit booked",
    LeadStage.offer: "Offer stage",
    LeadStage.booked: "Booked",
}


def _pct_delta(prev: float, curr: float) -> float:
    if not prev:
        return 0.0
    return round((curr - prev) / prev * 100, 1)


@router.get("", response_model=schemas.DashboardOut)
def get_dashboard(db: Session = Depends(get_db)):
    """
    Single call that supplies everything the Dashboard tab needs:
    the 4 KPI cards, the 6-month trend line, and the pipeline-by-stage table.
    """
    trend_rows = crud.get_monthly_metrics(db, months=6)
    prev, curr = crud.latest_two_metrics(db)

    kpis = []
    if curr:
        for label, field in [
            ("LEADS", "leads_count"),
            ("SITE VISITS", "site_visits"),
            ("BOOKINGS", "bookings"),
            ("REVENUE", "revenue"),
        ]:
            curr_val = getattr(curr, field)
            prev_val = getattr(prev, field) if prev else 0
            delta = _pct_delta(prev_val, curr_val)
            kpis.append(
                schemas.KPI(
                    label=label,
                    value=curr_val,
                    delta_pct=delta,
                    direction="up" if delta >= 0 else "down",
                )
            )

    # Pipeline snapshot: count leads currently sitting in each stage.
    leads = crud.get_leads(db, limit=10_000)
    stage_counts = {stage: 0 for stage in STAGE_ORDER}
    for lead in leads:
        stage_counts[lead.stage] = stage_counts.get(lead.stage, 0) + 1
    max_count = max(stage_counts.values()) or 1
    pipeline = [
        schemas.PipelineStage(
            stage=STAGE_LABELS[stage],
            count=count,
            share_pct=round(count / max_count * 100, 1),
        )
        for stage, count in stage_counts.items()
    ]

    return schemas.DashboardOut(kpis=kpis, trend=trend_rows, pipeline=pipeline)
