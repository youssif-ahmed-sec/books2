from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from uuid import UUID
from typing import List
from decimal import Decimal, ROUND_HALF_UP
from datetime import datetime
from zoneinfo import ZoneInfo
import hashlib
import json
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError

from core.dependencies import require_admin, require_pos_orders_access
from database import get_db
from models.customer import Customer
from models.financial import Payment
from models.user import AuditLog
from models.user import User, RoleEnum
from models.customer import CustomerTypeEnum
from models.customer import CustomerInteraction
from models.product import PriceLevelEnum
from models.order import Order, CustomerDebtAllocation
from schemas.customer import CustomerCreate, CustomerUpdate, CustomerResponse, CreditLimitUpdate, InteractionCreate, InteractionResponse
from schemas.payment import CustomerPaymentCreate, PaymentResponse
from services.cash_register_service import open_shift

router = APIRouter(prefix="/customers", tags=["Customers"])


@router.get("/segments", response_model=List[CustomerResponse])
async def marketing_segment(
    customer_type: CustomerTypeEnum | None = None,
    tag: str | None = None,
    min_purchases: Decimal = Decimal("0"),
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_admin),
):
    query = select(Customer).where(Customer.is_deleted == False, Customer.is_active == True, Customer.total_purchases >= min_purchases)
    if customer_type:
        query = query.where(Customer.customer_type == customer_type)
    customers = (await db.execute(query.order_by(Customer.total_purchases.desc()))).scalars().all()
    return [customer for customer in customers if not tag or tag in (customer.tags or [])]


def default_price_level(customer_type: CustomerTypeEnum) -> PriceLevelEnum:
    return {
        CustomerTypeEnum.WHOLESALE: PriceLevelEnum.WHOLESALE,
        CustomerTypeEnum.SUPER_WHOLESALE: PriceLevelEnum.SUPER_WHOLESALE,
        CustomerTypeEnum.VIP: PriceLevelEnum.VIP,
    }.get(customer_type, PriceLevelEnum.RETAIL)


def visible_customer(customer: Customer, role: RoleEnum) -> CustomerResponse:
    response = CustomerResponse.model_validate(customer)
    response.addresses = list(dict.fromkeys(address for address in [customer.address, *(customer.addresses or [])] if address))
    if role not in (RoleEnum.ADMIN, RoleEnum.CASHIER_ORDERS):
        response.balance = None
        response.credit_limit = None
    if role != RoleEnum.ADMIN:
        response.purchase_count = None
        response.total_purchases = None
        response.average_purchase = None
        response.last_purchase_date = None
    return response


class CustomerAddressInput(BaseModel):
    address: str = Field(min_length=5, max_length=300)


@router.post("/{customer_id}/addresses", response_model=CustomerResponse)
async def add_customer_address(
    customer_id: UUID, payload: CustomerAddressInput,
    db: AsyncSession = Depends(get_db), current_user: User = Depends(require_pos_orders_access),
):
    address = " ".join(payload.address.split())
    if len(address) < 5:
        raise HTTPException(status_code=422, detail="اكتب عنوانًا واضحًا")
    customer = (await db.execute(select(Customer).where(
        Customer.id == customer_id, Customer.is_deleted == False, Customer.is_active == True,
    ).with_for_update())).scalar_one_or_none()
    if customer is None:
        raise HTTPException(status_code=404, detail="العميل غير موجود")
    if address not in [customer.address, *(customer.addresses or [])]:
        if not customer.address:
            customer.address = address
        else:
            customer.addresses = [*(customer.addresses or []), address]
        db.add(AuditLog(user_id=current_user.id, action="ADD_CUSTOMER_ADDRESS", entity_type="Customer", entity_id=str(customer.id)))
        await db.commit()
        await db.refresh(customer)
    return visible_customer(customer, current_user.role)

@router.get("", response_model=List[CustomerResponse])
async def get_customers(
    phone: str | None = Query(default=None, pattern=r"^[0-9]{11}$"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_pos_orders_access),
):
    query = select(Customer).where(Customer.is_deleted == False).order_by(Customer.name)
    if phone is not None:
        query = query.where(Customer.phone == phone, Customer.is_active == True)
    result = await db.execute(query)
    return [visible_customer(customer, current_user.role) for customer in result.scalars().all()]

@router.post("", response_model=CustomerResponse, status_code=status.HTTP_201_CREATED)
async def create_customer(
    customer_in: CustomerCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_pos_orders_access)
):
    values = customer_in.model_dump()
    if values.get("phone"):
        values["phone"] = values["phone"].strip()
        existing = (await db.execute(select(Customer.id).where(
            Customer.phone == values["phone"], Customer.is_deleted == False,
        ))).scalar_one_or_none()
        if existing is not None:
            raise HTTPException(status_code=409, detail="رقم التليفون مسجل لعميل بالفعل")
    if current_user.role != RoleEnum.ADMIN:
        values["price_level"] = default_price_level(customer_in.customer_type)
    new_customer = Customer(**values)
    db.add(new_customer)
    await db.flush()
    db.add(AuditLog(user_id=current_user.id, action="CREATE_CUSTOMER", entity_type="Customer", entity_id=str(new_customer.id)))
    await db.commit()
    await db.refresh(new_customer)
    return visible_customer(new_customer, current_user.role)

@router.put("/{customer_id}", response_model=CustomerResponse)
async def update_customer(
    customer_id: UUID,
    customer_in: CustomerUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_pos_orders_access)
):
    result = await db.execute(select(Customer).where(Customer.id == customer_id, Customer.is_deleted == False))
    customer = result.scalar_one_or_none()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    if current_user.role != RoleEnum.ADMIN and "price_level" in customer_in.model_fields_set:
        raise HTTPException(status_code=403, detail="Admin access required to change customer pricing")
        
    changes = customer_in.model_dump(exclude_unset=True)
    if "address" in changes and customer.address and changes["address"] != customer.address:
        customer.addresses = list(dict.fromkeys([*(customer.addresses or []), customer.address]))
    if current_user.role != RoleEnum.ADMIN and "customer_type" in changes:
        changes["price_level"] = default_price_level(changes["customer_type"])
    for k, v in changes.items():
        setattr(customer, k, v)
    db.add(AuditLog(user_id=current_user.id, action="UPDATE_CUSTOMER", entity_type="Customer", entity_id=str(customer_id), new_value={"fields": list(changes)}))
    await db.commit()
    await db.refresh(customer)
    return visible_customer(customer, current_user.role)

@router.delete("/{customer_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_customer(
    customer_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_pos_orders_access)
):
    result = await db.execute(select(Customer).where(Customer.id == customer_id, Customer.is_deleted == False))
    customer = result.scalar_one_or_none()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
        
    customer.is_deleted = True
    db.add(AuditLog(user_id=current_user.id, action="ARCHIVE_CUSTOMER", entity_type="Customer", entity_id=str(customer_id)))
    await db.commit()


@router.patch("/{customer_id}/credit-limit", response_model=CustomerResponse)
async def set_credit_limit(
    customer_id: UUID,
    update: CreditLimitUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    customer = (await db.execute(select(Customer).where(
        Customer.id == customer_id, Customer.is_deleted == False,
    ).with_for_update())).scalar_one_or_none()
    if customer is None:
        raise HTTPException(status_code=404, detail="Customer not found")
    old_limit = Decimal(str(customer.credit_limit or 0))
    customer.credit_limit = update.credit_limit
    db.add(AuditLog(
        user_id=current_user.id, action="SET_CUSTOMER_CREDIT_LIMIT", entity_type="Customer",
        entity_id=str(customer_id), old_value={"credit_limit": str(old_limit)},
        new_value={"credit_limit": str(update.credit_limit)},
    ))
    await db.commit()
    await db.refresh(customer)
    return visible_customer(customer, current_user.role)


@router.post("/{customer_id}/payments", response_model=PaymentResponse, status_code=status.HTTP_201_CREATED)
async def collect_customer_payment(
    customer_id: UUID,
    payment_in: CustomerPaymentCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_pos_orders_access),
):
    fingerprint = hashlib.sha256(json.dumps({
        "customer_id": str(customer_id), "user_id": str(current_user.id),
        "amount": str(payment_in.amount), "method": payment_in.method,
        "next_due_date": payment_in.next_due_date.isoformat() if payment_in.next_due_date else None,
    }, sort_keys=True).encode()).hexdigest()
    existing = (await db.execute(select(Payment).where(Payment.id == payment_in.request_id))).scalar_one_or_none()
    if existing is not None:
        if existing.customer_id != customer_id or existing.user_id != current_user.id or existing.kind != "COLLECTION" or existing.method != payment_in.method or Decimal(str(existing.amount)) != payment_in.amount or (existing.request_fingerprint is None and payment_in.next_due_date is not None) or (existing.request_fingerprint is not None and existing.request_fingerprint != fingerprint):
            raise HTTPException(status_code=409, detail="Payment request ID was already used differently")
        return existing
    customer = (await db.execute(select(Customer).where(
        Customer.id == customer_id, Customer.is_deleted == False,
    ).with_for_update())).scalar_one_or_none()
    if customer is None:
        raise HTTPException(status_code=404, detail="Customer not found")
    amount = Decimal(str(payment_in.amount))
    wallet_fee = (amount / Decimal("100")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP) if payment_in.method == "Wallet" else Decimal("0")
    if amount > Decimal(str(customer.balance or 0)):
        raise HTTPException(status_code=400, detail="Payment exceeds the customer balance")
    if payment_in.next_due_date and payment_in.next_due_date < datetime.now(ZoneInfo("Africa/Cairo")).date():
        raise HTTPException(status_code=422, detail="تاريخ الدفعة القادمة لا يمكن أن يكون في الماضي")
    open_orders = (await db.execute(select(Order).where(
        Order.customer_id == customer_id, Order.deferred_remaining > 0,
    ).order_by(Order.next_due_date.asc().nulls_last(), Order.created_at, Order.id).with_for_update())).scalars().all()
    tracked = sum((Decimal(str(order.deferred_remaining)) for order in open_orders), Decimal("0"))
    old_unlinked = max(Decimal("0"), Decimal(str(customer.balance or 0)) - tracked)
    allocatable = max(Decimal("0"), amount - old_unlinked)
    allocations: list[tuple[Order, Decimal]] = []
    for order in open_orders:
        applied = min(allocatable, Decimal(str(order.deferred_remaining)))
        if applied <= 0:
            break
        allocations.append((order, applied))
        allocatable -= applied
    partly_paid = [order for order, applied in allocations if Decimal(str(order.deferred_remaining)) > applied]
    if partly_paid and payment_in.next_due_date is None:
        raise HTTPException(status_code=422, detail="حدد تاريخ استحقاق الدفعة التالية للباقي")
    if payment_in.next_due_date and not partly_paid:
        raise HTTPException(status_code=422, detail="لا توجد فاتورة مسددة جزئيًا تحتاج موعدًا جديدًا")
    customer.balance = Decimal(str(customer.balance)) - amount
    try:
        shift_id = (await open_shift(db, current_user.id)).id if payment_in.method == "Cash" else None
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))
    payment = Payment(
        id=payment_in.request_id,
        customer_id=customer_id, user_id=current_user.id,
        shift_id=shift_id, amount=amount, wallet_fee_amount=wallet_fee,
        method=payment_in.method, kind="COLLECTION", request_fingerprint=fingerprint,
    )
    db.add(payment)
    for order, applied in allocations:
        order.deferred_remaining = Decimal(str(order.deferred_remaining)) - applied
        if order.deferred_remaining == 0:
            order.next_due_date = None
        elif payment_in.next_due_date is not None:
            order.next_due_date = payment_in.next_due_date
        db.add(CustomerDebtAllocation(payment_id=payment.id, order_id=order.id, amount=applied))
    db.add(AuditLog(user_id=current_user.id, action="COLLECT_CUSTOMER_DEBT", entity_type="Customer", entity_id=str(customer_id), new_value={"amount": str(amount), "wallet_fee_amount": str(wallet_fee), "method": payment_in.method}))
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        replay = (await db.execute(select(Payment).where(Payment.id == payment_in.request_id))).scalar_one_or_none()
        if replay is None or replay.customer_id != customer_id or replay.user_id != current_user.id or replay.kind != "COLLECTION" or replay.method != payment_in.method or Decimal(str(replay.amount)) != amount or replay.request_fingerprint != fingerprint:
            raise HTTPException(status_code=409, detail="Payment request ID was already used differently")
        return replay
    await db.refresh(payment)
    return payment


@router.get("/{customer_id}/payments", response_model=List[PaymentResponse])
async def customer_payment_history(
    customer_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_pos_orders_access),
):
    query = select(Payment).where(Payment.customer_id == customer_id)
    if current_user.role != RoleEnum.ADMIN:
        query = query.where(Payment.kind == "COLLECTION")
    return (await db.execute(query.order_by(Payment.created_at.desc()))).scalars().all()


@router.get("/{customer_id}/interactions", response_model=List[InteractionResponse])
async def interaction_history(
    customer_id: UUID,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_pos_orders_access),
):
    return (await db.execute(select(CustomerInteraction).where(CustomerInteraction.customer_id == customer_id).order_by(CustomerInteraction.created_at.desc()))).scalars().all()


@router.post("/{customer_id}/interactions", response_model=InteractionResponse, status_code=status.HTTP_201_CREATED)
async def record_interaction(
    customer_id: UUID,
    payload: InteractionCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_pos_orders_access),
):
    exists = (await db.execute(select(Customer.id).where(Customer.id == customer_id, Customer.is_deleted == False))).scalar_one_or_none()
    if exists is None:
        raise HTTPException(status_code=404, detail="Customer not found")
    entry = CustomerInteraction(customer_id=customer_id, user_id=user.id, **payload.model_dump())
    db.add(entry)
    await db.flush()
    db.add(AuditLog(user_id=user.id, action="RECORD_CUSTOMER_INTERACTION", entity_type="Customer", entity_id=str(customer_id), new_value={"interaction_id": str(entry.id), "channel": payload.channel}))
    await db.commit()
    await db.refresh(entry)
    return entry


@router.get("/{customer_id}/orders")
async def customer_order_history(
    customer_id: UUID,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_admin),
):
    rows = (await db.execute(select(Order).where(Order.customer_id == customer_id).order_by(Order.created_at.desc()))).scalars().all()
    return [{"id": order.id, "public_number": order.public_number, "status": order.status, "total_amount": float(order.total_amount),
             "created_at": order.created_at, "source": order.source} for order in rows]
