from decimal import Decimal
from uuid import UUID

from sqlalchemy import case, func, select
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
    payment_total = (await db.execute(select(func.coalesce(func.sum(case(
        (Payment.kind.in_(("SALE", "COLLECTION")), Payment.amount),
        (Payment.kind == "REFUND", -Payment.amount),
        else_=0,
    )), 0)).where(Payment.shift_id == shift.id))).scalar_one()
    adjustment_total = (await db.execute(select(func.coalesce(func.sum(CashAdjustment.amount), 0)).where(
        CashAdjustment.shift_id == shift.id,
    ))).scalar_one()
    return Decimal(str(shift.opening_cash)) + Decimal(str(payment_total)) + Decimal(str(adjustment_total))
