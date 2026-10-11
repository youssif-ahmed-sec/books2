from decimal import Decimal
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.financial import CashAdjustment, CashShift, Payment


async def open_shift(db: AsyncSession, user_id: UUID) -> CashShift:
    shift = (await db.execute(select(CashShift).where(
        CashShift.user_id == user_id, CashShift.status == "OPEN",
    ).with_for_update())).scalar_one_or_none()
    if shift is None:
        raise ValueError("Open a cash register shift before cash transactions.")
    return shift


async def expected_cash(db: AsyncSession, shift: CashShift) -> Decimal:
    payments = (await db.execute(select(Payment).where(Payment.shift_id == shift.id))).scalars().all()
    adjustments = (await db.execute(select(CashAdjustment).where(CashAdjustment.shift_id == shift.id))).scalars().all()
    paid_in = sum((Decimal(str(entry.amount)) for entry in payments if entry.kind in ("SALE", "COLLECTION")), Decimal("0"))
    refunded = sum((Decimal(str(entry.amount)) for entry in payments if entry.kind == "REFUND"), Decimal("0"))
    adjustment_total = sum((Decimal(str(entry.amount)) for entry in adjustments), Decimal("0"))
    return Decimal(str(shift.opening_cash)) + paid_in - refunded + adjustment_total
