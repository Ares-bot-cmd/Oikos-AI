from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import crud, schemas
from ..database import get_db

router = APIRouter(prefix="/api/funnel", tags=["funnel"])


@router.get("", response_model=schemas.FunnelOut)
def get_funnel(db: Session = Depends(get_db)):
    """Powers the Marketing -> Revenue funnel view, using the latest month."""
    rows = crud.get_monthly_metrics(db, months=1)
    if not rows:
        return schemas.FunnelOut(
            steps=[], cost_per_lead=0, cost_per_booking=0, roas=0
        )
    m = rows[-1]

    steps = [
        schemas.FunnelStep(label="Ad spend", value=m.ad_spend, display=f"AED {m.ad_spend:,.0f}"),
        schemas.FunnelStep(
            label="Leads", value=m.leads_count, display=f"{m.leads_count} leads",
            pct_of_leads=100.0,
        ),
        schemas.FunnelStep(
            label="Site visits", value=m.site_visits, display=f"{m.site_visits} visits",
            pct_of_leads=round(m.site_visits / m.leads_count * 100, 1) if m.leads_count else 0,
        ),
        schemas.FunnelStep(
            label="Bookings", value=m.bookings, display=f"{m.bookings} bookings",
            pct_of_leads=round(m.bookings / m.leads_count * 100, 1) if m.leads_count else 0,
        ),
        schemas.FunnelStep(label="Revenue", value=m.revenue, display=f"AED {m.revenue:,.0f}"),
    ]

    cost_per_lead = m.ad_spend / m.leads_count if m.leads_count else 0
    cost_per_booking = m.ad_spend / m.bookings if m.bookings else 0
    roas = m.revenue / m.ad_spend if m.ad_spend else 0

    return schemas.FunnelOut(
        steps=steps,
        cost_per_lead=round(cost_per_lead, 2),
        cost_per_booking=round(cost_per_booking, 2),
        roas=round(roas, 1),
    )
