from decimal import Decimal
from uuid import uuid4

import pytest
from fastapi import HTTPException
from httpx import ASGITransport, AsyncClient
from sqlalchemy import event, select
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.pool import StaticPool

from api.v1.inventory import create_inventory_transaction, create_stock_receipt, get_stock_receipt
from core.dependencies import get_current_user
from core.security import hash_password
from database import get_db
from main import app
from models.user import Base, RoleEnum, User
from models.product import Product, ProductUnit, ProductPrice, ProductBundleComponent, Supplier
from models.inventory import InventoryBalance, InventoryTransaction, Warehouse
from models.order import Order, OrderItem, OrderStatusEnum
from models.financial import CashShift
from schemas.inventory import InventoryTransactionCreate, StockReceiptCreate
from schemas.order import OrderCreate, OrderDraftCreate, OrderStatusUpdate, OrderPreparation
from services.order_service import OrderService


@compiles(JSONB, "sqlite")
def _compile_jsonb(_element, _compiler, **_kwargs):
    return "JSON"


@pytest.fixture
async def database():
    engine = create_async_engine("sqlite+aiosqlite://", poolclass=StaticPool)

    @event.listens_for(engine.sync_engine, "connect")
    def _enable_foreign_keys(connection, _record):
        connection.execute("PRAGMA foreign_keys=ON")

    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


@pytest.mark.asyncio
async def test_draft_bundle_uses_component_snapshot_after_recipe_edit(database):
    user_id, preparer_id, warehouse_id, bundle_id, old_id, new_id, unit_id = [uuid4() for _ in range(7)]
    async with database() as db:
        db.add_all([
            User(id=user_id, role=RoleEnum.ADMIN),
            User(id=preparer_id, role=RoleEnum.SALES_ASSISTANT),
            Warehouse(id=warehouse_id, name="Main"),
            Product(id=bundle_id, sku="BUNDLE", name_en="Bundle", name_ar="باقة", base_unit="Piece", is_bundle=True),
            Product(id=old_id, sku="OLD", name_en="Old", name_ar="قديم", base_unit="Piece"),
            Product(id=new_id, sku="NEW", name_en="New", name_ar="جديد", base_unit="Piece"),
        ])
        await db.flush()
        db.add(CashShift(user_id=user_id, opening_cash=0, status="OPEN"))
        db.add_all([
            ProductUnit(id=unit_id, product_id=bundle_id, unit_name="Piece", conversion_factor=1),
            ProductBundleComponent(bundle_id=bundle_id, component_id=old_id, quantity=2),
            InventoryBalance(product_id=old_id, warehouse_id=warehouse_id, current_stock=4),
            InventoryBalance(product_id=new_id, warehouse_id=warehouse_id, current_stock=4),
        ])
        await db.flush()
        db.add(ProductPrice(product_id=bundle_id, unit_id=unit_id, price_level="Retail", price=10))
        await db.commit()

        draft = await OrderService.create_draft_order(
            db, OrderDraftCreate(items=[{"product_id": bundle_id, "unit_id": unit_id, "quantity": 1}]), user_id
        )
        item = (await db.execute(select(OrderItem).where(OrderItem.order_id == draft["id"]))).scalar_one()
        assert item.bundle_components_snapshot == [{"product_id": str(old_id), "quantity": "2.00"}]

        component = (await db.execute(select(ProductBundleComponent))).scalar_one()
        component.component_id = new_id
        await db.commit()

        for status in (
            OrderStatusEnum.WAITING_QUOTATION, OrderStatusEnum.QUOTATION_SENT,
            OrderStatusEnum.WAITING_APPROVAL, OrderStatusEnum.APPROVED,
        ):
            await OrderService.update_order_status(db, draft["id"], OrderStatusUpdate(status=status), user_id)
        await OrderService.assign_preparer(db, draft["id"], preparer_id, user_id)
        preparer = (await db.execute(select(User).where(User.id == preparer_id))).scalar_one()
        await OrderService.complete_preparation(
            db, draft["id"],
            OrderPreparation(items=[{"order_item_id": item.id, "picked_quantity": 1}], package_confirmed=True),
            preparer,
        )
        await OrderService.update_order_status(
            db, draft["id"], OrderStatusUpdate(status=OrderStatusEnum.DELIVERED, warehouse_id=warehouse_id), user_id
        )
        balances = {row.product_id: row.current_stock for row in (await db.execute(select(InventoryBalance))).scalars()}
        assert balances[old_id] == Decimal("2")
        assert balances[new_id] == Decimal("4")
        assert len((await db.execute(select(InventoryTransaction))).scalars().all()) == 1


@pytest.mark.asyncio
async def test_pos_retry_returns_original_order_without_second_stock_movement(database):
    user_id, warehouse_id, product_id, unit_id, request_id = [uuid4() for _ in range(5)]
    async with database() as db:
        db.add_all([
            User(id=user_id, role=RoleEnum.ADMIN), Warehouse(id=warehouse_id, name="Main"),
            Product(id=product_id, sku="SINGLE", name_en="Book", name_ar="كتاب", base_unit="Piece"),
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

        payload = OrderCreate(request_id=request_id, warehouse_id=warehouse_id,
                              items=[{"product_id": product_id, "unit_id": unit_id, "quantity": 1}])
        first = await OrderService.create_order(db, payload, user_id)
        replay = await OrderService.create_order(db, payload, user_id)
        assert replay["id"] == first["id"]
        assert (await db.execute(select(InventoryBalance.current_stock))).scalar_one() == 1
        assert len((await db.execute(select(Order))).scalars().all()) == 1
        assert len((await db.execute(select(InventoryTransaction))).scalars().all()) == 1
        with pytest.raises(ValueError, match="different checkout"):
            await OrderService.create_order(db, payload.model_copy(update={"discount_amount": Decimal("1")}), user_id)


@pytest.mark.asyncio
async def test_receipt_retry_returns_original_movement(database):
    user_id, warehouse_id, product_id, supplier_id, request_id = [uuid4() for _ in range(5)]
    async with database() as db:
        user = User(id=user_id, role=RoleEnum.ADMIN)
        db.add_all([
            user, Warehouse(id=warehouse_id, name="Main"), Supplier(id=supplier_id, name="Supplier"),
            Product(id=product_id, sku="RECEIPT", name_en="Book", name_ar="كتاب", base_unit="Piece"),
        ])
        await db.commit()
        payload = InventoryTransactionCreate(
            request_id=request_id, product_id=product_id, warehouse_id=warehouse_id,
            transaction_type="Receiving", quantity_changed=2, supplier_id=supplier_id,
        )
        first = await create_inventory_transaction(payload, db, user)
        replay = await create_inventory_transaction(payload, db, user)
        assert replay.id == first.id
        assert (await db.execute(select(InventoryBalance.current_stock))).scalar_one() == 2
        assert len((await db.execute(select(InventoryTransaction))).scalars().all()) == 1
        with pytest.raises(HTTPException) as error:
            await create_inventory_transaction(payload.model_copy(update={"quantity_changed": Decimal("9")}), db, user)
        assert error.value.status_code == 409


@pytest.mark.asyncio
async def test_stock_receipt_adds_existing_quantity_atomically_without_pricing(database):
    user_id, warehouse_id, first_id, second_id, supplier_id = [uuid4() for _ in range(5)]
    async with database() as db:
        user = User(id=user_id, role=RoleEnum.INVENTORY_CONTROLLER)
        db.add_all([
            user, Warehouse(id=warehouse_id, name="Main"), Supplier(id=supplier_id, name="Supplier"),
            Product(id=first_id, sku="RCV-A", name_en="Pen", name_ar="قلم", base_unit="Piece", cost=Decimal("7")),
            Product(id=second_id, sku="RCV-B", name_en="Notebook", name_ar="دفتر", base_unit="Piece", cost=Decimal("9")),
        ])
        await db.flush()
        db.add(InventoryBalance(product_id=first_id, warehouse_id=warehouse_id, current_stock=5))
        await db.commit()
        first = StockReceiptCreate(request_id=uuid4(), supplier_id=supplier_id, warehouse_id=warehouse_id,
                                   lines=[{"product_id": first_id, "quantity": "3"},
                                          {"product_id": second_id, "quantity": "2"}])
        with pytest.raises(HTTPException) as missing:
            await create_stock_receipt(StockReceiptCreate(
                request_id=uuid4(), supplier_id=supplier_id, warehouse_id=warehouse_id,
                lines=[{"product_id": first_id, "quantity": "3"},
                       {"product_id": uuid4(), "quantity": "2"}],
            ), db, user)
        assert missing.value.status_code == 404
        assert (await db.execute(select(InventoryBalance.current_stock))).scalar_one() == Decimal("5")
        document = await create_stock_receipt(first, db, user)
        assert len(document["lines"]) == 2
        assert len((await get_stock_receipt(first.request_id, db, user))["lines"]) == 2
        assert (await create_stock_receipt(first, db, user))["id"] == str(first.request_id)
        second = StockReceiptCreate(request_id=uuid4(), supplier_id=supplier_id, warehouse_id=warehouse_id,
                                    lines=[{"product_id": first_id, "quantity": "4"}])
        await create_stock_receipt(second, db, user)
        balances = {row.product_id: row.current_stock for row in
                    (await db.execute(select(InventoryBalance))).scalars().all()}
        assert balances[first_id] == Decimal("12")
        assert balances[second_id] == Decimal("2")
        products = {row.id: row.cost for row in (await db.execute(select(Product))).scalars().all()}
        assert products[first_id] == Decimal("7") and products[second_id] == Decimal("9")
        movements = (await db.execute(select(InventoryTransaction))).scalars().all()
        assert len(movements) == 3
        assert all(row.unit_cost is None and row.supplier_finance_included is False for row in movements)
        with pytest.raises(HTTPException) as error:
            await create_stock_receipt(StockReceiptCreate(
                request_id=first.request_id, supplier_id=supplier_id, warehouse_id=warehouse_id,
                lines=[{"product_id": first_id, "quantity": "8"}],
            ), db, user)
        assert error.value.status_code == 409


@pytest.mark.asyncio
async def test_stock_receipt_rejects_cashier_role(database):
    async def isolated_db():
        async with database() as db:
            yield db

    app.dependency_overrides[get_db] = isolated_db
    app.dependency_overrides[get_current_user] = lambda: User(id=uuid4(), role=RoleEnum.CASHIER_ORDERS)
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.post("/api/v1/inventory/receipts", json={
                "request_id": str(uuid4()), "supplier_id": str(uuid4()), "warehouse_id": str(uuid4()),
                "lines": [{"product_id": str(uuid4()), "quantity": "1"}],
            })
            assert response.status_code == 403
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_current_user, None)


@pytest.mark.asyncio
async def test_database_rejects_negative_and_duplicate_balances(database):
    user_id, warehouse_id, product_id = [uuid4() for _ in range(3)]
    async with database() as db:
        db.add_all([
            User(id=user_id, role=RoleEnum.ADMIN), Warehouse(id=warehouse_id, name="Main"),
            Product(id=product_id, sku="GUARDED", name_en="Book", name_ar="كتاب", base_unit="Piece"),
        ])
        await db.commit()
        db.add(InventoryBalance(product_id=product_id, warehouse_id=warehouse_id, current_stock=-1))
        with pytest.raises(IntegrityError):
            await db.commit()
        await db.rollback()
        db.add(InventoryBalance(product_id=product_id, warehouse_id=warehouse_id, current_stock=1))
        await db.commit()
        db.add(InventoryBalance(product_id=product_id, warehouse_id=warehouse_id, current_stock=2))
        with pytest.raises(IntegrityError):
            await db.commit()


@pytest.mark.asyncio
async def test_local_api_order_roles_transitions_and_checkout_retry(database):
    user_id, preparer_id, warehouse_id, product_id, unit_id, request_id = [uuid4() for _ in range(6)]
    async with database() as db:
        user = User(id=user_id, role=RoleEnum.ADMIN)
        db.add_all([
            user,
            User(id=preparer_id, role=RoleEnum.SALES_ASSISTANT),
            Warehouse(id=warehouse_id, name="API test warehouse"),
            Product(id=product_id, sku="API-TEST", name_en="Book", name_ar="كتاب", base_unit="Piece"),
        ])
        await db.flush()
        db.add(CashShift(user_id=user_id, opening_cash=0, status="OPEN"))
        db.add_all([
            ProductUnit(id=unit_id, product_id=product_id, unit_name="Piece", conversion_factor=1),
            InventoryBalance(product_id=product_id, warehouse_id=warehouse_id, current_stock=3),
        ])
        await db.flush()
        db.add(ProductPrice(product_id=product_id, unit_id=unit_id, price_level="Retail", price=10))
        await db.commit()

    async def isolated_db():
        async with database() as db:
            yield db

    role = {"value": RoleEnum.INVENTORY_CONTROLLER}
    app.dependency_overrides[get_db] = isolated_db
    app.dependency_overrides[get_current_user] = lambda: User(id=user_id, role=role["value"])
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            assert (await client.get("/api/v1/orders")).status_code == 403
            assert (await client.get("/api/v1/reports/sales")).status_code == 403
            assert (await client.get("/api/v1/reports/inventory")).status_code == 200
            assert (await client.get("/api/v1/inventory/transactions")).status_code == 200
            assert (await client.get("/api/v1/inventory/transactions/recent")).status_code == 200
            stats = await client.get("/api/v1/inventory/stats")
            assert stats.status_code == 200
            assert stats.json()["today_movements"] is None
            role["value"] = RoleEnum.CASHIER_ORDERS
            assert (await client.get("/api/v1/inventory/transactions")).status_code == 403
            role["value"] = RoleEnum.ADMIN

            item = {"product_id": str(product_id), "unit_id": str(unit_id), "quantity": 1}
            draft = await client.post("/api/v1/orders/draft", json={"items": [item]})
            assert draft.status_code == 201, draft.text
            order_id = draft.json()["id"]
            assert draft.json()["status"] == OrderStatusEnum.DRAFT.value

            skipped = await client.patch(
                f"/api/v1/orders/{order_id}/status",
                json={"status": OrderStatusEnum.DELIVERED.value, "warehouse_id": str(warehouse_id)},
            )
            assert skipped.status_code == 400
            for next_status in (
                OrderStatusEnum.WAITING_QUOTATION, OrderStatusEnum.QUOTATION_SENT,
                OrderStatusEnum.WAITING_APPROVAL, OrderStatusEnum.APPROVED,
            ):
                response = await client.patch(
                    f"/api/v1/orders/{order_id}/status", json={"status": next_status.value}
                )
                assert response.status_code == 200, response.text
            assigned = await client.patch(
                f"/api/v1/orders/{order_id}/assign", json={"user_id": str(preparer_id)},
            )
            assert assigned.status_code == 200, assigned.text
            prepared = await client.post(
                f"/api/v1/orders/{order_id}/prepare",
                json={"items": [{"order_item_id": draft.json()["items"][0]["id"], "picked_quantity": 1}],
                      "package_confirmed": True},
            )
            assert prepared.status_code == 200, prepared.text
            delivered = await client.patch(
                f"/api/v1/orders/{order_id}/status",
                json={"status": OrderStatusEnum.DELIVERED.value, "warehouse_id": str(warehouse_id)},
            )
            assert delivered.status_code == 200, delivered.text
            assert delivered.json()["allowed_next_statuses"] == [OrderStatusEnum.CLOSED.value]
            repeated = await client.patch(
                f"/api/v1/orders/{order_id}/status",
                json={"status": OrderStatusEnum.DELIVERED.value, "warehouse_id": str(warehouse_id)},
            )
            assert repeated.status_code == 200
            assert repeated.json()["id"] == order_id

            checkout_payload = {
                "request_id": str(request_id), "warehouse_id": str(warehouse_id), "items": [item],
            }
            first = await client.post("/api/v1/orders", json=checkout_payload)
            assert first.status_code == 201, first.text
            replay = await client.post("/api/v1/orders", json=checkout_payload)
            assert replay.status_code == 201
            assert replay.json()["id"] == first.json()["id"]
            conflict = await client.post(
                "/api/v1/orders", json={**checkout_payload, "discount_amount": 1}
            )
            assert conflict.status_code == 409
            history = await client.get("/api/v1/inventory/transactions")
            assert history.status_code == 200
            assert history.json()["total"] == 2
            assert (await client.get("/api/v1/reports/inventory")).status_code == 200

        async with database() as db:
            assert (await db.execute(select(InventoryBalance.current_stock))).scalar_one() == 1
            assert len((await db.execute(select(InventoryTransaction))).scalars().all()) == 2
            assert len((await db.execute(select(Order))).scalars().all()) == 2
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_current_user, None)


@pytest.mark.asyncio
async def test_real_login_roles_inventory_receipt_and_cashier_checkout(database):
    warehouse_id, product_id, unit_id, supplier_id = [uuid4() for _ in range(4)]
    async with database() as db:
        db.add_all([
            User(email=f"{role.name.lower()}@local.test", hashed_password=hash_password("LocalTest!12345"), role=role)
            for role in (RoleEnum.ADMIN, RoleEnum.INVENTORY_CONTROLLER, RoleEnum.CASHIER_ORDERS)
        ])
        db.add_all([
            Warehouse(id=warehouse_id, name="Local test warehouse"),
            Supplier(id=supplier_id, name="Local test supplier"),
            Product(id=product_id, sku="AUTH-TEST", name_en="Book", name_ar="كتاب", base_unit="Piece"),
        ])
        await db.flush()
        db.add_all([
            ProductUnit(id=unit_id, product_id=product_id, unit_name="Piece", conversion_factor=1),
            InventoryBalance(product_id=product_id, warehouse_id=warehouse_id, current_stock=3),
        ])
        await db.flush()
        db.add(ProductPrice(product_id=product_id, unit_id=unit_id, price_level="Retail", price=10))
        await db.commit()

    async def isolated_db():
        async with database() as db:
            yield db

    app.dependency_overrides[get_db] = isolated_db
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            headers = {}
            for role in (RoleEnum.ADMIN, RoleEnum.INVENTORY_CONTROLLER, RoleEnum.CASHIER_ORDERS):
                login = await client.post(
                    "/api/v1/auth/login",
                    data={"username": f"{role.name.lower()}@local.test", "password": "LocalTest!12345"},
                )
                assert login.status_code == 200, login.text
                headers[role] = {"Authorization": f"Bearer {login.json()['access_token']}"}
                me = await client.get("/api/v1/auth/me", headers=headers[role])
                assert me.status_code == 200
                assert me.json()["role"] == role.value

            inventory_headers = headers[RoleEnum.INVENTORY_CONTROLLER]
            assert (await client.get("/api/v1/reports/inventory", headers=inventory_headers)).status_code == 200
            assert (await client.get("/api/v1/inventory/transactions", headers=inventory_headers)).status_code == 200
            assert (await client.get("/api/v1/inventory/transactions/recent", headers=inventory_headers)).status_code == 200
            stats = await client.get("/api/v1/inventory/stats", headers=inventory_headers)
            assert stats.status_code == 200
            assert stats.json()["today_movements"] is None
            receipt = await client.post(
                "/api/v1/inventory/transactions", headers=inventory_headers,
                json={
                    "request_id": str(uuid4()), "product_id": str(product_id),
                    "warehouse_id": str(warehouse_id), "supplier_id": str(supplier_id),
                    "transaction_type": "Receiving", "quantity_changed": 1, "unit_cost": 7,
                },
            )
            assert receipt.status_code == 201, receipt.text

            cashier_headers = headers[RoleEnum.CASHIER_ORDERS]
            assert (await client.get("/api/v1/inventory/transactions", headers=cashier_headers)).status_code == 403
            opened = await client.post(
                "/api/v1/cash-register/open", headers=cashier_headers, json={"opening_cash": 0},
            )
            assert opened.status_code == 201, opened.text
            checkout = await client.post(
                "/api/v1/orders", headers=cashier_headers,
                json={
                    "request_id": str(uuid4()), "warehouse_id": str(warehouse_id),
                    "items": [{"product_id": str(product_id), "unit_id": str(unit_id), "quantity": 1}],
                },
            )
            assert checkout.status_code == 201, checkout.text

            admin_headers = headers[RoleEnum.ADMIN]
            admin_stats = await client.get("/api/v1/inventory/stats", headers=admin_headers)
            assert admin_stats.status_code == 200
            assert admin_stats.json()["today_movements"] == 2
            history = await client.get("/api/v1/inventory/transactions", headers=admin_headers)
            assert history.status_code == 200
            assert history.json()["total"] == 2
            assert (await client.get("/api/v1/reports/inventory", headers=admin_headers)).status_code == 200

        async with database() as db:
            assert (await db.execute(select(InventoryBalance.current_stock))).scalar_one() == 3
            assert len((await db.execute(select(InventoryTransaction))).scalars().all()) == 2
    finally:
        app.dependency_overrides.pop(get_db, None)
