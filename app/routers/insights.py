from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import crud, schemas
from ..database import get_db

router = APIRouter(prefix="/api/insights", tags=["insights"])


@router.get("", response_model=list[schemas.InsightOut])
def list_insights(limit: int = 50, db: Session = Depends(get_db)):
    """Powers the AI Insights view (newest first)."""
    return crud.get_insights(db, limit=limit)


@router.post("", response_model=schemas.InsightOut, status_code=201)
def create_insight(insight: schemas.InsightCreate, db: Session = Depends(get_db)):
    """Insert a new AI-generated (or manually written) insight card."""
    return crud.create_insight(db, insight)
