from decimal import Decimal
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import or_, and_

from core.dependencies import get_current_user, require_pos_orders_access
from database import get_db
from models.inventory import InventoryBalance, InventoryTransaction, TransactionTypeEnum
from models.order import Order, OrderItem, OrderStatusEnum, OrderSourceEnum
from models.product import Product, ProductPrice, ProductUnit
from models.user import User
from schemas.order import OrderCreate, OrderDraftCreate, OrderResponse, OrderStatusUpdate

router = APIRouter(prefix="/orders", tags=["Orders"])


def _build_order_dict(order, items):
    return {
        "id":              order.id,
        "customer_id":     order.customer_id,
        "user_id":         order.user_id,
        "assigned_to_id":  order.assigned_to_id,
        "status":          order.status.value if hasattr(order.status, "value") else order.status,
        "source":          (order.source.value if hasattr(order.source, "value") else order.source) if order.source else "Walk-In Customer",
        "total_amount":    float(order.total_amount),
        "tax_amount":      float(order.tax_amount),
        "discount_amount": float(order.discount_amount),
        "shipping_cost":   float(order.shipping_cost),
        "payment_method":  order.payment_method,
        "notes":           order.notes,
        "created_at":      order.created_at,
        "updated_at":      order.updated_at,
        "items": [
            {
                "id":                 item.id,
                "order_id":           item.order_id,
                "product_id":         item.product_id,
                "unit_id":            item.unit_id,
                "quantity_requested": float(item.quantity_requested),
                "quantity_actual":    float(item.quantity_actual),
                "conversion_factor":  float(item.conversion_factor),
                "price_level":        item.price_level,
                "unit_price":         float(item.unit_price),
                "total_price":        float(item.total_price),
                "created_at":         item.created_at,
            }
            for item in items
        ],
    }


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
    order = Order(
        customer_id=order_in.customer_id,
        user_id=current_user.id,
        status=order_in.status.value,
        source=order_in.source if hasattr(order_in, "source") and order_in.source else OrderSourceEnum.WALK_IN.value,
        discount_amount=Decimal(str(order_in.discount_amount)),
        shipping_cost=Decimal("0"),
        payment_method=order_in.payment_method,
        notes=order_in.notes,
        total_amount=Decimal("0"),
        tax_amount=Decimal("0"),
    )
    db.add(order)
    await db.flush()

    grand_total = Decimal("0")
    items_out   = []

    for item_in in order_in.items:
        unit_q = await db.execute(
            select(ProductUnit).where(
                ProductUnit.id == item_in.unit_id,
                ProductUnit.product_id == item_in.product_id,
                ProductUnit.is_deleted == False,
            )
        )
        unit = unit_q.scalar_one_or_none()
        if unit is None:
            await db.rollback()
            raise HTTPException(status_code=400, detail="Unit not found.")

        conversion_factor = Decimal(str(unit.conversion_factor))
        qty_requested     = Decimal(str(item_in.quantity))
        qty_actual        = qty_requested * conversion_factor

        price_q = await db.execute(
            select(ProductPrice).where(
                ProductPrice.product_id == item_in.product_id,
                ProductPrice.unit_id == item_in.unit_id,
                ProductPrice.price_level == item_in.price_level.value,
            )
        )
        price_record = price_q.scalar_one_or_none()
        if not price_record:
            await db.rollback()
            raise HTTPException(status_code=400, detail="Price missing.")

        unit_price = Decimal(str(price_record.price))
        item_total = unit_price * qty_requested

        prod_q = await db.execute(select(Product).where(Product.id == item_in.product_id))
        product = prod_q.scalar_one_or_none()
        
        components_to_deduct = []
        if product and product.is_bundle:
            from models.product import ProductBundleComponent
            bundle_comps_q = await db.execute(select(ProductBundleComponent).where(ProductBundleComponent.bundle_id == product.id))
            bundle_comps = bundle_comps_q.scalars().all()
            for comp in bundle_comps:
                components_to_deduct.append({
                    "product_id": comp.component_id,
                    "qty": qty_actual * Decimal(str(comp.quantity))
                })
        else:
            components_to_deduct.append({
                "product_id": item_in.product_id,
                "qty": qty_actual
            })

        for comp_data in components_to_deduct:
            c_prod_id = comp_data["product_id"]
            c_qty = comp_data["qty"]
            
            if str(order_in.warehouse_id) == "00000000-0000-0000-0000-000000000000":
                balance_q = await db.execute(
                    select(InventoryBalance)
                    .where(
                        InventoryBalance.product_id == c_prod_id,
                        InventoryBalance.current_stock >= c_qty
                    )
                    .order_by(InventoryBalance.current_stock.desc())
                    .limit(1)
                    .with_for_update()
                )
            else:
                balance_q = await db.execute(
                    select(InventoryBalance)
                    .where(
                        InventoryBalance.product_id == c_prod_id,
                        InventoryBalance.warehouse_id == order_in.warehouse_id,
                    )
                    .with_for_update()
                )

            balance = balance_q.scalar_one_or_none()
            if not balance or Decimal(str(balance.current_stock)) < c_qty:
                await db.rollback()
                raise HTTPException(status_code=400, detail=f"Insufficient stock for product/component {c_prod_id}.")

            balance.current_stock = Decimal(str(balance.current_stock)) - c_qty
            db.add(InventoryTransaction(
                product_id=c_prod_id,
                warehouse_id=balance.warehouse_id,
                user_id=current_user.id,
                transaction_type=TransactionTypeEnum.ISSUING,
                quantity_changed=-c_qty,
                reference_document=str(order.id),
                notes=f"POS Order #{order.id}",
            ))

        order_item = OrderItem(
            order_id=order.id,
            product_id=item_in.product_id,
            unit_id=item_in.unit_id,
            quantity_requested=qty_requested,
            quantity_actual=qty_actual,
            conversion_factor=conversion_factor,
            price_level=item_in.price_level.value,
            unit_price=unit_price,
            total_price=item_total,
        )
        db.add(order_item)
        await db.flush()

        grand_total += item_total
        items_out.append(order_item)

    order.total_amount = grand_total - Decimal(str(order_in.discount_amount))
    await db.commit()
    await db.refresh(order)
    return _build_order_dict(order, items_out)


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
    order = Order(
        customer_id=order_in.customer_id,
        user_id=current_user.id,
        assigned_to_id=order_in.assigned_to_id,
        status=order_in.status.value,
        source=order_in.source.value,
        discount_amount=Decimal(str(order_in.discount_amount)),
        shipping_cost=Decimal(str(order_in.shipping_cost)),
        payment_method=order_in.payment_method,
        notes=order_in.notes,
        total_amount=Decimal("0"),
        tax_amount=Decimal("0"),
    )
    db.add(order)
    await db.flush()

    grand_total = Decimal("0")
    items_out   = []

    for item_in in order_in.items:
        unit_q = await db.execute(
            select(ProductUnit).where(ProductUnit.id == item_in.unit_id)
        )
        unit = unit_q.scalar_one_or_none()
        if not unit:
            await db.rollback()
            raise HTTPException(status_code=400, detail="Unit not found.")

        conversion_factor = Decimal(str(unit.conversion_factor))
        qty_requested     = Decimal(str(item_in.quantity))
        qty_actual        = qty_requested * conversion_factor

        price_q = await db.execute(
            select(ProductPrice).where(
                ProductPrice.product_id == item_in.product_id,
                ProductPrice.unit_id == item_in.unit_id,
                ProductPrice.price_level == item_in.price_level.value,
            )
        )
        price_record = price_q.scalar_one_or_none()
        if not price_record:
            await db.rollback()
            raise HTTPException(status_code=400, detail=f"Price missing for {item_in.price_level.value}.")

        unit_price = Decimal(str(price_record.price))
        item_total = unit_price * qty_requested

        order_item = OrderItem(
            order_id=order.id,
            product_id=item_in.product_id,
            unit_id=item_in.unit_id,
            quantity_requested=qty_requested,
            quantity_actual=qty_actual,
            conversion_factor=conversion_factor,
            price_level=item_in.price_level.value,
            unit_price=unit_price,
            total_price=item_total,
        )
        db.add(order_item)
        await db.flush()

        grand_total += item_total
        items_out.append(order_item)

    order.total_amount = grand_total + Decimal(str(order_in.shipping_cost)) - Decimal(str(order_in.discount_amount))
    await db.commit()
    await db.refresh(order)
    return _build_order_dict(order, items_out)


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
    order_q = await db.execute(select(Order).where(Order.id == order_id))
    order = order_q.scalar_one_or_none()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    new_status = status_update.status.value
    old_status = order.status

    if new_status in [OrderStatusEnum.DELIVERED.value, OrderStatusEnum.CLOSED.value]:
        # Only deduct if not already deducted (we consider DELIVERED or CLOSED as deducted)
        if old_status not in [OrderStatusEnum.DELIVERED.value, OrderStatusEnum.CLOSED.value]:
            if not status_update.warehouse_id:
                raise HTTPException(status_code=400, detail="warehouse_id is required to deliver/close.")

            items_q = await db.execute(select(OrderItem).where(OrderItem.order_id == order.id))
            items = items_q.scalars().all()

            for item in items:
                prod_q = await db.execute(select(Product).where(Product.id == item.product_id))
                product = prod_q.scalar_one_or_none()
                
                components_to_deduct = []
                if product and product.is_bundle:
                    from models.product import ProductBundleComponent
                    bundle_comps_q = await db.execute(select(ProductBundleComponent).where(ProductBundleComponent.bundle_id == product.id))
                    bundle_comps = bundle_comps_q.scalars().all()
                    for comp in bundle_comps:
                        components_to_deduct.append({
                            "product_id": comp.component_id,
                            "qty": Decimal(str(item.quantity_actual)) * Decimal(str(comp.quantity))
                        })
                else:
                    components_to_deduct.append({
                        "product_id": item.product_id,
                        "qty": Decimal(str(item.quantity_actual))
                    })

                for comp_data in components_to_deduct:
                    c_prod_id = comp_data["product_id"]
                    c_qty = comp_data["qty"]

                    balance_q = await db.execute(
                        select(InventoryBalance)
                        .where(
                            InventoryBalance.product_id == c_prod_id,
                            InventoryBalance.warehouse_id == status_update.warehouse_id,
                        )
                        .with_for_update()
                    )
                    balance = balance_q.scalar_one_or_none()
                    if not balance or Decimal(str(balance.current_stock)) < c_qty:
                        await db.rollback()
                        raise HTTPException(status_code=400, detail=f"Insufficient stock for delivery of component {c_prod_id}.")

                    balance.current_stock = Decimal(str(balance.current_stock)) - c_qty
                    db.add(InventoryTransaction(
                        product_id=c_prod_id,
                        warehouse_id=status_update.warehouse_id,
                        user_id=current_user.id,
                        transaction_type=TransactionTypeEnum.ISSUING,
                        quantity_changed=-c_qty,
                        reference_document=str(order.id),
                        notes=f"Order {order.id} Delivered",
                    ))

    order.status = new_status
    await db.commit()
    await db.refresh(order)

    # Return full object
    items_q = await db.execute(select(OrderItem).where(OrderItem.order_id == order.id))
    items_out = items_q.scalars().all()
    return _build_order_dict(order, items_out)


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
    query = select(Order).order_by(Order.created_at.desc())
    if status:
        query = query.where(Order.status == status)
    if source:
        query = query.where(Order.source == source)
    if customer_id:
        query = query.where(Order.customer_id == customer_id)

    orders_q = await db.execute(query)
    orders = orders_q.scalars().all()

    results = []
    for order in orders:
        items_q = await db.execute(
            select(OrderItem).where(OrderItem.order_id == order.id)
        )
        items = items_q.scalars().all()
        results.append(_build_order_dict(order, items))

    return results

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
    order_q = await db.execute(select(Order).where(Order.id == order_id))
    order = order_q.scalar_one_or_none()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    items_q = await db.execute(select(OrderItem).where(OrderItem.order_id == order.id))
    items = items_q.scalars().all()
    
    return _build_order_dict(order, items)
