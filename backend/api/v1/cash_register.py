from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from core.dependencies import require_pos_orders_access
from database import get_db
from models.financial import CashAdjustment, CashShift
from models.user import AuditLog, User
from services.cash_register_service import expected_cash, open_shift

router = APIRouter(prefix="/cash-register", tags=["Cash Register"])


class OpenShift(BaseModel):
    opening_cash: Decimal = Field(ge=0, allow_inf_nan=False)


class CloseShift(BaseModel):
    closing_cash: Decimal = Field(ge=0, allow_inf_nan=False)


class Adjustment(BaseModel):
    request_id: UUID
    amount: Decimal = Field(allow_inf_nan=False)
    reason: str = Field(min_length=3, max_length=300)


def shift_data(shift: CashShift, expected: Decimal) -> dict:
    return {"id": shift.id, "user_id": shift.user_id, "status": shift.status,
            "opening_cash": float(shift.opening_cash), "expected_cash": float(expected),
            "closing_cash": float(shift.closing_cash) if shift.closing_cash is not None else None,
            "difference": float(Decimal(str(shift.closing_cash)) - expected) if shift.closing_cash is not None else None,
            "opened_at": shift.opened_at, "closed_at": shift.closed_at}


@router.get("/current")
async def current_shift(db: AsyncSession = Depends(get_db), user: User = Depends(require_pos_orders_access)):
    shift = (await db.execute(select(CashShift).where(CashShift.user_id == user.id, CashShift.status == "OPEN"))).scalar_one_or_none()
    return shift_data(shift, await expected_cash(db, shift)) if shift else None


@router.get("/history")
async def shift_history(db: AsyncSession = Depends(get_db), user: User = Depends(require_pos_orders_access)):
    shifts = (await db.execute(select(CashShift).where(CashShift.user_id == user.id).order_by(CashShift.opened_at.desc()).limit(100))).scalars().all()
    return [shift_data(shift, await expected_cash(db, shift)) for shift in shifts]


@router.post("/open", status_code=status.HTTP_201_CREATED)
async def start_shift(payload: OpenShift, db: AsyncSession = Depends(get_db), user: User = Depends(require_pos_orders_access)):
    existing = (await db.execute(select(CashShift.id).where(CashShift.user_id == user.id, CashShift.status == "OPEN"))).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail="A cash shift is already open")
    shift = CashShift(user_id=user.id, opening_cash=payload.opening_cash, status="OPEN")
    db.add(shift)
    try:
        await db.flush()
        db.add(AuditLog(user_id=user.id, action="OPEN_CASH_SHIFT", entity_type="CashShift", entity_id=str(shift.id), new_value={"opening_cash": str(payload.opening_cash)}))
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="A cash shift is already open")
    await db.refresh(shift)
    return shift_data(shift, Decimal(str(shift.opening_cash)))


@router.post("/adjustments", status_code=status.HTTP_201_CREATED)
async def add_adjustment(payload: Adjustment, db: AsyncSession = Depends(get_db), user: User = Depends(require_pos_orders_access)):
    prior = (await db.execute(select(CashAdjustment).where(CashAdjustment.id == payload.request_id))).scalar_one_or_none()
    if prior is not None:
        if prior.user_id != user.id or Decimal(str(prior.amount)) != payload.amount or prior.reason != payload.reason:
            raise HTTPException(status_code=409, detail="Adjustment request ID was already used differently")
        shift = (await db.execute(select(CashShift).where(CashShift.id == prior.shift_id))).scalar_one()
        return shift_data(shift, await expected_cash(db, shift))
    if payload.amount == 0:
        raise HTTPException(status_code=400, detail="Adjustment amount cannot be zero")
    try:
        shift = await open_shift(db, user.id)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))
    current = await expected_cash(db, shift)
    if current + payload.amount < 0:
        raise HTTPException(status_code=400, detail="Drawer balance cannot be negative")
    entry = CashAdjustment(id=payload.request_id, shift_id=shift.id, user_id=user.id, amount=payload.amount, reason=payload.reason)
    db.add(entry)
    db.add(AuditLog(user_id=user.id, action="CASH_ADJUSTMENT", entity_type="CashShift", entity_id=str(shift.id), new_value={"amount": str(payload.amount), "reason": payload.reason}))
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        prior = (await db.execute(select(CashAdjustment).where(CashAdjustment.id == payload.request_id))).scalar_one_or_none()
        if prior is None or prior.user_id != user.id or Decimal(str(prior.amount)) != payload.amount or prior.reason != payload.reason:
            raise HTTPException(status_code=409, detail="Adjustment request ID was already used differently")
        shift = (await db.execute(select(CashShift).where(CashShift.id == prior.shift_id))).scalar_one()
        return shift_data(shift, await expected_cash(db, shift))
    return shift_data(shift, current + payload.amount)


@router.post("/close")
async def finish_shift(payload: CloseShift, db: AsyncSession = Depends(get_db), user: User = Depends(require_pos_orders_access)):
    try:
        shift = await open_shift(db, user.id)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))
    expected = await expected_cash(db, shift)
    shift.expected_cash = expected
    shift.closing_cash = payload.closing_cash
    shift.status = "CLOSED"
    shift.closed_at = datetime.now(timezone.utc)
    db.add(AuditLog(user_id=user.id, action="CLOSE_CASH_SHIFT", entity_type="CashShift", entity_id=str(shift.id), new_value={"expected": str(expected), "counted": str(payload.closing_cash), "difference": str(payload.closing_cash - expected)}))
    await db.commit()
    return shift_data(shift, expected)
