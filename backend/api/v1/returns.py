from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, func, String, cast, or_
from sqlalchemy.ext.asyncio import AsyncSession
from uuid import UUID
import re

from core.dependencies import require_pos_orders_access
from core.idempotency import IdempotencyConflict
from database import get_db
from models.returns import SalesReturn
from models.returns import SalesReturnLine
from models.order import Order, OrderItem, OrderStatusEnum
from models.customer import Customer
from models.product import Product, ProductUnit
from models.inventory import InventoryTransaction, TransactionTypeEnum
from models.user import User, RoleEnum
from schemas.returns import SalesReturnCreate, SalesReturnPreview, SalesReturnReceipt, SalesReturnResponse
from services.return_service import ReturnService

router = APIRouter(prefix="/returns", tags=["Returns and Exchanges"])


@router.get("/lookup/{invoice_number}")
async def lookup_invoice(
    invoice_number: str,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_pos_orders_access),
):
    number = invoice_number.strip().lower()
    if number.startswith("inv") and re.fullmatch(r"inv[1-9][0-9]*", number):
        number = number[3:]
    if re.fullmatch(r"[1-9][0-9]*", number):
        if int(number) > 9223372036854775807:
            raise HTTPException(status_code=400, detail="رقم الفاتورة غير صالح")
        condition = Order.public_number == int(number)
        if len(number) == 12:
            condition = or_(condition, cast(Order.id, String).ilike(f"%{number}"))
    elif re.fullmatch(r"[0-9a-f]{12}", number):
        condition = cast(Order.id, String).ilike(f"%{number}")
    else:
        try:
            condition = Order.id == UUID(number)
        except ValueError:
            raise HTTPException(status_code=400, detail="أدخل رقم الفاتورة الرقمي كما هو مطبوع")
    rows = (await db.execute(select(Order.id, Order.status).where(
        condition,
        Order.status.in_((OrderStatusEnum.DELIVERED.value, OrderStatusEnum.CLOSED.value, OrderStatusEnum.RETURNED.value)),
    ).limit(2))).all()
    if not rows:
        raise HTTPException(status_code=404, detail="لم تُعثر على فاتورة مكتملة بهذا الرقم")
    if len(rows) > 1:
        raise HTTPException(status_code=409, detail="الرقم يطابق أكثر من فاتورة؛ أدخل المعرّف الكامل")
    return {"id": rows[0].id, "status": rows[0].status}


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
    rows = (await db.execute(select(OrderItem, Product.name_ar, ProductUnit.unit_name).join(
        Product, Product.id == OrderItem.product_id,
    ).join(
        ProductUnit, ProductUnit.id == OrderItem.unit_id,
    ).where(OrderItem.order_id == order_id))).all()
    result = []
    for item, product_name, unit_name in rows:
        returned = (await db.execute(select(func.coalesce(func.sum(SalesReturnLine.quantity), 0)).where(
            SalesReturnLine.order_item_id == item.id,
        ))).scalar_one()
        result.append({
            "order_item_id": item.id,
            "product_name": product_name,
            "unit_name": unit_name,
            "unit_id": item.unit_id,
            "price_level": item.price_level,
            "unit_price": float(item.unit_price),
            "remaining_quantity": float(item.quantity_requested - returned),
            "manual_review": item.bundle_components_snapshot is None,
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
    current_user: User = Depends(require_pos_orders_access),
):
    if current_user.role == RoleEnum.CASHIER_ORDERS and order_id is None:
        raise HTTPException(status_code=400, detail="order_id is required")
    query = select(SalesReturn).order_by(SalesReturn.created_at.desc())
    if order_id:
        query = query.where(SalesReturn.order_id == order_id)
    return (await db.execute(query)).scalars().all()


@router.get("/{return_id}/receipt", response_model=SalesReturnReceipt)
async def return_receipt(
    return_id: UUID,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_pos_orders_access),
):
    record = (await db.execute(select(SalesReturn).where(SalesReturn.id == return_id))).scalar_one_or_none()
    if record is None:
        raise HTTPException(status_code=404, detail="Return not found")
    returned_rows = (await db.execute(select(
        SalesReturnLine, Product.name_ar, ProductUnit.unit_name,
    ).join(OrderItem, OrderItem.id == SalesReturnLine.order_item_id).join(
        Product, Product.id == OrderItem.product_id,
    ).join(ProductUnit, ProductUnit.id == OrderItem.unit_id).where(
        SalesReturnLine.return_id == return_id,
    ))).all()
    replacement_rows = []
    if record.exchange_order_id:
        replacement_rows = (await db.execute(select(
            OrderItem, Product.name_ar, ProductUnit.unit_name,
        ).join(Product, Product.id == OrderItem.product_id).join(
            ProductUnit, ProductUnit.id == OrderItem.unit_id,
        ).where(OrderItem.order_id == record.exchange_order_id))).all()
    invoice_numbers = dict((await db.execute(select(Order.id, Order.public_number).where(
        Order.id.in_([record.order_id, record.exchange_order_id] if record.exchange_order_id else [record.order_id]),
    ))).all())
    employee = (await db.execute(select(User.full_name, User.username, User.email).where(User.id == record.user_id))).one_or_none()
    customer = (await db.execute(select(Customer.name, Customer.phone).join(Order, Order.customer_id == Customer.id).where(
        Order.id == record.order_id,
    ))).one_or_none()
    return {
        "id": record.id, "order_id": record.order_id,
        "order_public_number": invoice_numbers.get(record.order_id),
        "exchange_order_id": record.exchange_order_id,
        "exchange_order_public_number": invoice_numbers.get(record.exchange_order_id),
        "kind": record.kind, "payment_method": record.payment_method,
        "created_at": record.created_at,
        "employee_name": next((name for name in employee if name), "") if employee else "",
        "customer_name": customer[0] if customer else None,
        "customer_phone": customer[1] if customer else None,
        "returned_value": record.returned_value,
        "replacement_value": record.replacement_value,
        "refund_amount": record.refund_amount,
        "charge_amount": record.charge_amount,
        "returned_lines": [
            {"product_name": name, "unit_name": unit, "quantity": line.quantity, "amount": line.amount}
            for line, name, unit in returned_rows
        ],
        "replacement_lines": [
            {"product_name": name, "unit_name": unit, "quantity": item.quantity_requested, "amount": item.total_price}
            for item, name, unit in replacement_rows
        ],
    }


@router.post("/preview", response_model=SalesReturnPreview)
async def preview_return(
    payload: SalesReturnCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_pos_orders_access),
):
    try:
        return await ReturnService.preview(db, payload, user.id)
    except PermissionError as error:
        raise HTTPException(status_code=403, detail=str(error))
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))


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
