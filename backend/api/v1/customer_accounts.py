"""Customer financial history, open dues, and reviewed duplicate consolidation."""

from collections import defaultdict
from datetime import datetime
from decimal import Decimal
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.dependencies import require_admin, require_pos_orders_access
from database import get_db
from models.customer import Customer, CustomerInteraction
from models.financial import Payment
from models.order import Order, OrderStatusEnum
from models.returns import SalesReturn
from models.user import AuditLog, User
from services.order_service import OrderService

router = APIRouter(prefix="/customers", tags=["Customers"])


def _money(value) -> Decimal:
    return Decimal(str(value or 0))


def _active_customer(customer: Customer | None) -> Customer:
    if customer is None or customer.is_deleted:
        raise HTTPException(status_code=404, detail="العميل غير موجود")
    return customer


@router.get("/overdue")
async def overdue_customer_dues(
    db: AsyncSession = Depends(get_db), _user: User = Depends(require_admin),
):
    today = datetime.now(ZoneInfo("Africa/Cairo")).date()
    rows = (await db.execute(select(Order, Customer).join(Customer, Customer.id == Order.customer_id).where(
        Order.deferred_remaining > 0, Order.next_due_date < today,
        Customer.is_deleted == False,
    ).order_by(Order.next_due_date, Order.created_at))).all()
    return [{"order_id": str(order.id), "public_number": order.public_number,
             "customer_id": str(customer.id), "customer_name": customer.name,
             "customer_phone": customer.phone, "remaining": float(order.deferred_remaining),
             "due_date": order.next_due_date} for order, customer in rows]


@router.get("/duplicates")
async def duplicate_customers(
    db: AsyncSession = Depends(get_db), _user: User = Depends(require_admin),
):
    rows = (await db.execute(select(Customer).where(Customer.is_deleted == False, Customer.phone.is_not(None))
                             .order_by(Customer.phone, Customer.created_at))).scalars().all()
    groups: dict[str, list[Customer]] = defaultdict(list)
    for customer in rows:
        phone = "".join(char for char in (customer.phone or "") if char.isdigit())
        if phone:
            groups[phone].append(customer)
    return [{"phone": phone, "customers": [
        {"id": str(customer.id), "name": customer.name, "phone": customer.phone,
         "balance": float(customer.balance or 0), "credit_limit": float(customer.credit_limit or 0),
         "purchase_count": customer.purchase_count or 0} for customer in matches
    ]} for phone, matches in groups.items() if len(matches) > 1]


class MergeCustomersInput(BaseModel):
    source_id: UUID
    target_id: UUID


@router.post("/merge")
async def merge_customers(
    payload: MergeCustomersInput,
    db: AsyncSession = Depends(get_db), current_user: User = Depends(require_admin),
):
    if payload.source_id == payload.target_id:
        raise HTTPException(status_code=422, detail="اختر سجلين مختلفين")
    locked = (await db.execute(select(Customer).where(Customer.id.in_((payload.source_id, payload.target_id)))
                               .order_by(Customer.id).with_for_update())).scalars().all()
    by_id = {customer.id: customer for customer in locked}
    source = _active_customer(by_id.get(payload.source_id))
    target = _active_customer(by_id.get(payload.target_id))
    source_phone = "".join(char for char in (source.phone or "") if char.isdigit())
    target_phone = "".join(char for char in (target.phone or "") if char.isdigit())
    if not source_phone or source_phone != target_phone:
        raise HTTPException(status_code=409, detail="الدمج متاح للسجلين اللذين يحملان نفس رقم الهاتف فقط")
    merged_balance = _money(source.balance) + _money(target.balance)
    if merged_balance > _money(target.credit_limit):
        raise HTTPException(status_code=409, detail="ارفع الحد الائتماني للسجل الذي سيبقى قبل دمج الرصيدين")
    source_orders = (await db.execute(select(Order).where(Order.customer_id == source.id).with_for_update())).scalars().all()
    source_payments = (await db.execute(select(Payment).where(Payment.customer_id == source.id).with_for_update())).scalars().all()
    source_interactions = (await db.execute(select(CustomerInteraction).where(CustomerInteraction.customer_id == source.id).with_for_update())).scalars().all()
    for order in source_orders:
        order.customer_id = target.id
    for payment in source_payments:
        payment.customer_id = target.id
    for interaction in source_interactions:
        interaction.customer_id = target.id
    target.balance = merged_balance
    target.addresses = list(dict.fromkeys(address for address in [target.address, *(target.addresses or []), source.address, *(source.addresses or [])] if address and address != target.address))
    target.tags = list(dict.fromkeys([*(target.tags or []), *(source.tags or [])]))
    target.favorite_categories = list(dict.fromkeys([*(target.favorite_categories or []), *(source.favorite_categories or [])]))
    source.is_deleted = True
    await db.flush()
    await OrderService._record_customer_sale(db, target.id, Decimal("0"))
    db.add(AuditLog(user_id=current_user.id, action="MERGE_CUSTOMERS", entity_type="Customer",
                    entity_id=str(target.id), old_value={"source_id": str(source.id)},
                    new_value={"orders": len(source_orders), "payments": len(source_payments),
                               "interactions": len(source_interactions), "balance": str(merged_balance)}))
    await db.commit()
    return {"target_id": str(target.id), "merged_source_id": str(source.id)}


@router.get("/{customer_id}/dues")
async def customer_dues(
    customer_id: UUID, db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_pos_orders_access),
):
    customer = _active_customer((await db.execute(select(Customer).where(Customer.id == customer_id))).scalar_one_or_none())
    orders = (await db.execute(select(Order).where(Order.customer_id == customer_id, Order.deferred_remaining > 0)
                               .order_by(Order.next_due_date.asc().nulls_last(), Order.created_at))).scalars().all()
    tracked = sum((_money(order.deferred_remaining) for order in orders), Decimal("0"))
    return {"balance": float(customer.balance or 0), "unlinked_balance": float(max(Decimal("0"), _money(customer.balance) - tracked)),
            "invoices": [{"order_id": str(order.id), "public_number": order.public_number,
                          "remaining": float(order.deferred_remaining), "due_date": order.next_due_date} for order in orders]}


@router.get("/{customer_id}/statement")
async def customer_statement(
    customer_id: UUID, db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_admin),
):
    customer = _active_customer((await db.execute(select(Customer).where(Customer.id == customer_id))).scalar_one_or_none())
    exchange_ids = set((await db.execute(select(SalesReturn.exchange_order_id).join(
        Order, Order.id == SalesReturn.order_id,
    ).where(Order.customer_id == customer_id, SalesReturn.exchange_order_id.is_not(None)))).scalars().all())
    orders = (await db.execute(select(Order).where(
        Order.customer_id == customer_id,
        Order.status.in_((OrderStatusEnum.DELIVERED.value, OrderStatusEnum.CLOSED.value, OrderStatusEnum.RETURNED.value)),
    ))).scalars().all()
    payments = (await db.execute(select(Payment).where(Payment.customer_id == customer_id))).scalars().all()
    returns = (await db.execute(select(SalesReturn, Order.public_number).join(
        Order, Order.id == SalesReturn.order_id,
    ).where(Order.customer_id == customer_id))).all()
    entries = []
    for order in orders:
        if order.id not in exchange_ids:
            entries.append({"kind": "invoice", "id": str(order.id), "order_id": str(order.id),
                            "public_number": order.public_number, "at": order.created_at,
                            "delta": _money(order.total_amount)})
    for payment in payments:
        entries.append({"kind": "refund" if payment.kind == "REFUND" else "payment",
                        "id": str(payment.id), "order_id": str(payment.order_id) if payment.order_id else None,
                        "public_number": None, "at": payment.created_at,
                        "delta": _money(payment.amount) if payment.kind == "REFUND" else -_money(payment.amount),
                        "method": payment.method})
    for record, public_number in returns:
        entries.append({"kind": "return", "id": str(record.id), "order_id": str(record.order_id),
                        "public_number": public_number, "at": record.created_at,
                        "delta": _money(record.charge_amount) - _money(record.refund_amount)})
    entries.sort(key=lambda entry: (entry["at"] or datetime.min.replace(tzinfo=ZoneInfo("UTC")),
                                    0 if entry["kind"] == "invoice" else 1, entry["id"]))
    opening = _money(customer.balance) - sum((entry["delta"] for entry in entries), Decimal("0"))
    running = opening
    for entry in entries:
        delta = entry.pop("delta")
        running += delta
        entry["amount"] = float(abs(delta))
        entry["direction"] = "debit" if delta > 0 else "credit"
        entry["balance"] = float(running)
    return {"opening_balance": float(opening), "closing_balance": float(customer.balance or 0),
            "entries": entries}
