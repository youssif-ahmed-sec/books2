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
from models.sale_correction import SaleCorrection
from models.order import Order, OrderItem, OrderStatusEnum
from models.customer import Customer
from models.product import Product, ProductUnit
from models.inventory import InventoryTransaction, TransactionTypeEnum
from models.user import User, RoleEnum
from schemas.returns import SalesReturnCreate, SalesReturnPreview, SalesReturnReceipt, SalesReturnResponse
from services.return_service import ReturnService

router = APIRouter(prefix="/returns", tags=["Returns and Exchanges"])
RETURNABLE_STATUSES = (
    OrderStatusEnum.DELIVERED.value, OrderStatusEnum.CLOSED.value,
    OrderStatusEnum.RETURNED.value, OrderStatusEnum.EXCHANGE.value,
)


@router.get("/search")
async def search_returnable_invoices(
    q: str = "",
    limit: int = 15,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_pos_orders_access),
):
    term = q.strip()
    query = select(Order, Customer.name, Customer.phone).outerjoin(
        Customer, Customer.id == Order.customer_id
    ).where(
        Order.status.in_(RETURNABLE_STATUSES)
    )

    if term:
        clean = term.lower()
        for prefix in ("inv-", "inv#", "inv", "#"):
            if clean.startswith(prefix):
                clean = clean[len(prefix):].strip()
                break

        escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        clean_escaped = clean.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        pattern = f"%{escaped}%"
        clean_pattern = f"%{clean_escaped}%"

        conditions = [
            Customer.name.ilike(pattern, escape="\\"),
            Customer.phone.ilike(pattern, escape="\\"),
            cast(Order.id, String).ilike(pattern, escape="\\"),
        ]
        if clean.isdigit():
            conditions.append(cast(Order.public_number, String).ilike(clean_pattern, escape="\\"))
        else:
            conditions.append(cast(Order.public_number, String).ilike(pattern, escape="\\"))
        query = query.where(or_(*conditions))

    rows = (await db.execute(query.order_by(Order.created_at.desc(), Order.id.desc()).limit(min(max(1, limit), 50)))).all()
    return [
        {
            "id": str(order.id),
            "public_number": order.public_number,
            "customer_name": cust_name or "عميل نقدي",
            "customer_phone": cust_phone,
            "status": order.status,
            "payment_method": order.payment_method,
            "total_amount": float(order.total_amount),
            "wallet_fee_amount": float(order.wallet_fee_amount or 0),
            "created_at": order.created_at.isoformat() if order.created_at else None,
        }
        for order, cust_name, cust_phone in rows
    ]


@router.get("/lookup/{invoice_number}")
async def lookup_invoice(
    invoice_number: str,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_pos_orders_access),
):
    raw = invoice_number.strip().lower()
    clean = raw
    for prefix in ("inv-", "inv#", "inv", "#"):
        if clean.startswith(prefix):
            clean = clean[len(prefix):].strip()
            break

    condition = None
    if clean.isdigit():
        num = int(clean)
        if num > 9223372036854775807:
            raise HTTPException(status_code=400, detail="رقم الفاتورة غير صالح")
        condition = Order.public_number == num
        if len(clean) == 12:
            condition = or_(condition, cast(Order.id, String).ilike(f"%{clean}"))
    elif re.fullmatch(r"[0-9a-f]{12}", clean):
        condition = cast(Order.id, String).ilike(f"%{clean}")
    else:
        try:
            condition = Order.id == UUID(clean)
        except ValueError:
            pass

    if condition is not None:
        rows = (await db.execute(select(Order.id, Order.status).where(
            condition,
            Order.status.in_(RETURNABLE_STATUSES),
        ).limit(2))).all()
        if rows:
            if len(rows) > 1:
                raise HTTPException(status_code=409, detail="الرقم يطابق أكثر من فاتورة؛ أدخل المعرّف الكامل")
            return {"id": rows[0].id, "status": rows[0].status}

    # Fallback to customer phone or exact customer name
    escaped = raw.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    cust_matches = (await db.execute(
        select(Order.id, Order.status).outerjoin(Customer, Customer.id == Order.customer_id).where(
            or_(
                Customer.phone == raw,
                Customer.name.ilike(f"%{escaped}%", escape="\\"),
            ),
            Order.status.in_(RETURNABLE_STATUSES),
        ).order_by(Order.created_at.desc()).limit(2)
    )).all()
    if not cust_matches:
        raise HTTPException(status_code=404, detail="لم تُعثر على فاتورة مكتملة بهذا الرقم أو البحث")
    if len(cust_matches) > 1:
        raise HTTPException(status_code=409, detail="يوجد أكثر من فاتورة مطابقة؛ استخدم قائمة البحث لاختيار الفاتورة")
    return {"id": cust_matches[0].id, "status": cust_matches[0].status}


@router.get("/eligibility/{order_id}")
async def return_eligibility(
    order_id: UUID,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_pos_orders_access),
):
    order = (await db.execute(select(Order).where(Order.id == order_id))).scalar_one_or_none()
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.status not in RETURNABLE_STATUSES:
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
    customer_name = "عميل نقدي"
    customer_phone = None
    if order.customer_id:
        cust = (await db.execute(select(Customer.price_level, Customer.name, Customer.phone).where(Customer.id == order.customer_id))).one_or_none()
        if cust is not None:
            if cust[0] is not None:
                customer_level = cust[0].value
            if cust[1]:
                customer_name = cust[1]
            if cust[2]:
                customer_phone = cust[2]
    return {
        "warehouse_id": warehouses[0],
        "customer_id": str(order.customer_id) if order.customer_id else None,
        "payment_method": order.payment_method,
        "customer_price_level": customer_level,
        "customer_name": customer_name,
        "customer_phone": customer_phone,
        "public_number": order.public_number,
        "total_amount": float(order.total_amount),
        "discount_amount": float(order.discount_amount or 0),
        "subtotal_amount": float(sum((item.total_price for item, _, _ in rows), 0)),
        "deferred_remaining": float(order.deferred_remaining) if order.deferred_remaining is not None else None,
        "wallet_fee_amount": float(order.wallet_fee_amount or 0),
        "items": result,
    }


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
    records = (await db.execute(query)).scalars().all()
    ids = [record.id for record in records]
    correction_ids = set((await db.execute(select(SaleCorrection.id).where(
        SaleCorrection.id.in_(ids), SaleCorrection.status == "APPLIED",
    ))).scalars().all()) if ids else set()
    return [{**SalesReturnResponse.model_validate(record).model_dump(), "is_correction": record.id in correction_ids}
            for record in records]


@router.get("/{return_id}/receipt", response_model=SalesReturnReceipt)
async def return_receipt(
    return_id: UUID,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_pos_orders_access),
):
    record = (await db.execute(select(SalesReturn).where(SalesReturn.id == return_id))).scalar_one_or_none()
    if record is None:
        raise HTTPException(status_code=404, detail="Return not found")
    correction = (await db.execute(select(SaleCorrection).where(
        SaleCorrection.id == record.id, SaleCorrection.status == "APPLIED",
    ))).scalar_one_or_none()
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
        "id": record.id, "public_number": record.public_number, "order_id": record.order_id,
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
        "wallet_fee_amount": record.wallet_fee_amount,
        "collection_amount": record.collection_amount,
        "is_correction": correction is not None,
        "settlement_breakdown": correction.settlement_breakdown or [] if correction is not None else [],
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
