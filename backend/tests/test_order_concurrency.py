import asyncio
from uuid import uuid4

import pytest
from sqlalchemy import select, func

from database import AsyncSessionLocal
from models.user import User, RoleEnum
from models.product import Product, ProductUnit, ProductPrice
from models.inventory import Warehouse, InventoryBalance, InventoryTransaction
from models.order import Order
from schemas.order import OrderCreate, OrderDraftCreate, OrderStatusUpdate
from models.order import OrderStatusEnum
from services.order_service import OrderService


@pytest.mark.asyncio
async def test_concurrent_checkout_retry_creates_one_order_and_one_issue():
    user_id, warehouse_id, product_id, unit_id, request_id = [uuid4() for _ in range(5)]
    async with AsyncSessionLocal() as db:
        db.add_all([
            User(id=user_id, role=RoleEnum.CASHIER_ORDERS),
            Warehouse(id=warehouse_id, name="Concurrency Test"),
            Product(id=product_id, sku=f"CON-{product_id.hex[:8]}", name_en="Book", name_ar="كتاب", base_unit="Piece"),
        ])
        await db.flush()
        db.add_all([
            ProductUnit(id=unit_id, product_id=product_id, unit_name="Piece", conversion_factor=1),
            InventoryBalance(product_id=product_id, warehouse_id=warehouse_id, current_stock=2),
        ])
        await db.flush()
        db.add(ProductPrice(product_id=product_id, unit_id=unit_id, price_level="Retail", price=10))
        await db.commit()

    payload = OrderCreate(request_id=request_id, warehouse_id=warehouse_id,
                          items=[{"product_id": product_id, "unit_id": unit_id, "quantity": 1}])

    async def checkout():
        async with AsyncSessionLocal() as db:
            return await OrderService.create_order(db, payload, user_id)

    first, second = await asyncio.gather(checkout(), checkout())
    assert first["id"] == second["id"]
    async with AsyncSessionLocal() as db:
        assert (await db.execute(select(func.count(Order.id)).where(Order.request_id == request_id))).scalar_one() == 1
        assert (await db.execute(select(InventoryBalance.current_stock).where(
            InventoryBalance.product_id == product_id, InventoryBalance.warehouse_id == warehouse_id
        ))).scalar_one() == 1
        assert (await db.execute(select(func.count(InventoryTransaction.id)).where(
            InventoryTransaction.reference_document == str(first["id"])
        ))).scalar_one() == 1


@pytest.mark.asyncio
async def test_draft_delivery_requires_pipeline_and_issues_stock_once():
    user_id, warehouse_id, product_id, unit_id = [uuid4() for _ in range(4)]
    async with AsyncSessionLocal() as db:
        db.add_all([
            User(id=user_id, role=RoleEnum.CASHIER_ORDERS),
            Warehouse(id=warehouse_id, name="Workflow Test"),
            Product(id=product_id, sku=f"FLOW-{product_id.hex[:8]}", name_en="Book", name_ar="كتاب", base_unit="Piece"),
        ])
        await db.flush()
        db.add_all([
            ProductUnit(id=unit_id, product_id=product_id, unit_name="Piece", conversion_factor=1),
            InventoryBalance(product_id=product_id, warehouse_id=warehouse_id, current_stock=2),
        ])
        await db.flush()
        db.add(ProductPrice(product_id=product_id, unit_id=unit_id, price_level="Retail", price=10))
        await db.commit()

        draft = await OrderService.create_draft_order(
            db, OrderDraftCreate(items=[{"product_id": product_id, "unit_id": unit_id, "quantity": 1}]), user_id
        )
        assert draft["allowed_next_statuses"] == ["Waiting Quotation", "Cancelled"]
        with pytest.raises(ValueError, match="not allowed"):
            await OrderService.update_order_status(
                db, draft["id"], OrderStatusUpdate(status=OrderStatusEnum.DELIVERED, warehouse_id=warehouse_id), user_id
            )
        await db.rollback()
        for status in (
            OrderStatusEnum.WAITING_QUOTATION, OrderStatusEnum.QUOTATION_SENT,
            OrderStatusEnum.WAITING_APPROVAL, OrderStatusEnum.APPROVED,
            OrderStatusEnum.PREPARING, OrderStatusEnum.READY,
        ):
            await OrderService.update_order_status(db, draft["id"], OrderStatusUpdate(status=status), user_id)
        delivered = await OrderService.update_order_status(
            db, draft["id"], OrderStatusUpdate(status=OrderStatusEnum.DELIVERED, warehouse_id=warehouse_id), user_id
        )
        assert delivered["allowed_next_statuses"] == ["Closed"]
        await OrderService.update_order_status(db, draft["id"], OrderStatusUpdate(status=OrderStatusEnum.CLOSED), user_id)
        assert (await db.execute(select(InventoryBalance.current_stock).where(
            InventoryBalance.product_id == product_id
        ))).scalar_one() == 1
        assert (await db.execute(select(func.count(InventoryTransaction.id)).where(
            InventoryTransaction.reference_document == str(draft["id"])
        ))).scalar_one() == 1
