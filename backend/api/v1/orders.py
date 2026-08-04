"""
orders.py — POS Checkout Router

Business Rules Enforced:
  1. ZERO TRUST PRICING   — unit_price and total_price are NEVER taken from the client.
                            They are fetched from ProductPrice using (product_id, unit_id, price_level).
  2. UNIT CONVERSION      — actual_qty = requested_qty × unit.conversion_factor.
                            Stock is deducted in base units; the selling unit is just a UI concept.
  3. ROW-LEVEL LOCKING    — InventoryBalance is queried with SELECT … FOR UPDATE to prevent
                            two concurrent POS transactions from overselling the same product.
  4. STRICT STOCK CHECK   — If current_stock < actual_qty the entire transaction is rolled back
                            and a 400 HTTPException is raised. No negative stock is ever written.
  5. STATE MACHINE STATUS — Order.status is a Postgres ENUM (orderstatusenum). The default
                            value for a new POS order is DRAFT; callers may advance the state.
"""

from decimal import Decimal
from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from core.dependencies import get_current_user
from database import get_db
from models.inventory import InventoryBalance, InventoryTransaction, TransactionTypeEnum
from models.order import Order, OrderItem, OrderStatusEnum
from models.product import Product, ProductPrice, ProductUnit
from models.user import User
from schemas.order import OrderCreate, OrderResponse

router = APIRouter(prefix="/orders", tags=["Orders"])


# ─────────────────────────────────────────────────────────────────────────────
# POST /orders — POS Checkout
# ─────────────────────────────────────────────────────────────────────────────

@router.post(
    "",
    response_model=OrderResponse,
    status_code=status.HTTP_201_CREATED,
    summary="🛒 Create a new order (POS Checkout)",
    description=(
        "Executes a full POS checkout within a single atomic DB transaction.\n\n"
        "**Security:** Prices are always fetched from the database — client-supplied prices are ignored.\n\n"
        "**Concurrency:** Uses `SELECT FOR UPDATE` on every `InventoryBalance` row to prevent "
        "overselling under concurrent load.\n\n"
        "**Stock:** Raises `HTTP 400` immediately if any item has insufficient stock."
    ),
)
async def create_order(
    order_in: OrderCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # ── 1. Create the Order header (not committed yet) ───────────────────────
    order = Order(
        customer_id=order_in.customer_id,
        user_id=current_user.id,
        status=order_in.status,
        discount_amount=Decimal(str(order_in.discount_amount)),
        payment_method=order_in.payment_method,
        notes=order_in.notes,
        total_amount=Decimal("0"),   # finalised after all items are processed
        tax_amount=Decimal("0"),
    )
    db.add(order)
    await db.flush()  # obtain order.id without committing

    grand_total = Decimal("0")
    grand_tax   = Decimal("0")
    items_out   = []

    for item_in in order_in.items:

        # ── 2a. Fetch ProductUnit → conversion_factor (Zero Trust) ───────────
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
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Unit '{item_in.unit_id}' not found or does not belong "
                    f"to product '{item_in.product_id}'."
                ),
            )

        conversion_factor = Decimal(str(unit.conversion_factor))
        qty_requested     = Decimal(str(item_in.quantity))
        qty_actual        = qty_requested * conversion_factor  # base-unit quantity

        # ── 2b. Fetch ProductPrice → unit_price (Zero Trust — client price ignored) ─
        price_q = await db.execute(
            select(ProductPrice).where(
                ProductPrice.product_id == item_in.product_id,
                ProductPrice.unit_id    == item_in.unit_id,
                ProductPrice.price_level == item_in.price_level,
                ProductPrice.is_deleted == False,
            )
        )
        db_price = price_q.scalar_one_or_none()
        if db_price is None:
            await db.rollback()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"No '{item_in.price_level.value}' price configured for "
                    f"product '{item_in.product_id}' / unit '{item_in.unit_id}'. "
                    "Contact an administrator to set up pricing."
                ),
            )

        unit_price  = Decimal(str(db_price.price))
        item_total  = unit_price * qty_requested   # price is per-selling-unit

        # ── 2c. Fetch Product tax rate for tax computation ────────────────────
        prod_q = await db.execute(
            select(Product).where(Product.id == item_in.product_id)
        )
        product = prod_q.scalar_one_or_none()
        tax_rate   = Decimal(str(product.tax_rate)) if product and product.tax_rate else Decimal("0")
        item_tax   = item_total * tax_rate / Decimal("100")

        # ── 3. Row-Level Lock: SELECT … FOR UPDATE on InventoryBalance ────────
        #       Postgres holds an exclusive row lock until the transaction commits,
        #       preventing any other concurrent transaction from modifying this
        #       balance simultaneously.
        balance_q = await db.execute(
            select(InventoryBalance)
            .where(
                InventoryBalance.product_id  == item_in.product_id,
                InventoryBalance.warehouse_id == order_in.warehouse_id,
            )
            .with_for_update()   # 🔒  SELECT … FOR UPDATE
        )
        balance = balance_q.scalar_one_or_none()

        if balance is None:
            await db.rollback()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Product '{item_in.product_id}' has no inventory record "
                    f"in warehouse '{order_in.warehouse_id}'."
                ),
            )

        # ── 4. Strict Stock Validation — no negative stock allowed ────────────
        if Decimal(str(balance.current_stock)) < qty_actual:
            await db.rollback()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Insufficient stock for product '{item_in.product_id}'. "
                    f"Available: {balance.current_stock} base units, "
                    f"Required: {qty_actual} base units "
                    f"({qty_requested} × {conversion_factor} conversion factor)."
                ),
            )

        # ── 5. Deduct stock and record the inventory transaction ──────────────
        balance.current_stock = Decimal(str(balance.current_stock)) - qty_actual

        db.add(InventoryTransaction(
            product_id        = item_in.product_id,
            warehouse_id      = order_in.warehouse_id,
            user_id           = current_user.id,
            transaction_type  = TransactionTypeEnum.ISSUING,
            quantity_changed  = -qty_actual,           # negative = stock out
            reference_document= str(order.id),
            notes             = (
                f"POS Order #{order.id} | "
                f"{unit.unit_name} × {qty_requested} → {qty_actual} base units"
            ),
        ))

        # ── 6. Create OrderItem with server-computed values only ──────────────
        order_item = OrderItem(
            order_id          = order.id,
            product_id        = item_in.product_id,
            unit_id           = item_in.unit_id,
            quantity_requested= qty_requested,
            quantity_actual   = qty_actual,
            conversion_factor = conversion_factor,
            price_level       = item_in.price_level.value,
            unit_price        = unit_price,
            total_price       = item_total,
        )
        db.add(order_item)
        await db.flush()  # populate order_item.id and created_at

        grand_total += item_total
        grand_tax   += item_tax
        items_out.append(order_item)

    # ── 7. Finalise order totals and commit the atomic transaction ────────────
    order.total_amount = grand_total - Decimal(str(order_in.discount_amount))
    order.tax_amount   = grand_tax

    await db.commit()
    await db.refresh(order)   # reload server-generated timestamps

    # Build response dict (expire_on_commit=False keeps item attrs accessible)
    return {
        "id":              order.id,
        "customer_id":     order.customer_id,
        "user_id":         order.user_id,
        "status":          order.status.value,
        "total_amount":    float(order.total_amount),
        "tax_amount":      float(order.tax_amount),
        "discount_amount": float(order.discount_amount),
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
            for item in items_out
        ],
    }


# ─────────────────────────────────────────────────────────────────────────────
# GET /orders — List all orders (staff/admin only)
# ─────────────────────────────────────────────────────────────────────────────

@router.get(
    "",
    response_model=List[OrderResponse],
    summary="📋 List all orders",
)
async def get_orders(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Returns all orders with their items. Requires authentication.
    """
    orders_q = await db.execute(
        select(Order).order_by(Order.created_at.desc())
    )
    orders = orders_q.scalars().all()

    results = []
    for order in orders:
        items_q = await db.execute(
            select(OrderItem).where(OrderItem.order_id == order.id)
        )
        items = items_q.scalars().all()

        results.append({
            "id":              order.id,
            "customer_id":     order.customer_id,
            "user_id":         order.user_id,
            "status":          order.status.value if hasattr(order.status, "value") else order.status,
            "total_amount":    float(order.total_amount),
            "tax_amount":      float(order.tax_amount),
            "discount_amount": float(order.discount_amount),
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
        })

    return results
