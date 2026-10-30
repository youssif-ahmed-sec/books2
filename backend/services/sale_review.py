"""Review state shared by cancellation and correction workflows."""
from hashlib import sha256

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.financial import CashShift, Payment
from models.order import Order
from models.returns import SalesReturn


async def requires_review(db: AsyncSession, order: Order) -> bool:
    has_return = (await db.execute(select(SalesReturn.id).where(
        (SalesReturn.order_id == order.id) | (SalesReturn.exchange_order_id == order.id)
    ).limit(1))).first()
    if has_return:
        return True
    payment = (await db.execute(select(Payment).where(
        Payment.order_id == order.id, Payment.kind == "SALE"
    ).order_by(Payment.created_at, Payment.id).limit(1))).scalar_one_or_none()
    if payment and payment.shift_id:
        shift = (await db.execute(select(CashShift).where(CashShift.id == payment.shift_id).with_for_update())).scalar_one_or_none()
        return not shift or shift.status != "OPEN"
    user_id = payment.user_id if payment else order.user_id
    when = payment.created_at if payment else order.created_at
    if not user_id or not when:
        return True
    shift = (await db.execute(select(CashShift).where(
        CashShift.user_id == user_id, CashShift.status == "OPEN", CashShift.opened_at <= when,
    ).with_for_update())).scalar_one_or_none()
    return shift is None


async def review_signature(db: AsyncSession, order: Order) -> str:
    returns = (await db.execute(select(SalesReturn.id).where(
        (SalesReturn.order_id == order.id) | (SalesReturn.exchange_order_id == order.id),
    ))).scalars().all()
    payment = (await db.execute(select(Payment).where(Payment.order_id == order.id, Payment.kind == "SALE")
                                .order_by(Payment.created_at, Payment.id).limit(1))).scalar_one_or_none()
    shift = None
    if payment and payment.shift_id:
        shift = (await db.execute(select(CashShift).where(CashShift.id == payment.shift_id).with_for_update())).scalar_one_or_none()
    else:
        user_id = payment.user_id if payment else order.user_id
        when = payment.created_at if payment else order.created_at
        if user_id and when:
            shift = (await db.execute(select(CashShift).where(
                CashShift.user_id == user_id, CashShift.status == "OPEN", CashShift.opened_at <= when,
            ).with_for_update())).scalar_one_or_none()
    parts = [str(item) for item in sorted(returns, key=str)]
    parts.append(f"{shift.id}:{shift.status}" if shift else "unknown")
    return sha256("|".join(parts).encode()).hexdigest()
