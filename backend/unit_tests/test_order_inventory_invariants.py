from decimal import Decimal
from datetime import datetime, timezone
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
from models.product import Product, ProductUnit, ProductPrice, ProductBundleComponent, Supplier, SupplierPayment, SupplierDebtEntry
from models.inventory import InventoryBalance, InventoryTransaction, Warehouse
from models.inventory import TransactionTypeEnum
from models.purchase import PurchaseOrder
from models.order import Order, OrderItem, OrderStatusEnum
from models.financial import CashShift
from models.financial import CashAdjustment, Payment
from models.customer import Customer
from models.returns import SalesReturn, SalesReturnLine
from schemas.inventory import InventoryTransactionCreate, StockReceiptCreate
from schemas.order import OrderCreate, OrderDraftCreate, OrderStatusUpdate, OrderPreparation
from services.order_service import OrderService
from services.cash_register_service import expected_cash
from services.analytics_service import management_details, stock_alerts
from services.return_service import ReturnService
from schemas.returns import SalesReturnCreate
from api.v1.pos import search_pos_products


@pytest.mark.asyncio
async def test_discounted_return_preview_and_exchange_are_atomic_and_retry_safe(database):
    user_id, warehouse_id, old_id, new_id, old_unit, new_unit = [uuid4() for _ in range(6)]
    async with database() as db:
        db.add_all([
            User(id=user_id, role=RoleEnum.ADMIN), Warehouse(id=warehouse_id, name="Main"),
            Product(id=old_id, sku="RETURN-OLD", name_en="Old", name_ar="قديم", base_unit="Piece"),
            Product(id=new_id, sku="RETURN-NEW", name_en="New", name_ar="جديد", base_unit="Piece"),
        ])
        await db.flush()
        db.add_all([
            CashShift(user_id=user_id, opening_cash=0, status="OPEN"),
            ProductUnit(id=old_unit, product_id=old_id, unit_name="Piece", conversion_factor=1),
            ProductUnit(id=new_unit, product_id=new_id, unit_name="Piece", conversion_factor=1),
            InventoryBalance(product_id=old_id, warehouse_id=warehouse_id, current_stock=5),
            InventoryBalance(product_id=new_id, warehouse_id=warehouse_id, current_stock=5),
        ])
        await db.flush()
        db.add_all([
            ProductPrice(product_id=old_id, unit_id=old_unit, price_level="Retail", price=30),
            ProductPrice(product_id=new_id, unit_id=new_unit, price_level="Retail", price=40),
        ])
        await db.commit()
        sale = await OrderService.create_order(db, OrderCreate(
            request_id=uuid4(), warehouse_id=warehouse_id, discount_amount=10,
            items=[{"product_id": old_id, "unit_id": old_unit, "quantity": 2}],
        ), user_id)
        original_item = sale["items"][0]["id"]
        payload = SalesReturnCreate(
            request_id=uuid4(), order_id=sale["id"], warehouse_id=warehouse_id,
            kind="EXCHANGE", settlement_confirmed=True,
            lines=[{"order_item_id": original_item, "quantity": 1}],
            replacements=[{"product_id": new_id, "unit_id": new_unit, "quantity": 1}],
            expected_refund_amount=0, expected_charge_amount=15,
        )
        quote = await ReturnService.preview(db, payload, user_id)
        assert quote["returned_value"] == 25
        assert quote["replacement_value"] == 40
        assert quote["charge_amount"] == 15
        stale = payload.model_copy(update={"expected_charge_amount": Decimal("14")})
        with pytest.raises(ValueError, match="settlement changed"):
            await ReturnService.process(db, stale, user_id)
        assert not (await db.execute(select(SalesReturn))).scalars().all()
        record = await ReturnService.process(db, payload, user_id)
        assert record.charge_amount == 15
        assert (await ReturnService.process(db, payload, user_id)).id == record.id
        balances = {row.product_id: row.current_stock for row in (await db.execute(select(InventoryBalance))).scalars()}
        assert balances == {old_id: 4, new_id: 4}
        assert len((await db.execute(select(SalesReturnLine))).scalars().all()) == 1
        assert len((await db.execute(select(Payment).where(Payment.kind == "SALE"))).scalars().all()) == 2
        refund = SalesReturnCreate(
            request_id=uuid4(), order_id=sale["id"], warehouse_id=warehouse_id, kind="REFUND",
            lines=[{"order_item_id": original_item, "quantity": 1}],
            expected_refund_amount=25, expected_charge_amount=0,
        )
        assert (await ReturnService.preview(db, refund, user_id))["refund_amount"] == 25
        with pytest.raises(ValueError, match="Confirm refund"):
            await ReturnService.process(db, refund, user_id)
        assert len((await db.execute(select(SalesReturnLine))).scalars().all()) == 1
        completed = await ReturnService.process(db, refund.model_copy(update={"settlement_confirmed": True}), user_id)
        assert completed.refund_amount == 25
        assert (await db.execute(select(Order.status).where(Order.id == sale["id"]))).scalar_one() == OrderStatusEnum.RETURNED.value
        assert (await db.execute(select(InventoryBalance.current_stock).where(InventoryBalance.product_id == old_id))).scalar_one() == 5


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
async def test_customer_metrics_exclude_exchange_count_and_subtract_returns(database):
    user_id, warehouse_id, customer_id, original_id, exchange_id = [uuid4() for _ in range(5)]
    async with database() as db:
        db.add_all([User(id=user_id, role=RoleEnum.ADMIN), Warehouse(id=warehouse_id, name="Metrics"),
                    Customer(id=customer_id, name="Customer")])
        await db.flush()
        db.add_all([
            Order(id=original_id, customer_id=customer_id, status=OrderStatusEnum.RETURNED.value, total_amount=60),
            Order(id=exchange_id, customer_id=customer_id, status=OrderStatusEnum.CLOSED.value, total_amount=40),
            Order(customer_id=customer_id, status=OrderStatusEnum.DRAFT.value, total_amount=999),
        ])
        await db.flush()
        db.add(SalesReturn(order_id=original_id, exchange_order_id=exchange_id, warehouse_id=warehouse_id,
                           user_id=user_id, kind="EXCHANGE", payment_method="Cash", request_fingerprint="metrics",
                           returned_value=30, replacement_value=40))
        await OrderService._record_customer_sale(db, customer_id, Decimal("0"))
        customer = (await db.execute(select(Customer).where(Customer.id == customer_id))).scalar_one()
        assert customer.purchase_count == 1
        assert customer.total_purchases == 70
        assert customer.average_purchase == 70
        assert customer.last_purchase_date is not None


@pytest.mark.asyncio
async def test_expected_cash_aggregates_payments_and_adjustments(database):
    user_id = uuid4()
    async with database() as db:
        db.add(User(id=user_id, role=RoleEnum.ADMIN))
        await db.flush()
        shift = CashShift(user_id=user_id, opening_cash=100, status="OPEN")
        db.add(shift)
        await db.flush()
        assert await expected_cash(db, shift) == 100
        db.add_all([
            Payment(user_id=user_id, shift_id=shift.id, amount=60, method="Cash", kind="SALE"),
            Payment(user_id=user_id, shift_id=shift.id, amount=20, method="Cash", kind="COLLECTION"),
            Payment(user_id=user_id, shift_id=shift.id, amount=30, method="Cash", kind="REFUND"),
            Payment(user_id=user_id, shift_id=shift.id, amount=999, method="Cash", kind="OTHER"),
            CashAdjustment(user_id=user_id, shift_id=shift.id, amount=-10, reason="Withdrawal"),
        ])
        await db.flush()
        assert await expected_cash(db, shift) == 140


@pytest.mark.asyncio
async def test_stock_alerts_keep_threshold_and_sorting_rules(database):
    warehouse_id = uuid4()
    async with database() as db:
        db.add(Warehouse(id=warehouse_id, name="Alerts"))
        products = [
            Product(sku="OUT", name_en="Out", name_ar="نفد", base_unit="Piece", min_stock_level=0),
            Product(sku="LOW", name_en="Low", name_ar="قليل", base_unit="Piece", min_stock_level=10),
            Product(sku="DEFAULT", name_en="Default", name_ar="افتراضي", base_unit="Piece", min_stock_level=0),
            Product(sku="OK", name_en="OK", name_ar="كافي", base_unit="Piece", min_stock_level=0),
        ]
        db.add_all(products)
        await db.flush()
        db.add_all([
            InventoryBalance(product_id=products[1].id, warehouse_id=warehouse_id, current_stock=8),
            InventoryBalance(product_id=products[2].id, warehouse_id=warehouse_id, current_stock=4),
            InventoryBalance(product_id=products[3].id, warehouse_id=warehouse_id, current_stock=5),
        ])
        await db.flush()
        alerts = await stock_alerts(db)
        assert [row["name"] for row in alerts] == ["نفد", "افتراضي", "قليل"]
        assert [(row["stock"], row["severity"]) for row in alerts] == [(0, "out"), (4, "low"), (8, "low")]


@pytest.mark.asyncio
async def test_conversation_dashboard_counts_require_admin(database):
    user_id = uuid4()
    async with database() as db:
        db.add(User(id=user_id, role=RoleEnum.ADMIN))
        await db.flush()
        db.add_all([
            Order(status=OrderStatusEnum.NEW_LEAD.value, total_amount=0),
            Order(status=OrderStatusEnum.DRAFT.value, total_amount=0),
        ])
        await db.commit()

    async def isolated_db():
        async with database() as db:
            yield db

    app.dependency_overrides[get_db] = isolated_db
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            app.dependency_overrides[get_current_user] = lambda: User(id=user_id, role=RoleEnum.CASHIER_ORDERS)
            assert (await client.get("/api/v1/dashboards/conversations")).status_code == 403
            app.dependency_overrides[get_current_user] = lambda: User(id=user_id, role=RoleEnum.ADMIN)
            response = await client.get("/api/v1/dashboards/conversations")
            assert response.status_code == 200
            assert response.json() == {"new_leads": 1, "active_orders": 1}
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_current_user, None)


@pytest.mark.asyncio
async def test_assigned_orders_filter_before_loading_items(database):
    first_user, second_user = uuid4(), uuid4()
    async with database() as db:
        db.add_all([User(id=first_user, role=RoleEnum.CASHIER_ORDERS),
                    User(id=second_user, role=RoleEnum.CASHIER_ORDERS)])
        await db.flush()
        db.add_all([
            Order(assigned_to_id=first_user, status=OrderStatusEnum.PREPARING.value, total_amount=10),
            Order(assigned_to_id=second_user, status=OrderStatusEnum.PREPARING.value, total_amount=20),
        ])
        await db.flush()
        visible = await OrderService.get_orders(db, status=OrderStatusEnum.PREPARING.value,
                                                 assigned_to_id=first_user)
        assert len(visible) == 1
        assert visible[0]["assigned_to_id"] == first_user


@pytest.mark.asyncio
async def test_management_supplier_balances_use_aggregated_finance_rows(database):
    user_id, warehouse_id, product_id, supplier_id, incomplete_id = [uuid4() for _ in range(5)]
    async with database() as db:
        db.add_all([
            User(id=user_id, role=RoleEnum.ADMIN), Warehouse(id=warehouse_id, name="Finance"),
            Product(id=product_id, sku="FINANCE", name_en="Finance", name_ar="مالي", base_unit="Piece"),
            Supplier(id=supplier_id, name="Complete", opening_balance=100),
            Supplier(id=incomplete_id, name="Incomplete", opening_balance=10),
        ])
        await db.flush()
        db.add_all([
            InventoryTransaction(product_id=product_id, warehouse_id=warehouse_id, user_id=user_id,
                                 supplier_id=supplier_id, transaction_type=TransactionTypeEnum.RECEIVING,
                                 quantity_changed=2, unit_cost=10, supplier_finance_included=True),
            InventoryTransaction(product_id=product_id, warehouse_id=warehouse_id, user_id=user_id,
                                 supplier_id=incomplete_id, transaction_type=TransactionTypeEnum.RECEIVING,
                                 quantity_changed=1, unit_cost=None, supplier_finance_included=True),
            SupplierPayment(supplier_id=supplier_id, amount=5),
            SupplierDebtEntry(id=uuid4(), supplier_id=supplier_id, entry_type="DEBT", amount=7,
                              note="Debt", created_by=user_id),
            SupplierDebtEntry(id=uuid4(), supplier_id=supplier_id, entry_type="REVERSAL", amount=2,
                              note="Reversal", created_by=user_id),
            PurchaseOrder(product_id=product_id, supplier_id=supplier_id, quantity=1,
                          received_quantity=1, status="RECEIVED", requested_by=user_id),
        ])
        await db.flush()
        details = await management_details(db, datetime.now(timezone.utc))
        suppliers = {row["id"]: row for row in details["suppliers"]}
        assert suppliers[supplier_id]["balance"] == 120
        assert suppliers[supplier_id]["orders"] == suppliers[supplier_id]["received_orders"] == 1
        assert suppliers[incomplete_id]["balance"] is None


@pytest.mark.asyncio
async def test_order_pages_filter_status_before_limit_and_keep_cashier_private(database):
    user_id = uuid4()
    async with database() as db:
        db.add(User(id=user_id, role=RoleEnum.ADMIN))
        await db.flush()
        db.add_all([
            Order(status=OrderStatusEnum.NEW_LEAD.value, total_amount=0),
            Order(status=OrderStatusEnum.DRAFT.value, total_amount=0),
            Order(status=OrderStatusEnum.CLOSED.value, total_amount=90),
        ])
        await db.commit()

    async def isolated_db():
        async with database() as db:
            yield db

    app.dependency_overrides[get_db] = isolated_db
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            app.dependency_overrides[get_current_user] = lambda: User(id=user_id, role=RoleEnum.CASHIER_ORDERS)
            first = await client.get("/api/v1/orders?group=inbox&limit=1&offset=0")
            second = await client.get("/api/v1/orders?group=inbox&limit=1&offset=1")
            assert first.status_code == second.status_code == 200
            assert first.json()[0]["id"] != second.json()[0]["id"]
            assert {first.json()[0]["status"], second.json()[0]["status"]} == {
                OrderStatusEnum.NEW_LEAD.value, OrderStatusEnum.DRAFT.value,
            }
            assert (await client.get("/api/v1/orders?group=returnable")).status_code == 403
            app.dependency_overrides[get_current_user] = lambda: User(id=user_id, role=RoleEnum.ADMIN)
            returnable = await client.get("/api/v1/orders?group=returnable&limit=1")
            assert returnable.status_code == 200
            assert [row["status"] for row in returnable.json()] == [OrderStatusEnum.CLOSED.value]
            assert (await client.get("/api/v1/orders?limit=101")).status_code == 422
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_current_user, None)


@pytest.mark.asyncio
async def test_cashier_sees_actionable_orders_and_looks_up_only_exact_completed_invoice(database):
    user_id, warehouse_id = uuid4(), uuid4()
    statuses = (
        OrderStatusEnum.DRAFT, OrderStatusEnum.PREPARING, OrderStatusEnum.READY,
        OrderStatusEnum.DELIVERED, OrderStatusEnum.CLOSED, OrderStatusEnum.RETURNED,
        OrderStatusEnum.CANCELLED, OrderStatusEnum.LOST,
    )
    order_ids = {value: uuid4() for value in statuses}
    return_id = uuid4()
    async with database() as db:
        db.add_all([User(id=user_id, role=RoleEnum.ADMIN), Warehouse(id=warehouse_id, name="Isolated")])
        await db.flush()
        db.add_all([Order(id=order_ids[value], user_id=user_id, status=value.value) for value in statuses])
        await db.flush()
        db.add(SalesReturn(
            id=return_id, order_id=order_ids[OrderStatusEnum.DELIVERED],
            warehouse_id=warehouse_id, user_id=user_id, kind="REFUND",
            payment_method="Cash", request_fingerprint="a" * 64,
        ))
        await db.commit()

    async def isolated_db():
        async with database() as db:
            yield db

    role = {"value": RoleEnum.CASHIER_ORDERS}
    app.dependency_overrides[get_db] = isolated_db
    app.dependency_overrides[get_current_user] = lambda: User(id=user_id, role=role["value"])
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            listed = await client.get("/api/v1/orders")
            assert listed.status_code == 200, listed.text
            assert {row["id"] for row in listed.json()} == {
                str(order_ids[value]) for value in (
                    OrderStatusEnum.DRAFT, OrderStatusEnum.PREPARING, OrderStatusEnum.READY,
                )
            }
            assert (await client.get("/api/v1/orders", params={"status": "Delivered"})).json() == []
            printed_number = str(order_ids[OrderStatusEnum.DELIVERED])[-12:]
            found = await client.get(f"/api/v1/returns/lookup/{printed_number}")
            assert found.status_code == 200, found.text
            assert found.json() == {"id": str(order_ids[OrderStatusEnum.DELIVERED]), "status": "Delivered"}
            assert (await client.get(f"/api/v1/returns/lookup/{order_ids[OrderStatusEnum.CLOSED]}")).status_code == 200
            assert (await client.get(f"/api/v1/returns/lookup/{str(order_ids[OrderStatusEnum.DRAFT])[-12:]}")).status_code == 404
            assert (await client.get("/api/v1/returns/lookup/invalid")).status_code == 400
            assert (await client.get("/api/v1/returns")).status_code == 400
            own_history = await client.get("/api/v1/returns", params={"order_id": str(order_ids[OrderStatusEnum.DELIVERED])})
            assert own_history.status_code == 200 and [row["id"] for row in own_history.json()] == [str(return_id)]

            role["value"] = RoleEnum.ADMIN
            assert len((await client.get("/api/v1/orders")).json()) == len(statuses)
            assert len((await client.get("/api/v1/returns")).json()) == 1
            role["value"] = RoleEnum.INVENTORY_CONTROLLER
            assert (await client.get("/api/v1/orders")).status_code == 403
            assert (await client.get(f"/api/v1/returns/lookup/{printed_number}")).status_code == 403
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_current_user, None)


@pytest.mark.asyncio
async def test_cashier_shift_responses_hide_expected_cash_and_difference(database):
    cashier_id, admin_id = uuid4(), uuid4()
    async with database() as db:
        db.add_all([
            User(id=cashier_id, role=RoleEnum.CASHIER_ORDERS),
            User(id=admin_id, role=RoleEnum.ADMIN),
        ])
        await db.flush()
        db.add_all([
            CashShift(user_id=cashier_id, opening_cash=100, status="OPEN"),
            CashShift(user_id=admin_id, opening_cash=50, status="OPEN"),
        ])
        await db.commit()

    async def isolated_db():
        async with database() as db:
            yield db

    actor = {"id": cashier_id, "role": RoleEnum.CASHIER_ORDERS}
    app.dependency_overrides[get_db] = isolated_db
    app.dependency_overrides[get_current_user] = lambda: User(id=actor["id"], role=actor["role"])
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            current = await client.get("/api/v1/cash-register/current")
            assert current.status_code == 200
            assert current.json()["opening_cash"] == 100
            assert current.json()["expected_cash"] is None and current.json()["difference"] is None
            adjustment = {"request_id": str(uuid4()), "amount": -10, "reason": "Local drawer withdrawal"}
            moved = await client.post("/api/v1/cash-register/adjustments", json=adjustment)
            assert moved.status_code == 201, moved.text
            assert moved.json()["expected_cash"] is None and moved.json()["difference"] is None
            repeated = await client.post("/api/v1/cash-register/adjustments", json=adjustment)
            assert repeated.status_code == 201
            assert repeated.json()["expected_cash"] is None
            closed = await client.post("/api/v1/cash-register/close", json={"closing_cash": 85})
            assert closed.status_code == 200, closed.text
            assert closed.json()["closing_cash"] == 85
            assert closed.json()["expected_cash"] is None and closed.json()["difference"] is None
            history = await client.get("/api/v1/cash-register/history")
            assert history.status_code == 200
            assert len(history.json()) == 1
            assert history.json()[0]["expected_cash"] is None and history.json()[0]["difference"] is None

            actor.update(id=admin_id, role=RoleEnum.ADMIN)
            admin_current = await client.get("/api/v1/cash-register/current")
            assert admin_current.status_code == 200
            assert admin_current.json()["expected_cash"] == 50
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_current_user, None)


@pytest.mark.asyncio
async def test_cashier_pos_sale_exchange_refund_and_shift_close_journey(database):
    cashier_id, warehouse_id, old_id, new_id, old_unit, new_unit = [uuid4() for _ in range(6)]
    async with database() as db:
        db.add_all([
            User(id=cashier_id, role=RoleEnum.CASHIER_ORDERS),
            Warehouse(id=warehouse_id, name="Local journey"),
            Product(id=old_id, sku="JOURNEY-OLD", name_en="Old", name_ar="قديم", base_unit="Piece"),
            Product(id=new_id, sku="JOURNEY-NEW", name_en="New", name_ar="جديد", base_unit="Piece"),
        ])
        await db.flush()
        db.add_all([
            ProductUnit(id=old_unit, product_id=old_id, unit_name="Piece", conversion_factor=1),
            ProductUnit(id=new_unit, product_id=new_id, unit_name="Piece", conversion_factor=1),
            InventoryBalance(product_id=old_id, warehouse_id=warehouse_id, current_stock=5),
            InventoryBalance(product_id=new_id, warehouse_id=warehouse_id, current_stock=5),
        ])
        await db.flush()
        db.add_all([
            ProductPrice(product_id=old_id, unit_id=old_unit, price_level="Retail", price=30),
            ProductPrice(product_id=new_id, unit_id=new_unit, price_level="Retail", price=40),
        ])
        await db.commit()

    async def isolated_db():
        async with database() as db:
            yield db

    app.dependency_overrides[get_db] = isolated_db
    app.dependency_overrides[get_current_user] = lambda: User(id=cashier_id, role=RoleEnum.CASHIER_ORDERS)
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            opened = await client.post("/api/v1/cash-register/open", json={"opening_cash": 100})
            assert opened.status_code == 201, opened.text
            assert opened.json()["expected_cash"] is None

            sale = await client.post("/api/v1/orders", json={
                "request_id": str(uuid4()), "warehouse_id": str(warehouse_id),
                "items": [{"product_id": str(old_id), "unit_id": str(old_unit), "quantity": 2}],
            })
            assert sale.status_code == 201, sale.text
            order_id = sale.json()["id"]
            item_id = sale.json()["items"][0]["id"]
            assert sale.json()["total_amount"] == 60
            assert (await client.get("/api/v1/orders")).json() == []
            found = await client.get(f"/api/v1/returns/lookup/{order_id[-12:]}")
            assert found.status_code == 200 and found.json()["id"] == order_id
            eligibility = await client.get(f"/api/v1/returns/eligibility/{order_id}")
            assert eligibility.status_code == 200, eligibility.text
            assert eligibility.json()["items"][0]["remaining_quantity"] == 2

            exchange = {
                "request_id": str(uuid4()), "order_id": order_id, "warehouse_id": str(warehouse_id),
                "kind": "EXCHANGE", "settlement_confirmed": True,
                "lines": [{"order_item_id": item_id, "quantity": 1}],
                "replacements": [{"product_id": str(new_id), "unit_id": str(new_unit), "quantity": 1}],
                "expected_refund_amount": 0, "expected_charge_amount": 10,
            }
            quote = await client.post("/api/v1/returns/preview", json=exchange)
            assert quote.status_code == 200 and quote.json()["charge_amount"] == "10.00"
            exchanged = await client.post("/api/v1/returns", json=exchange)
            assert exchanged.status_code == 201, exchanged.text
            retried = await client.post("/api/v1/returns", json=exchange)
            assert retried.status_code == 201 and retried.json()["id"] == exchanged.json()["id"]

            refund = {
                "request_id": str(uuid4()), "order_id": order_id, "warehouse_id": str(warehouse_id),
                "kind": "REFUND", "settlement_confirmed": True,
                "lines": [{"order_item_id": item_id, "quantity": 1}],
                "expected_refund_amount": 30, "expected_charge_amount": 0,
            }
            quote = await client.post("/api/v1/returns/preview", json=refund)
            assert quote.status_code == 200 and quote.json()["refund_amount"] == "30.00"
            refunded = await client.post("/api/v1/returns", json=refund)
            assert refunded.status_code == 201, refunded.text
            assert (await client.get("/api/v1/cash-register/current")).json()["expected_cash"] is None
            closed = await client.post("/api/v1/cash-register/close", json={"closing_cash": 135})
            assert closed.status_code == 200, closed.text
            assert closed.json()["closing_cash"] == 135
            assert closed.json()["expected_cash"] is None and closed.json()["difference"] is None

        async with database() as db:
            balances = {row.product_id: row.current_stock for row in
                        (await db.execute(select(InventoryBalance))).scalars()}
            assert balances == {old_id: 5, new_id: 4}
            payments = [(row.kind, row.amount) for row in
                        (await db.execute(select(Payment).order_by(Payment.amount))).scalars()]
            assert sorted(payments) == sorted([
                ("SALE", Decimal("60")), ("SALE", Decimal("10")), ("REFUND", Decimal("30")),
            ])
            shift = (await db.execute(select(CashShift).where(CashShift.user_id == cashier_id))).scalar_one()
            assert shift.status == "CLOSED" and shift.expected_cash == 140 and shift.closing_cash == 135
            assert len((await db.execute(select(SalesReturn))).scalars().all()) == 2
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_current_user, None)


@pytest.mark.asyncio
async def test_draft_bundle_uses_component_snapshot_after_recipe_edit(database):
    user_id, preparer_id, warehouse_id, bundle_id, old_id, new_id, unit_id = [uuid4() for _ in range(7)]
    async with database() as db:
        db.add_all([
            User(id=user_id, role=RoleEnum.ADMIN),
            User(id=preparer_id, role=RoleEnum.CASHIER_ORDERS),
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
async def test_pos_search_uses_selected_warehouse_and_bundle_components(database):
    user_id, first_warehouse, second_warehouse, product_id, bundle_id, unit_id = [uuid4() for _ in range(6)]
    async with database() as db:
        user = User(id=user_id, role=RoleEnum.CASHIER_ORDERS)
        db.add_all([
            user, Warehouse(id=first_warehouse, name="First"), Warehouse(id=second_warehouse, name="Second"),
            Product(id=product_id, sku="POS-BOOK", name_en="Book", name_ar="كتاب", base_unit="Piece"),
            Product(id=bundle_id, sku="POS-BUNDLE", name_en="Book offer", name_ar="عرض كتاب", base_unit="Piece", is_bundle=True),
        ])
        await db.flush()
        db.add_all([
            ProductUnit(id=unit_id, product_id=product_id, unit_name="Piece", conversion_factor=1),
            ProductBundleComponent(bundle_id=bundle_id, component_id=product_id, quantity=2),
            InventoryBalance(product_id=product_id, warehouse_id=first_warehouse, current_stock=5),
            InventoryBalance(product_id=product_id, warehouse_id=second_warehouse, current_stock=1),
        ])
        await db.commit()
        first = await search_pos_products(q="كتاب", warehouse_id=first_warehouse, limit=20, db=db, current_user=user)
        second = await search_pos_products(q="كتاب", warehouse_id=second_warehouse, limit=20, db=db, current_user=user)
        assert {row.id: row.current_stock for row in first} == {product_id: 5, bundle_id: 2}
        assert {row.id: row.current_stock for row in second} == {product_id: 1, bundle_id: 0}


@pytest.mark.asyncio
async def test_pos_rejects_stale_displayed_total_without_moving_stock(database):
    user_id, warehouse_id, product_id, unit_id = [uuid4() for _ in range(4)]
    async with database() as db:
        db.add_all([
            User(id=user_id, role=RoleEnum.CASHIER_ORDERS), Warehouse(id=warehouse_id, name="Main"),
            Product(id=product_id, sku="POS-PRICE", name_en="Book", name_ar="كتاب", base_unit="Piece"),
        ])
        await db.flush()
        db.add_all([
            ProductUnit(id=unit_id, product_id=product_id, unit_name="Piece", conversion_factor=1),
            InventoryBalance(product_id=product_id, warehouse_id=warehouse_id, current_stock=2),
        ])
        await db.flush()
        db.add(ProductPrice(product_id=product_id, unit_id=unit_id, price_level="Retail", price=10))
        await db.commit()
        payload = OrderCreate(request_id=uuid4(), warehouse_id=warehouse_id, expected_total=Decimal("9"),
                              items=[{"product_id": product_id, "unit_id": unit_id, "quantity": 1}])
        with pytest.raises(ValueError, match="Prices changed"):
            await OrderService.create_order(db, payload, user_id)
        assert (await db.execute(select(InventoryBalance.current_stock))).scalar_one() == 2
        assert len((await db.execute(select(Order))).scalars().all()) == 0
        assert len((await db.execute(select(InventoryTransaction))).scalars().all()) == 0


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
    user_id, warehouse_id, first_id, second_id, supplier_id, bundle_id = [uuid4() for _ in range(6)]
    async with database() as db:
        user = User(id=user_id, role=RoleEnum.INVENTORY_CONTROLLER)
        db.add_all([
            user, Warehouse(id=warehouse_id, name="Main"), Supplier(id=supplier_id, name="Supplier"),
            Product(id=first_id, sku="RCV-A", name_en="Pen", name_ar="قلم", base_unit="Piece", cost=Decimal("7")),
            Product(id=second_id, sku="RCV-B", name_en="Notebook", name_ar="دفتر", base_unit="Piece", cost=Decimal("9")),
            Product(id=bundle_id, sku="RCV-OFFER", name_en="Offer", name_ar="عرض", base_unit="Piece", is_bundle=True),
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
        with pytest.raises(HTTPException) as virtual:
            await create_stock_receipt(StockReceiptCreate(
                request_id=uuid4(), supplier_id=supplier_id, warehouse_id=warehouse_id,
                lines=[{"product_id": bundle_id, "quantity": "1"}],
            ), db, user)
        assert virtual.value.status_code == 404
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
    controller_id, cashier_id, supplier_id, warehouse_id, product_id = [uuid4() for _ in range(5)]
    async with database() as db:
        db.add_all([
            User(id=controller_id, role=RoleEnum.INVENTORY_CONTROLLER),
            User(id=cashier_id, role=RoleEnum.CASHIER_ORDERS),
            Supplier(id=supplier_id, name="Supplier"),
            Warehouse(id=warehouse_id, name="Main"),
            Product(id=product_id, sku="RCV-HTTP", name_en="Book", name_ar="كتاب", base_unit="Piece", cost=5),
        ])
        await db.commit()

    async def isolated_db():
        async with database() as db:
            yield db

    app.dependency_overrides[get_db] = isolated_db
    app.dependency_overrides[get_current_user] = lambda: User(id=cashier_id, role=RoleEnum.CASHIER_ORDERS)
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            payload = {
                "request_id": str(uuid4()), "supplier_id": str(supplier_id), "warehouse_id": str(warehouse_id),
                "lines": [{"product_id": str(product_id), "quantity": "2"}],
            }
            response = await client.post("/api/v1/inventory/receipts", json=payload)
            assert response.status_code == 403
            app.dependency_overrides[get_current_user] = lambda: User(id=controller_id, role=RoleEnum.INVENTORY_CONTROLLER)
            saved = await client.post("/api/v1/inventory/receipts", json=payload)
            assert saved.status_code == 201, saved.text
            assert Decimal(str(saved.json()["lines"][0]["quantity"])) == Decimal("2")
            fetched = await client.get(f"/api/v1/inventory/receipts/{payload['request_id']}")
            assert fetched.status_code == 200 and fetched.json()["id"] == payload["request_id"]
            app.dependency_overrides.pop(get_current_user, None)
            assert (await client.get(f"/api/v1/inventory/receipts/{payload['request_id']}")).status_code == 401
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
            User(id=preparer_id, role=RoleEnum.CASHIER_ORDERS),
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
                    "transaction_type": "Receiving", "quantity_changed": 1,
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
