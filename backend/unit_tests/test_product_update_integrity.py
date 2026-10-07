from decimal import Decimal
from uuid import uuid4

import pytest
from sqlalchemy import event, select
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.pool import StaticPool

from models.user import Base, RoleEnum, User
from models.product import Product, ProductPrice, ProductUnit
from models.order import Order, OrderItem, OrderStatusEnum
from models.inventory import InventoryBalance, InventoryTransaction, Warehouse
from models.inventory import TransactionTypeEnum
from api.v1.reports import get_inventory_report, get_sales_report
from schemas.order import OrderCreate, OrderDraftCreate, OrderStatusUpdate
from schemas.product import ProductUpdate
from services.order_service import OrderService
from services.product_service import ProductService


@compiles(JSONB, "sqlite")
def compile_jsonb_for_test(_element, _compiler, **_kwargs):
    return "JSON"


@pytest.mark.asyncio
async def test_editing_product_preserves_order_unit_reference_and_archives_removed_unit():
    engine = create_async_engine("sqlite+aiosqlite://", poolclass=StaticPool)

    @event.listens_for(engine.sync_engine, "connect")
    def enable_foreign_keys(connection, _record):
        connection.execute("PRAGMA foreign_keys=ON")

    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    user_id, product_id, kept_unit_id, removed_unit_id, order_id = [uuid4() for _ in range(5)]
    async with session_factory() as db:
        db.add_all([
            User(id=user_id, role=RoleEnum.ADMIN),
            Product(id=product_id, sku="BOOK-1", name_en="Book", name_ar="كتاب", base_unit="Piece"),
        ])
        await db.flush()
        db.add_all([
            ProductUnit(id=kept_unit_id, product_id=product_id, unit_name="Piece", conversion_factor=1, barcode="BOOK-1-PIECE"),
            ProductUnit(id=removed_unit_id, product_id=product_id, unit_name="Old Box", conversion_factor=5, barcode="BOOK-1-BOX"),
        ])
        await db.flush()
        db.add_all([
            ProductPrice(product_id=product_id, unit_id=kept_unit_id, price_level="Retail", price=10),
            Order(id=order_id, user_id=user_id, status=OrderStatusEnum.CLOSED.value),
        ])
        await db.flush()
        db.add_all([
            OrderItem(order_id=order_id, product_id=product_id, unit_id=removed_unit_id,
                      quantity_requested=1, quantity_actual=5, conversion_factor=5,
                      price_level="Retail", unit_price=40, total_price=40),
        ])
        await db.commit()

        updated = await ProductService.update_product(
            db, product_id,
            ProductUpdate(is_bundle=False, bundle_components=[], units=[{
                "id": kept_unit_id, "unit_name": "Piece", "conversion_factor": Decimal("1"),
                "barcode": "BOOK-1-PIECE", "prices": [{"price_level": "Retail", "price": Decimal("12")}],
            }]),
            user_id,
        )
        assert [unit.id for unit in updated.units if not unit.is_deleted] == [kept_unit_id]
        assert (await db.execute(select(OrderItem.unit_id).where(OrderItem.order_id == order_id))).scalar_one() == removed_unit_id
        removed = (await db.execute(select(ProductUnit).where(ProductUnit.id == removed_unit_id))).scalar_one()
        assert removed.is_deleted is True
        assert removed.barcode is None

    await engine.dispose()


@pytest.mark.asyncio
async def test_reports_use_current_order_and_inventory_columns():
    engine = create_async_engine("sqlite+aiosqlite://", poolclass=StaticPool)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    user_id, product_id, warehouse_id = [uuid4() for _ in range(3)]
    async with session_factory() as db:
        user = User(id=user_id, role=RoleEnum.ADMIN)
        db.add_all([
            user,
            Product(id=product_id, sku="REPORT-1", name_en="Book", name_ar="كتاب", base_unit="Piece"),
            Warehouse(id=warehouse_id, name="Main Warehouse"),
        ])
        await db.flush()
        db.add_all([
            Order(user_id=user_id, status=OrderStatusEnum.CLOSED.value, total_amount=20),
            InventoryTransaction(product_id=product_id, warehouse_id=warehouse_id, user_id=user_id,
                                 transaction_type=TransactionTypeEnum.RECEIVING, quantity_changed=2),
        ])
        await db.commit()

        sales = await get_sales_report(db=db, current_user=user)
        inventory = await get_inventory_report(db=db, current_user=user)
        assert sales["metrics"]["total_revenue"] == 20
        assert sales["data"][0]["final_total"] == 20
        assert inventory[0]["transaction_type"] == "Receiving"
        assert inventory[0]["quantity_changed"] == 2

    await engine.dispose()


@pytest.mark.asyncio
async def test_draft_delivery_is_idempotent_for_stock():
    engine = create_async_engine("sqlite+aiosqlite://", poolclass=StaticPool)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    user_id, product_id, unit_id, warehouse_id = [uuid4() for _ in range(4)]
    async with session_factory() as db:
        db.add_all([
            User(id=user_id, role=RoleEnum.CASHIER_ORDERS),
            Product(id=product_id, sku="DRAFT-1", name_en="Book", name_ar="كتاب", base_unit="Piece"),
            Warehouse(id=warehouse_id, name="Main Warehouse"),
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
            db,
            OrderDraftCreate(items=[{"product_id": product_id, "unit_id": unit_id, "quantity": 1}]),
            user_id,
        )
        assert (await db.execute(select(InventoryBalance.current_stock))).scalar_one() == 2
        for status in (
            OrderStatusEnum.WAITING_QUOTATION, OrderStatusEnum.QUOTATION_SENT,
            OrderStatusEnum.WAITING_APPROVAL, OrderStatusEnum.APPROVED,
            OrderStatusEnum.PREPARING, OrderStatusEnum.READY,
        ):
            await OrderService.update_order_status(db, draft["id"], OrderStatusUpdate(status=status), user_id)
        await OrderService.update_order_status(
            db, draft["id"], OrderStatusUpdate(status=OrderStatusEnum.DELIVERED, warehouse_id=warehouse_id), user_id,
        )
        assert (await db.execute(select(InventoryBalance.current_stock))).scalar_one() == 1
        await OrderService.update_order_status(
            db, draft["id"], OrderStatusUpdate(status=OrderStatusEnum.CLOSED), user_id,
        )
        assert (await db.execute(select(InventoryBalance.current_stock))).scalar_one() == 1
        assert len((await db.execute(select(InventoryTransaction))).scalars().all()) == 1

    await engine.dispose()


@pytest.mark.asyncio
async def test_checkout_deducts_stock_once_and_rejects_insufficient_stock():
    engine = create_async_engine("sqlite+aiosqlite://", poolclass=StaticPool)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    user_id, product_id, unit_id, warehouse_id = [uuid4() for _ in range(4)]
    async with session_factory() as db:
        db.add_all([
            User(id=user_id, role=RoleEnum.CASHIER_ORDERS),
            Product(id=product_id, sku="POS-1", name_en="Book", name_ar="كتاب", base_unit="Piece"),
            Warehouse(id=warehouse_id, name="Main Warehouse"),
        ])
        await db.flush()
        db.add_all([
            ProductUnit(id=unit_id, product_id=product_id, unit_name="Piece", conversion_factor=1),
            InventoryBalance(product_id=product_id, warehouse_id=warehouse_id, current_stock=2),
        ])
        await db.flush()
        db.add(ProductPrice(product_id=product_id, unit_id=unit_id, price_level="Retail", price=10))
        await db.commit()

        payload = OrderCreate(request_id=uuid4(), warehouse_id=warehouse_id, items=[{
            "product_id": product_id, "unit_id": unit_id, "quantity": 1,
        }])
        order = await OrderService.create_order(db, payload, user_id)
        assert order["total_amount"] == 10
        assert (await db.execute(select(InventoryBalance.current_stock))).scalar_one() == 1
        assert len((await db.execute(select(InventoryTransaction))).scalars().all()) == 1

        with pytest.raises(ValueError, match="Insufficient stock"):
            await OrderService.create_order(
                db,
                OrderCreate(request_id=uuid4(), warehouse_id=warehouse_id, items=[{
                    "product_id": product_id, "unit_id": unit_id, "quantity": 2,
                }]),
                user_id,
            )
        assert (await db.execute(select(InventoryBalance.current_stock))).scalar_one() == 1
        assert len((await db.execute(select(Order))).scalars().all()) == 1

    await engine.dispose()
