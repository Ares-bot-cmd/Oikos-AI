from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import crud, schemas
from ..database import get_db

router = APIRouter(prefix="/api/leads/{lead_id}/messages", tags=["messages"])


@router.get("", response_model=list[schemas.MessageOut])
def list_messages(lead_id: int, db: Session = Depends(get_db)):
    """Powers the WhatsApp Agent chat thread for a given lead."""
    if not crud.get_lead(db, lead_id):
        raise HTTPException(status_code=404, detail="Lead not found")
    return crud.get_messages_for_lead(db, lead_id)


@router.post("", response_model=schemas.MessageOut, status_code=201)
def add_message(
    lead_id: int, message: schemas.MessageCreate, db: Session = Depends(get_db)
):
    if not crud.get_lead(db, lead_id):
        raise HTTPException(status_code=404, detail="Lead not found")
    return crud.add_message(db, lead_id, message)
