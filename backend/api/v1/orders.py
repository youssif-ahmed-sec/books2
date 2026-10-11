from typing import List, Optional
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from core.dependencies import require_pos_orders_access, get_current_user
from core.idempotency import IdempotencyConflict
from database import get_db
from models.user import User, RoleEnum
from schemas.order import OrderCreate, OrderDraftCreate, OrderResponse, OrderStatusUpdate, QuotationResponse, OrderAssignmentUpdate, OrderPreparation, LeadCreate
from models.customer import Customer
from models.order import Order
from models.product import Product
from services.order_service import OrderService

router = APIRouter(prefix="/orders", tags=["Orders"])


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
    if current_user.role not in (RoleEnum.ADMIN, RoleEnum.SENIOR_SALES, RoleEnum.SALES_ASSISTANT):
        raise HTTPException(status_code=403, detail="Preparation access required")
    orders = await OrderService.get_orders(db, status="Preparing")
    visible = orders if current_user.role == RoleEnum.ADMIN else [order for order in orders if order["assigned_to_id"] == current_user.id]
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
        User.role.in_([RoleEnum.SENIOR_SALES, RoleEnum.SALES_ASSISTANT]),
        User.is_active == True, User.is_deleted == False,
    ))).scalars().all()
    return [{"id": user.id, "email": user.email, "role": user.role.value} for user in rows]


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
    if current_user.role not in (RoleEnum.ADMIN, RoleEnum.SENIOR_SALES, RoleEnum.SALES_ASSISTANT):
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
# GET /orders — List all orders (staff/admin only)
# ─────────────────────────────────────────────────────────────────────────────

@router.get(
    "",
    response_model=List[OrderResponse],
    summary="📋 List all orders",
)
async def get_orders(
    status: Optional[str] = Query(None),
    source: Optional[str] = Query(None),
    customer_id: Optional[UUID] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_pos_orders_access),
):
    return await OrderService.get_orders(db, status, source, customer_id)

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
        order["customer_name"] = (await db.execute(select(Customer.name).where(
            Customer.id == order["customer_id"],
        ))).scalar_one_or_none()
    product_ids = {item["product_id"] for item in order["items"]}
    names = dict((await db.execute(select(Product.id, Product.name_ar).where(Product.id.in_(product_ids)))).all()) if product_ids else {}
    for item in order["items"]:
        item["product_name"] = names.get(item["product_id"], "منتج غير متاح")
    return order
