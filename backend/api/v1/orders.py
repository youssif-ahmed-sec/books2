from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession

from core.dependencies import require_pos_orders_access
from database import get_db
from models.user import User
from schemas.order import OrderCreate, OrderDraftCreate, OrderResponse, OrderStatusUpdate
from services.order_service import OrderService

router = APIRouter(prefix="/orders", tags=["Orders"])

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
    response_model=OrderResponse,
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
    return order
