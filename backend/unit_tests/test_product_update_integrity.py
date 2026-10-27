from decimal import Decimal
from uuid import UUID, uuid4

import pytest
from pydantic import ValidationError
from sqlalchemy import event, select, text
from fastapi import HTTPException
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.pool import StaticPool

from models.user import Base, RoleEnum, User
from models.product import Brand, Category, Product, ProductBundleComponent, ProductPrice, ProductUnit, Subcategory, Supplier
from models.order import Order, OrderItem, OrderStatusEnum
from models.inventory import InventoryBalance, InventoryTransaction, Warehouse
from models.inventory import TransactionTypeEnum
from models.financial import CashShift
from api.v1.reports import get_inventory_report, get_sales_report
from api.v1.product_approvals import RequestInput, approve_request, cancel_request, request_change
from models.product_approval import ProductApproval
from models.notification import Notification
from schemas.order import OrderCreate, OrderDraftCreate, OrderStatusUpdate, OrderPreparation
from schemas.product import ProductCreate, ProductUpdate
from services.order_service import OrderService
from services.product_service import ProductService


@compiles(JSONB, "sqlite")
def compile_jsonb_for_test(_element, _compiler, **_kwargs):
    return "JSON"


async def seed_product_catalog(db):
    category_id, subcategory_id, brand_id, supplier_id = [uuid4() for _ in range(4)]
    db.add_all([
        Category(id=category_id, name_en="Books", name_ar="كتب"),
        Subcategory(id=subcategory_id, category_id=category_id, name_en="General", name_ar="عام"),
        Brand(id=brand_id, name_en="Local", name_ar="محلي"),
        Supplier(id=supplier_id, name="Local supplier"),
    ])
    await db.commit()
    return dict(category_id=category_id, subcategory_id=subcategory_id,
                brand_id=brand_id, supplier_id=supplier_id)


@pytest.mark.asyncio
async def test_barcodes_cannot_be_reused_by_a_different_product(monkeypatch):
    async def no_name_conflict(*_args, **_kwargs):
        return None

    monkeypatch.setattr(ProductService, "name_match", no_name_conflict)
    engine = create_async_engine("sqlite+aiosqlite://", poolclass=StaticPool)
    async with engine.begin() as connection:
        tables = [table for table in Base.metadata.sorted_tables if table.name in {
            "users", "audit_logs", "categories", "subcategories", "brands", "suppliers", "products",
            "product_units", "product_prices", "product_supplier_links", "product_supplier_prices",
            "product_bundle_components", "warehouses", "inventory_balances", "purchase_orders",
        }]
        await connection.run_sync(lambda sync: Base.metadata.create_all(sync, tables=tables))
    async with async_sessionmaker(engine, expire_on_commit=False)() as db:
        user_id = uuid4()
        db.add(User(id=user_id, role=RoleEnum.ADMIN))
        await db.commit()
        catalog = await seed_product_catalog(db)
        first = await ProductService.create_product(db, ProductCreate(
            sku="FIRST", name_ar="أول", base_unit="قطعة", barcode="BOX-A", **catalog,
            units=[{"unit_name": "قطعة", "conversion_factor": 1, "barcode": "UNIT-A"}],
        ), user_id)
        second = await ProductService.create_product(db, ProductCreate(
            sku="SECOND", name_ar="ثاني", base_unit="قطعة", **catalog,
        ), user_id)
        with pytest.raises(ValueError, match="Duplicate barcode"):
            await ProductService.create_product(db, ProductCreate(
                sku="THIRD", name_ar="ثالث", base_unit="قطعة", barcode="UNIT-A", **catalog,
            ), user_id)
        await db.rollback()
        with pytest.raises(ValueError, match="Duplicate barcode"):
            await ProductService.create_product(db, ProductCreate(
                sku="THIRD", name_ar="ثالث", base_unit="قطعة", **catalog,
                units=[{"unit_name": "قطعة", "conversion_factor": 1, "barcode": "BOX-A"}],
            ), user_id)
        await db.rollback()
        with pytest.raises(ValueError, match="Duplicate barcode"):
            await ProductService.update_product(db, second["id"], ProductUpdate(barcode="UNIT-A"), user_id)
        await db.rollback()
        with pytest.raises(ValueError, match="Duplicate barcode"):
            await ProductService.update_product(db, second["id"], ProductUpdate(
                units=[{"unit_name": "قطعة", "conversion_factor": 1, "barcode": "BOX-A"}],
            ), user_id)
        await db.rollback()
        assert (await db.execute(select(Product.barcode).where(Product.id == first["id"]))).scalar_one() == "BOX-A"
        assert (await db.execute(select(Product.barcode).where(Product.id == second["id"]))).scalar_one() is None
        same_owner = await ProductService.create_product(db, ProductCreate(
            sku="SAME", name_ar="رابع", base_unit="قطعة", barcode="SAME-CODE", **catalog,
            units=[{"unit_name": "قطعة", "conversion_factor": 1, "barcode": "SAME-CODE"}],
        ), user_id)
        assert same_owner["units"][0]["barcode"] == same_owner["barcode"]
    await engine.dispose()


@pytest.mark.asyncio
async def test_archiving_rejects_stock_in_any_warehouse():
    engine = create_async_engine("sqlite+aiosqlite://", poolclass=StaticPool)
    async with engine.begin() as connection:
        tables = [table for table in Base.metadata.sorted_tables if table.name in {
            "users", "audit_logs", "categories", "subcategories", "brands", "suppliers", "products",
            "product_units", "product_prices", "product_supplier_links", "product_supplier_prices",
            "product_bundle_components", "warehouses", "inventory_balances", "purchase_orders",
        }]
        await connection.run_sync(lambda sync: Base.metadata.create_all(sync, tables=tables))
    async with async_sessionmaker(engine, expire_on_commit=False)() as db:
        user_id, product_id, warehouse_id = uuid4(), uuid4(), uuid4()
        db.add_all([
            User(id=user_id, role=RoleEnum.ADMIN),
            Product(id=product_id, sku="ARCHIVE-STOCK", name_ar="صنف", name_en="", base_unit="Piece"),
            Warehouse(id=warehouse_id, name="Inactive", is_active=False),
            InventoryBalance(product_id=product_id, warehouse_id=warehouse_id, current_stock=2),
        ])
        await db.commit()
        with pytest.raises(ValueError, match="warehouse stock"):
            await ProductService.delete_product(db, product_id, user_id)
        await db.rollback()
        assert not (await db.execute(select(Product.is_deleted).where(Product.id == product_id))).scalar_one()
        balance = (await db.execute(select(InventoryBalance).where(InventoryBalance.product_id == product_id))).scalar_one()
        balance.current_stock = 0
        await db.commit()
        assert await ProductService.delete_product(db, product_id, user_id)
        assert (await db.execute(select(Product.is_deleted).where(Product.id == product_id))).scalar_one()
    await engine.dispose()


@pytest.mark.asyncio
async def test_controller_requests_box_barcode_and_manager_approves(monkeypatch):
    async def no_name_conflict(*_args, **_kwargs):
        return None

    monkeypatch.setattr(ProductService, "name_match", no_name_conflict)
    engine = create_async_engine("sqlite+aiosqlite://", poolclass=StaticPool)
    async with engine.begin() as connection:
        tables = [table for table in Base.metadata.sorted_tables if table.name in {
            "users", "audit_logs", "categories", "subcategories", "brands", "suppliers", "products",
            "product_units", "product_prices", "product_supplier_links", "product_supplier_prices",
            "product_bundle_components", "warehouses", "inventory_balances", "purchase_orders",
            "product_approvals", "notifications",
        }]
        await connection.run_sync(lambda sync: Base.metadata.create_all(sync, tables=tables))
    async with async_sessionmaker(engine, expire_on_commit=False)() as db:
        admin = User(id=uuid4(), role=RoleEnum.ADMIN, is_active=True, is_deleted=False)
        controller = User(id=uuid4(), role=RoleEnum.INVENTORY_CONTROLLER, is_active=True, is_deleted=False)
        db.add_all([admin, controller])
        await db.commit()
        catalog = await seed_product_catalog(db)
        product = await ProductService.create_product(db, ProductCreate(
            sku="BOX-REQUEST", name_ar="صنف للتجربة", base_unit="قطعة", **catalog,
            units=[{"unit_name": "قطعة", "conversion_factor": 1, "barcode": "UNIT-ORIGINAL"}],
        ), admin.id)
        request = await request_change(RequestInput(
            product_id=product["id"], action="UPDATE", proposed=ProductUpdate(barcode="BOX-SCANNED"),
        ), db, controller)
        assert request["status"] == "PENDING"
        assert (await db.execute(select(Product.barcode).where(Product.id == product["id"]))).scalar_one() is None
        result = await approve_request(UUID(request["id"]), db, admin)
        assert result["status"] == "APPROVED"
        assert (await db.execute(select(Product.barcode).where(Product.id == product["id"]))).scalar_one() == "BOX-SCANNED"
        assert (await db.execute(select(Notification).where(Notification.user_id == controller.id))).scalars().first()
        assert (await db.execute(select(ProductApproval.status))).scalar_one() == "APPROVED"
    await engine.dispose()


@pytest.mark.asyncio
async def test_controller_cancels_own_pending_request_and_can_submit_again(monkeypatch):
    async def no_name_conflict(*_args, **_kwargs):
        return None

    monkeypatch.setattr(ProductService, "name_match", no_name_conflict)
    engine = create_async_engine("sqlite+aiosqlite://", poolclass=StaticPool)
    async with engine.begin() as connection:
        tables = [table for table in Base.metadata.sorted_tables if table.name in {
            "users", "audit_logs", "categories", "subcategories", "brands", "suppliers", "products",
            "product_units", "product_prices", "product_supplier_links", "product_supplier_prices",
            "product_bundle_components", "warehouses", "inventory_balances", "purchase_orders",
            "product_approvals", "notifications",
        }]
        await connection.run_sync(lambda sync: Base.metadata.create_all(sync, tables=tables))
        await connection.execute(text("DROP INDEX uq_product_approvals_pending_product"))
        await connection.execute(text("CREATE UNIQUE INDEX uq_product_approvals_pending_product ON product_approvals (product_id) WHERE status = 'PENDING'"))
    async with async_sessionmaker(engine, expire_on_commit=False)() as db:
        admin = User(id=uuid4(), role=RoleEnum.ADMIN, is_active=True, is_deleted=False)
        owner = User(id=uuid4(), role=RoleEnum.INVENTORY_CONTROLLER, is_active=True, is_deleted=False)
        other = User(id=uuid4(), role=RoleEnum.INVENTORY_CONTROLLER, is_active=True, is_deleted=False)
        db.add_all([admin, owner, other])
        await db.commit()
        catalog = await seed_product_catalog(db)
        product = await ProductService.create_product(db, ProductCreate(
            sku="CANCEL-REQ", name_ar="إلغاء للتجربة", base_unit="قطعة", **catalog,
        ), admin.id)
        payload = RequestInput(product_id=product["id"], action="UPDATE", proposed=ProductUpdate(barcode="BOX-TEST"))
        request = await request_change(payload, db, owner)
        with pytest.raises(HTTPException) as denied:
            await cancel_request(UUID(request["id"]), db, other)
        assert denied.value.status_code == 404
        result = await cancel_request(UUID(request["id"]), db, owner)
        assert result["status"] == "CANCELLED"
        assert (await db.execute(select(Product.barcode).where(Product.id == product["id"]))).scalar_one() is None
        with pytest.raises(HTTPException) as repeated:
            await cancel_request(UUID(request["id"]), db, owner)
        assert repeated.value.status_code == 409
        second = await request_change(payload, db, owner)
        assert second["status"] == "PENDING"
        assert (await db.execute(select(ProductApproval.status).where(ProductApproval.id == UUID(request["id"])))).scalar_one() == "CANCELLED"
    await engine.dispose()


@pytest.mark.asyncio
async def test_product_english_name_can_be_omitted_or_cleared():
    engine = create_async_engine("sqlite+aiosqlite://", poolclass=StaticPool)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    user_id = uuid4()
    async with session_factory() as db:
        db.add(User(id=user_id, role=RoleEnum.ADMIN))
        await db.commit()
        catalog = await seed_product_catalog(db)
        created = await ProductService.create_product(
            db, ProductCreate(sku="AR-ONLY", name_ar="كتاب عربي", base_unit="Piece", **catalog), user_id,
        )
        product_id = created["id"]
        assert (await db.execute(select(Product.name_en).where(Product.id == product_id))).scalar_one() == ""
        await ProductService.update_product(db, product_id, ProductUpdate(name_en=None), user_id)
        assert (await db.execute(select(Product.name_en).where(Product.id == product_id))).scalar_one() == ""
    await engine.dispose()


@pytest.mark.asyncio
async def test_unit_barcodes_are_distinct_and_product_edit_accepts_blank_barcode():
    engine = create_async_engine("sqlite+aiosqlite://", poolclass=StaticPool)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    user_id = uuid4()
    async with session_factory() as db:
        db.add(User(id=user_id, role=RoleEnum.ADMIN))
        await db.commit()
        catalog = await seed_product_catalog(db)
        created = await ProductService.create_product(db, ProductCreate(
            sku="PENS-1", name_ar="قلم جاف", base_unit="قطعة", **catalog,
            units=[
                {"unit_name": "قطعة", "conversion_factor": 1, "prices": [{"price_level": "Retail", "price": 7}]},
                {"unit_name": "دستة", "conversion_factor": 12, "prices": [{"price_level": "Wholesale", "price": 66}]},
            ],
        ), user_id)
        product_id = created["id"]
        original = {unit.unit_name: unit for unit in (await db.execute(
            select(ProductUnit).where(ProductUnit.product_id == product_id)
        )).scalars().all()}
        assert original["قطعة"].barcode
        assert original["دستة"].barcode
        assert original["قطعة"].barcode != original["دستة"].barcode

        await ProductService.update_product(db, product_id, ProductUpdate(
            barcode="",
            units=[
                {"id": original["قطعة"].id, "unit_name": "قطعة", "conversion_factor": 1,
                 "barcode": original["قطعة"].barcode, "prices": [{"price_level": "Retail", "price": 7}]},
                {"id": original["دستة"].id, "unit_name": "دستة", "conversion_factor": 12,
                 "barcode": original["دستة"].barcode, "prices": [{"price_level": "Wholesale", "price": 66}]},
                {"unit_name": "علبة", "conversion_factor": 24, "barcode": "",
                 "prices": [{"price_level": "Wholesale", "price": 120}]},
            ],
        ), user_id)
        assert (await db.execute(select(Product.barcode).where(Product.id == product_id))).scalar_one() is None
        current = {unit.unit_name: unit for unit in (await db.execute(
            select(ProductUnit).where(ProductUnit.product_id == product_id, ProductUnit.is_deleted == False)
        )).scalars().all()}
        assert current["قطعة"].id == original["قطعة"].id
        assert current["دستة"].barcode == original["دستة"].barcode
        assert current["علبة"].barcode not in {current["قطعة"].barcode, current["دستة"].barcode, None, ""}
        wholesale = (await db.execute(select(ProductPrice.price).where(
            ProductPrice.unit_id == current["دستة"].id, ProductPrice.price_level == "Wholesale",
        ))).scalar_one()
        assert wholesale == Decimal("66")

    await engine.dispose()


@pytest.mark.asyncio
async def test_offer_keeps_selected_dozen_and_wholesale_tier_with_base_stock_quantity():
    engine = create_async_engine("sqlite+aiosqlite://", poolclass=StaticPool)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    user_id = uuid4()
    async with session_factory() as db:
        db.add(User(id=user_id, role=RoleEnum.ADMIN))
        await db.commit()
        catalog = await seed_product_catalog(db)
        item = await ProductService.create_product(db, ProductCreate(
            sku="OFFER-PENS", name_ar="قلم", base_unit="قطعة", **catalog,
            units=[{"unit_name": "دستة", "conversion_factor": 12,
                    "prices": [{"price_level": "Wholesale", "price": 66}]}],
        ), user_id)
        unit = (await db.execute(select(ProductUnit).where(ProductUnit.product_id == item["id"]))).scalar_one()
        offer = await ProductService.create_product(db, ProductCreate(
            sku="OFFER-1", name_ar="عرض أقلام", base_unit="عرض", is_bundle=True, **catalog,
            bundle_components=[{"component_id": item["id"], "unit_id": unit.id,
                                "price_level": "Wholesale", "quantity": 24}],
        ), user_id)
        component = (await db.execute(select(ProductBundleComponent).where(
            ProductBundleComponent.bundle_id == offer["id"]))).scalar_one()
        assert (component.unit_id, component.price_level, component.quantity) == (unit.id, "Wholesale", Decimal("24"))
        with pytest.raises(ValidationError, match="total_stock"):
            ProductUpdate(total_stock=1)
        with pytest.raises(ValueError, match="component stock"):
            await ProductService.create_product(db, ProductCreate(
                sku="OFFER-WITH-STOCK", name_ar="عرض بمخزون", base_unit="عرض", **catalog,
                is_bundle=True, initial_stock=1,
            ), user_id)
        with pytest.raises(ValueError, match="whole number"):
            await ProductService.validate_bundle_components(db, uuid4(), [
                ProductCreate(sku="X", name_ar="X", base_unit="X", is_bundle=True, **catalog,
                    bundle_components=[{"component_id": item["id"], "unit_id": unit.id,
                                        "price_level": "Wholesale", "quantity": 13}]).bundle_components[0]
            ])
    await engine.dispose()


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
        db.add(User(id=user_id, role=RoleEnum.ADMIN))
        await db.commit()
        catalog = await seed_product_catalog(db)
        db.add_all([
            Product(id=product_id, sku="BOOK-1", name_en="Book", name_ar="كتاب", base_unit="Piece", **catalog),
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
        assert removed.barcode == "BOOK-1-BOX"

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
        assert inventory["data"][0]["transaction_type"] == "Receiving"
        assert inventory["data"][0]["quantity_changed"] == 2

    await engine.dispose()


@pytest.mark.asyncio
async def test_draft_delivery_is_idempotent_for_stock():
    engine = create_async_engine("sqlite+aiosqlite://", poolclass=StaticPool)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    user_id, preparer_id, product_id, unit_id, warehouse_id = [uuid4() for _ in range(5)]
    async with session_factory() as db:
        db.add_all([
            User(id=user_id, role=RoleEnum.CASHIER_ORDERS),
            User(id=preparer_id, role=RoleEnum.CASHIER_ORDERS),
            Product(id=product_id, sku="DRAFT-1", name_en="Book", name_ar="كتاب", base_unit="Piece"),
            Warehouse(id=warehouse_id, name="Main Warehouse"),
        ])
        await db.flush()
        db.add(CashShift(user_id=user_id, opening_cash=0, status="OPEN"))
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
        ):
            await OrderService.update_order_status(db, draft["id"], OrderStatusUpdate(status=status), user_id)
        await OrderService.assign_preparer(db, draft["id"], preparer_id, user_id)
        item_id = (await db.execute(select(OrderItem.id).where(OrderItem.order_id == draft["id"]))).scalar_one()
        preparer = (await db.execute(select(User).where(User.id == preparer_id))).scalar_one()
        await OrderService.complete_preparation(
            db, draft["id"],
            OrderPreparation(items=[{"order_item_id": item_id, "picked_quantity": 1}], package_confirmed=True),
            preparer,
        )
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
        db.add(CashShift(user_id=user_id, opening_cash=0, status="OPEN"))
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
