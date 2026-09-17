from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import crud, schemas
from ..database import get_db

router = APIRouter(prefix="/api/leads", tags=["leads"])


@router.get("", response_model=list[schemas.LeadOut])
def list_leads(skip: int = 0, limit: int = 200, db: Session = Depends(get_db)):
    """Powers the Lead Scoring table (sorted hottest-first)."""
    return crud.get_leads(db, skip=skip, limit=limit)


@router.post("", response_model=schemas.LeadOut, status_code=201)
def create_lead(lead: schemas.LeadCreate, db: Session = Depends(get_db)):
    return crud.create_lead(db, lead)


@router.get("/{lead_id}", response_model=schemas.LeadOut)
def get_lead(lead_id: int, db: Session = Depends(get_db)):
    lead = crud.get_lead(db, lead_id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    return lead


@router.patch("/{lead_id}", response_model=schemas.LeadOut)
def update_lead(
    lead_id: int, patch: schemas.LeadUpdate, db: Session = Depends(get_db)
):
    """Used e.g. to move a lead through stages or re-score it after contact."""
    lead = crud.update_lead(db, lead_id, patch)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    return lead


@router.delete("/{lead_id}", status_code=204)
def delete_lead(lead_id: int, db: Session = Depends(get_db)):
    if not crud.delete_lead(db, lead_id):
        raise HTTPException(status_code=404, detail="Lead not found")
