"""Transactional journeys against the isolated TEST_DATABASE_URL fixture."""

from decimal import Decimal
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from core.dependencies import get_current_user
from database import AsyncSessionLocal
from main import app
from models.customer import Customer
from models.financial import CashAdjustment, Payment
from models.inventory import InventoryBalance, InventoryCount, Warehouse
from models.product import Product, ProductPrice, ProductUnit, Supplier
from models.returns import SalesReturn
from models.user import RoleEnum, User


async def _admin_client(user_id):
    app.dependency_overrides[get_current_user] = lambda: User(id=user_id, role=RoleEnum.ADMIN)
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest.mark.asyncio
async def test_credit_refund_exchange_and_cash_shift_are_consistent():
    user_id, customer_id, warehouse_id, first_id, first_unit, second_id, second_unit = [uuid4() for _ in range(7)]
    async with AsyncSessionLocal() as db:
        db.add_all([
            User(id=user_id, role=RoleEnum.ADMIN),
            Customer(id=customer_id, name="Flow customer"),
            Warehouse(id=warehouse_id, name="Flow warehouse"),
            Product(id=first_id, sku=f"FLOW-{first_id.hex[:8]}", name_en="", name_ar="منتج أول", base_unit="Piece", cost=10),
            Product(id=second_id, sku=f"FLOW-{second_id.hex[:8]}", name_en="", name_ar="منتج ثان", base_unit="Piece", cost=15),
        ])
        await db.flush()
        db.add_all([
            ProductUnit(id=first_unit, product_id=first_id, unit_name="Piece", conversion_factor=1),
            ProductUnit(id=second_unit, product_id=second_id, unit_name="Piece", conversion_factor=1),
            InventoryBalance(product_id=first_id, warehouse_id=warehouse_id, current_stock=5),
            InventoryBalance(product_id=second_id, warehouse_id=warehouse_id, current_stock=5),
        ])
        await db.flush()
        db.add_all([
            ProductPrice(product_id=first_id, unit_id=first_unit, price_level="Retail", price=30),
            ProductPrice(product_id=second_id, unit_id=second_unit, price_level="Retail", price=40),
        ])
        await db.commit()

    client = await _admin_client(user_id)
    try:
        async with client:
            assert (await client.patch(f"/api/v1/customers/{customer_id}/credit-limit", json={"credit_limit": 50})).status_code == 200
            opened = await client.post("/api/v1/cash-register/open", json={"opening_cash": 100})
            assert opened.status_code == 201, opened.text

            def sale(quantity, method):
                return {"request_id": str(uuid4()), "customer_id": str(customer_id),
                        "warehouse_id": str(warehouse_id), "payment_method": method,
                        "items": [{"product_id": str(first_id), "unit_id": str(first_unit), "quantity": quantity}]}

            over_limit = await client.post("/api/v1/orders", json=sale(2, "Deferred Payment"))
            assert over_limit.status_code == 400, over_limit.text
            deferred = await client.post("/api/v1/orders", json=sale(1, "Deferred Payment"))
            assert deferred.status_code == 201, deferred.text
            cash = await client.post("/api/v1/orders", json=sale(1, "Cash"))
            assert cash.status_code == 201, cash.text

            refund_payload = {"request_id": str(uuid4()), "order_id": cash.json()["id"],
                              "warehouse_id": str(warehouse_id), "kind": "REFUND", "settlement_confirmed": True,
                              "lines": [{"order_item_id": cash.json()["items"][0]["id"], "quantity": 1}]}
            refunded = await client.post("/api/v1/returns", json=refund_payload)
            assert refunded.status_code == 201, refunded.text
            assert refunded.json()["refund_amount"] == "30.00"
            replay = await client.post("/api/v1/returns", json=refund_payload)
            assert replay.status_code == 201 and replay.json()["id"] == refunded.json()["id"]

            cash_exchange = await client.post("/api/v1/orders", json=sale(1, "Cash"))
            assert cash_exchange.status_code == 201, cash_exchange.text
            exchanged = await client.post("/api/v1/returns", json={
                "request_id": str(uuid4()), "order_id": cash_exchange.json()["id"],
                "warehouse_id": str(warehouse_id), "kind": "EXCHANGE", "settlement_confirmed": True,
                "lines": [{"order_item_id": cash_exchange.json()["items"][0]["id"], "quantity": 1}],
                "replacements": [{"product_id": str(second_id), "unit_id": str(second_unit), "quantity": 1}],
            })
            assert exchanged.status_code == 201, exchanged.text
            assert exchanged.json()["charge_amount"] == "10.00"

            collected = await client.post(f"/api/v1/customers/{customer_id}/payments", json={
                "request_id": str(uuid4()), "method": "Cash", "amount": 30,
            })
            assert collected.status_code == 201, collected.text
            current = await client.get("/api/v1/cash-register/current")
            assert current.status_code == 200 and current.json()["expected_cash"] == 170
            closed = await client.post("/api/v1/cash-register/close", json={"closing_cash": 170})
            assert closed.status_code == 200 and closed.json()["difference"] == 0

        async with AsyncSessionLocal() as db:
            balances = {row.product_id: row.current_stock for row in (await db.execute(select(InventoryBalance).where(
                InventoryBalance.warehouse_id == warehouse_id,
            ))).scalars()}
            customer = (await db.execute(select(Customer).where(Customer.id == customer_id))).scalar_one()
            returns = (await db.execute(select(SalesReturn).where(SalesReturn.order_id.in_([
                cash.json()["id"], cash_exchange.json()["id"],
            ])))).scalars().all()
            assert balances[first_id] == 4 and balances[second_id] == 4
            assert customer.balance == 0 and len(returns) == 2
            assert len((await db.execute(select(Payment).where(Payment.customer_id == customer_id))).scalars().all()) == 5
    finally:
        app.dependency_overrides.pop(get_current_user, None)


@pytest.mark.asyncio
async def test_purchase_receipt_transfer_count_and_supplier_cash_payment():
    user_id, supplier_id, product_id, first_warehouse, second_warehouse = [uuid4() for _ in range(5)]
    async with AsyncSessionLocal() as db:
        db.add_all([
            User(id=user_id, role=RoleEnum.ADMIN),
            Supplier(id=supplier_id, name="Flow supplier"),
            Product(id=product_id, sku=f"BUY-{product_id.hex[:8]}", name_en="", name_ar="كتاب", base_unit="Piece"),
            Warehouse(id=first_warehouse, name="Receiving warehouse"),
            Warehouse(id=second_warehouse, name="Transfer warehouse"),
        ])
        await db.commit()

    client = await _admin_client(user_id)
    try:
        async with client:
            purchase = await client.post("/api/v1/purchases", json={
                "product_id": str(product_id), "supplier_id": str(supplier_id), "quantity": 2,
            })
            assert purchase.status_code == 201, purchase.text
            purchase_id = purchase.json()["id"]
            for action in ("approve", "place"):
                response = await client.post(f"/api/v1/purchases/{purchase_id}/{action}")
                assert response.status_code == 200, response.text
            receipt_payload = {"request_id": str(uuid4()), "warehouse_id": str(first_warehouse),
                               "quantity": 2}
            received = await client.post(f"/api/v1/purchases/{purchase_id}/receive", json=receipt_payload)
            assert received.status_code == 200 and received.json()["status"] == "RECEIVED", received.text
            replay = await client.post(f"/api/v1/purchases/{purchase_id}/receive", json=receipt_payload)
            assert replay.status_code == 200, replay.text

            transfer = await client.post("/api/v1/inventory/transfers", json={
                "request_id": str(uuid4()), "product_id": str(product_id),
                "source_warehouse_id": str(first_warehouse), "target_warehouse_id": str(second_warehouse),
                "quantity": 1,
            })
            assert transfer.status_code == 200, transfer.text
            count = await client.post("/api/v1/inventory/counts", json={
                "request_id": str(uuid4()), "product_id": str(product_id),
                "warehouse_id": str(second_warehouse), "observed_quantity": 2,
            })
            assert count.status_code == 200 and count.json()["difference"] == "1.00", count.text

            assert (await client.post("/api/v1/cash-register/open", json={"opening_cash": 100})).status_code == 201
            debt = await client.post(f"/api/v1/suppliers/{supplier_id}/debts", json={
                "request_id": str(uuid4()), "amount": 14, "note": "فاتورة المورد اليدوية",
            })
            assert debt.status_code == 201, debt.text
            payment = await client.post(f"/api/v1/suppliers/{supplier_id}/payments", json={
                "request_id": str(uuid4()), "amount": 14, "payment_method": "Cash", "cash_source": "SHIFT",
            })
            assert payment.status_code == 201, payment.text
            shift = await client.get("/api/v1/cash-register/current")
            assert shift.status_code == 200 and shift.json()["expected_cash"] == 86
            supplier = await client.get(f"/api/v1/suppliers/{supplier_id}")
            assert supplier.status_code == 200 and Decimal(supplier.json()["balance"]) == 0, supplier.text

        async with AsyncSessionLocal() as db:
            balances = {row.warehouse_id: row.current_stock for row in (await db.execute(select(InventoryBalance).where(
                InventoryBalance.product_id == product_id,
            ))).scalars()}
            assert balances[first_warehouse] == 1 and balances[second_warehouse] == 2
            assert (await db.execute(select(InventoryCount).where(InventoryCount.product_id == product_id))).scalar_one().difference == 1
            assert len((await db.execute(select(CashAdjustment).where(CashAdjustment.user_id == user_id))).scalars().all()) == 1
    finally:
        app.dependency_overrides.pop(get_current_user, None)
