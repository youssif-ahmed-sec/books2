from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from uuid import UUID

from core.dependencies import require_pos_orders_access
from core.idempotency import IdempotencyConflict
from database import get_db
from models.returns import SalesReturn
from models.returns import SalesReturnLine
from models.order import Order, OrderItem, OrderStatusEnum
from models.customer import Customer
from models.product import Product
from models.inventory import InventoryTransaction, TransactionTypeEnum
from models.user import User
from schemas.returns import SalesReturnCreate, SalesReturnResponse
from services.return_service import ReturnService

router = APIRouter(prefix="/returns", tags=["Returns and Exchanges"])


@router.get("/eligibility/{order_id}")
async def return_eligibility(
    order_id: UUID,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_pos_orders_access),
):
    order = (await db.execute(select(Order).where(Order.id == order_id))).scalar_one_or_none()
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.status not in (OrderStatusEnum.DELIVERED.value, OrderStatusEnum.CLOSED.value, OrderStatusEnum.RETURNED.value):
        raise HTTPException(status_code=400, detail="Only delivered orders can be returned")
    warehouses = (await db.execute(select(InventoryTransaction.warehouse_id).where(
        InventoryTransaction.reference_document == str(order_id),
        InventoryTransaction.transaction_type == TransactionTypeEnum.ISSUING,
    ).distinct())).scalars().all()
    if len(warehouses) != 1:
        raise HTTPException(status_code=409, detail="Sale warehouse requires manual review")
    rows = (await db.execute(select(OrderItem, Product.name_ar).join(
        Product, Product.id == OrderItem.product_id,
    ).where(OrderItem.order_id == order_id))).all()
    result = []
    for item, product_name in rows:
        returned = (await db.execute(select(func.coalesce(func.sum(SalesReturnLine.quantity), 0)).where(
            SalesReturnLine.order_item_id == item.id,
        ))).scalar_one()
        result.append({
            "order_item_id": item.id,
            "product_name": product_name,
            "unit_id": item.unit_id,
            "price_level": item.price_level,
            "unit_price": float(item.unit_price),
            "remaining_quantity": float(item.quantity_requested - returned),
        })
    customer_level = "Retail"
    if order.customer_id:
        level = (await db.execute(select(Customer.price_level).where(Customer.id == order.customer_id))).scalar_one_or_none()
        if level is not None:
            customer_level = level.value
    return {"warehouse_id": warehouses[0], "payment_method": order.payment_method, "customer_price_level": customer_level, "items": result}


@router.get("", response_model=list[SalesReturnResponse])
async def list_returns(
    order_id: UUID | None = None,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_pos_orders_access),
):
    query = select(SalesReturn).order_by(SalesReturn.created_at.desc())
    if order_id:
        query = query.where(SalesReturn.order_id == order_id)
    return (await db.execute(query)).scalars().all()


@router.post("", response_model=SalesReturnResponse, status_code=status.HTTP_201_CREATED)
async def create_return(
    payload: SalesReturnCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_pos_orders_access),
):
    try:
        return await ReturnService.process(db, payload, user.id)
    except IdempotencyConflict as error:
        raise HTTPException(status_code=409, detail=str(error))
    except PermissionError as error:
        raise HTTPException(status_code=403, detail=str(error))
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))
