from typing import List, Optional
from datetime import date, datetime, timedelta, timezone
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import String, cast, func, or_, select

from core.dependencies import require_admin, require_pos_orders_access, get_current_user
from core.idempotency import IdempotencyConflict
from database import get_db
from models.user import User, RoleEnum
from schemas.order import OrderCreate, OrderDraftCreate, OrderResponse, OrderStatusUpdate, QuotationResponse, OrderAssignmentUpdate, OrderPreparation, LeadCreate
from models.customer import Customer
from models.financial import Payment
from models.order import CustomerDebtAllocation, Order, OrderStatusEnum
from models.returns import SalesReturn
from models.product import Product, ProductUnit
from services.order_service import OrderService

router = APIRouter(prefix="/orders", tags=["Orders"])


@router.get("/invoices")
async def list_invoices(
    search: str = Query("", max_length=80),
    date_from: date | None = None,
    date_to: date | None = None,
    payment_status: str | None = Query(None, pattern="^(paid|due|untracked)$"),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_admin),
):
    if date_from and date_to and date_from > date_to:
        raise HTTPException(status_code=422, detail="تاريخ البداية بعد تاريخ النهاية")
    query = select(Order, Customer.name).outerjoin(Customer, Customer.id == Order.customer_id).where(
        Order.status.in_((OrderStatusEnum.DELIVERED.value, OrderStatusEnum.CLOSED.value, OrderStatusEnum.RETURNED.value)),
    )
    term = search.strip()
    if term:
        escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        pattern = f"%{escaped}%"
        query = query.where(or_(
            cast(Order.public_number, String).ilike(pattern, escape="\\"),
            Customer.name.ilike(pattern, escape="\\"),
            Customer.phone.ilike(pattern, escape="\\"),
        ))
    cairo = ZoneInfo("Africa/Cairo")
    if date_from:
        query = query.where(Order.created_at >= datetime.combine(date_from, datetime.min.time(), tzinfo=cairo))
    if date_to:
        query = query.where(Order.created_at <= datetime.combine(date_to, datetime.max.time(), tzinfo=cairo))
    is_credit = Order.payment_method == "Deferred Payment"
    if payment_status == "paid":
        query = query.where(or_(~is_credit, Order.deferred_remaining == 0))
    elif payment_status == "due":
        query = query.where(is_credit, Order.deferred_remaining > 0)
    elif payment_status == "untracked":
        query = query.where(is_credit, Order.deferred_remaining.is_(None))
    rows = (await db.execute(query.order_by(Order.created_at.desc(), Order.id.desc()).limit(limit).offset(offset))).all()
    return [{
        "id": str(order.id), "public_number": order.public_number,
        "customer_id": str(order.customer_id) if order.customer_id else None,
        "customer_name": customer_name or "عميل نقدي", "status": order.status,
        "total_amount": order.total_amount, "payment_method": order.payment_method,
        "payment_status": "paid" if order.payment_method != "Deferred Payment" or order.deferred_remaining == 0
            else "untracked" if order.deferred_remaining is None else "due",
        "created_at": order.created_at,
    } for order, customer_name in rows]


@router.get("/{order_id}/activity")
async def invoice_activity(
    order_id: UUID,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_admin),
):
    order = (await db.execute(select(Order).where(Order.id == order_id))).scalar_one_or_none()
    if order is None or order.status not in (OrderStatusEnum.DELIVERED.value, OrderStatusEnum.CLOSED.value, OrderStatusEnum.RETURNED.value):
        raise HTTPException(status_code=404, detail="الفاتورة غير موجودة")
    direct_payments = (await db.execute(select(Payment).where(Payment.order_id == order_id)
                                        .order_by(Payment.created_at, Payment.id))).scalars().all()
    allocations = (await db.execute(select(Payment, CustomerDebtAllocation.amount).join(
        CustomerDebtAllocation, CustomerDebtAllocation.payment_id == Payment.id,
    ).where(CustomerDebtAllocation.order_id == order_id).order_by(Payment.created_at, Payment.id))).all()
    returns = (await db.execute(select(SalesReturn).where(or_(
        SalesReturn.order_id == order_id, SalesReturn.exchange_order_id == order_id,
    )).order_by(SalesReturn.created_at, SalesReturn.id))).scalars().all()
    events = [{"id": str(payment.id), "kind": payment.kind.lower(), "at": payment.created_at,
               "amount": payment.amount, "method": payment.method, "related_invoice": None}
              for payment in direct_payments]
    events.extend({"id": str(payment.id), "kind": "collection", "at": payment.created_at,
                   "amount": amount, "method": payment.method, "related_invoice": None}
                  for payment, amount in allocations)
    events.extend({"id": str(record.id), "kind": ("exchange" if record.kind == "EXCHANGE" else "return") if record.order_id == order_id else "exchange_invoice",
                   "at": record.created_at, "amount": record.returned_value if record.order_id == order_id else record.replacement_value,
                   "method": record.payment_method,
                   "related_invoice": str(record.exchange_order_id) if record.order_id == order_id and record.exchange_order_id else None}
                  for record in returns)
    events.sort(key=lambda event: (event["at"], event["id"]))
    return {"remaining": order.deferred_remaining, "events": events}


@router.get("/preparation-alerts")
async def preparation_alerts(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_pos_orders_access),
):
    now = datetime.now(timezone.utc)
    rows = (await db.execute(select(Order).where(
        Order.status == "Preparing", Order.preparing_started_at < now - timedelta(hours=2),
    ))).scalars().all()
    return [{"id": order.id, "assigned_to_id": order.assigned_to_id,
             "hours": round((now - order.preparing_started_at).total_seconds() / 3600, 1),
             "escalate_to_admin": order.preparing_started_at < now - timedelta(hours=4)} for order in rows]


@router.post("/leads", response_model=OrderResponse, status_code=status.HTTP_201_CREATED)
async def create_manual_lead(
    payload: LeadCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_pos_orders_access),
):
    try:
        return await OrderService.create_lead(db, payload, current_user.id)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))


@router.get("/assigned", response_model=List[OrderResponse])
async def assigned_orders(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role not in (RoleEnum.ADMIN, RoleEnum.CASHIER_ORDERS):
        raise HTTPException(status_code=403, detail="Preparation access required")
    visible = await OrderService.get_orders(
        db, status="Preparing",
        assigned_to_id=current_user.id if current_user.role != RoleEnum.ADMIN else None,
    )
    product_ids = {item["product_id"] for order in visible for item in order["items"]}
    names = dict((await db.execute(select(Product.id, Product.name_ar).where(Product.id.in_(product_ids)))).all()) if product_ids else {}
    for order in visible:
        for item in order["items"]:
            item["product_name"] = names.get(item["product_id"])
    return visible


@router.get("/preparers")
async def list_preparers(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_pos_orders_access),
):
    rows = (await db.execute(select(User).where(
        User.role == RoleEnum.CASHIER_ORDERS,
        User.is_active == True, User.is_deleted == False,
    ))).scalars().all()
    return [{"id": user.id, "full_name": user.full_name, "username": user.username, "email": user.email, "role": user.role.value} for user in rows]


@router.patch("/{order_id}/assign", response_model=OrderResponse)
async def assign_order(
    order_id: UUID,
    payload: OrderAssignmentUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_pos_orders_access),
):
    try:
        order = await OrderService.assign_preparer(db, order_id, payload.user_id, current_user.id)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found")
    return order


@router.post("/{order_id}/prepare", response_model=OrderResponse)
async def finish_order_preparation(
    order_id: UUID,
    payload: OrderPreparation,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role not in (RoleEnum.ADMIN, RoleEnum.CASHIER_ORDERS):
        raise HTTPException(status_code=403, detail="Preparation access required")
    try:
        order = await OrderService.complete_preparation(db, order_id, payload, current_user)
    except PermissionError as error:
        raise HTTPException(status_code=403, detail=str(error))
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found")
    return order

# ─────────────────────────────────────────────────────────────────────────────
# POST /orders — POS Checkout (Instant Deduction)
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/checkout-attempt/{request_id}")
async def get_checkout_attempt(
    request_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_pos_orders_access),
):
    """Read the result of this cashier's checkout without creating another sale."""
    order = (await db.execute(select(Order).where(
        Order.request_id == request_id,
        Order.user_id == current_user.id,
    ))).scalar_one_or_none()
    if order is None:
        return {"found": False, "order": None}
    return {"found": True, "order": await OrderService.get_order(db, order.id)}

@router.post(
    "",
    response_model=OrderResponse,
    status_code=status.HTTP_201_CREATED,
    summary="🛒 Create a new POS order (Instant Deduction)",
)
async def create_order(
    order_in: OrderCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_pos_orders_access),
):
    try:
        return await OrderService.create_order(db, order_in, current_user.id)
    except IdempotencyConflict as e:
        raise HTTPException(status_code=409, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ─────────────────────────────────────────────────────────────────────────────
# POST /orders/draft — OMS Create Draft Order (Deferred Deduction)
# ─────────────────────────────────────────────────────────────────────────────

@router.post(
    "/draft",
    response_model=OrderResponse,
    status_code=status.HTTP_201_CREATED,
    summary="📝 Create Draft Order (OMS)",
)
async def create_draft_order(
    order_in: OrderDraftCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_pos_orders_access),
):
    try:
        return await OrderService.create_draft_order(db, order_in, current_user.id)
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ─────────────────────────────────────────────────────────────────────────────
# PATCH /orders/{id}/status — OMS Status Transitions
# ─────────────────────────────────────────────────────────────────────────────

@router.patch(
    "/{order_id}/status",
    response_model=OrderResponse,
    summary="🔄 Advance Order Status & Deduct Stock",
)
async def update_order_status(
    order_id: UUID,
    status_update: OrderStatusUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_pos_orders_access),
):
    try:
        order = await OrderService.update_order_status(db, order_id, status_update, current_user.id)
        if not order:
            raise HTTPException(status_code=404, detail="Order not found")
        return order
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ─────────────────────────────────────────────────────────────────────────────
# GET /orders — Cashiers see only orders requiring action.
# ─────────────────────────────────────────────────────────────────────────────

@router.get(
    "",
    response_model=List[OrderResponse],
    summary="📋 List visible orders",
)
async def get_orders(
    status: Optional[str] = Query(None),
    source: Optional[str] = Query(None),
    customer_id: Optional[UUID] = Query(None),
    group: Optional[str] = Query(None, pattern="^(inbox|returnable)$"),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_pos_orders_access),
):
    actionable = (
        OrderStatusEnum.NEW_LEAD.value, OrderStatusEnum.DRAFT.value,
        OrderStatusEnum.WAITING_QUOTATION.value, OrderStatusEnum.QUOTATION_SENT.value,
        OrderStatusEnum.WAITING_APPROVAL.value, OrderStatusEnum.APPROVED.value,
        OrderStatusEnum.PREPARING.value, OrderStatusEnum.READY.value,
    )
    groups = {
        "inbox": (
            OrderStatusEnum.NEW_LEAD.value, OrderStatusEnum.DRAFT.value,
            OrderStatusEnum.WAITING_QUOTATION.value, OrderStatusEnum.QUOTATION_SENT.value,
            OrderStatusEnum.WAITING_APPROVAL.value,
        ),
        "returnable": (
            OrderStatusEnum.DELIVERED.value, OrderStatusEnum.CLOSED.value, OrderStatusEnum.RETURNED.value,
        ),
    }
    if group == "returnable" and current_user.role != RoleEnum.ADMIN:
        raise HTTPException(status_code=403, detail="Admin access required")
    allowed_statuses = groups[group] if group else (actionable if current_user.role == RoleEnum.CASHIER_ORDERS else None)
    return await OrderService.get_orders(db, status, source, customer_id, allowed_statuses, limit=limit, offset=offset)

# ─────────────────────────────────────────────────────────────────────────────
# GET /orders/{order_id}/quotation — Generate Quotation Data
# ─────────────────────────────────────────────────────────────────────────────

@router.get(
    "/{order_id}/quotation",
    response_model=QuotationResponse,
    summary="📄 Get Quotation Data",
)
async def get_order_quotation(
    order_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_pos_orders_access),
):
    order = await OrderService.get_order(db, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order["customer_id"]:
        customer = (await db.execute(select(Customer.name, Customer.phone, Customer.address).where(
            Customer.id == order["customer_id"],
        ))).one_or_none()
        if customer:
            order["customer_name"], order["customer_phone"], customer_address = customer
            order["customer_address"] = order["customer_address"] if order.get("customer_address") is not None else customer_address
    if order["user_id"]:
        employee = (await db.execute(select(User.full_name, User.username, User.email).where(User.id == order["user_id"]))).one_or_none()
        order["employee_name"] = next((name for name in employee if name), "") if employee else ""
    order["amount_received"] = (await db.execute(select(func.coalesce(func.sum(Payment.amount), 0)).where(
        Payment.order_id == order_id, Payment.kind == "SALE",
    ))).scalar_one()
    order["received_method"] = (await db.execute(select(Payment.method).where(
        Payment.order_id == order_id, Payment.kind == "SALE",
    ).order_by(Payment.created_at.asc()).limit(1))).scalar_one_or_none()
    product_ids = {item["product_id"] for item in order["items"]}
    names = dict((await db.execute(select(Product.id, Product.name_ar).where(Product.id.in_(product_ids)))).all()) if product_ids else {}
    unit_ids = {item["unit_id"] for item in order["items"]}
    units = dict((await db.execute(select(ProductUnit.id, ProductUnit.unit_name).where(ProductUnit.id.in_(unit_ids)))).all()) if unit_ids else {}
    for item in order["items"]:
        item["product_name"] = names.get(item["product_id"], "منتج غير متاح")
        item["unit_name"] = units.get(item["unit_id"], "")
    return order
