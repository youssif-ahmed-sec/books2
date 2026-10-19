from datetime import datetime, timezone
from decimal import Decimal
import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from core.dependencies import require_admin, require_pos_orders_access
from database import get_db
from models.financial import CashAdjustment, CashShift
from models.shift_email import ShiftEmailReport, ShiftReportRecipient
from models.user import AuditLog, RoleEnum, User
from services.cash_register_service import expected_cash, open_shift
from services.shift_email_service import deliver_shift_email, prepare_shift_email
from services.notification_service import notify_roles

router = APIRouter(prefix="/cash-register", tags=["Cash Register"])
logger = logging.getLogger(__name__)


class OpenShift(BaseModel):
    opening_cash: Decimal = Field(ge=0, allow_inf_nan=False)


class CloseShift(BaseModel):
    closing_cash: Decimal = Field(ge=0, allow_inf_nan=False)


class Adjustment(BaseModel):
    request_id: UUID
    amount: Decimal = Field(allow_inf_nan=False)
    reason: str = Field(min_length=3, max_length=300)


class ReportRecipientInput(BaseModel):
    email: EmailStr | None


def shift_data(shift: CashShift, expected: Decimal | None, user: User, email_status: str | None = None) -> dict:
    show_reconciliation = user.role == RoleEnum.ADMIN
    result = {"id": shift.id, "user_id": shift.user_id, "status": shift.status,
            "opening_cash": float(shift.opening_cash) if show_reconciliation else None,
            "expected_cash": float(expected) if show_reconciliation and expected is not None else None,
            "closing_cash": float(shift.closing_cash) if show_reconciliation and shift.closing_cash is not None else None,
            "difference": float(Decimal(str(shift.closing_cash)) - expected)
            if show_reconciliation and shift.closing_cash is not None and expected is not None else None,
            "opened_at": shift.opened_at, "closed_at": shift.closed_at}
    if show_reconciliation and email_status is not None:
        result["email_report_status"] = email_status
    return result


@router.get("/email-recipient")
async def get_report_recipient(db: AsyncSession = Depends(get_db), user: User = Depends(require_admin)):
    recipient = (await db.execute(select(ShiftReportRecipient).where(ShiftReportRecipient.id == 1))).scalar_one_or_none()
    return {"email": recipient.email if recipient else None}


@router.put("/email-recipient")
async def set_report_recipient(payload: ReportRecipientInput, db: AsyncSession = Depends(get_db),
                               user: User = Depends(require_admin)):
    recipient = (await db.execute(select(ShiftReportRecipient).where(
        ShiftReportRecipient.id == 1).with_for_update())).scalar_one_or_none()
    old_email = recipient.email if recipient else None
    if payload.email is None:
        if recipient:
            await db.delete(recipient)
    elif recipient:
        recipient.email = str(payload.email)
        recipient.updated_at = datetime.now(timezone.utc)
    else:
        db.add(ShiftReportRecipient(id=1, email=str(payload.email)))
    db.add(AuditLog(user_id=user.id, action="SET_SHIFT_REPORT_RECIPIENT", entity_type="ShiftReportRecipient",
                    entity_id="1", old_value={"email": old_email}, new_value={"email": str(payload.email) if payload.email else None}))
    await db.commit()
    return {"email": str(payload.email) if payload.email else None}


@router.get("/email-reports")
async def list_email_reports(db: AsyncSession = Depends(get_db), user: User = Depends(require_admin)):
    rows = (await db.execute(select(ShiftEmailReport).order_by(ShiftEmailReport.created_at.desc())
                             .limit(50))).scalars().all()
    return [{"shift_id": row.shift_id, "recipient_email": row.recipient_email, "status": row.status,
             "attempts": row.attempts, "created_at": row.created_at, "sent_at": row.sent_at} for row in rows]


@router.post("/email-reports/{shift_id}/retry")
async def retry_email_report(shift_id: UUID, db: AsyncSession = Depends(get_db),
                             user: User = Depends(require_admin)):
    report = (await db.execute(select(ShiftEmailReport).where(ShiftEmailReport.shift_id == shift_id))).scalar_one_or_none()
    if report is None:
        raise HTTPException(status_code=404, detail="Shift email report not found")
    return {"status": await deliver_shift_email(db, shift_id)}


@router.get("/current")
async def current_shift(db: AsyncSession = Depends(get_db), user: User = Depends(require_pos_orders_access)):
    shift = (await db.execute(select(CashShift).where(CashShift.user_id == user.id, CashShift.status == "OPEN"))).scalar_one_or_none()
    return shift_data(shift, await expected_cash(db, shift) if user.role == RoleEnum.ADMIN else None, user) if shift else None


@router.get("/history")
async def shift_history(db: AsyncSession = Depends(get_db), user: User = Depends(require_pos_orders_access)):
    shifts = (await db.execute(select(CashShift).where(CashShift.user_id == user.id).order_by(CashShift.opened_at.desc()).limit(100))).scalars().all()
    return [shift_data(shift, await expected_cash(db, shift) if user.role == RoleEnum.ADMIN else None, user) for shift in shifts]


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
    return shift_data(shift, Decimal(str(shift.opening_cash)), user)


@router.post("/adjustments", status_code=status.HTTP_201_CREATED)
async def add_adjustment(payload: Adjustment, db: AsyncSession = Depends(get_db), user: User = Depends(require_pos_orders_access)):
    prior = (await db.execute(select(CashAdjustment).where(CashAdjustment.id == payload.request_id))).scalar_one_or_none()
    if prior is not None:
        if prior.user_id != user.id or Decimal(str(prior.amount)) != payload.amount or prior.reason != payload.reason:
            raise HTTPException(status_code=409, detail="Adjustment request ID was already used differently")
        shift = (await db.execute(select(CashShift).where(CashShift.id == prior.shift_id))).scalar_one()
        return shift_data(shift, await expected_cash(db, shift), user)
    if payload.amount >= 0:
        raise HTTPException(status_code=422, detail="Cash adjustment must be a withdrawal")
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
        return shift_data(shift, await expected_cash(db, shift), user)
    return shift_data(shift, current + payload.amount, user)


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
    recipient = (await db.execute(select(ShiftReportRecipient).where(ShiftReportRecipient.id == 1))).scalar_one_or_none()
    if recipient:
        await prepare_shift_email(db, shift, recipient.email)
    db.add(AuditLog(user_id=user.id, action="CLOSE_CASH_SHIFT", entity_type="CashShift", entity_id=str(shift.id), new_value={"expected": str(expected), "counted": str(payload.closing_cash), "difference": str(payload.closing_cash - expected)}))
    await db.commit()
    email_status = "NOT_CONFIGURED"
    if recipient:
        try:
            email_status = await deliver_shift_email(db, shift.id)
            if email_status == "FAILED":
                await notify_roles(db, (RoleEnum.ADMIN,), kind="shift_email_failed",
                                   title="تعذر إرسال ملخص الوردية",
                                   message=f"وردية {str(shift.id)[:8]} أُغلقت، لكن ملخص البريد لم يُرسل. راجع الإعدادات.",
                                   href="/settings")
                await db.commit()
        except Exception:
            logger.exception("Shift %s closed, but report delivery state could not be updated", shift.id)
            email_status = "UNKNOWN"
    return shift_data(shift, expected, user, email_status)
