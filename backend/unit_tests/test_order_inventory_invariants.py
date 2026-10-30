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
from api.v1.orders import get_order_quotation
from api.v1.customer_accounts import customer_statement
from api.v1.sale_cancellations import (ApprovalInput as CancellationApprovalInput, CancellationInput,
    SettlementInput as CancellationSettlementInput, approve_request as approve_cancellation_request,
    create_request as create_cancellation_request, settle_request as settle_cancellation_request,
    settlement_preview as cancellation_settlement_preview)
from api.v1 import inventory as inventory_api
from core.dependencies import get_current_user
from core.idempotency import request_fingerprint
from core.security import hash_password
from database import get_db
from main import app
from models.user import AuditLog, Base, RoleEnum, User
from models.product import Product, ProductUnit, ProductPrice, ProductBundleComponent, Supplier, SupplierPayment, SupplierDebtEntry
from models.inventory import InventoryBalance, InventoryTransaction, Warehouse
from models.inventory import TransactionTypeEnum
from models.purchase import PurchaseOrder
from models.order import CustomerDebtAllocation, Order, OrderItem, OrderStatusEnum
from models.financial import CashShift
from models.financial import CashAdjustment, Payment
from models.customer import Customer
from models.notification import Notification
from models.returns import SalesReturn, SalesReturnLine
from models.sale_cancellation import SaleCancellation
from schemas.inventory import InventoryTransactionCreate, StockReceiptCreate
from schemas.order import OrderCreate, OrderDraftCreate, OrderStatusUpdate, OrderPreparation
from services.order_service import OrderService
from services.cash_register_service import expected_cash
from services.analytics_service import financial_summary, management_details, stock_alerts
from services.return_service import ReturnService
from services.cancellation_settlement import settle_simple_cancellation
from services.sale_correction_snapshot import capture_sale_snapshot, snapshot_fingerprint
from services.sale_correction_pricing import CorrectionLines, resolve_correction_prices
from services.sale_correction_requests import CorrectionProposal, create_correction_request, review_correction_request
from services.sale_correction_quote import quote_correction
from services.sale_correction_execution import preview_correction_settlement, apply_correction_settlement
from services import cancellation_settlement as cancellation_service
from schemas.returns import SalesReturnCreate
from api.v1.pos import search_pos_products


@pytest.mark.asyncio
async def test_management_today_counts_customers_in_both_repeated_cairo_hours(database):
    from zoneinfo import ZoneInfo
    async with database() as db:
        db.add_all([
            Customer(id=uuid4(), name="Before", created_at=datetime(2026, 10, 28, 20, 59, 59)),
            Customer(id=uuid4(), name="First repeated hour", created_at=datetime(2026, 10, 29, 20, 30)),
            Customer(id=uuid4(), name="Second repeated hour", created_at=datetime(2026, 10, 29, 21, 30)),
            Customer(id=uuid4(), name="Next day", created_at=datetime(2026, 10, 29, 22, 0)),
        ])
        await db.commit()
        now = datetime(2026, 10, 29, 21, 45, tzinfo=timezone.utc).astimezone(ZoneInfo("Africa/Cairo"))
        assert (await management_details(db, now))["new_customers"] == 2


@pytest.mark.asyncio
async def test_product_quantity_change_role_approval_and_stale_stock(database):
    controller_id, admin_id, cashier_id, warehouse_id, product_id = [uuid4() for _ in range(5)]
    async with database() as db:
        db.add_all([User(id=controller_id, role=RoleEnum.INVENTORY_CONTROLLER, is_active=True),
                    User(id=admin_id, role=RoleEnum.ADMIN, is_active=True),
                    User(id=cashier_id, role=RoleEnum.CASHIER_ORDERS, is_active=True),
                    Warehouse(id=warehouse_id, name="Count stock"),
                    Product(id=product_id, sku="COUNT-QA", name_en="Test", name_ar="صنف", base_unit="Piece", cost=12)])
        await db.flush()
        db.add(InventoryBalance(product_id=product_id, warehouse_id=warehouse_id, current_stock=10))
        await db.commit()
    async def isolated_db():
        async with database() as db:
            yield db
    actor = {"id": controller_id, "role": RoleEnum.INVENTORY_CONTROLLER}
    app.dependency_overrides[get_db] = isolated_db
    app.dependency_overrides[get_current_user] = lambda: User(id=actor["id"], role=actor["role"], is_active=True)
    body = {"request_id": str(uuid4()), "warehouse_id": str(warehouse_id), "lines": [{"product_id": str(product_id),
        "expected_quantity": "10", "observed_quantity": "12", "reason": "تصحيح الكمية"}]}
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            created = await client.post("/api/v1/inventory/count-sessions", json=body)
            assert created.status_code == 200 and created.json()["items"][0]["status"] == "PENDING"
            count_id = created.json()["items"][0]["id"]
            assert (await client.post("/api/v1/inventory/count-sessions", json=body)).status_code == 200
            assert (await client.post(f"/api/v1/inventory/counts/{count_id}/approve")).status_code == 403
            async with database() as db:
                assert (await db.execute(select(InventoryBalance.current_stock))).scalar_one() == 10
                notices = (await db.execute(select(Notification).where(Notification.kind == "count_approval"))).scalars().all()
                assert len(notices) == 1 and notices[0].user_id == admin_id
            actor.update(id=cashier_id, role=RoleEnum.CASHIER_ORDERS)
            assert (await client.post("/api/v1/inventory/count-sessions", json=body)).status_code == 403
            actor.update(id=admin_id, role=RoleEnum.ADMIN)
            approved = await client.post(f"/api/v1/inventory/counts/{count_id}/approve")
            assert approved.status_code == 200 and approved.json()["status"] == "APPROVED"
            assert (await client.post(f"/api/v1/inventory/counts/{count_id}/approve")).status_code == 200
            async with database() as db:
                notices = (await db.execute(select(Notification).where(Notification.kind == "count_approved"))).scalars().all()
                assert len(notices) == 1 and notices[0].user_id == controller_id
            stale = {**body, "request_id": str(uuid4())}
            assert (await client.post("/api/v1/inventory/count-sessions", json=stale)).status_code == 409
            direct = {**stale, "request_id": str(uuid4()), "lines": [{**body["lines"][0], "expected_quantity": "12", "observed_quantity": "9"}]}
            result = await client.post("/api/v1/inventory/count-sessions", json=direct)
            assert result.status_code == 200 and result.json()["items"][0]["status"] == "APPROVED"
            async with database() as db:
                assert (await db.execute(select(InventoryBalance.current_stock))).scalar_one() == 9
                movements = (await db.execute(select(InventoryTransaction).where(InventoryTransaction.product_id == product_id))).scalars().all()
                assert len(movements) == 2
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_current_user, None)


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
        with pytest.raises(ValueError, match="Confirm the settlement amount"):
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
async def test_return_can_join_a_transaction_and_roll_back_with_its_caller(database):
    user_id, warehouse_id, product_id, unit_id = [uuid4() for _ in range(4)]
    async with database() as db:
        db.add_all([
            User(id=user_id, role=RoleEnum.ADMIN), Warehouse(id=warehouse_id, name="Main"),
            Product(id=product_id, sku="TX-ROLLBACK", name_en="Item", name_ar="صنف", base_unit="Piece"),
        ])
        await db.flush()
        db.add_all([
            CashShift(user_id=user_id, opening_cash=0, status="OPEN"),
            ProductUnit(id=unit_id, product_id=product_id, unit_name="Piece", conversion_factor=1),
            InventoryBalance(product_id=product_id, warehouse_id=warehouse_id, current_stock=5),
            ProductPrice(product_id=product_id, unit_id=unit_id, price_level="Retail", price=30),
        ])
        await db.commit()
        sale = await OrderService.create_order(db, OrderCreate(
            request_id=uuid4(), warehouse_id=warehouse_id,
            items=[{"product_id": product_id, "unit_id": unit_id, "quantity": 1}],
        ), user_id)
        payload = SalesReturnCreate(
            request_id=uuid4(), order_id=sale["id"], warehouse_id=warehouse_id,
            kind="REFUND", settlement_confirmed=True,
            lines=[{"order_item_id": sale["items"][0]["id"], "quantity": 1}],
            expected_refund_amount=30, expected_charge_amount=0,
        )
        await ReturnService._process_once(db, payload, user_id, request_fingerprint(payload), commit=False)
        assert (await db.execute(select(InventoryBalance.current_stock))).scalar_one() == 5
        assert (await db.execute(select(SalesReturn.id))).scalar_one() == payload.request_id
        await db.rollback()
        assert (await db.execute(select(InventoryBalance.current_stock))).scalar_one() == 4
        assert (await db.execute(select(SalesReturn.id))).scalar_one_or_none() is None
        assert not (await db.execute(select(Payment.id).where(Payment.kind == "REFUND"))).first()


@pytest.mark.asyncio
async def test_checkout_can_join_a_transaction_and_roll_back_with_its_caller(database):
    user_id, warehouse_id, product_id, unit_id = [uuid4() for _ in range(4)]
    async with database() as db:
        db.add_all([User(id=user_id, role=RoleEnum.ADMIN), Warehouse(id=warehouse_id, name="Checkout"),
                    Product(id=product_id, sku="CHECKOUT-ROLLBACK", name_en="Item", name_ar="صنف", base_unit="Piece")])
        await db.flush()
        db.add_all([CashShift(user_id=user_id, opening_cash=0, status="OPEN"),
                    ProductUnit(id=unit_id, product_id=product_id, unit_name="Piece", conversion_factor=1),
                    InventoryBalance(product_id=product_id, warehouse_id=warehouse_id, current_stock=5),
                    ProductPrice(product_id=product_id, unit_id=unit_id, price_level="Retail", price=30)])
        await db.commit()
        payload = OrderCreate(request_id=uuid4(), warehouse_id=warehouse_id,
                              items=[{"product_id": product_id, "unit_id": unit_id, "quantity": 1}])
        sale = await OrderService._create_order_once(db, payload, user_id, request_fingerprint(payload), commit=False)
        assert (await db.execute(select(InventoryBalance.current_stock))).scalar_one() == 4
        assert (await db.execute(select(Payment.id).where(Payment.order_id == sale["id"]))).first()
        await db.rollback()
        assert (await db.execute(select(InventoryBalance.current_stock))).scalar_one() == 5
        assert not (await db.execute(select(Order.id).where(Order.id == sale["id"]))).first()
        assert not (await db.execute(select(Payment.id).where(Payment.order_id == sale["id"]))).first()


@pytest.mark.asyncio
async def test_simple_cancellation_requires_reviewed_amount_and_reverses_stock_and_payment(database):
    user_id, warehouse_id, product_id, unit_id = [uuid4() for _ in range(4)]
    async with database() as db:
        db.add_all([User(id=user_id, role=RoleEnum.ADMIN), Warehouse(id=warehouse_id, name="Main"),
                    Product(id=product_id, sku="CANCEL", name_en="Item", name_ar="صنف", base_unit="Piece")])
        await db.flush()
        db.add_all([CashShift(user_id=user_id, opening_cash=0, status="OPEN"),
                    ProductUnit(id=unit_id, product_id=product_id, unit_name="Piece", conversion_factor=1),
                    InventoryBalance(product_id=product_id, warehouse_id=warehouse_id, current_stock=5),
                    ProductPrice(product_id=product_id, unit_id=unit_id, price_level="Retail", price=30)])
        await db.commit()
        sale = await OrderService.create_order(db, OrderCreate(
            request_id=uuid4(), warehouse_id=warehouse_id,
            items=[{"product_id": product_id, "unit_id": unit_id, "quantity": 1}],
        ), user_id)
        request_id = uuid4()
        price = (await db.execute(select(ProductPrice).where(ProductPrice.product_id == product_id))).scalar_one()
        price.price = 70
        await db.commit()
        order = (await db.execute(select(Order).where(Order.id == sale["id"]))).scalar_one()
        order.shipping_cost = 5
        await db.flush()
        with pytest.raises(ValueError, match="sale fees need manual review"):
            await settle_simple_cancellation(db, order_id=sale["id"], request_id=request_id,
                                             actor_id=user_id, confirmed_refund=Decimal("30"), confirmed_method="Cash")
        order.shipping_cost = 0
        await db.flush()
        with pytest.raises(ValueError, match="amount changed"):
            await settle_simple_cancellation(db, order_id=sale["id"], request_id=request_id,
                                             actor_id=user_id, confirmed_refund=Decimal("29"), confirmed_method="Cash")
        assert (await db.execute(select(InventoryBalance.current_stock))).scalar_one() == 4
        assert not (await db.execute(select(SalesReturn.id))).first()
        shift = (await db.execute(select(CashShift).where(CashShift.user_id == user_id))).scalar_one()
        shift.status = "CLOSED"
        await db.commit()
        with pytest.raises(ValueError, match="Open a cash register shift"):
            await settle_simple_cancellation(db, order_id=sale["id"], request_id=request_id,
                                             actor_id=user_id, confirmed_refund=Decimal("30"), confirmed_method="Cash")
        await db.rollback()
        assert (await db.execute(select(InventoryBalance.current_stock))).scalar_one() == 4
        assert not (await db.execute(select(SalesReturn.id))).first()
        shift = (await db.execute(select(CashShift).where(CashShift.user_id == user_id))).scalar_one()
        shift.status = "OPEN"
        await db.commit()
        result = await settle_simple_cancellation(db, order_id=sale["id"], request_id=request_id,
                                                  actor_id=user_id, confirmed_refund=Decimal("30"), confirmed_method="Cash")
        await db.commit()
        assert result.refund_amount == 30
        assert (await db.execute(select(InventoryBalance.current_stock))).scalar_one() == 5
        assert (await db.execute(select(Payment.amount).where(Payment.kind == "REFUND"))).scalar_one() == 30
        assert (await db.execute(select(Order.status).where(Order.id == sale["id"]))).scalar_one() == "Returned"
        assert (await financial_summary(db))["net_sales"] == 0
        shift = (await db.execute(select(CashShift).where(CashShift.user_id == user_id))).scalar_one()
        assert await expected_cash(db, shift) == 0
        with pytest.raises(ValueError, match="manual review"):
            await settle_simple_cancellation(db, order_id=sale["id"], request_id=request_id,
                                             actor_id=user_id, confirmed_refund=Decimal("30"), confirmed_method="Cash")
        assert len((await db.execute(select(Payment.id).where(Payment.kind == "REFUND"))).all()) == 1


@pytest.mark.asyncio
async def test_cashier_request_is_scoped_retry_safe_and_never_settles(database):
    cashier, other, admin, warehouse_id, product_id, unit_id = [uuid4() for _ in range(6)]
    async with database() as db:
        db.add_all([User(id=cashier, role=RoleEnum.CASHIER_ORDERS, is_active=True),
                    User(id=other, role=RoleEnum.CASHIER_ORDERS, is_active=True),
                    User(id=admin, role=RoleEnum.ADMIN, is_active=True), Warehouse(id=warehouse_id, name="Main"),
                    Product(id=product_id, sku="REQUEST", name_en="Item", name_ar="صنف", base_unit="Piece")])
        await db.flush()
        db.add_all([CashShift(user_id=cashier, opening_cash=0, status="OPEN"),
                    ProductUnit(id=unit_id, product_id=product_id, unit_name="Piece", conversion_factor=1),
                    InventoryBalance(product_id=product_id, warehouse_id=warehouse_id, current_stock=5),
                    ProductPrice(product_id=product_id, unit_id=unit_id, price_level="Retail", price=30)])
        await db.commit()
        sale = await OrderService.create_order(db, OrderCreate(
            request_id=uuid4(), warehouse_id=warehouse_id,
            items=[{"product_id": product_id, "unit_id": unit_id, "quantity": 1}],
        ), cashier)

    async def isolated_db():
        async with database() as db:
            yield db

    actor = {"id": other, "role": RoleEnum.CASHIER_ORDERS}
    app.dependency_overrides[get_db] = isolated_db
    app.dependency_overrides[get_current_user] = lambda: User(id=actor["id"], role=actor["role"])
    body = {"request_id": str(uuid4()), "order_id": str(sale["id"])}
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            assert (await client.post("/api/v1/sale-cancellations", json=body)).status_code == 404
            actor["id"] = cashier
            response = await client.post("/api/v1/sale-cancellations", json=body)
            assert response.status_code == 201 and response.json()["status"] == "PENDING"
            assert (await client.post("/api/v1/sale-cancellations", json=body)).status_code == 201
            assert (await client.post("/api/v1/sale-cancellations", json={**body, "request_id": str(uuid4())})).status_code == 409
            assert (await client.post(f"/api/v1/sale-cancellations/{body['request_id']}/approve", json={})).status_code == 403
            actor.update(id=admin, role=RoleEnum.ADMIN)
            approved = await client.post(f"/api/v1/sale-cancellations/{body['request_id']}/approve", json={})
            assert approved.status_code == 200 and approved.json()["status"] == "AWAITING_SETTLEMENT"
        async with database() as db:
            assert (await db.execute(select(SaleCancellation.status))).scalar_one() == "AWAITING_SETTLEMENT"
            assert (await db.execute(select(InventoryBalance.current_stock))).scalar_one() == 4
            assert not (await db.execute(select(Payment.id).where(Payment.kind == "REFUND"))).first()
            assert not (await db.execute(select(SalesReturn.id))).first()
            old_shift = (await db.execute(select(CashShift).where(CashShift.user_id == cashier))).scalar_one()
            old_shift.status = "CLOSED"
            db.add(CashShift(user_id=cashier, opening_cash=0, status="OPEN"))
            await db.commit()
        actor.update(id=cashier, role=RoleEnum.CASHIER_ORDERS)
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            assert (await client.get(f"/api/v1/sale-cancellations/{body['request_id']}/settlement-preview")).status_code == 409
            assert (await client.post(f"/api/v1/sale-cancellations/{body['request_id']}/request-review")).status_code == 200
            assert (await client.post(f"/api/v1/sale-cancellations/{body['request_id']}/request-review")).status_code == 200
            async with database() as db:
                audit_rows = (await db.execute(select(AuditLog).where(AuditLog.action == "SALE_CANCELLATION_REREVIEW_REQUESTED"))).scalars().all()
                assert len(audit_rows) == 1
            actor.update(id=admin, role=RoleEnum.ADMIN)
            assert (await client.get("/api/v1/sale-cancellations")).json()[0]["rereview_requested"] is True
            assert (await client.post(f"/api/v1/sale-cancellations/{body['request_id']}/approve", json={})).status_code == 409
            assert (await client.post(f"/api/v1/sale-cancellations/{body['request_id']}/approve", json={"manual_review_confirmed": True})).status_code == 200
        actor.update(id=other, role=RoleEnum.CASHIER_ORDERS)
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            assert (await client.get(f"/api/v1/sale-cancellations/{body['request_id']}/settlement-preview")).status_code == 404
            assert (await client.post(f"/api/v1/sale-cancellations/{body['request_id']}/settle", json={"confirmed_refund": "30", "refund_confirmed": True})).status_code == 404
            actor["id"] = cashier
            preview = await client.get(f"/api/v1/sale-cancellations/{body['request_id']}/settlement-preview")
            assert preview.status_code == 200 and Decimal(preview.json()["refund_amount"]) == 30
            assert (await client.post(f"/api/v1/sale-cancellations/{body['request_id']}/settle", json={"confirmed_refund": "30", "refund_confirmed": False})).status_code == 422
            settlement = {"confirmed_refund": "30", "confirmed_method": "Cash", "refund_confirmed": True}
            settled = await client.post(f"/api/v1/sale-cancellations/{body['request_id']}/settle", json=settlement)
            assert settled.status_code == 200 and settled.json()["status"] == "APPROVED"
            assert (await client.post(f"/api/v1/sale-cancellations/{body['request_id']}/settle", json=settlement)).status_code == 200
        async with database() as db:
            assert (await db.execute(select(InventoryBalance.current_stock))).scalar_one() == 5
            refunds = (await db.execute(select(Payment).where(Payment.kind == "REFUND"))).scalars().all()
            assert len(refunds) == 1
            current_shift = (await db.execute(select(CashShift).where(CashShift.user_id == cashier, CashShift.status == "OPEN"))).scalar_one()
            assert refunds[0].shift_id == current_shift.id and refunds[0].user_id == cashier
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_current_user, None)


@pytest.mark.asyncio
async def test_admin_direct_cancellation_requires_confirmed_quote_and_is_atomic(database):
    admin, cashier, warehouse_id, product_id, unit_id = [uuid4() for _ in range(5)]
    async with database() as db:
        db.add_all([User(id=admin, role=RoleEnum.ADMIN, is_active=True),
                    User(id=cashier, role=RoleEnum.CASHIER_ORDERS, is_active=True),
                    Warehouse(id=warehouse_id, name="Main"),
                    Product(id=product_id, sku="ADMIN-CANCEL", name_en="Item", name_ar="صنف", base_unit="Piece")])
        await db.flush()
        db.add_all([CashShift(user_id=admin, opening_cash=0, status="OPEN"),
                    ProductUnit(id=unit_id, product_id=product_id, unit_name="Piece", conversion_factor=1),
                    InventoryBalance(product_id=product_id, warehouse_id=warehouse_id, current_stock=5),
                    ProductPrice(product_id=product_id, unit_id=unit_id, price_level="Retail", price=30)])
        await db.commit()
        sale = await OrderService.create_order(db, OrderCreate(
            request_id=uuid4(), warehouse_id=warehouse_id,
            items=[{"product_id": product_id, "unit_id": unit_id, "quantity": 1}],
        ), admin)

    async def isolated_db():
        async with database() as db:
            yield db

    actor = {"id": cashier, "role": RoleEnum.CASHIER_ORDERS}
    app.dependency_overrides[get_db] = isolated_db
    app.dependency_overrides[get_current_user] = lambda: User(id=actor["id"], role=actor["role"])
    body = {"request_id": str(uuid4()), "order_id": str(sale["id"])}
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            assert (await client.get(f"/api/v1/sale-cancellations/direct-preview/{sale['id']}")).status_code == 403
            actor.update(id=admin, role=RoleEnum.ADMIN)
            preview = await client.get(f"/api/v1/sale-cancellations/direct-preview/{sale['id']}")
            assert preview.status_code == 200 and Decimal(preview.json()["refund_amount"]) == 30
            assert (await client.post("/api/v1/sale-cancellations", json=body)).status_code == 422
            stale = {**body, "confirmed_refund": "29", "confirmed_method": "Cash", "refund_confirmed": True}
            assert (await client.post("/api/v1/sale-cancellations", json=stale)).status_code == 409
            confirmed = {**body, "confirmed_refund": "30", "confirmed_method": "Cash", "refund_confirmed": True}
            response = await client.post("/api/v1/sale-cancellations", json=confirmed)
            assert response.status_code == 201 and response.json()["status"] == "APPROVED"
            assert (await client.post("/api/v1/sale-cancellations", json=confirmed)).status_code == 201
            assert (await client.post("/api/v1/sale-cancellations", json=stale)).status_code == 409
        async with database() as db:
            assert (await db.execute(select(InventoryBalance.current_stock))).scalar_one() == 5
            refunds = (await db.execute(select(Payment).where(Payment.kind == "REFUND"))).scalars().all()
            assert len(refunds) == 1 and refunds[0].user_id == admin
            assert (await financial_summary(db))["net_sales"] == 0
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_current_user, None)


@pytest.mark.asyncio
async def test_admin_closed_original_shift_requires_manual_review(database):
    admin, warehouse_id, product_id, unit_id = [uuid4() for _ in range(4)]
    async with database() as db:
        db.add_all([User(id=admin, role=RoleEnum.ADMIN, is_active=True), Warehouse(id=warehouse_id, name="Main"),
                    Product(id=product_id, sku="CLOSED-CANCEL", name_en="Item", name_ar="صنف", base_unit="Piece")])
        await db.flush()
        db.add_all([CashShift(user_id=admin, opening_cash=0, status="OPEN"),
                    ProductUnit(id=unit_id, product_id=product_id, unit_name="Piece", conversion_factor=1),
                    InventoryBalance(product_id=product_id, warehouse_id=warehouse_id, current_stock=5),
                    ProductPrice(product_id=product_id, unit_id=unit_id, price_level="Retail", price=30)])
        await db.commit()
        sale = await OrderService.create_order(db, OrderCreate(
            request_id=uuid4(), warehouse_id=warehouse_id,
            items=[{"product_id": product_id, "unit_id": unit_id, "quantity": 1}],
        ), admin)
        old_shift = (await db.execute(select(CashShift).where(CashShift.user_id == admin))).scalar_one()
        old_shift.status = "CLOSED"
        db.add(CashShift(user_id=admin, opening_cash=0, status="OPEN"))
        await db.commit()

    async def isolated_db():
        async with database() as db:
            yield db

    app.dependency_overrides[get_db] = isolated_db
    app.dependency_overrides[get_current_user] = lambda: User(id=admin, role=RoleEnum.ADMIN)
    body = {"request_id": str(uuid4()), "order_id": str(sale["id"]), "confirmed_refund": "30", "confirmed_method": "Cash", "refund_confirmed": True}
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            preview = await client.get(f"/api/v1/sale-cancellations/direct-preview/{sale['id']}")
            assert preview.status_code == 200 and preview.json()["manual_review"] is True
            request = await client.post("/api/v1/sale-cancellations", json=body)
            assert request.status_code == 201 and request.json()["status"] == "PENDING"
            assert (await client.post(f"/api/v1/sale-cancellations/{body['request_id']}/approve", json={})).status_code == 409
            reviewed = await client.post(f"/api/v1/sale-cancellations/{body['request_id']}/approve", json={"manual_review_confirmed": True})
            assert reviewed.status_code == 200 and reviewed.json()["status"] == "AWAITING_SETTLEMENT"
            quote = await client.get(f"/api/v1/sale-cancellations/{body['request_id']}/settlement-preview")
            assert quote.status_code == 200 and Decimal(quote.json()["refund_amount"]) == 30
            settled = await client.post(f"/api/v1/sale-cancellations/{body['request_id']}/settle", json={"confirmed_refund": "30", "confirmed_method": "Cash", "refund_confirmed": True})
            assert settled.status_code == 200 and settled.json()["status"] == "APPROVED"
        async with database() as db:
            assert (await db.execute(select(InventoryBalance.current_stock))).scalar_one() == 5
            refund = (await db.execute(select(Payment).where(Payment.kind == "REFUND"))).scalar_one()
            current = (await db.execute(select(CashShift).where(CashShift.user_id == admin, CashShift.status == "OPEN"))).scalar_one()
            assert refund.shift_id == current.id
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_current_user, None)


@pytest.mark.asyncio
@pytest.mark.parametrize("returned_quantity,late_return", [(1, False), (2, False), (1, True)])
async def test_cancellation_after_previous_refund_only_returns_remaining_items(database, returned_quantity, late_return):
    cashier, admin, warehouse_id, product_id, unit_id = [uuid4() for _ in range(5)]
    async with database() as db:
        db.add_all([User(id=cashier, role=RoleEnum.CASHIER_ORDERS, is_active=True),
                    User(id=admin, role=RoleEnum.ADMIN, is_active=True), Warehouse(id=warehouse_id, name="Main"),
                    Product(id=product_id, sku="PARTIAL-CANCEL", name_en="Item", name_ar="صنف", base_unit="Piece")])
        await db.flush()
        db.add_all([CashShift(user_id=cashier, opening_cash=0, status="OPEN"),
                    ProductUnit(id=unit_id, product_id=product_id, unit_name="Piece", conversion_factor=1),
                    InventoryBalance(product_id=product_id, warehouse_id=warehouse_id, current_stock=5),
                    ProductPrice(product_id=product_id, unit_id=unit_id, price_level="Retail", price=30)])
        await db.commit()
        sale = await OrderService.create_order(db, OrderCreate(
            request_id=uuid4(), warehouse_id=warehouse_id,
            items=[{"product_id": product_id, "unit_id": unit_id, "quantity": 2}],
        ), cashier)
        await ReturnService.process(db, SalesReturnCreate(
            request_id=uuid4(), order_id=sale["id"], warehouse_id=warehouse_id, kind="REFUND",
            settlement_confirmed=True, expected_refund_amount=30 * returned_quantity, expected_charge_amount=0,
            lines=[{"order_item_id": sale["items"][0]["id"], "quantity": returned_quantity}],
        ), cashier)
    async def isolated_db():
        async with database() as db:
            yield db
    actor = {"id": cashier, "role": RoleEnum.CASHIER_ORDERS}
    app.dependency_overrides[get_db] = isolated_db
    app.dependency_overrides[get_current_user] = lambda: User(id=actor["id"], role=actor["role"])
    body = {"request_id": str(uuid4()), "order_id": str(sale["id"])}
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            request = await client.post("/api/v1/sale-cancellations", json=body)
            assert request.status_code == 201 and request.json()["manual_review"] is True
            actor.update(id=admin, role=RoleEnum.ADMIN)
            assert (await client.post(f"/api/v1/sale-cancellations/{body['request_id']}/approve", json={})).status_code == 409
            assert (await client.post(f"/api/v1/sale-cancellations/{body['request_id']}/approve", json={"manual_review_confirmed": True})).status_code == 200
            actor.update(id=cashier, role=RoleEnum.CASHIER_ORDERS)
            async with database() as db:
                previous_refund = (await db.execute(select(Payment).where(Payment.order_id == sale["id"], Payment.kind == "REFUND"))).scalar_one()
                previous_refund.amount = 29
                await db.commit()
            assert (await client.get(f"/api/v1/sale-cancellations/{body['request_id']}/settlement-preview")).status_code == 409
            async with database() as db:
                previous_refund = (await db.execute(select(Payment).where(Payment.order_id == sale["id"], Payment.kind == "REFUND"))).scalar_one()
                previous_refund.amount = 30 * returned_quantity
                await db.commit()
            if late_return:
                async with database() as db:
                    await ReturnService.process(db, SalesReturnCreate(
                        request_id=uuid4(), order_id=sale["id"], warehouse_id=warehouse_id, kind="REFUND",
                        settlement_confirmed=True, expected_refund_amount=30, expected_charge_amount=0,
                        lines=[{"order_item_id": sale["items"][0]["id"], "quantity": 1}],
                    ), cashier)
                assert (await client.get(f"/api/v1/sale-cancellations/{body['request_id']}/settlement-preview")).status_code == 409
                actor.update(id=admin, role=RoleEnum.ADMIN)
                assert (await client.post(f"/api/v1/sale-cancellations/{body['request_id']}/approve", json={})).status_code == 409
                assert (await client.post(f"/api/v1/sale-cancellations/{body['request_id']}/approve", json={"manual_review_confirmed": True})).status_code == 200
                actor.update(id=cashier, role=RoleEnum.CASHIER_ORDERS)
            effective_quantity = returned_quantity + int(late_return)
            quote = await client.get(f"/api/v1/sale-cancellations/{body['request_id']}/settlement-preview")
            remaining = 30 * (2 - effective_quantity)
            assert quote.status_code == 200 and Decimal(quote.json()["refund_amount"]) == remaining
            assert quote.json()["already_returned"] is (effective_quantity == 2)
            settled = await client.post(f"/api/v1/sale-cancellations/{body['request_id']}/settle", json={"confirmed_refund": str(remaining), "confirmed_method": "Cash" if remaining else None, "refund_confirmed": True})
            assert settled.status_code == 200 and settled.json()["status"] == "APPROVED"
        async with database() as db:
            assert (await db.execute(select(InventoryBalance.current_stock))).scalar_one() == 5
            refunds = (await db.execute(select(Payment.amount).where(Payment.kind == "REFUND"))).scalars().all()
            assert sum(refunds) == Decimal("60") and len(refunds) == (2 if returned_quantity == 1 else 1)
            assert (await financial_summary(db))["net_sales"] == 0
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_current_user, None)


@pytest.mark.asyncio
async def test_unpaid_deferred_cancellation_reduces_debt_without_cash_payment(database):
    cashier, admin, customer_id, warehouse_id, product_id, unit_id = [uuid4() for _ in range(6)]
    async with database() as db:
        db.add_all([User(id=cashier, role=RoleEnum.CASHIER_ORDERS, is_active=True),
                    User(id=admin, role=RoleEnum.ADMIN, is_active=True),
                    Customer(id=customer_id, name="Credit", credit_limit=500), Warehouse(id=warehouse_id, name="Main"),
                    Product(id=product_id, sku="DEBT-CANCEL", name_en="Item", name_ar="صنف", base_unit="Piece")])
        await db.flush()
        db.add_all([CashShift(user_id=cashier, opening_cash=0, status="OPEN"),
                    ProductUnit(id=unit_id, product_id=product_id, unit_name="Piece", conversion_factor=1),
                    InventoryBalance(product_id=product_id, warehouse_id=warehouse_id, current_stock=5),
                    ProductPrice(product_id=product_id, unit_id=unit_id, price_level="Retail", price=30)])
        await db.commit()
        sale = await OrderService.create_order(db, OrderCreate(
            request_id=uuid4(), warehouse_id=warehouse_id, customer_id=customer_id,
            payment_method="Deferred Payment", amount_received=0, expected_collection_method="Cash",
            next_due_date="2099-01-01", items=[{"product_id": product_id, "unit_id": unit_id, "quantity": 2}],
        ), cashier)
    async def isolated_db():
        async with database() as db:
            yield db
    actor = {"id": cashier, "role": RoleEnum.CASHIER_ORDERS}
    app.dependency_overrides[get_db] = isolated_db
    app.dependency_overrides[get_current_user] = lambda: User(id=actor["id"], role=actor["role"])
    body = {"request_id": str(uuid4()), "order_id": str(sale["id"])}
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            assert (await client.post("/api/v1/sale-cancellations", json=body)).status_code == 201
            actor.update(id=admin, role=RoleEnum.ADMIN)
            assert (await client.post(f"/api/v1/sale-cancellations/{body['request_id']}/approve", json={})).status_code == 200
            actor.update(id=cashier, role=RoleEnum.CASHIER_ORDERS)
            async with database() as db:
                customer = (await db.execute(select(Customer).where(Customer.id == customer_id))).scalar_one()
                customer.balance = 70
                await db.commit()
            assert (await client.get(f"/api/v1/sale-cancellations/{body['request_id']}/settlement-preview")).status_code == 409
            async with database() as db:
                customer = (await db.execute(select(Customer).where(Customer.id == customer_id))).scalar_one()
                customer.balance = 60
                await db.commit()
            async with database() as db:
                customer = (await db.execute(select(Customer).where(Customer.id == customer_id))).scalar_one()
                order = (await db.execute(select(Order).where(Order.id == sale["id"]))).scalar_one()
                shift = (await db.execute(select(CashShift).where(CashShift.user_id == cashier, CashShift.status == "OPEN"))).scalar_one()
                customer.balance = 40
                order.deferred_remaining = 40
                db.add(Payment(order_id=order.id, customer_id=customer_id, user_id=cashier, shift_id=shift.id,
                               amount=20, method="Cash", kind="SALE"))
                await db.commit()
            mixed_preview = await client.get(f"/api/v1/sale-cancellations/{body['request_id']}/settlement-preview")
            assert mixed_preview.status_code == 200 and mixed_preview.json()["settlement_type"] == "MIXED"
            assert Decimal(mixed_preview.json()["refund_amount"]) == 20 and Decimal(mixed_preview.json()["debt_amount"]) == 40
            async with database() as db:
                customer = (await db.execute(select(Customer).where(Customer.id == customer_id))).scalar_one()
                order = (await db.execute(select(Order).where(Order.id == sale["id"]))).scalar_one()
                payment = (await db.execute(select(Payment).where(Payment.order_id == sale["id"]))).scalar_one()
                await db.delete(payment)
                customer.balance = 60
                order.deferred_remaining = 60
                await db.commit()
            preview = await client.get(f"/api/v1/sale-cancellations/{body['request_id']}/settlement-preview")
            assert preview.status_code == 200 and preview.json()["settlement_type"] == "DEBT"
            assert Decimal(preview.json()["refund_amount"]) == 0 and Decimal(preview.json()["debt_amount"]) == 60
            response = await client.post(f"/api/v1/sale-cancellations/{body['request_id']}/settle", json={"confirmed_refund": "0", "confirmed_debt": "60", "refund_confirmed": True})
            assert response.status_code == 200 and response.json()["status"] == "APPROVED"
        async with database() as db:
            assert (await db.execute(select(Customer.balance).where(Customer.id == customer_id))).scalar_one() == 0
            assert (await db.execute(select(Order.deferred_remaining).where(Order.id == sale["id"]))).scalar_one() == 0
            assert (await db.execute(select(InventoryBalance.current_stock))).scalar_one() == 5
            assert not (await db.execute(select(Payment.id).where(Payment.order_id == sale["id"]))).first()
            assert (await financial_summary(db))["net_sales"] == 0
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_current_user, None)


@pytest.mark.asyncio
async def test_admin_direct_unpaid_deferred_cancellation_has_no_cash_refund(database):
    admin, customer_id, warehouse_id, product_id, unit_id = [uuid4() for _ in range(5)]
    async with database() as db:
        db.add_all([User(id=admin, role=RoleEnum.ADMIN, is_active=True), Customer(id=customer_id, name="Credit", credit_limit=500),
                    Warehouse(id=warehouse_id, name="Main"), Product(id=product_id, sku="ADMIN-DEBT", name_en="Item", name_ar="صنف", base_unit="Piece")])
        await db.flush()
        db.add_all([CashShift(user_id=admin, opening_cash=0, status="OPEN"),
                    ProductUnit(id=unit_id, product_id=product_id, unit_name="Piece", conversion_factor=1),
                    InventoryBalance(product_id=product_id, warehouse_id=warehouse_id, current_stock=5),
                    ProductPrice(product_id=product_id, unit_id=unit_id, price_level="Retail", price=30)])
        await db.commit()
        sale = await OrderService.create_order(db, OrderCreate(
            request_id=uuid4(), warehouse_id=warehouse_id, customer_id=customer_id,
            payment_method="Deferred Payment", amount_received=0, expected_collection_method="Cash",
            next_due_date="2099-01-01", items=[{"product_id": product_id, "unit_id": unit_id, "quantity": 1}],
        ), admin)
    async def isolated_db():
        async with database() as db:
            yield db
    app.dependency_overrides[get_db] = isolated_db
    app.dependency_overrides[get_current_user] = lambda: User(id=admin, role=RoleEnum.ADMIN)
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            preview = await client.get(f"/api/v1/sale-cancellations/direct-preview/{sale['id']}")
            assert preview.status_code == 200 and preview.json()["settlement_type"] == "DEBT"
            result = await client.post("/api/v1/sale-cancellations", json={"request_id": str(uuid4()),
                "order_id": str(sale["id"]), "confirmed_refund": "0", "confirmed_debt": "30", "refund_confirmed": True})
            assert result.status_code == 201 and result.json()["status"] == "APPROVED"
        async with database() as db:
            assert (await db.execute(select(Customer.balance).where(Customer.id == customer_id))).scalar_one() == 0
            assert (await db.execute(select(InventoryBalance.current_stock))).scalar_one() == 5
            assert not (await db.execute(select(Payment.id).where(Payment.order_id == sale["id"]))).first()
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_current_user, None)


@pytest.mark.asyncio
@pytest.mark.parametrize("method,retained", [("Cash", Decimal("10.00")), ("Wallet", Decimal("10.60"))])
async def test_cancellation_refunds_merchandise_and_retains_shipping_and_wallet_fee(database, method, retained):
    admin, warehouse_id, product_id, unit_id = [uuid4() for _ in range(4)]
    async with database() as db:
        db.add_all([User(id=admin, role=RoleEnum.ADMIN, is_active=True), Warehouse(id=warehouse_id, name="Delivery"),
                    Product(id=product_id, sku="FEE-CANCEL", name_en="Item", name_ar="صنف", base_unit="Piece")])
        await db.flush()
        db.add_all([CashShift(user_id=admin, opening_cash=0, status="OPEN"),
                    ProductUnit(id=unit_id, product_id=product_id, unit_name="Piece", conversion_factor=1),
                    InventoryBalance(product_id=product_id, warehouse_id=warehouse_id, current_stock=5),
                    ProductPrice(product_id=product_id, unit_id=unit_id, price_level="Retail", price=30)])
        await db.commit()
        sale = await OrderService.create_order(db, OrderCreate(request_id=uuid4(), warehouse_id=warehouse_id,
            source="Delivery", payment_method=method, shipping_cost=10, discount_amount=10,
            items=[{"product_id": product_id, "unit_id": unit_id, "quantity": 2}]), admin)
    async def isolated_db():
        async with database() as db:
            yield db
    app.dependency_overrides[get_db] = isolated_db
    app.dependency_overrides[get_current_user] = lambda: User(id=admin, role=RoleEnum.ADMIN, is_active=True, is_deleted=False)
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            quote = await client.get(f"/api/v1/sale-cancellations/direct-preview/{sale['id']}")
            assert quote.status_code == 200 and Decimal(quote.json()["refund_amount"]) == 50
            assert Decimal(quote.json()["retained_fees"]) == retained
            result = await client.post("/api/v1/sale-cancellations", json={"request_id": str(uuid4()), "order_id": str(sale["id"]),
                "confirmed_refund": "50", "confirmed_method": method, "refund_confirmed": True})
            assert result.status_code == 201 and result.json()["status"] == "APPROVED"
        async with database() as db:
            assert (await db.execute(select(InventoryBalance.current_stock))).scalar_one() == 5
            refund = (await db.execute(select(Payment).where(Payment.kind == "REFUND"))).scalar_one()
            assert refund.amount == 50 and refund.method == method
            assert Decimal(str((await financial_summary(db))["net_sales"])) == retained
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_current_user, None)


@pytest.mark.asyncio
async def test_correction_snapshot_freezes_sold_prices_and_detects_payment_changes(database):
    user_id, warehouse_id, product_id, unit_id = [uuid4() for _ in range(4)]
    async with database() as db:
        db.add_all([User(id=user_id, role=RoleEnum.ADMIN), Warehouse(id=warehouse_id, name="Snapshot"),
                    Product(id=product_id, sku="SNAPSHOT", name_en="Item", name_ar="صنف", base_unit="Piece")])
        await db.flush()
        db.add_all([CashShift(user_id=user_id, opening_cash=0, status="OPEN"),
                    ProductUnit(id=unit_id, product_id=product_id, unit_name="Piece", conversion_factor=1),
                    InventoryBalance(product_id=product_id, warehouse_id=warehouse_id, current_stock=5),
                    ProductPrice(product_id=product_id, unit_id=unit_id, price_level="Retail", price=30)])
        await db.commit()
        sale = await OrderService.create_order(db, OrderCreate(request_id=uuid4(), warehouse_id=warehouse_id,
            items=[{"product_id": product_id, "unit_id": unit_id, "quantity": 1}]), user_id)
        snapshot, original_hash = await capture_sale_snapshot(db, sale["id"])
        assert Decimal(snapshot["items"][0]["unit_price"]) == 30
        assert len(snapshot["payments"]) == 1 and len(snapshot["inventory_movements"]) == 1
        assert snapshot_fingerprint(snapshot) == original_hash
        price = (await db.execute(select(ProductPrice).where(ProductPrice.product_id == product_id))).scalar_one()
        price.price = 70
        await db.flush()
        same, same_hash = await capture_sale_snapshot(db, sale["id"])
        assert same_hash == original_hash and Decimal(same["items"][0]["unit_price"]) == 30
        payment = (await db.execute(select(Payment).where(Payment.order_id == sale["id"]))).scalar_one()
        payment.amount = 29
        await db.flush()
        changed, changed_hash = await capture_sale_snapshot(db, sale["id"])
        assert changed_hash != original_hash and Decimal(changed["payments"][0]["amount"]) == 29
        assert Decimal(snapshot["payments"][0]["amount"]) == 30


@pytest.mark.asyncio
async def test_correction_snapshot_includes_allocated_customer_collections(database):
    user_id, customer_id, order_id, payment_id = [uuid4() for _ in range(4)]
    async with database() as db:
        db.add_all([User(id=user_id, role=RoleEnum.ADMIN), Customer(id=customer_id, name="Snapshot")])
        await db.flush()
        db.add_all([Order(id=order_id, user_id=user_id, customer_id=customer_id, status="Closed",
                          payment_method="Deferred Payment", total_amount=60, deferred_remaining=40),
                    Payment(id=payment_id, customer_id=customer_id, user_id=user_id,
                            amount=20, method="Credit Card", kind="COLLECTION")])
        await db.flush()
        allocation = CustomerDebtAllocation(payment_id=payment_id, order_id=order_id, amount=20)
        db.add(allocation)
        await db.flush()
        snapshot, original_hash = await capture_sale_snapshot(db, order_id)
        assert snapshot["payments"][0]["id"] == str(payment_id)
        assert Decimal(snapshot["debt_allocations"][0]["amount"]) == 20
        allocation.amount = 19
        await db.flush()
        _, changed_hash = await capture_sale_snapshot(db, order_id)
        assert changed_hash != original_hash


@pytest.mark.asyncio
async def test_correction_prices_use_old_sale_and_reject_foreign_or_changed_units(database):
    user_id, warehouse_id, product_id, unit_id = [uuid4() for _ in range(4)]
    async with database() as db:
        db.add_all([User(id=user_id, role=RoleEnum.ADMIN), Warehouse(id=warehouse_id, name="Pricing"),
                    Product(id=product_id, sku="CORRECTION-PRICE", name_en="Item", name_ar="صنف", base_unit="Piece")])
        await db.flush()
        db.add_all([CashShift(user_id=user_id, opening_cash=0, status="OPEN"),
                    ProductUnit(id=unit_id, product_id=product_id, unit_name="Piece", conversion_factor=1),
                    InventoryBalance(product_id=product_id, warehouse_id=warehouse_id, current_stock=10),
                    ProductPrice(product_id=product_id, unit_id=unit_id, price_level="Retail", price=30)])
        await db.commit()
        def order():
            return OrderCreate(request_id=uuid4(), warehouse_id=warehouse_id,
                items=[{"product_id": product_id, "unit_id": unit_id, "quantity": 1}])
        original = await OrderService.create_order(db, order(), user_id)
        other = await OrderService.create_order(db, order(), user_id)
        price = (await db.execute(select(ProductPrice).where(ProductPrice.product_id == product_id))).scalar_one()
        unit = (await db.execute(select(ProductUnit).where(ProductUnit.id == unit_id))).scalar_one()
        price.price = 70
        unit.conversion_factor = 2
        await db.flush()
        line = {"product_id": product_id, "unit_id": unit_id, "price_level": "Retail", "quantity": 1}
        original_line = {**line, "original_item_id": original["items"][0]["id"]}
        result = await resolve_correction_prices(db, original["id"], CorrectionLines(items=[original_line, line]))
        assert result[0].unit_price == 30 and result[0].conversion_factor == 1
        assert result[1].unit_price == 70 and result[1].conversion_factor == 2
        with pytest.raises(ValueError, match="original line does not match"):
            await resolve_correction_prices(db, original["id"], CorrectionLines(items=[{**line, "original_item_id": other["items"][0]["id"]}]))
        with pytest.raises(ValueError, match="unit changed"):
            await resolve_correction_prices(db, original["id"], CorrectionLines(items=[{**original_line, "quantity": 2}]))
        with pytest.raises(ValueError, match="cannot be reused"):
            CorrectionLines(items=[original_line, original_line])
        with pytest.raises(ValueError, match="Extra inputs"):
            CorrectionLines(items=[{**line, "unit_price": "0.01"}])
        sold_item = (await db.execute(select(OrderItem).where(OrderItem.id == original["items"][0]["id"]))).scalar_one()
        sold_item.bundle_components_snapshot = None
        await db.flush()
        with pytest.raises(ValueError, match="components need manual review"):
            await resolve_correction_prices(db, original["id"], CorrectionLines(items=[original_line]))


@pytest.mark.asyncio
@pytest.mark.parametrize("payment_method", ["Cash", "Wallet", "Deferred Payment"])
async def test_correction_quote_matches_checkout_rounding_and_fees(database, payment_method):
    user_id, customer_id, warehouse_id, product_id, unit_id = [uuid4() for _ in range(5)]
    async with database() as db:
        db.add_all([User(id=user_id, role=RoleEnum.ADMIN), Customer(id=customer_id, name="Quote", credit_limit=500),
                    Warehouse(id=warehouse_id, name="Quote"),
                    Product(id=product_id, sku="QUOTE-MATCH", name_en="Item", name_ar="صنف", base_unit="Piece")])
        await db.flush()
        db.add_all([CashShift(user_id=user_id, opening_cash=0, status="OPEN"),
                    ProductUnit(id=unit_id, product_id=product_id, unit_name="Piece", conversion_factor=1),
                    InventoryBalance(product_id=product_id, warehouse_id=warehouse_id, current_stock=10),
                    ProductPrice(product_id=product_id, unit_id=unit_id, price_level="Retail", price=Decimal("19.99"))])
        await db.commit()
        fields = {"request_id": uuid4(), "warehouse_id": warehouse_id, "customer_id": customer_id,
                  "payment_method": payment_method, "items": [{"product_id": product_id, "unit_id": unit_id, "quantity": "1.25"}]}
        if payment_method == "Deferred Payment":
            fields.update(amount_received=10, received_method="Wallet", expected_collection_method="Cash", next_due_date="2099-01-01")
        order = OrderCreate(**fields)
        lines = await resolve_correction_prices(db, uuid4(), CorrectionLines(items=[item.model_dump() for item in order.items]))
        quote = quote_correction(order, lines)
        result = await OrderService.create_order(db, order, user_id)
        assert Decimal(str(result["total_amount"])) == quote.total
        assert Decimal(str(result["wallet_fee_amount"])) == quote.wallet_fee
        remaining = (await db.execute(select(Order.deferred_remaining).where(Order.id == result["id"]))).scalar_one()
        assert Decimal(str(remaining or 0)) == quote.deferred_remaining


@pytest.mark.asyncio
async def test_transactional_correction_checkout_preserves_original_price_cost_and_tax(database):
    admin_id, cashier_id, warehouse_id, product_id, unit_id = [uuid4() for _ in range(5)]
    async with database() as db:
        db.add_all([User(id=admin_id, role=RoleEnum.ADMIN), User(id=cashier_id, role=RoleEnum.CASHIER_ORDERS),
                    Warehouse(id=warehouse_id, name="Correction"), Product(id=product_id, sku="CORR-CHECKOUT",
                    name_en="Item", name_ar="صنف", base_unit="Piece", cost=10, tax_rate=10)])
        await db.flush()
        db.add_all([CashShift(user_id=admin_id, opening_cash=0, status="OPEN"),
                    ProductUnit(id=unit_id, product_id=product_id, unit_name="Piece", conversion_factor=1),
                    InventoryBalance(product_id=product_id, warehouse_id=warehouse_id, current_stock=10),
                    ProductPrice(product_id=product_id, unit_id=unit_id, price_level="Retail", price=30)])
        await db.commit()
        original = await OrderService.create_order(db, OrderCreate(request_id=uuid4(), warehouse_id=warehouse_id,
            items=[{"product_id": product_id, "unit_id": unit_id, "quantity": 1}]), admin_id)
        product = (await db.execute(select(Product).where(Product.id == product_id))).scalar_one()
        price = (await db.execute(select(ProductPrice).where(ProductPrice.product_id == product_id))).scalar_one()
        product.cost = 100
        product.tax_rate = 20
        price.price = 70
        await db.commit()
        proposal = CorrectionProposal(request_id=uuid4(), warehouse_id=warehouse_id, items=[{
            "product_id": product_id, "unit_id": unit_id, "price_level": "Retail", "quantity": 1,
            "original_item_id": original["items"][0]["id"],
        }])
        lines = await resolve_correction_prices(db, original["id"], CorrectionLines(items=proposal.items))
        corrected = await OrderService._create_order_once(db, proposal, cashier_id, request_fingerprint(proposal),
            commit=False, correction_lines=lines, original_order_id=original["id"], pricing_user_id=admin_id, defer_payment=True)
        item = (await db.execute(select(OrderItem).where(OrderItem.order_id == corrected["id"]))).scalar_one()
        assert item.unit_price == 30 and item.cost_at_sale == 10 and item.tax_rate == 10
        assert not (await db.execute(select(Payment.id).where(Payment.order_id == corrected["id"]))).first()
        await db.rollback()
        assert not (await db.execute(select(Order.id).where(Order.id == corrected["id"]))).first()
        assert (await db.execute(select(InventoryBalance.current_stock))).scalar_one() == 9


@pytest.mark.asyncio
async def test_correction_request_preserves_evidence_is_private_and_excludes_cancellation(database):
    cashier_id, other_id, admin_id, warehouse_id, product_id, unit_id = [uuid4() for _ in range(6)]
    async with database() as db:
        cashier = User(id=cashier_id, role=RoleEnum.CASHIER_ORDERS, is_active=True, is_deleted=False)
        other = User(id=other_id, role=RoleEnum.CASHIER_ORDERS, is_active=True, is_deleted=False)
        admin = User(id=admin_id, role=RoleEnum.ADMIN, is_active=True, is_deleted=False)
        db.add_all([cashier, other, admin, Warehouse(id=warehouse_id, name="Correction"),
                    Product(id=product_id, sku="CORRECTION-REQUEST", name_en="Item", name_ar="صنف", base_unit="Piece")])
        await db.flush()
        db.add_all([CashShift(user_id=cashier_id, opening_cash=0, status="OPEN"),
                    ProductUnit(id=unit_id, product_id=product_id, unit_name="Piece", conversion_factor=1),
                    InventoryBalance(product_id=product_id, warehouse_id=warehouse_id, current_stock=10),
                    ProductPrice(product_id=product_id, unit_id=unit_id, price_level="Retail", price=30)])
        await db.commit()
        sale = await OrderService.create_order(db, OrderCreate(request_id=uuid4(), warehouse_id=warehouse_id,
            items=[{"product_id": product_id, "unit_id": unit_id, "quantity": 1}]), cashier_id)
        price = (await db.execute(select(ProductPrice).where(ProductPrice.product_id == product_id))).scalar_one()
        price.price = 70
        await db.commit()
        line = {"product_id": product_id, "unit_id": unit_id, "price_level": "Retail", "quantity": 1,
                "original_item_id": sale["items"][0]["id"]}
        proposal = CorrectionProposal(request_id=uuid4(), warehouse_id=warehouse_id,
                                      items=[line, {"product_id": product_id, "unit_id": unit_id, "price_level": "Retail", "quantity": 1}])
        with pytest.raises(LookupError):
            await create_correction_request(db, sale["id"], proposal, other)
        row = await create_correction_request(db, sale["id"], proposal, cashier)
        await db.commit()
        assert row.status == "PENDING" and Decimal(row.priced_lines[0]["unit_price"]) == 30
        assert Decimal(row.priced_lines[1]["unit_price"]) == 70
        assert Decimal(row.original_snapshot["items"][0]["unit_price"]) == 30
        assert (await create_correction_request(db, sale["id"], proposal, cashier)).id == row.id
        with pytest.raises(ValueError, match="used differently"):
            await create_correction_request(db, sale["id"], proposal.model_copy(update={"discount_amount": Decimal("1")}), cashier)
        with pytest.raises(ValueError, match="active correction"):
            await create_correction_request(db, sale["id"], proposal.model_copy(update={"request_id": uuid4()}), cashier)
        with pytest.raises(PermissionError):
            await review_correction_request(db, row.id, cashier)
        payment = (await db.execute(select(Payment).where(Payment.order_id == sale["id"]))).scalar_one()
        payment.amount = 29
        await db.flush()
        with pytest.raises(ValueError, match="sale changed"):
            await review_correction_request(db, row.id, admin)
        payment.amount = 30
        await db.flush()
        price.price = 80
        await db.flush()
        with pytest.raises(ValueError, match="prices or units changed"):
            await review_correction_request(db, row.id, admin)
        price.price = 70
        await db.flush()
        approved = await review_correction_request(db, row.id, admin)
        assert approved.status == "AWAITING_SETTLEMENT"
        await db.commit()
        assert (await db.execute(select(InventoryBalance.current_stock))).scalar_one() == 9
        assert len((await db.execute(select(Payment.id))).all()) == 1

    async def isolated_db():
        async with database() as db:
            yield db
    app.dependency_overrides[get_db] = isolated_db
    app.dependency_overrides[get_current_user] = lambda: User(id=cashier_id, role=RoleEnum.CASHIER_ORDERS)
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            result = await client.post("/api/v1/sale-cancellations", json={"request_id": str(uuid4()), "order_id": str(sale["id"])})
            assert result.status_code == 409
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_current_user, None)


@pytest.mark.asyncio
@pytest.mark.parametrize("new_method", ["Cash", "Credit Card", "Wallet"])
async def test_prepaid_correction_atomically_replaces_sale_and_settles_difference(database, new_method, monkeypatch):
    cashier_id, admin_id, warehouse_id, product_id, unit_id = [uuid4() for _ in range(5)]
    async with database() as db:
        cashier = User(id=cashier_id, role=RoleEnum.CASHIER_ORDERS, is_active=True, is_deleted=False)
        admin = User(id=admin_id, role=RoleEnum.ADMIN, is_active=True, is_deleted=False)
        db.add_all([cashier, admin, Warehouse(id=warehouse_id, name="Correction"),
                    Product(id=product_id, sku="EXEC-CORRECTION", name_en="Item", name_ar="صنف", base_unit="Piece", cost=10)])
        await db.flush()
        db.add_all([CashShift(user_id=cashier_id, opening_cash=0, status="OPEN"),
                    ProductUnit(id=unit_id, product_id=product_id, unit_name="Piece", conversion_factor=1),
                    InventoryBalance(product_id=product_id, warehouse_id=warehouse_id, current_stock=10),
                    ProductPrice(product_id=product_id, unit_id=unit_id, price_level="Retail", price=30)])
        await db.commit()
        sale = await OrderService.create_order(db, OrderCreate(request_id=uuid4(), warehouse_id=warehouse_id,
            items=[{"product_id": product_id, "unit_id": unit_id, "quantity": 2}]), cashier_id)
        price = (await db.execute(select(ProductPrice).where(ProductPrice.product_id == product_id))).scalar_one()
        price.price = 70
        await db.commit()
        line = {"product_id": product_id, "unit_id": unit_id, "price_level": "Retail",
                "quantity": 1 if new_method == "Cash" else 2, "original_item_id": sale["items"][0]["id"]}
        items = [line]
        if new_method == "Cash":
            items.append({"product_id": product_id, "unit_id": unit_id, "price_level": "Retail", "quantity": 1})
        proposal = CorrectionProposal(request_id=uuid4(), warehouse_id=warehouse_id, payment_method=new_method, items=items)
        row = await create_correction_request(db, sale["id"], proposal, cashier)
        await review_correction_request(db, row.id, admin)
        await db.commit()
        correction_id = row.id

    async with database() as db:
        cashier = (await db.execute(select(User).where(User.id == cashier_id))).scalar_one()
        admin = (await db.execute(select(User).where(User.id == admin_id))).scalar_one()
        with pytest.raises(LookupError):
            await preview_correction_settlement(db, correction_id, admin)
        preview = await preview_correction_settlement(db, correction_id, cashier)
        assert Decimal(preview["original_total"]) == 60
        assert Decimal(preview["corrected_total"]) == (Decimal("100") if new_method == "Cash" else Decimal("60.60") if new_method == "Wallet" else Decimal("60"))
        expected = ([{"kind": "SALE", "method": "Cash", "amount": "40.00"}] if new_method == "Cash" else
                    [{"kind": "REFUND", "method": "Cash", "amount": "60.00"},
                     {"kind": "SALE", "method": new_method, "amount": "60.60" if new_method == "Wallet" else "60.00"}])
        assert preview["adjustments"] == expected
        with pytest.raises(ValueError, match="confirm"):
            await apply_correction_settlement(db, correction_id, cashier, confirmed=True, fingerprint="stale")

    if new_method == "Cash":
        original_checkout = OrderService._create_order_once
        async def failed_checkout(*args, **kwargs):
            raise ValueError("injected failure after return")
        monkeypatch.setattr(OrderService, "_create_order_once", failed_checkout)
        async with database() as db:
            cashier = (await db.execute(select(User).where(User.id == cashier_id))).scalar_one()
            with pytest.raises(ValueError, match="injected failure"):
                await apply_correction_settlement(db, correction_id, cashier, confirmed=True, fingerprint=preview["fingerprint"])
            assert (await db.execute(select(InventoryBalance.current_stock))).scalar_one() == 8
            assert not (await db.execute(select(SalesReturn.id))).first()
            assert len((await db.execute(select(Payment.id))).all()) == 1
        monkeypatch.setattr(OrderService, "_create_order_once", original_checkout)

    async with database() as db:
        cashier = (await db.execute(select(User).where(User.id == cashier_id))).scalar_one()
        applied = await apply_correction_settlement(db, correction_id, cashier, confirmed=True, fingerprint=preview["fingerprint"])
        corrected_id = applied.corrected_order_id
        await db.commit()
        assert applied.status == "APPLIED" and corrected_id is not None
        assert (await apply_correction_settlement(db, correction_id, cashier, confirmed=True, fingerprint=preview["fingerprint"])).corrected_order_id == corrected_id
        assert (await db.execute(select(InventoryBalance.current_stock))).scalar_one() == 8
        corrected_items = (await db.execute(select(OrderItem).where(OrderItem.order_id == corrected_id))).scalars().all()
        assert sorted(Decimal(str(item.unit_price)) for item in corrected_items) == ([Decimal("30"), Decimal("70")] if new_method == "Cash" else [Decimal("30")])
        returned = (await db.execute(select(SalesReturn))).scalar_one()
        assert returned.exchange_order_id == corrected_id and returned.returned_value == 60
        expected_total = Decimal("100") if new_method == "Cash" else Decimal("60.60") if new_method == "Wallet" else Decimal("60")
        assert Decimal(str((await financial_summary(db))["net_sales"])) == expected_total
        corrected_invoice = await get_order_quotation(corrected_id, db, cashier)
        assert Decimal(str(corrected_invoice["amount_received"])) == expected_total
        assert corrected_invoice["received_method"] == new_method
        payments = (await db.execute(select(Payment))).scalars().all()
        assert len(payments) == (2 if new_method == "Cash" else 3)
        cash = (await db.execute(select(CashShift).where(CashShift.user_id == cashier_id, CashShift.status == "OPEN"))).scalar_one()
        assert await expected_cash(db, cash) == (100 if new_method == "Cash" else 0)
        admin = (await db.execute(select(User).where(User.id == admin_id))).scalar_one()
        cancellation_id = uuid4()
        cancellation = await create_cancellation_request(CancellationInput(request_id=cancellation_id, order_id=corrected_id), db, cashier)
        assert cancellation["status"] == "PENDING" and cancellation["manual_review"] is True
        approved = await approve_cancellation_request(cancellation_id, CancellationApprovalInput(manual_review_confirmed=True), db, admin)
        assert approved["status"] == "AWAITING_SETTLEMENT"
        cancellation_quote = await cancellation_settlement_preview(cancellation_id, db, cashier)
        assert Decimal(cancellation_quote["refund_amount"]) == (100 if new_method == "Cash" else 60)
        settled = await settle_cancellation_request(cancellation_id, CancellationSettlementInput(
            confirmed_refund=cancellation_quote["refund_amount"], confirmed_method=cancellation_quote["payment_method"], refund_confirmed=True,
        ), db, cashier)
        assert settled["status"] == "APPROVED"
        assert (await db.execute(select(InventoryBalance.current_stock))).scalar_one() == 10
        assert Decimal(str((await financial_summary(db))["net_sales"])) == (Decimal("0.60") if new_method == "Wallet" else 0)


@pytest.mark.asyncio
async def test_correction_api_roles_approval_preview_and_settlement_journey(database):
    cashier_id, other_id, admin_id, warehouse_id, product_id, unit_id = [uuid4() for _ in range(6)]
    async with database() as db:
        db.add_all([User(id=cashier_id, role=RoleEnum.CASHIER_ORDERS, is_active=True),
                    User(id=other_id, role=RoleEnum.CASHIER_ORDERS, is_active=True), User(id=admin_id, role=RoleEnum.ADMIN, is_active=True),
                    Warehouse(id=warehouse_id, name="Correction"), Product(id=product_id, sku="API-CORRECTION",
                    name_en="Item", name_ar="صنف", base_unit="Piece")])
        await db.flush()
        db.add_all([CashShift(user_id=cashier_id, opening_cash=0, status="OPEN"),
                    ProductUnit(id=unit_id, product_id=product_id, unit_name="Piece", conversion_factor=1),
                    InventoryBalance(product_id=product_id, warehouse_id=warehouse_id, current_stock=10),
                    ProductPrice(product_id=product_id, unit_id=unit_id, price_level="Retail", price=30)])
        await db.commit()
        sale = await OrderService.create_order(db, OrderCreate(request_id=uuid4(), warehouse_id=warehouse_id,
            items=[{"product_id": product_id, "unit_id": unit_id, "quantity": 2}]), cashier_id)
    async def isolated_db():
        async with database() as db:
            yield db
    actor = {"id": cashier_id, "role": RoleEnum.CASHIER_ORDERS}
    app.dependency_overrides[get_db] = isolated_db
    app.dependency_overrides[get_current_user] = lambda: User(id=actor["id"], role=actor["role"], is_active=True, is_deleted=False)
    body = {"order_id": str(sale["id"]), "proposal": {"request_id": str(uuid4()), "warehouse_id": str(warehouse_id),
        "payment_method": "Credit Card", "items": [{"product_id": str(product_id), "unit_id": str(unit_id),
        "price_level": "Retail", "quantity": 2, "original_item_id": str(sale["items"][0]["id"])}]}}
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            actor["id"] = other_id
            assert (await client.post("/api/v1/sale-corrections", json=body)).status_code == 404
            assert (await client.post("/api/v1/sale-corrections/quote", json=body)).status_code == 404
            actor["id"] = cashier_id
            draft = await client.post("/api/v1/sale-corrections/quote", json=body)
            assert draft.status_code == 200 and Decimal(draft.json()["quote"]["total"]) == 60
            body["proposal"]["expected_total"] = draft.json()["quote"]["total"]
            created = await client.post("/api/v1/sale-corrections", json=body)
            assert created.status_code == 201 and created.json()["status"] == "PENDING"
            assert (await client.post("/api/v1/sale-corrections", json=body)).status_code == 201
            request_id = created.json()["id"]
            assert (await client.post(f"/api/v1/sale-corrections/{request_id}/approve", json={})).status_code == 403
            actor["id"] = other_id
            assert (await client.get("/api/v1/sale-corrections")).json() == []
            assert (await client.get(f"/api/v1/sale-corrections/{request_id}/settlement-preview")).status_code == 404
            actor.update(id=admin_id, role=RoleEnum.ADMIN)
            listed = await client.get("/api/v1/sale-corrections")
            assert listed.status_code == 200 and listed.json()[0]["priced_lines"][0]["product_name"] == "صنف"
            assert (await client.post(f"/api/v1/sale-corrections/{request_id}/approve", json={})).status_code == 200
            async with database() as db:
                old_shift = (await db.execute(select(CashShift).where(CashShift.user_id == cashier_id))).scalar_one()
                old_shift.status = "CLOSED"
                db.add(CashShift(user_id=cashier_id, opening_cash=0, status="OPEN"))
                await db.commit()
            actor.update(id=cashier_id, role=RoleEnum.CASHIER_ORDERS)
            assert (await client.get(f"/api/v1/sale-corrections/{request_id}/settlement-preview")).status_code == 409
            assert (await client.post(f"/api/v1/sale-corrections/{request_id}/request-review")).status_code == 200
            assert (await client.post(f"/api/v1/sale-corrections/{request_id}/request-review")).status_code == 200
            async with database() as db:
                audit_rows = (await db.execute(select(AuditLog).where(AuditLog.action == "SALE_CORRECTION_REREVIEW_REQUESTED"))).scalars().all()
                assert len(audit_rows) == 1
            actor.update(id=admin_id, role=RoleEnum.ADMIN)
            assert (await client.get("/api/v1/sale-corrections")).json()[0]["rereview_requested"] is True
            assert (await client.post(f"/api/v1/sale-corrections/{request_id}/approve", json={})).status_code == 409
            assert (await client.post(f"/api/v1/sale-corrections/{request_id}/approve", json={"manual_review_confirmed": True})).status_code == 200
            actor.update(id=cashier_id, role=RoleEnum.CASHIER_ORDERS)
            quote = await client.get(f"/api/v1/sale-corrections/{request_id}/settlement-preview")
            assert quote.status_code == 200 and len(quote.json()["adjustments"]) == 2
            settlement = {"confirmed": True, "fingerprint": quote.json()["fingerprint"]}
            applied = await client.post(f"/api/v1/sale-corrections/{request_id}/settle", json=settlement)
            assert applied.status_code == 200 and applied.json()["status"] == "APPLIED"
            assert (await client.post(f"/api/v1/sale-corrections/{request_id}/settle", json=settlement)).status_code == 200
            corrected_id = applied.json()["corrected_order_id"]
            invoice = await client.get(f"/api/v1/orders/{corrected_id}/quotation")
            assert invoice.status_code == 200 and invoice.json()["amount_received"] == 60
            history = await client.get("/api/v1/returns", params={"order_id": str(sale["id"])})
            assert history.status_code == 200 and history.json()[0]["is_correction"] is True
            receipt = await client.get(f"/api/v1/returns/{request_id}/receipt")
            assert receipt.status_code == 200 and receipt.json()["is_correction"] is True
            assert {entry["method"] for entry in receipt.json()["settlement_breakdown"]} == {"Cash", "Credit Card"}
            actor.update(id=admin_id, role=RoleEnum.ADMIN)
            activity = await client.get(f"/api/v1/orders/{sale['id']}/activity")
            assert activity.status_code == 200 and any(item["kind"] == "correction" for item in activity.json()["events"])
        async with database() as db:
            assert (await db.execute(select(InventoryBalance.current_stock))).scalar_one() == 8
            assert len((await db.execute(select(Payment))).scalars().all()) == 3
            assert (await financial_summary(db))["net_sales"] == 60
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_current_user, None)


@pytest.mark.asyncio
async def test_correction_after_partial_refund_only_replaces_remaining_sale(database):
    cashier_id, admin_id, warehouse_id, product_id, unit_id = [uuid4() for _ in range(5)]
    async with database() as db:
        db.add_all([User(id=cashier_id, role=RoleEnum.CASHIER_ORDERS, is_active=True), User(id=admin_id, role=RoleEnum.ADMIN, is_active=True),
                    Warehouse(id=warehouse_id, name="Correction"), Product(id=product_id, sku="PARTIAL-CORRECTION",
                    name_en="Item", name_ar="صنف", base_unit="Piece")])
        await db.flush()
        db.add_all([CashShift(user_id=cashier_id, opening_cash=0, status="OPEN"),
                    ProductUnit(id=unit_id, product_id=product_id, unit_name="Piece", conversion_factor=1),
                    InventoryBalance(product_id=product_id, warehouse_id=warehouse_id, current_stock=10),
                    ProductPrice(product_id=product_id, unit_id=unit_id, price_level="Retail", price=30)])
        await db.commit()
        sale = await OrderService.create_order(db, OrderCreate(request_id=uuid4(), warehouse_id=warehouse_id,
            items=[{"product_id": product_id, "unit_id": unit_id, "quantity": 2}]), cashier_id)
        await ReturnService.process(db, SalesReturnCreate(request_id=uuid4(), order_id=sale["id"], warehouse_id=warehouse_id,
            kind="REFUND", settlement_confirmed=True, expected_refund_amount=30, expected_charge_amount=0,
            lines=[{"order_item_id": sale["items"][0]["id"], "quantity": 1}]), cashier_id)
    async def isolated_db():
        async with database() as db:
            yield db
    actor = {"id": cashier_id, "role": RoleEnum.CASHIER_ORDERS}
    app.dependency_overrides[get_db] = isolated_db
    app.dependency_overrides[get_current_user] = lambda: User(id=actor["id"], role=actor["role"], is_active=True, is_deleted=False)
    body = {"order_id": str(sale["id"]), "proposal": {"request_id": str(uuid4()), "warehouse_id": str(warehouse_id),
        "payment_method": "Credit Card", "items": [{"product_id": str(product_id), "unit_id": str(unit_id),
        "price_level": "Retail", "quantity": 1, "original_item_id": str(sale["items"][0]["id"])}]}}
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            draft = await client.post("/api/v1/sale-corrections/quote", json=body)
            assert draft.status_code == 200 and Decimal(draft.json()["quote"]["total"]) == 30
            created = await client.post("/api/v1/sale-corrections", json=body)
            assert created.status_code == 201 and created.json()["manual_review"] is True
            request_id = created.json()["id"]
            actor.update(id=admin_id, role=RoleEnum.ADMIN)
            assert (await client.post(f"/api/v1/sale-corrections/{request_id}/approve", json={})).status_code == 409
            assert (await client.post(f"/api/v1/sale-corrections/{request_id}/approve", json={"manual_review_confirmed": True})).status_code == 200
            actor.update(id=cashier_id, role=RoleEnum.CASHIER_ORDERS)
            quote = await client.get(f"/api/v1/sale-corrections/{request_id}/settlement-preview")
            assert quote.status_code == 200 and Decimal(quote.json()["original_total"]) == 30
            assert len(quote.json()["adjustments"]) == 2
            result = await client.post(f"/api/v1/sale-corrections/{request_id}/settle", json={"confirmed": True, "fingerprint": quote.json()["fingerprint"]})
            assert result.status_code == 200 and result.json()["status"] == "APPLIED"
        async with database() as db:
            assert (await db.execute(select(InventoryBalance.current_stock))).scalar_one() == 9
            assert (await financial_summary(db))["net_sales"] == 30
            refund_amount = sum((p.amount for p in (await db.execute(select(Payment).where(Payment.kind == "REFUND"))).scalars()), Decimal("0"))
            assert refund_amount == 60
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_current_user, None)


@pytest.mark.asyncio
@pytest.mark.parametrize("add_bundle", [False, True])
async def test_bundle_correction_uses_original_components_after_recipe_changes(database, add_bundle):
    cashier_id, admin_id, warehouse_id, bundle_id, first_id, second_id, bundle_unit, second_unit = [uuid4() for _ in range(8)]
    async with database() as db:
        cashier = User(id=cashier_id, role=RoleEnum.CASHIER_ORDERS, is_active=True, is_deleted=False)
        admin = User(id=admin_id, role=RoleEnum.ADMIN, is_active=True, is_deleted=False)
        db.add_all([cashier, admin, Warehouse(id=warehouse_id, name="Bundle"),
                    Product(id=bundle_id, sku="CORR-BUNDLE", name_en="Bundle", name_ar="عرض", base_unit="Piece", is_bundle=True),
                    Product(id=first_id, sku="CORR-PART-A", name_en="A", name_ar="أ", base_unit="Piece", cost=5),
                    Product(id=second_id, sku="CORR-PART-B", name_en="B", name_ar="ب", base_unit="Piece", cost=8)])
        await db.flush()
        db.add_all([CashShift(user_id=cashier_id, opening_cash=0, status="OPEN"),
                    ProductUnit(id=bundle_unit, product_id=bundle_id, unit_name="عرض", conversion_factor=1),
                    ProductUnit(id=second_unit, product_id=second_id, unit_name="Piece", conversion_factor=1),
                    InventoryBalance(product_id=first_id, warehouse_id=warehouse_id, current_stock=10),
                    InventoryBalance(product_id=second_id, warehouse_id=warehouse_id, current_stock=10),
                    ProductPrice(product_id=bundle_id, unit_id=bundle_unit, price_level="Retail", price=50),
                    ProductPrice(product_id=second_id, unit_id=second_unit, price_level="Retail", price=20)])
        await db.flush()
        component = ProductBundleComponent(bundle_id=bundle_id, component_id=first_id, quantity=2)
        db.add(component)
        await db.commit()
        sale = await OrderService.create_order(db, OrderCreate(request_id=uuid4(), warehouse_id=warehouse_id,
            items=[{"product_id": bundle_id, "unit_id": bundle_unit, "quantity": 1}]), cashier_id)
        component.is_deleted = True
        db.add(ProductBundleComponent(bundle_id=bundle_id, component_id=second_id, quantity=3))
        await db.commit()
        old_line = {"product_id": bundle_id, "unit_id": bundle_unit, "price_level": "Retail", "quantity": 1,
                    "original_item_id": sale["items"][0]["id"]}
        with pytest.raises(ValueError, match="unit changed"):
            await resolve_correction_prices(db, sale["id"], CorrectionLines(items=[{**old_line, "quantity": 2}]))
        new_line = ({"product_id": bundle_id, "unit_id": bundle_unit, "price_level": "Retail", "quantity": 1}
                    if add_bundle else {"product_id": second_id, "unit_id": second_unit, "price_level": "Retail", "quantity": 1})
        proposal = CorrectionProposal(request_id=uuid4(), warehouse_id=warehouse_id, items=[old_line, new_line])
        request = await create_correction_request(db, sale["id"], proposal, cashier)
        await review_correction_request(db, request.id, admin)
        await db.commit()
        quote = await preview_correction_settlement(db, request.id, cashier)
        assert quote["adjustments"] == [{"kind": "SALE", "method": "Cash", "amount": "50.00" if add_bundle else "20.00"}]
        applied = await apply_correction_settlement(db, request.id, cashier, confirmed=True, fingerprint=quote["fingerprint"])
        corrected_id = applied.corrected_order_id
        await db.commit()
        balances = {row.product_id: row.current_stock for row in (await db.execute(select(InventoryBalance))).scalars()}
        assert balances == {first_id: 8, second_id: 7 if add_bundle else 9}
        items = (await db.execute(select(OrderItem).where(OrderItem.order_id == corrected_id, OrderItem.product_id == bundle_id))).scalars().all()
        item = next(item for item in items if item.bundle_components_snapshot[0]["product_id"] == str(first_id))
        assert len(item.bundle_components_snapshot) == 1 and item.bundle_components_snapshot[0]["product_id"] == str(first_id)
        assert Decimal(item.bundle_components_snapshot[0]["quantity"]) == 2
        assert item.cost_at_sale == 10 and (await financial_summary(db))["net_sales"] == (100 if add_bundle else 70)
        if add_bundle:
            new_bundle = next(item for item in items if item.bundle_components_snapshot[0]["product_id"] == str(second_id))
            assert new_bundle.cost_at_sale == 24


@pytest.mark.asyncio
async def test_correction_changes_customer_and_reconciles_both_accounts(database):
    cashier_id, admin_id, old_customer_id, new_customer_id, warehouse_id, product_id, unit_id = [uuid4() for _ in range(7)]
    async with database() as db:
        cashier = User(id=cashier_id, role=RoleEnum.CASHIER_ORDERS, is_active=True, is_deleted=False)
        admin = User(id=admin_id, role=RoleEnum.ADMIN, is_active=True, is_deleted=False)
        db.add_all([cashier, admin, Customer(id=old_customer_id, name="Old", credit_limit=500),
                    Customer(id=new_customer_id, name="New", credit_limit=500), Warehouse(id=warehouse_id, name="Customer change"),
                    Product(id=product_id, sku="CORR-CUSTOMER", name_en="Item", name_ar="صنف", base_unit="Piece", cost=10)])
        await db.flush()
        db.add_all([CashShift(user_id=cashier_id, opening_cash=0, status="OPEN"),
                    ProductUnit(id=unit_id, product_id=product_id, unit_name="Piece", conversion_factor=1),
                    InventoryBalance(product_id=product_id, warehouse_id=warehouse_id, current_stock=10),
                    ProductPrice(product_id=product_id, unit_id=unit_id, price_level="Retail", price=30)])
        await db.commit()
        sale = await OrderService.create_order(db, OrderCreate(request_id=uuid4(), warehouse_id=warehouse_id, customer_id=old_customer_id,
            items=[{"product_id": product_id, "unit_id": unit_id, "quantity": 2}]), cashier_id)
        proposal = CorrectionProposal(request_id=uuid4(), warehouse_id=warehouse_id, customer_id=new_customer_id, items=[{
            "product_id": product_id, "unit_id": unit_id, "quantity": 2, "price_level": "Retail", "original_item_id": sale["items"][0]["id"],
        }])
        request = await create_correction_request(db, sale["id"], proposal, cashier)
        await review_correction_request(db, request.id, admin)
        await db.commit()
        quote = await preview_correction_settlement(db, request.id, cashier)
        assert quote["customer_changed"] is True
        assert quote["adjustments"] == [{"kind": "REFUND", "method": "Cash", "amount": "60.00"},
                                         {"kind": "SALE", "method": "Cash", "amount": "60.00"}]
        applied = await apply_correction_settlement(db, request.id, cashier, confirmed=True, fingerprint=quote["fingerprint"])
        await db.commit()
        assert applied.status == "APPLIED"
        old = (await db.execute(select(Customer).where(Customer.id == old_customer_id).execution_options(populate_existing=True))).scalar_one()
        new = (await db.execute(select(Customer).where(Customer.id == new_customer_id).execution_options(populate_existing=True))).scalar_one()
        assert old.total_purchases == 0 and old.purchase_count == 0
        assert new.total_purchases == 60 and new.purchase_count == 1
        old_statement = await customer_statement(old_customer_id, db, admin)
        new_statement = await customer_statement(new_customer_id, db, admin)
        assert old_statement["opening_balance"] == 0 and old_statement["closing_balance"] == 0
        assert new_statement["opening_balance"] == 0 and new_statement["closing_balance"] == 0
        old_refund = (await db.execute(select(Payment).where(Payment.kind == "REFUND"))).scalar_one()
        assert old_refund.customer_id == old_customer_id
        corrected_payment = (await db.execute(select(Payment).where(Payment.order_id == applied.corrected_order_id))).scalar_one()
        assert corrected_payment.customer_id == new_customer_id


@pytest.mark.asyncio
@pytest.mark.parametrize("old_deferred,new_deferred", [(True, True), (False, True), (True, False)])
async def test_correction_reconciles_deferred_debt_and_collected_payment(database, old_deferred, new_deferred):
    from datetime import date
    cashier_id, admin_id, customer_id, warehouse_id, product_id, unit_id = [uuid4() for _ in range(6)]
    async with database() as db:
        cashier = User(id=cashier_id, role=RoleEnum.CASHIER_ORDERS, is_active=True, is_deleted=False)
        admin = User(id=admin_id, role=RoleEnum.ADMIN, is_active=True, is_deleted=False)
        db.add_all([cashier, admin, Customer(id=customer_id, name="Credit", credit_limit=500),
                    Warehouse(id=warehouse_id, name="Credit stock"),
                    Product(id=product_id, sku="CORR-CREDIT", name_en="Item", name_ar="صنف", base_unit="Piece", cost=10)])
        await db.flush()
        db.add_all([CashShift(user_id=cashier_id, opening_cash=0, status="OPEN"),
                    ProductUnit(id=unit_id, product_id=product_id, unit_name="Piece", conversion_factor=1),
                    InventoryBalance(product_id=product_id, warehouse_id=warehouse_id, current_stock=10),
                    ProductPrice(product_id=product_id, unit_id=unit_id, price_level="Retail", price=30)])
        await db.commit()
        old_fields = {"payment_method": "Deferred Payment", "amount_received": 20, "received_method": "Cash",
                      "expected_collection_method": "Cash", "next_due_date": date(2099, 1, 1)} if old_deferred else {}
        sale = await OrderService.create_order(db, OrderCreate(request_id=uuid4(), warehouse_id=warehouse_id,
            customer_id=customer_id, items=[{"product_id": product_id, "unit_id": unit_id, "quantity": 2}], **old_fields), cashier_id)
        new_fields = {"payment_method": "Deferred Payment", "amount_received": 30, "received_method": "Cash",
                      "expected_collection_method": "Cash", "next_due_date": date(2099, 1, 1)} if new_deferred else {}
        proposal = CorrectionProposal(request_id=uuid4(), warehouse_id=warehouse_id, customer_id=customer_id, items=[{
            "product_id": product_id, "unit_id": unit_id, "quantity": 2, "price_level": "Retail", "original_item_id": sale["items"][0]["id"]}], **new_fields)
        request = await create_correction_request(db, sale["id"], proposal, cashier)
        await review_correction_request(db, request.id, admin)
        await db.commit()
        quote = await preview_correction_settlement(db, request.id, cashier)
        assert Decimal(quote["old_debt"]) == (40 if old_deferred else 0)
        assert Decimal(quote["new_debt"]) == (30 if new_deferred else 0)
        applied = await apply_correction_settlement(db, request.id, cashier, confirmed=True, fingerprint=quote["fingerprint"])
        await db.commit()
        customer = (await db.execute(select(Customer).where(Customer.id == customer_id).execution_options(populate_existing=True))).scalar_one()
        assert customer.balance == (30 if new_deferred else 0)
        statement = await customer_statement(customer_id, db, admin)
        assert statement["opening_balance"] == 0 and statement["closing_balance"] == customer.balance
        old_order = (await db.execute(select(Order).where(Order.id == sale["id"]).execution_options(populate_existing=True))).scalar_one()
        corrected = (await db.execute(select(Order).where(Order.id == applied.corrected_order_id))).scalar_one()
        assert not old_order.deferred_remaining and (corrected.deferred_remaining or 0) == (30 if new_deferred else 0)
        quotation = await get_order_quotation(corrected.id, db, cashier)
        assert quotation["amount_received"] == (30 if new_deferred else 60)


@pytest.mark.asyncio
async def test_corrected_invoice_can_be_corrected_again_without_losing_payment_history(database):
    cashier_id, admin_id, warehouse_id, product_id, unit_id = [uuid4() for _ in range(5)]
    async with database() as db:
        cashier = User(id=cashier_id, role=RoleEnum.CASHIER_ORDERS, is_active=True, is_deleted=False)
        admin = User(id=admin_id, role=RoleEnum.ADMIN, is_active=True, is_deleted=False)
        db.add_all([cashier, admin, Warehouse(id=warehouse_id, name="Chain"),
                    Product(id=product_id, sku="CORR-CHAIN", name_en="Item", name_ar="صنف", base_unit="Piece", cost=10)])
        await db.flush()
        db.add_all([CashShift(user_id=cashier_id, opening_cash=0, status="OPEN"),
                    ProductUnit(id=unit_id, product_id=product_id, unit_name="Piece", conversion_factor=1),
                    InventoryBalance(product_id=product_id, warehouse_id=warehouse_id, current_stock=10),
                    ProductPrice(product_id=product_id, unit_id=unit_id, price_level="Retail", price=30)])
        await db.commit()
        sale = await OrderService.create_order(db, OrderCreate(request_id=uuid4(), warehouse_id=warehouse_id,
            items=[{"product_id": product_id, "unit_id": unit_id, "quantity": 2}]), cashier_id)
        price = (await db.execute(select(ProductPrice).where(ProductPrice.product_id == product_id))).scalar_one()
        price.price = 70
        await db.commit()
        first = CorrectionProposal(request_id=uuid4(), warehouse_id=warehouse_id, items=[
            {"product_id": product_id, "unit_id": unit_id, "quantity": 1, "price_level": "Retail", "original_item_id": sale["items"][0]["id"]},
            {"product_id": product_id, "unit_id": unit_id, "quantity": 1, "price_level": "Retail"},
        ])
        request = await create_correction_request(db, sale["id"], first, cashier)
        await review_correction_request(db, request.id, admin)
        await db.commit()
        quote = await preview_correction_settlement(db, request.id, cashier)
        first_applied = await apply_correction_settlement(db, request.id, cashier, confirmed=True, fingerprint=quote["fingerprint"])
        first_id = first_applied.corrected_order_id
        await db.commit()
        first_items = (await db.execute(select(OrderItem).where(OrderItem.order_id == first_id))).scalars().all()
        old_price_item = next(item for item in first_items if item.unit_price == 30)
        second = CorrectionProposal(request_id=uuid4(), warehouse_id=warehouse_id, items=[{
            "product_id": product_id, "unit_id": unit_id, "quantity": 1, "price_level": "Retail", "original_item_id": old_price_item.id,
        }])
        second_request = await create_correction_request(db, first_id, second, cashier)
        assert second_request.manual_review is True
        await review_correction_request(db, second_request.id, admin, manual_review_confirmed=True)
        await db.commit()
        second_quote = await preview_correction_settlement(db, second_request.id, cashier)
        assert Decimal(second_quote["original_total"]) == 100 and Decimal(second_quote["corrected_total"]) == 30
        assert second_quote["adjustments"] == [{"kind": "REFUND", "method": "Cash", "amount": "70.00"}]
        second_applied = await apply_correction_settlement(db, second_request.id, cashier, confirmed=True, fingerprint=second_quote["fingerprint"])
        await db.commit()
        assert second_applied.status == "APPLIED"
        assert (await db.execute(select(InventoryBalance.current_stock))).scalar_one() == 9
        assert (await financial_summary(db))["net_sales"] == 30
        shift = (await db.execute(select(CashShift).where(CashShift.user_id == cashier_id))).scalar_one()
        assert await expected_cash(db, shift) == 30


@pytest.mark.asyncio
@pytest.mark.parametrize("method", ["Cash", "Credit Card"])
async def test_part_paid_deferred_cancellation_splits_refund_and_debt(database, method, monkeypatch):
    cashier, admin, customer_id, warehouse_id, product_id, unit_id = [uuid4() for _ in range(6)]
    async with database() as db:
        db.add_all([User(id=cashier, role=RoleEnum.CASHIER_ORDERS, is_active=True), User(id=admin, role=RoleEnum.ADMIN, is_active=True),
                    Customer(id=customer_id, name="Credit", credit_limit=500), Warehouse(id=warehouse_id, name="Main"),
                    Product(id=product_id, sku="MIXED-CANCEL", name_en="Item", name_ar="صنف", base_unit="Piece")])
        await db.flush()
        db.add_all([CashShift(user_id=cashier, opening_cash=0, status="OPEN"),
                    ProductUnit(id=unit_id, product_id=product_id, unit_name="Piece", conversion_factor=1),
                    InventoryBalance(product_id=product_id, warehouse_id=warehouse_id, current_stock=5),
                    ProductPrice(product_id=product_id, unit_id=unit_id, price_level="Retail", price=30)])
        await db.commit()
        sale = await OrderService.create_order(db, OrderCreate(
            request_id=uuid4(), warehouse_id=warehouse_id, customer_id=customer_id, payment_method="Deferred Payment",
            amount_received=20, received_method=method, expected_collection_method="Cash", next_due_date="2099-01-01",
            items=[{"product_id": product_id, "unit_id": unit_id, "quantity": 2}],
        ), cashier)
    async def isolated_db():
        async with database() as db:
            yield db
    actor = {"id": cashier, "role": RoleEnum.CASHIER_ORDERS}
    app.dependency_overrides[get_db] = isolated_db
    app.dependency_overrides[get_current_user] = lambda: User(id=actor["id"], role=actor["role"])
    body = {"request_id": str(uuid4()), "order_id": str(sale["id"])}
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            assert (await client.post("/api/v1/sale-cancellations", json=body)).status_code == 201
            actor.update(id=admin, role=RoleEnum.ADMIN)
            assert (await client.post(f"/api/v1/sale-cancellations/{body['request_id']}/approve", json={})).status_code == 200
            actor.update(id=cashier, role=RoleEnum.CASHIER_ORDERS)
            quote = await client.get(f"/api/v1/sale-cancellations/{body['request_id']}/settlement-preview")
            assert quote.status_code == 200 and quote.json()["settlement_type"] == "MIXED"
            assert Decimal(quote.json()["refund_amount"]) == 20 and Decimal(quote.json()["debt_amount"]) == 40
            assert quote.json()["payment_method"] == method
            settlement = {"confirmed_refund": "20", "confirmed_debt": "40", "confirmed_method": method, "refund_confirmed": True}
            stale = {**settlement, "confirmed_debt": "41"}
            assert (await client.post(f"/api/v1/sale-cancellations/{body['request_id']}/settle", json=stale)).status_code == 409
            wrong_method = {**settlement, "confirmed_method": "Instapay"}
            assert (await client.post(f"/api/v1/sale-cancellations/{body['request_id']}/settle", json=wrong_method)).status_code == 409
            if method == "Cash":
                original_open_shift = cancellation_service.open_shift
                calls = 0
                async def fail_during_settlement(session, user_id):
                    nonlocal calls
                    calls += 1
                    if calls == 2:
                        raise ValueError("injected failure after inventory movement")
                    return await original_open_shift(session, user_id)
                monkeypatch.setattr(cancellation_service, "open_shift", fail_during_settlement)
                assert (await client.post(f"/api/v1/sale-cancellations/{body['request_id']}/settle", json=settlement)).status_code == 409
                monkeypatch.setattr(cancellation_service, "open_shift", original_open_shift)
                async with database() as db:
                    assert (await db.execute(select(InventoryBalance.current_stock))).scalar_one() == 3
                    assert (await db.execute(select(Customer.balance).where(Customer.id == customer_id))).scalar_one() == 40
                    assert not (await db.execute(select(Payment.id).where(Payment.kind == "REFUND"))).first()
                    assert (await db.execute(select(SaleCancellation.status))).scalar_one() == "AWAITING_SETTLEMENT"
            settled = await client.post(f"/api/v1/sale-cancellations/{body['request_id']}/settle", json=settlement)
            assert settled.status_code == 200 and settled.json()["status"] == "APPROVED"
            assert (await client.post(f"/api/v1/sale-cancellations/{body['request_id']}/settle", json=settlement)).status_code == 200
        async with database() as db:
            assert (await db.execute(select(Customer.balance).where(Customer.id == customer_id))).scalar_one() == 0
            assert (await db.execute(select(Order.deferred_remaining).where(Order.id == sale["id"]))).scalar_one() == 0
            assert (await db.execute(select(InventoryBalance.current_stock))).scalar_one() == 5
            refund = (await db.execute(select(Payment).where(Payment.order_id == sale["id"], Payment.kind == "REFUND"))).scalar_one()
            assert refund.amount == 20 and refund.method == method and refund.user_id == cashier
            shift = (await db.execute(select(CashShift).where(CashShift.user_id == cashier, CashShift.status == "OPEN"))).scalar_one()
            assert refund.shift_id == (shift.id if method == "Cash" else None)
            assert (await financial_summary(db))["net_sales"] == 0
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_current_user, None)


@pytest.mark.asyncio
async def test_inventory_today_uses_cairo_midnight_boundaries(database, monkeypatch):
    class FixedDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime(2026, 1, 15, 10, tzinfo=timezone.utc).astimezone(tz)

    user_id, warehouse_id, product_id = [uuid4() for _ in range(3)]
    async with database() as db:
        user = User(id=user_id, role=RoleEnum.ADMIN)
        db.add_all([user, Warehouse(id=warehouse_id, name="Clock"),
                    Product(id=product_id, sku="CLOCK", name_en="Clock", name_ar="وقت", base_unit="Piece")])
        await db.flush()
        for stamp in [datetime(2026, 1, 14, 21, 59), datetime(2026, 1, 14, 22, 0),
                      datetime(2026, 1, 15, 21, 59), datetime(2026, 1, 15, 22, 0)]:
            db.add(InventoryTransaction(product_id=product_id, warehouse_id=warehouse_id, user_id=user_id,
                transaction_type=TransactionTypeEnum.RECEIVING, quantity_changed=1, created_at=stamp))
        await db.flush()
        monkeypatch.setattr(inventory_api, "datetime", FixedDatetime)
        result = await inventory_api.get_inventory_stats(db=db, current_user=user)
        assert result["today_movements"] == 2


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
            assert (await client.get("/api/v1/returns/lookup/invalid")).status_code == 404
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
            assert current.json()["opening_cash"] is None
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
            assert closed.json()["closing_cash"] is None
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
            assert closed.json()["closing_cash"] is None
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
            assert (await client.get("/api/v1/reports/inventory")).status_code == 403
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
            assert (await client.get("/api/v1/reports/inventory", headers=inventory_headers)).status_code == 403
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
